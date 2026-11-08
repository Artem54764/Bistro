'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BISTRO, DEFAULT_DAY, addrLine, blankForm, buildText, geoQuery, norm, splitAddr, suggestStreets, timeLabel, whenLabel, type Day, type Form, type Order } from '@/lib/order';
import { useDrivers, useGeocode, useLS, useStreets } from '@/lib/hooks';
import { officialStreet } from '@/lib/streetname';
import { CLEAR_CONFIRM, GROUP_COLORS, clearBoard, driverColor, groupNearby, type Extra } from '@/lib/routes';
import type { Focus, Pin } from '@/app/components/RouteMap';

const RouteMap = dynamic(() => import('@/app/components/RouteMap'), {
  ssr: false,
  loading: () => <div className="mapBox mapLoading">Ładuję mapę…</div>,
});

const pad = (x: number) => String(x).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shortDate = (d: string) => d.slice(5).split('-').reverse().join('.');
const DEPOT: [number, number] = [BISTRO.lat, BISTRO.lon];

/** Адреса до розвезення: замовлення або ручна вулиця. */
type Stop = { id: number; adres: string; lat: number; lon: number; order?: Order; na?: string };
type Picked = { lat: number; lon: number; adres: string | null; loading: boolean };

/** Пошук на карті: вулиці Кельце з підказками під час набору; Enter — додати в список. */
function MapSearch({ streets, onFound, onError }: {
  streets: string[]; onFound: (lat: number, lon: number, adres: string, na?: string) => void; onError: (m: string) => void;
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
    // година в кінці — замовлення на час: «Kościuszki 50 14:30» / «… 14.30»
    const tm = text.match(/\s+(\d{1,2})[:.](\d{2})$/);
    const na = tm && +tm[1] < 24 && +tm[2] < 60 ? `${tm[1].padStart(2, '0')}:${tm[2]}` : undefined;
    if (na) text = text.slice(0, tm!.index).trim();
    // повна офіційна назва вулиці — щоб точка стала біля будинку, а не посеред вулиці
    const sp = splitAddr(text);
    text = ((officialStreet(sp.q) ?? sp.q) + sp.rest).trim();
    setBusy(true); onError('');
    try {
      const r = await fetch('/api/geocode?q=' + encodeURIComponent(text + ', Kielce'));
      const j = r.ok ? await r.json() : null;
      if (j) { onFound(j.lat, j.lon, text, na); setV(''); } else onError(`Nie znaleziono: ${text}`);
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
        <input id="map-search" value={v} autoComplete="off" placeholder="🔍 Ulica i numer (+ godzina, np. Kościuszki 50 14:30) → Enter"
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
  // усі водії дня (з Trackera) + будь-хто вже вибраний
  const allDrivers = Array.from({ length: Math.max(drv.count, drv.names.length) }, (_, i) => i + 1).filter(d => d <= drv.count || drv.names[d - 1]?.trim());
  // що вважати «близько» (метри): близькі адреси — одна група, один колір
  const [nearM, setNearM] = useLS<number>('near_m_v1', 1000);
  // зняті галочки: ці вулиці не поїдуть при відправці групи (нові адреси одразу позначені)
  const [unchecked, setUnchecked] = useState<number[]>([]);
  const toggleStop = (id: number) => setUnchecked(u => (u.includes(id) ? u.filter(x => x !== id) : [...u, id]));
  const [extras, setExtras] = useLS<Extra[]>('route_extra_v1', []);
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
    ...todoOrders.filter(o => at(o)).map(o => ({ id: o.id, adres: addrLine(o, false), lat: at(o)!.lat, lon: at(o)!.lon, order: o })),
    ...todoExtras.map(e => ({ id: e.id, adres: e.adres, lat: e.lat, lon: e.lon, na: e.na })),
  ];
  const lost = todoOrders.filter(o => !at(o));
  // групи близьких адрес: A, B, C… — кожна свого кольору; адреса без сусідів — окремо, сіра
  const groups = useMemo(() => {
    let k = 0;
    return groupNearby(stops, nearM).map(g => {
      if (g.length < 2) return { name: 'Osobno', letter: '•', color: '#495057', stops: g };
      const i = k++;
      return { name: `Grupa ${String.fromCharCode(65 + i % 26)}`, letter: String.fromCharCode(65 + i % 26), color: GROUP_COLORS[i % GROUP_COLORS.length], stops: g };
    });
  }, [stops.map(x => `${x.id}:${x.lat},${x.lon}:${x.na ?? ''}`).join(), nearM]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupOf = new Map(groups.flatMap(g => g.stops.map(x => [x.id, g] as const)));

  /* ---------- дії зі списком ---------- */
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
  /** Вся група їде з цим водієм → «W drodze»; спільний sentAt тримає її разом у трекері, повернення рахує трекер. */
  function dispatch(ids: number[], d: number) {
    const now = Date.now();
    const info = (id: number) => ({ seq: ids.indexOf(id) + 1, sentAt: now, driver: d, etaAt: undefined, backAt: undefined });
    setOrders(os => os.map(o => (ids.includes(o.id) ? { ...o, status: 'wyslane', ...info(o.id) } : o)));
    setExtras(es => es.map(e => (ids.includes(e.id) ? { ...e, stage: 'road', ...info(e.id) } : e)));
  }
  /** 🧹 Очищення: доставлені або весь день. Точка старту (Trzcina Bistro) стала — її не чіпаємо. */
  function clear(mode: 'done' | 'day') {
    if (!confirm(CLEAR_CONFIRM[mode])) return;
    const r = clearBoard(mode, orders, extras);
    setOrders(r.orders); setExtras(r.extras);
    if (mode === 'day') setPicked(null);
  }
  /** Додати вулицю вручну (з пошуку чи з кліку по карті). */
  function addExtra(adres: string, lat: number, lon: number, na?: string) {
    setExtras(es => (es.some(e => !e.stage && norm(e.adres) === norm(adres))
      ? es.map(e => (!e.stage && norm(e.adres) === norm(adres) ? { ...e, lat, lon, on: true, ...(na ? { na } : {}) } : e))
      : [...es, { id: -Date.now(), adres, lat, lon, on: true, ...(na ? { na } : {}) }]));
    setPicked(null); setFindErr('');
    setFocus({ lat, lon, zoom: 16, t: Date.now() });
  }
  /** Година для вулиці, доданої вручну (порожньо — без часу). */
  const setExtraTime = (id: number, na: string) => setExtras(es => es.map(e => (e.id === id ? { ...e, na: na || undefined } : e)));
  function show(id: number) {
    const o = id > 0 ? list.find(x => x.id === id) : undefined, e = id < 0 ? extras.find(x => x.id === id) : undefined;
    const c = o ? at(o) : e ? { lat: e.lat, lon: e.lon } : null;
    if (c) { setPicked(null); setFocus({ lat: c.lat, lon: c.lon, zoom: 17, id, t: Date.now() }); }
    else if (o) setFindErr(`№${o.n} nie ma jeszcze miejsca na mapie — kliknij właściwe miejsce i wybierz „Przypisz”.`);
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
    // доставлені на карті не показуємо (лишаються в списку «✓ Dostarczone»)
    const fromOrders = list.filter(o => at(o) && o.status !== 'dostarczone').map(o => {
      const q = geoQuery(o)!, c = at(o)!, k = seen.get(q) ?? 0; seen.set(q, k + 1);
      const g = !o.status ? groupOf.get(o.id) : undefined;
      return {
        id: o.id, n: o.n, lat: c.lat + k * 0.00006, lon: c.lon + k * 0.00006, name: q.replace(/, Kielce$/, ''),
        color: g ? g.color : driverColor(o.driver),
        label: g ? g.letter : o.status === 'dostarczone' ? '✓' : '🚗',
        done: o.status === 'dostarczone', dim: o.status === 'wyslane', timed: o.status === 'dostarczone' ? '' : timeLabel(o),
        text: `№${o.n}${g ? ` · ${g.name}` : ` · ${o.status === 'wyslane' ? 'w drodze' : 'dostarczone'} (${drv.label(o.driver)})`}\n${buildText(o, day)}`,
      };
    });
    const fromExtras = extras.filter(e => e.stage !== 'done').map(e => {
      const g = !e.stage ? groupOf.get(e.id) : undefined;
      return {
        id: e.id, n: 0, lat: e.lat, lon: e.lon, name: e.adres,
        color: g ? g.color : driverColor(e.driver),
        label: g ? g.letter : e.stage === 'done' ? '✓' : '🚗',
        done: e.stage === 'done', dim: e.stage === 'road', timed: e.stage === 'done' ? '' : e.na ?? '',
        text: `${e.adres}\n(dodane ręcznie${g ? ` · ${g.name}` : e.stage === 'road' ? ' · w drodze' : ' · dostarczone'})`,
      };
    });
    return [...fromOrders, ...fromExtras];
  }, [list, extras, cache, groups, day, drv.names]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const Row = ({ id, adres, sub, chip, chipColor, actions, cls, check, onCheck, time }: {
    id: number; adres: string; sub: string; chip?: string; chipColor?: string; actions: React.ReactNode; cls?: string;
    check?: boolean; onCheck?: () => void; time?: string;
  }) => (
    <div className={'aRow' + (check === false ? ' off' : '') + (focus?.id === id ? ' cur' : '') + (cls ? ' ' + cls : '')}>
      {check !== undefined && <input type="checkbox" checked={check} onChange={onCheck} aria-label={`Jedzie: ${adres}`} />}
      <button type="button" className="aBody" onClick={() => show(id)} title="Pokaż na mapie">
        <span className="aMain"><span className="ad">{adres}</span><span className="m">{sub}</span></span>
        {time && <span className="aTime" title="Zamówienie na godzinę">⏰ {time}</span>}
        {chip && <span className="aNo" style={{ ['--c' as string]: chipColor }}>{chip}</span>}
      </button>
      {actions}
    </div>
  );
  /** Година для сортування (без «~»). */
  const timeOf = (x: Stop) => (x.order ? timeLabel(x.order).replace('~', '') : x.na ?? '');
  const sub = (o: Order) => [`№${o.n}`, o.date !== T && shortDate(o.date), whenLabel(o)].filter(Boolean).join(' · ');
  /** ↩ з дороги назад у «Do rozwiezienia» (знімає водія) */
  const backBtn = (id: number) => <button type="button" className="ic" title="Cofnij do „Do rozwiezienia”" onClick={() => undo(id)}>↩</button>;
  const doneBtn = (id: number) => <button type="button" className="ic ok" title="Dostarczone" onClick={() => deliver(id)}>✓</button>;

  return (
    <div className="mapPage">
      <aside className="mapSide">
        <section className="card">
          <div className="hd">
            <h2>Lista ulic <span className="cnt">{todoOrders.length + todoExtras.length}</span></h2>
            <button type="button" className="sm" onClick={() => document.getElementById('map-search')?.focus()}>+ Dodaj ręcznie</button>
          </div>

          <div className="nearRow">
            <span>Blisko to:</span>
            <div className="seg">
              {[500, 1000, 2000].map(m => (
                <button key={m} type="button" className={nearM === m ? 'on' : ''} onClick={() => setNearM(m)}>{m < 1000 ? `${m} m` : `${m / 1000} km`}</button>
              ))}
            </div>
          </div>
          <div className="timeLegend"><span className="aTime">⏰ 14:30</span> na godzinę · <span className="aTime">⏰ ~14:00</span> około · bez znaczka — bez godziny</div>
          {pending > 0 && <p className="hint">Szukam adresów na mapie: {pending}…</p>}

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
          {/* групи близьких адрес: кнопка з іменем відправляє всю групу цьому водієві */}
          {groups.map(g => {
            // їдуть лише позначені вулиці групи; решта лишається для іншого водія
            const on = g.stops.filter(x => !unchecked.includes(x.id)).map(x => x.id);
            return (
            <div key={g.stops[0].id} className="gCard" style={{ ['--c' as string]: g.color }}>
              <div className="gHd"><span className="gDot">{g.letter}</span><b>{g.name}</b><span className="m">{g.stops.length} adr.</span></div>
              <div className="activeList">
                {/* спершу на час (за годиною), потім без часу */}
                {[...g.stops].sort((a, b) => (timeOf(a) || '99').localeCompare(timeOf(b) || '99')).map(x => (x.order
                  ? <Row key={x.id} id={x.id} adres={x.adres} sub={sub(x.order)} check={on.includes(x.id)} onCheck={() => toggleStop(x.id)} actions={doneBtn(x.id)}
                      time={timeLabel(x.order)} />
                  : <Row key={x.id} id={x.id} adres={x.adres} sub="dodane ręcznie" cls="extra" check={on.includes(x.id)} onCheck={() => toggleStop(x.id)}
                      actions={<>
                        {/* година: заповнюється, коли вписано повністю (нецілу годину ігноруємо) */}
                        <input type="time" className={'xTime' + (x.na ? ' on' : '')} defaultValue={x.na ?? ''} title="Godzina, jeśli zamówienie na czas"
                          aria-label={`Godzina: ${x.adres}`} onChange={ev => setExtraTime(x.id, ev.target.value)} />
                        {doneBtn(x.id)}<button type="button" className="ic" title="Usuń z listy" onClick={() => setExtras(es => es.filter(e => e.id !== x.id))}>✕</button></>} />))}
              </div>
              <div className="gSend">
                <span className="m">Wyślij{g.stops.length > 1 ? ` (${on.length} z ${g.stops.length})` : ''}:</span>
                {allDrivers.map(d => (
                  <button key={d} type="button" className="dBtn" disabled={!on.length} style={{ ['--c' as string]: driverColor(d) }} onClick={() => { dispatch(on, d); setUnchecked(u => u.filter(id => !g.stops.some(x => x.id === id))); }}>🚗 {drv.label(d)}</button>
                ))}
              </div>
            </div>
            );
          })}
          {lost.length > 0 && (
            <div className="activeList">
              {lost.map(o => <Row key={o.id} id={o.id} adres={addrLine(o, false)} sub={sub(o) + ' · ? brak na mapie'} actions={doneBtn(o.id)} />)}
            </div>
          )}

          {noAddr.length > 0 && (
            <div className="activeList">
              {noAddr.map(o => (
                <div key={o.id} className="aRow off na" title="Bez dostawy">
                  <span className="aBody"><span className="aMain">
                    <span className="ad">{addrLine(o) || '—'}</span>
                    <span className="m">№{o.n} · {why(o)} — bez dostawy</span>
                  </span></span>
                </div>
              ))}
            </div>
          )}

          {(roadOrders.length > 0 || roadExtras.length > 0) && <>
            <div className="grpHd"><span>W drodze · {roadOrders.length + roadExtras.length}</span></div>
            <div className="activeList">
              {roadOrders.map(o => <Row key={o.id} id={o.id} adres={addrLine(o, false)} sub={sub(o)} time={timeLabel(o)}
                chip={drv.label(o.driver)} chipColor={driverColor(o.driver)} actions={<>{doneBtn(o.id)}{backBtn(o.id)}</>} />)}
              {roadExtras.map(e => <Row key={e.id} id={e.id} adres={e.adres} sub="dodane ręcznie" cls="extra" time={e.na}
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

          <div className="drvToday">
            <span>Kierowcy dziś:</span>
            {allDrivers.map(d => <span key={d} className="dTag" style={{ ['--c' as string]: driverColor(d) }}>{drv.label(d)}</span>)}
            <a href="/tracker" className="linkBtn">zmień w Trackerze</a>
          </div>
          <div className="clearRow">
            <button type="button" className="sm ghost" onClick={() => clear('done')}>🧹 Wyczyść dostarczone</button>
            <button type="button" className="sm ghost danger" onClick={() => clear('day')}>🌙 Koniec dnia</button>
          </div>
        </section>

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
      </aside>

      <div className="mapWrap">
        {/* пошук поверх карти (окремий шар — кліки не потрапляють у карту) */}
        <div className="mapSearch">
          <MapSearch streets={streets} onError={setFindErr} onFound={(lat, lon, adres, na) => addExtra(adres, lat, lon, na)} />
          {findErr && <div className="mapSearchErr">{findErr}</div>}
        </div>
        <RouteMap pins={pins} depot={DEPOT}
          picked={picked ? [picked.lat, picked.lon] : null} pickedContent={pickedContent} onPick={pick} focus={focus} />
      </div>
    </div>
  );
}
