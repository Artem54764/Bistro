'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BISTRO, DEFAULT_DAY, addrLine, blankForm, buildText, geoQuery, norm, splitAddr, suggestStreets, whenLabel, type Day, type Form, type Order } from '@/lib/order';
import { useDrivers, useGeocode, useLS, useStreets } from '@/lib/hooks';
import { CLEAR_CONFIRM, clearBoard, driverColor, planRoutes, stopTime, type Extra } from '@/lib/routes';
import type { Focus, Pin } from '@/app/components/RouteMap';

const RouteMap = dynamic(() => import('@/app/components/RouteMap'), {
  ssr: false,
  loading: () => <div className="mapBox mapLoading">Ładuję mapę…</div>,
});

const pad = (x: number) => String(x).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mins = (s: number) => Math.round(s / 60);
const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shortDate = (d: string) => d.slice(5).split('-').reverse().join('.');
const DEPOT: [number, number] = [BISTRO.lat, BISTRO.lon];


/** Точка маршруту: замовлення або ручна вулиця. */
type Stop = { id: number; adres: string; lat: number; lon: number; order?: Order };
/** Розрахунок трас. stops — знімок точок (щоб відправлена траса лишалась видимою); sent — які траси вже поїхали. */
type Result = {
  count: number; start: number; stops: Stop[];
  drivers: { ids: number[]; eta: number[]; time: number }[];
  lines: { k: number; points: [number, number][] }[];
  sent: Record<number, { d: number; at: number }>;
};
type Picked = { lat: number; lon: number; adres: string | null; loading: boolean };

/** Пошук на карті: вулиці Кельце з підказками під час набору; Enter — додати в список. */
function MapSearch({ streets, onFound, onError }: {
  streets: string[]; onFound: (lat: number, lon: number, adres: string) => void; onError: (m: string) => void;
}) {
  const [v, setV] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const { q, rest } = splitAddr(v);
  const sug = suggestStreets(q, streets, 8).filter(s => norm(s) !== norm(q));
  const show = open && sug.length > 0;
  const cur = Math.min(hi, sug.length - 1);
  async function go(text: string) {
    text = text.trim(); if (!text) return;
    setBusy(true); onError('');
    try {
      const r = await fetch('/api/geocode?q=' + encodeURIComponent(text + ', Kielce'));
      const j = r.ok ? await r.json() : null;
      if (j) { onFound(j.lat, j.lon, text); setV(''); } else onError(`Nie znaleziono: ${text}`);
    } catch { onError('Brak połączenia'); }
    setBusy(false);
  }
  // вулиця без номера — лишаємось дописати номер; з номером — одразу в список
  const choose = (s: string) => {
    const t = (s + rest).trim(); setOpen(false);
    if (/\d/.test(rest)) go(t); else setV(t + ' ');
  };
  return (
    <div className="street">
      <div className="searchRow">
        <input id="map-search" value={v} autoComplete="off" placeholder="🔍 Wpisz ulicę i numer → Enter dodaje do listy"
          onChange={e => { setV(e.target.value); setOpen(true); setHi(0); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (show && e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(cur + 1, sug.length - 1)); }
            else if (show && e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(cur - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (show) choose(sug[cur]); else { setOpen(false); go(v); } }
            else if (e.key === 'Escape') setOpen(false);
          }} />
        <button type="button" className="primary" disabled={busy || !v.trim()} onClick={() => go(v)}>{busy ? '…' : '+ Dodaj'}</button>
      </div>
      {show && (
        <div className="sug">{sug.map((s, i) => (
          <button key={s} type="button" className={i === cur ? 'hi' : ''} onMouseDown={e => { e.preventDefault(); choose(s); }}>{s}{rest}</button>
        ))}</div>
      )}
    </div>
  );
}

export default function MapaPage() {
  const router = useRouter();
  const [orders, setOrders] = useLS<Order[]>('orders_v1', []);
  const [day] = useLS<Day>('day_v2', DEFAULT_DAY);
  const [, setDraft] = useLS<Form>('draft_v1', blankForm());
  const drv = useDrivers();
  // на скільки трас ділити адреси — окремо від списку водіїв (водія на трасу вибираєте з усіх)
  const [routes, setRoutes] = useLS<number>('routes_count_v1', 2);
  const nRoutes = Math.min(8, Math.max(1, routes));
  // усі водії дня (з Trackera) + будь-хто вже вибраний
  const allDrivers = Array.from({ length: Math.max(drv.count, drv.names.length) }, (_, i) => i + 1).filter(d => d <= drv.count || drv.names[d - 1]?.trim());
  // який водій їде якою трасою (індекс траси → номер водія); вибирається після розрахунку
  const [assign, setAssign] = useState<number[]>([]);
  // галочки «в трасу»: якщо не чіпали — сьогоднішні вибрані, старіші ні
  const [sel, setSel] = useLS<Record<string, boolean>>('route_sel_v1', {});
  const [extras, setExtras] = useLS<Extra[]>('route_extra_v1', []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [assignTo, setAssignTo] = useState<number | ''>('');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [findErr, setFindErr] = useState('');
  const streets = useStreets();

  const T = todayStr();
  // у списку: усі сьогоднішні + недоставлені з попередніх днів
  const list = useMemo(() => orders
    .filter(o => geoQuery(o) && !o.cleared && (o.date === T || o.status !== 'dostarczone' || (!!o.doneAt && dayOf(o.doneAt) === T)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.n - b.n), [orders, T]);
  const queries = useMemo(() => [...new Set(list.map(geoQuery) as string[])], [list]);
  const { cache, setCoord, pending, retry } = useGeocode(queries);
  const at = (o: Order) => cache[geoQuery(o)!] ?? null;

  const isOn = (o: Order) => sel[o.id] ?? o.date === T;
  const todoOrders = list.filter(o => !o.status);
  const roadOrders = list.filter(o => o.status === 'wyslane');
  const doneOrders = list.filter(o => o.status === 'dostarczone').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const todoExtras = extras.filter(e => !e.stage), roadExtras = extras.filter(e => e.stage === 'road'),
    doneExtras = extras.filter(e => e.stage === 'done' && (!e.doneAt || dayOf(e.doneAt) === T));
  const missing = list.filter(o => geoQuery(o)! in cache && !at(o));
  const noAddr = orders.filter(o => o.date === T && !o.cleared && !geoQuery(o));
  // сьогоднішні, сховані очищенням (🧹 / 🌙) — можна повернути
  const hiddenToday = orders.filter(o => o.date === T && o.cleared);
  const restore = () => setOrders(os => os.map(o => (o.date === T && o.cleared ? { ...o, cleared: false } : o)));
  const why = (o: Order) => (o.odbior ? 'odbiór osobisty' : o.prac ? 'pracownicy' : 'brak adresu');

  const stops: Stop[] = [
    ...todoOrders.filter(o => isOn(o) && at(o)).map(o => ({ id: o.id, adres: addrLine(o, false), lat: at(o)!.lat, lon: at(o)!.lon, order: o })),
    ...todoExtras.filter(e => e.on).map(e => ({ id: e.id, adres: e.adres, lat: e.lat, lon: e.lon })),
  ];
  const stopById = new Map(stops.map(x => [x.id, x]));

  const who = (k: number) => assign[k] ?? k + 1;          // водій траси k
  const routeColor = (k: number) => driverColor(who(k));
  // застаріло, лише якщо додали нову точку, зняли галочку або змінили к-сть водіїв;
  // відправлені / доставлені точки розрахунок не ламають — інші траси лишаються
  const moved = (id: number) => (id > 0 ? !!orders.find(o => o.id === id)?.status : !!extras.find(e => e.id === id)?.stage);
  const stale = !!res && (res.count !== nRoutes
    || stops.some(x => !res.stops.some(y => y.id === x.id))
    || res.stops.some(x => !stopById.has(x.id) && !moved(x.id)));
  const planned = new Map<number, { k: number; seq: number }>();
  if (res && !stale) res.drivers.forEach((d, k) => d.ids.forEach((id, i) => planned.set(id, { k, seq: i + 1 })));

  /* ---------- дії зі списком ---------- */
  const toggleOrder = (o: Order) => setSel(s => ({ ...s, [o.id]: !isOn(o) }));
  const allTodo = [...todoOrders.map(isOn), ...todoExtras.map(e => e.on)];
  const allOn = allTodo.length > 0 && allTodo.every(Boolean);
  function setAll(on: boolean) {
    setSel(s => ({ ...s, ...Object.fromEntries(todoOrders.map(o => [o.id, on])) }));
    setExtras(es => es.map(e => (e.stage ? e : { ...e, on })));
  }
  const updOrder = (id: number, f: (o: Order) => Order) => setOrders(os => os.map(o => (o.id === id ? f(o) : o)));
  const updExtra = (id: number, f: (e: Extra) => Extra) => setExtras(es => es.map(e => (e.id === id ? f(e) : e)));
  /** ✓ доставлено */
  function deliver(id: number) {
    if (id < 0) updExtra(id, e => ({ ...e, stage: 'done', doneAt: Date.now() }));
    else updOrder(id, o => ({ ...o, status: 'dostarczone', doneAt: Date.now(), sentAt: o.sentAt ?? Date.now() }));
  }
  /** ↩ повернути назад */
  function undo(id: number) {
    if (id < 0) updExtra(id, e => (e.stage === 'done' && e.driver
      ? { ...e, stage: 'road', doneAt: undefined }
      : { ...e, stage: undefined, driver: undefined, sentAt: undefined, doneAt: undefined }));
    else updOrder(id, o => (o.status === 'dostarczone' && o.driver
      ? { ...o, status: 'wyslane', doneAt: undefined }
      : { ...o, status: undefined, driver: undefined, sentAt: undefined, doneAt: undefined }));
  }
  /** Відправити водія: усі його адреси → «W drodze». */
  function dispatch(k: number, ids: number[]) {
    const now = Date.now(), d = who(k), r = res?.drivers[k];
    // seq — порядок об'їзду; спільний sentAt тримає трасу разом у трекері;
    // etaAt / backAt — час приїзду й повернення, рахуємо від моменту відправки
    const info = (id: number) => {
      const i = ids.indexOf(id);
      return { seq: i + 1, sentAt: now, driver: d, etaAt: r ? now + r.eta[i] * 1000 : undefined, backAt: r ? now + r.time * 1000 : undefined };
    };
    setOrders(os => os.map(o => (ids.includes(o.id) ? { ...o, status: 'wyslane', ...info(o.id) } : o)));
    setExtras(es => es.map(e => (ids.includes(e.id) ? { ...e, stage: 'road', ...info(e.id) } : e)));
    setRes(r => (r ? { ...r, sent: { ...r.sent, [k]: { d, at: now } } } : r));   // траса лишається видимою як «wysłana»
  }
  /** Вибрати водія для траси k (інші траси не змінюються). */
  function chooseDriver(k: number, d: number) {
    setAssign(a => { const x = res ? res.drivers.map((_, i) => a[i] ?? i + 1) : [...a]; x[k] = d; return x; });
  }
  /** 🧹 Очищення: доставлені або весь день. Точка старту (Trzcina Bistro) стала — її не чіпаємо. */
  function clear(mode: 'done' | 'day') {
    if (!confirm(CLEAR_CONFIRM[mode])) return;
    const r = clearBoard(mode, orders, extras);
    setOrders(r.orders); setExtras(r.extras);
    if (mode === 'day') { setSel({}); setRes(null); setPicked(null); }
  }
  /** Додати вулицю вручну (з пошуку чи з кліку по карті). */
  function addExtra(adres: string, lat: number, lon: number) {
    setExtras(es => (es.some(e => !e.stage && norm(e.adres) === norm(adres))
      ? es.map(e => (!e.stage && norm(e.adres) === norm(adres) ? { ...e, lat, lon, on: true } : e))
      : [...es, { id: -Date.now(), adres, lat, lon, on: true }]));
    setPicked(null); setFindErr('');
    setFocus({ lat, lon, zoom: 16, t: Date.now() });
  }
  function show(id: number) {
    const o = id > 0 ? list.find(x => x.id === id) : undefined, e = id < 0 ? extras.find(x => x.id === id) : undefined;
    const c = o ? at(o) : e ? { lat: e.lat, lon: e.lon } : null;
    if (c) { setPicked(null); setFocus({ lat: c.lat, lon: c.lon, zoom: 17, id, t: Date.now() }); }
    else if (o) setFindErr(`№${o.n} nie ma jeszcze miejsca na mapie — kliknij właściwe miejsce i wybierz „Przypisz”.`);
  }

  /* ---------- маршрут ---------- */
  async function compute() {
    setErr('');
    if (!stops.length) { setErr('Zaznacz albo dodaj ulice do rozwiezienia'); return; }
    setBusy(true);
    try {
      const pts = [DEPOT, ...stops.map(x => [x.lat, x.lon])];
      const coords = (idx: number[]) => idx.map(i => `${pts[i][1].toFixed(6)},${pts[i][0].toFixed(6)}`).join(';');
      const tr = await fetch('/api/osrm?service=table&coords=' + coords(pts.map((_, i) => i)));
      const tj = await tr.json();
      if (!tr.ok) throw new Error(tj.error);
      const D: number[][] = tj.durations.map((row: (number | null)[]) => row.map(v => v ?? 36000));
      const plan = planRoutes(D, nRoutes, [0, ...stops.map(x => stopTime(x.order))]);
      const lines: Result['lines'] = [];
      for (let k = 0; k < plan.routes.length; k++) {
        const r = plan.routes[k]; if (!r.length) continue;
        const rr = await fetch('/api/osrm?service=route&coords=' + coords([0, ...r, 0]));
        const rj = await rr.json();
        if (rr.ok) lines.push({ k, points: rj.geometry });
      }
      setAssign(plan.routes.map((_, k) => k + 1));
      setRes({
        count: nRoutes, start: Date.now(), lines, stops, sent: {},
        drivers: plan.routes.map((r, k) => ({ ids: r.map(i => stops[i - 1].id), eta: plan.eta[k], time: plan.times[k] })),
      });
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : 'Nie udało się wyznaczyć tras');
    }
    setBusy(false);
  }

  /* ---------- клік по карті ---------- */
  async function pick(lat: number, lon: number) {
    setPicked({ lat, lon, adres: null, loading: true });
    setAssignTo(missing[0]?.id ?? '');
    try {
      const r = await fetch(`/api/geocode?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
      const j = r.ok ? await r.json() : null;
      setPicked(p => (p && p.lat === lat ? { ...p, adres: j?.adres ?? null, loading: false } : p));
    } catch {
      setPicked(p => (p && p.lat === lat ? { ...p, loading: false } : p));
    }
  }
  function newOrderHere() {
    if (!picked?.adres) return;
    // пишемо в чернетку одразу (до переходу), решту вже вписаного не чіпаємо
    let f: Form = blankForm();
    try { const raw = localStorage.getItem('draft_v1'); if (raw) f = JSON.parse(raw); } catch {}
    const next = { ...f, odbior: false, prac: false, adres: picked.adres };
    try { localStorage.setItem('draft_v1', JSON.stringify(next)); } catch {}
    setDraft(next);
    router.push('/');
  }
  function assignHere() {
    const o = list.find(x => x.id === assignTo);
    if (!o || !picked) return;
    setCoord(geoQuery(o)!, { lat: picked.lat, lon: picked.lon });
    setPicked(null);
  }

  /* ---------- піни ---------- */
  const pins: Pin[] = useMemo(() => {
    const seen = new Map<string, number>();
    const fromOrders = list.filter(o => at(o)).map(o => {
      const q = geoQuery(o)!, c = at(o)!, k = seen.get(q) ?? 0; seen.set(q, k + 1);
      const pl = !o.status ? planned.get(o.id) : undefined;
      return {
        id: o.id, n: o.n, lat: c.lat + k * 0.00006, lon: c.lon + k * 0.00006, name: q.replace(/, Kielce$/, ''),
        color: pl ? routeColor(pl.k) : o.status ? driverColor(o.driver) : '#495057',
        label: pl ? String(pl.seq) : o.status === 'dostarczone' ? '✓' : '№' + o.n,
        done: o.status === 'dostarczone' || (!o.status && !isOn(o)),
        text: `№${o.n}${o.status ? ` · ${o.status === 'wyslane' ? 'w drodze' : 'dostarczone'} (${drv.label(o.driver)})` : ''}${pl ? ` · ${drv.label(who(pl.k))}, przystanek ${pl.seq}` : ''}\n${buildText(o, day)}`,
      };
    });
    const fromExtras = extras.map(e => {
      const pl = !e.stage ? planned.get(e.id) : undefined;
      return {
        id: e.id, n: 0, lat: e.lat, lon: e.lon, name: e.adres,
        color: pl ? routeColor(pl.k) : e.stage ? driverColor(e.driver) : '#868e96',
        label: pl ? String(pl.seq) : e.stage === 'done' ? '✓' : '+',
        done: e.stage === 'done' || (!e.stage && !e.on),
        text: `${e.adres}\n(dodane ręcznie${e.stage === 'road' ? ' · w drodze' : e.stage === 'done' ? ' · dostarczone' : ''})`,
      };
    });
    return [...fromOrders, ...fromExtras];
  }, [list, extras, cache, res, stale, sel, day, drv.names, assign]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickedContent = picked && (
    <div className="pickBox">
      <div className="pickAdr">{picked.loading ? 'Szukam adresu…' : picked.adres ?? 'Brak adresu w tym miejscu'}</div>
      {picked.adres && <button type="button" className="primary sm" onClick={() => addExtra(picked.adres!, picked.lat, picked.lon)}>➕ Dodaj do listy</button>}
      {picked.adres && <button type="button" className="sm" onClick={newOrderHere}>Nowe zamówienie z tym adresem</button>}
      {list.length > 0 && (
        <div className="pickAssign">
          <span className="mute">Przypisz to miejsce do:</span>
          <select value={assignTo} onChange={e => setAssignTo(e.target.value ? +e.target.value : '')}>
            <option value="">— wybierz zamówienie —</option>
            {list.map(o => <option key={o.id} value={o.id}>№{o.n} · {addrLine(o, false)}{missing.includes(o) ? ' (nie znaleziono)' : ''}</option>)}
          </select>
          <button type="button" className="sm" disabled={assignTo === ''} onClick={assignHere}>📍 Przypisz</button>
        </div>
      )}
    </div>
  );

  /* ---------- рядок списку ---------- */
  const Row = ({ id, adres, sub, check, onCheck, chip, chipColor, actions, cls }: {
    id: number; adres: string; sub: string; check?: boolean; onCheck?: () => void;
    chip?: string; chipColor?: string; actions: React.ReactNode; cls?: string;
  }) => (
    <div className={'aRow' + (check !== undefined && check ? ' sel' : '') + (check === false ? ' off' : '') + (focus?.id === id ? ' cur' : '') + (cls ? ' ' + cls : '')}>
      {check !== undefined && <input type="checkbox" checked={check} onChange={onCheck} aria-label={`Do trasy: ${adres}`} />}
      <button type="button" className="aBody" onClick={() => show(id)} title="Pokaż na mapie">
        <span className="aMain"><span className="ad">{adres}</span><span className="m">{sub}</span></span>
        {chip && <span className="aNo" style={{ ['--c' as string]: chipColor }}>{chip}</span>}
      </button>
      {actions}
    </div>
  );
  const sub = (o: Order) => [`№${o.n}`, o.date !== T && shortDate(o.date), whenLabel(o)].filter(Boolean).join(' · ');
  /** ↩ з дороги назад у «Do rozwiezienia» (знімає водія) */
  const backBtn = (id: number) => <button type="button" className="ic" title="Cofnij do „Do rozwiezienia”" onClick={() => undo(id)}>↩</button>;
  const doneBtn = (id: number) => <button type="button" className="ic ok" title="Dostarczone" onClick={() => deliver(id)}>✓</button>;

  return (
    <div className="mapPage">
      <aside className="mapSide">
        <section className="card">
          <div className="hd">
            <h2>Lista ulic <span className="cnt">{stops.length}</span></h2>
            <button type="button" className="sm" onClick={() => document.getElementById('map-search')?.focus()}>+ Dodaj ręcznie</button>
          </div>

          <div className="grpHd">
            <span>Do rozwiezienia · {todoOrders.length + todoExtras.length}</span>
            {allTodo.length > 0 && <button type="button" className="linkBtn" onClick={() => setAll(!allOn)}>{allOn ? 'odznacz wszystkie' : 'zaznacz wszystkie'}</button>}
          </div>
          {!todoOrders.length && !todoExtras.length && (
            <p className="mute">
              {orders.some(o => o.date === T)
                ? `Brak zamówień z adresem do rozwiezienia${hiddenToday.length ? ` (${hiddenToday.length} ukryte po czyszczeniu)` : ''}.`
                : 'Dziś nie ma jeszcze zamówień.'} Możesz też wpisać ulicę w wyszukiwarce na mapie.
            </p>
          )}
          {hiddenToday.length > 0 && (
            <button type="button" className="sm restoreBtn" onClick={restore}>↩ Przywróć wyczyszczone dzisiaj ({hiddenToday.length})</button>
          )}
          <div className="activeList">
            {todoOrders.map(o => {
              const pl = planned.get(o.id);
              return <Row key={o.id} id={o.id} adres={addrLine(o, false)} sub={sub(o) + (at(o) ? '' : ' · ? brak na mapie')}
                check={isOn(o)} onCheck={() => toggleOrder(o)}
                chip={pl ? `${drv.label(who(pl.k))}·${pl.seq}` : undefined} chipColor={pl ? routeColor(pl.k) : undefined}
                actions={doneBtn(o.id)} />;
            })}
            {todoExtras.map(e => {
              const pl = planned.get(e.id);
              return <Row key={e.id} id={e.id} adres={e.adres} sub="dodane ręcznie" cls="extra"
                check={e.on} onCheck={() => updExtra(e.id, x => ({ ...x, on: !x.on }))}
                chip={pl ? `${drv.label(who(pl.k))}·${pl.seq}` : undefined} chipColor={pl ? routeColor(pl.k) : undefined}
                actions={<>{doneBtn(e.id)}<button type="button" className="ic" title="Usuń z listy" onClick={() => setExtras(es => es.filter(x => x.id !== e.id))}>✕</button></>} />;
            })}
          </div>

          {noAddr.length > 0 && (
            <div className="activeList">
              {noAddr.map(o => (
                <div key={o.id} className="aRow off na" title="Nie trafia do trasy">
                  <input type="checkbox" disabled checked={false} aria-label="Bez trasy" />
                  <span className="aBody"><span className="aMain">
                    <span className="ad">{addrLine(o) || '—'}</span>
                    <span className="m">№{o.n} · {why(o)} — nie trafia do trasy</span>
                  </span></span>
                </div>
              ))}
            </div>
          )}

          {(roadOrders.length > 0 || roadExtras.length > 0) && <>
            <div className="grpHd"><span>W drodze · {roadOrders.length + roadExtras.length}</span></div>
            <div className="activeList">
              {roadOrders.map(o => <Row key={o.id} id={o.id} adres={addrLine(o, false)} sub={sub(o)}
                chip={drv.label(o.driver)} chipColor={driverColor(o.driver)} actions={<>{doneBtn(o.id)}{backBtn(o.id)}</>} />)}
              {roadExtras.map(e => <Row key={e.id} id={e.id} adres={e.adres} sub="dodane ręcznie" cls="extra"
                chip={drv.label(e.driver)} chipColor={driverColor(e.driver)} actions={<>{doneBtn(e.id)}{backBtn(e.id)}</>} />)}
            </div>
          </>}

          {(doneOrders.length > 0 || doneExtras.length > 0) && (
            <details className="doneGrp">
              <summary className="grpHd"><span>✓ Dostarczone · {doneOrders.length + doneExtras.length}</span>
                <button type="button" className="linkBtn" onClick={e => { e.preventDefault(); clear('done'); }}>🧹 wyczyść</button></summary>
              <div className="activeList">
                {doneOrders.map(o => <Row key={o.id} id={o.id} adres={addrLine(o, false)} sub={sub(o)} cls="fin"
                  chip={o.driver ? drv.label(o.driver) : undefined} chipColor={driverColor(o.driver)}
                  actions={<button type="button" className="ic" title="Cofnij" onClick={() => undo(o.id)}>↩</button>} />)}
                {doneExtras.map(e => <Row key={e.id} id={e.id} adres={e.adres} sub="dodane ręcznie" cls="extra fin"
                  actions={<>
                    <button type="button" className="ic" title="Cofnij" onClick={() => undo(e.id)}>↩</button>
                    <button type="button" className="ic" title="Usuń z listy" onClick={() => setExtras(es => es.filter(x => x.id !== e.id))}>✕</button>
                  </>} />)}
              </div>
            </details>
          )}

          <div className="routeBox">
            <div className="stepRow">
              <span>Ile tras <span className="mute">(na ile części podzielić)</span></span>
              <div className="qtyBox">
                <button type="button" onClick={() => setRoutes(nRoutes - 1)}>−</button>
                <b className="stepVal">{nRoutes}</b>
                <button type="button" onClick={() => setRoutes(Math.min(8, nRoutes + 1))}>+</button>
              </div>
            </div>
            <div className="drvToday">
              <span>Kierowcy dziś:</span>
              {allDrivers.map(d => (
                <span key={d} className="dTag" style={{ ['--c' as string]: driverColor(d) }}>{drv.label(d)}</span>
              ))}
              <a href="/tracker" className="linkBtn">zmień w Trackerze</a>
            </div>
            <p className="hint">Czas na adresie liczy się sam: dom ~2 min, mieszkanie ~3 min, wyższe piętra i szpital / biuro dłużej.</p>
            <button type="button" className="primary printBtn" disabled={busy || !!pending || !stops.length} onClick={compute}>
              {busy ? 'Liczę trasy…' : pending ? `Szukam adresów (${pending})…` : stale ? `🔄 Przelicz trasy (${stops.length})` : `🚗 Wyznacz najlepszą trasę (${stops.length})`}
            </button>
            <div className="depotNow">🏠 Start i powrót: Trzcina Bistro, {BISTRO.adres}</div>
            {err && <p className="w">{err}</p>}
            {stale && <p className="hint">Lista lub ustawienia się zmieniły — przelicz trasy.</p>}
          </div>
          <div className="clearRow">
            <button type="button" className="sm ghost" onClick={() => clear('done')}>🧹 Wyczyść dostarczone</button>
            <button type="button" className="sm ghost danger" onClick={() => clear('day')}>🌙 Koniec dnia</button>
          </div>
        </section>

        {res && !stale && res.drivers.map((d, k) => d.ids.length > 0 && (
          <section key={k} className={'card driver' + (res.sent[k] ? ' sentCard' : '')} style={{ ['--c' as string]: routeColor(k) }}>
            <div className="hd">
              <h2><span className="dDot" />Trasa {k + 1}</h2>
              <span className="mute">{d.ids.length} adr. · {mins(d.time)} min · powrót ~{clock(new Date(res.start + d.time * 1000))}</span>
            </div>
            {res.sent[k] ? (
              <div className="sentBadge">✓ Wysłany: {drv.label(res.sent[k].d)} · {clock(new Date(res.sent[k].at))}</div>
            ) : <div className="whoRow">
              <span>Kto jedzie:</span>
              {[...new Set([...allDrivers, who(k)])].sort((a, b) => a - b).map(dn => (
                <button key={dn} type="button" className={'dBtn' + (who(k) === dn ? ' on' : '')} style={{ ['--c' as string]: driverColor(dn) }}
                  onClick={() => chooseDriver(k, dn)}>{drv.label(dn)}</button>
              ))}
            </div>}
            <ol className="stops">
              {d.ids.map((id, i) => {
                const st = res.stops.find(x => x.id === id); if (!st) return null;
                const o = st.order, t = new Date(res.start + d.eta[i] * 1000);
                const late = o?.na && clock(t) > o.na;
                return (
                  <li key={id}>
                    <span className="sNo">{i + 1}</span>
                    <div className="sMain">
                      <div className="ad">{st.adres}</div>
                      <div className="m">{o ? sub(o) : 'dodane ręcznie'}</div>
                    </div>
                    <span className="sSvc" title="Czas na adresie (liczony automatycznie)">~{mins(stopTime(o))} min</span>
                    <span className={'sEta' + (late ? ' w' : '')} title={late ? 'Spóźnienie względem zamówionej godziny' : 'Szacowany przyjazd'}>
                      {late ? '⚠ ' : ''}{clock(t)}</span>
                  </li>
                );
              })}
            </ol>
            {!res.sent[k] && <button type="button" className="primary sendBtn" onClick={() => dispatch(k, d.ids)}>🚗 Wyślij: {drv.label(who(k))}</button>}
          </section>
        ))}

        {missing.length > 0 && (
          <section className="card">
            {missing.length > 0 && <>
              <h2 className="w">Nie znaleziono na mapie</h2>
              <p className="hint">Kliknij na mapie właściwe miejsce i wybierz „Przypisz”.</p>
              {missing.map(o => <div key={o.id} className="o"><span className="m">№{o.n}</span><span className="ad">{addrLine(o, false)}</span></div>)}
              <button type="button" className="sm" onClick={retry}>Szukaj ponownie</button>
            </>}
          </section>
        )}
        <p className="hint">Trasy: OpenStreetMap + OSRM, czas przejazdu bez korków — orientacyjny.</p>
      </aside>

      <div className="mapWrap">
        {/* пошук поверх карти (окремий шар — кліки не потрапляють у карту) */}
        <div className="mapSearch">
          <MapSearch streets={streets} onError={setFindErr} onFound={(lat, lon, adres) => addExtra(adres, lat, lon)} />
          {findErr && <div className="mapSearchErr">{findErr}</div>}
        </div>
        <RouteMap pins={pins} lines={res && !stale ? res.lines.map(l => ({ color: routeColor(l.k), points: l.points })) : []} depot={DEPOT}
          picked={picked ? [picked.lat, picked.lon] : null} pickedContent={pickedContent} onPick={pick} focus={focus} />
      </div>
    </div>
  );
}
