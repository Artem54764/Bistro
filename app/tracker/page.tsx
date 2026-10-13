'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { addrLine, buildText, whenLabel, DEFAULT_DAY, type Day, type Order } from '@/lib/order';
import { useDrivers, useLS } from '@/lib/hooks';
import { CLEAR_CONFIRM, clearBoard, driverColor, type Extra } from '@/lib/routes';

const pad = (x: number) => String(x).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ago = (t: number, now: number) => { const m = Math.max(0, Math.round((now - t) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const shortDate = (d: string) => d.slice(5).split('-').reverse().join('.');

type St = 'wyslane' | 'dostarczone' | undefined;
/** Одна картка трекера: замовлення або вулиця, додана вручну на карті (спільні дані з «Mapa»). */
type Item = {
  key: string; id: number; order?: Order; extra?: Extra;
  status: St; driver?: number; sentAt?: number; doneAt?: number; seq?: number; etaAt?: number; backAt?: number; pickup: boolean;
};

export default function TrackerPage() {
  const [orders, setOrders] = useLS<Order[]>('orders_v1', []);
  const [extras, setExtras] = useLS<Extra[]>('route_extra_v1', []);
  const [day] = useLS<Day>('day_v1', DEFAULT_DAY);
  const drv = useDrivers();
  const list = Array.from({ length: drv.count }, (_, i) => i + 1);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const T = todayStr();
  // ті самі, що на карті: сьогоднішні + недоставлені з попередніх днів (+ доставлені сьогодні)
  const items: Item[] = [
    ...orders
      .filter(o => !o.cleared && (o.date === T || o.status !== 'dostarczone' || (o.doneAt && dayOf(o.doneAt) === T)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.n - b.n)
      .map(o => ({ key: 'o' + o.id, id: o.id, order: o, status: o.status, driver: o.driver, sentAt: o.sentAt, doneAt: o.doneAt, seq: o.seq, etaAt: o.etaAt, backAt: o.backAt, pickup: o.odbior || !!o.prac })),
    ...extras
      .filter(e => e.stage !== 'done' || !e.doneAt || dayOf(e.doneAt) === T)
      .map(e => ({
        key: 'e' + e.id, id: e.id, extra: e, pickup: false,
        status: (e.stage === 'road' ? 'wyslane' : e.stage === 'done' ? 'dostarczone' : undefined) as St,
        driver: e.driver, sentAt: e.sentAt, doneAt: e.doneAt, seq: e.seq, etaAt: e.etaAt, backAt: e.backAt,
      })),
  ];
  const todo = items.filter(i => !i.status);
  const road = items.filter(i => i.status === 'wyslane');
  const done = items.filter(i => i.status === 'dostarczone').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

  /** Зміна стану: для замовлення — status, для ручної вулиці — stage. */
  function patch(it: Item, p: { status: St; driver?: number; sentAt?: number; doneAt?: number; seq?: number; etaAt?: number; backAt?: number }) {
    if (it.order) setOrders(os => os.map(o => (o.id === it.id ? { ...o, ...p } : o)));
    else setExtras(es => es.map(e => (e.id === it.id
      ? { ...e, stage: p.status === 'wyslane' ? 'road' : p.status === 'dostarczone' ? 'done' : undefined, driver: p.driver, sentAt: p.sentAt, doneAt: p.doneAt, seq: p.seq, etaAt: 'etaAt' in p ? p.etaAt : e.etaAt, backAt: 'backAt' in p ? p.backAt : e.backAt }
      : e)));
  }
  const noEta = { etaAt: undefined, backAt: undefined };
  const send = (it: Item, d: number) => patch(it, { status: 'wyslane', driver: d, sentAt: Date.now(), doneAt: undefined, seq: undefined, ...noEta });
  const deliver = (it: Item) => patch(it, { status: 'dostarczone', driver: it.driver, sentAt: it.sentAt ?? Date.now(), doneAt: Date.now(), seq: it.seq });
  const back = (it: Item) => (it.status === 'dostarczone' && it.driver && !it.pickup
    ? patch(it, { status: 'wyslane', driver: it.driver, sentAt: it.sentAt, doneAt: undefined, seq: it.seq })
    : patch(it, { status: undefined, driver: undefined, sentAt: undefined, doneAt: undefined, seq: undefined, ...noEta }));
  /** Уся група (траса) доставлена. */
  function groupDone(g: Item[]) {
    const t = Date.now(), ids = new Set(g.map(i => i.id));
    setOrders(os => os.map(o => (ids.has(o.id) && o.status === 'wyslane' ? { ...o, status: 'dostarczone', doneAt: t } : o)));
    setExtras(es => es.map(e => (ids.has(e.id) && e.stage === 'road' ? { ...e, stage: 'done', doneAt: t } : e)));
  }
  const setDriver = (it: Item, d: number) => patch(it, { status: it.status, driver: d, sentAt: it.sentAt, doneAt: it.doneAt, seq: it.seq });


  /** 🧹 Очищення трекера й карти (замовлення лишаються в історії). */
  function clear(mode: 'done' | 'day') {
    if (!confirm(CLEAR_CONFIRM[mode])) return;
    const r = clearBoard(mode, orders, extras);
    setOrders(r.orders); setExtras(r.extras);
  }

  /** Хто везе: вибір водія прямо в картці. */
  const DriverPick = ({ it }: { it: Item }) => (
    <select className="dSel" value={it.driver ?? ''} style={{ ['--c' as string]: driverColor(it.driver) }}
      onChange={e => setDriver(it, +e.target.value)} title="Zmień kierowcę">
      {!it.driver && <option value="">?</option>}
      {list.map(d => <option key={d} value={d}>{drv.label(d)}</option>)}
      {it.driver && it.driver > drv.count && <option value={it.driver}>{drv.label(it.driver)}</option>}
    </select>
  );

  const Card = ({ it, children }: { it: Item; children: ReactNode }) => {
    const o = it.order;
    return (
      <div className={'tCard' + (it.status === 'dostarczone' ? ' fin' : '') + (it.extra ? ' extra' : '')}
        title={o ? buildText(o, day) : it.extra?.adres}
        style={it.driver ? { ['--c' as string]: driverColor(it.driver) } : undefined}>
        <div className="tTop">
          {o
            ? <>{whenLabel(o) ? <b className="when">{whenLabel(o)}</b> : <span className="when none">bez godz.</span>}
                <span className="m">№{o.n} · {o.date === T ? o.time : shortDate(o.date)}</span></>
            : <span className="m">📍 dodane ręcznie na mapie</span>}
          {it.driver && !it.pickup && <span className="tDrv"><DriverPick it={it} /></span>}
        </div>
        <div className="tAdr">{o ? addrLine(o) || '—' : it.extra!.adres}</div>
        <div className="tMeta">
          {o && [o.plat, o.kwota && o.kwota + ' zł'].filter(Boolean).join(' · ')}
          {it.status === 'wyslane' && it.sentAt && <span className="m"> · w drodze {ago(it.sentAt, now)}</span>}
          {it.status === 'wyslane' && it.etaAt && <span className="m"> · przyjazd ~{clock(it.etaAt)}</span>}
          {it.status === 'dostarczone' && it.doneAt && <span className="m"> · {clock(it.doneAt)}</span>}
        </div>
        <div className="tAct">{children}</div>
      </div>
    );
  };

  // «W drodze» групами, як на карті: відправлена траса (той самий водій + час виїзду) — одна група в порядку об'їзду;
  // поодинокі відправлення з трекера — разом по водію
  const groups = (() => {
    const m = new Map<string, Item[]>();
    for (const it of road) {
      const k = it.seq != null ? `t|${it.driver ?? 0}|${it.sentAt ?? 0}` : `d|${it.driver ?? 0}`;
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()].map(([k, g]) => ({
      k, route: k.startsWith('t'), driver: g[0].driver ?? 0,
      at: Math.min(...g.map(i => i.sentAt ?? 0)),
      back: Math.max(0, ...g.map(i => i.backAt ?? 0)),
      items: g.sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || (a.sentAt ?? 0) - (b.sentAt ?? 0)),
    })).sort((a, b) => a.at - b.at);
  })();

  return (
    <main className="trackPage">
      {/* водії: кількість і підписи */}
      <section className="card drvPanel">
        <div className="hd">
          <h2>Kierowcy</h2>
          <button type="button" className="sm ghost danger" style={{ marginLeft: 'auto', marginRight: 10 }} onClick={() => clear('day')}>🌙 Koniec dnia</button>
          <div className="qtyBox">
            <button type="button" aria-label="Mniej kierowców" onClick={() => drv.setCount(drv.count - 1)}>−</button>
            <b className="stepVal">{drv.count}</b>
            <button type="button" aria-label="Więcej kierowców" onClick={() => drv.setCount(drv.count + 1)}>+</button>
          </div>
        </div>
        <div className="drvList">
          {list.map(d => (
            <label key={d} className="drvItem" style={{ ['--c' as string]: driverColor(d) }}>
              <span className="dDot" />
              <input value={drv.names[d - 1] ?? ''} placeholder={`Kierowca ${d} — wpisz imię`}
                onChange={e => drv.setName(d, e.target.value)} />
              <span className="m">{road.filter(i => i.driver === d).length} w drodze · {done.filter(i => i.driver === d).length} dost.
                {(() => { const b = Math.max(0, ...road.filter(i => i.driver === d).map(i => i.backAt ?? 0)); return b ? <b className={now > b ? ' w' : ''}> · wraca ~{clock(b)}</b> : null; })()}</span>
            </label>
          ))}
        </div>
      </section>

      <div className="tCols">
        <section className="tCol">
          <h2>Do wysłania <span className="cnt">{todo.length}</span></h2>
          {!todo.length && <p className="mute">Wszystko wysłane 👍</p>}
          {orders.some(o => o.date === T && o.cleared) && (
            <button type="button" className="sm restoreBtn"
              onClick={() => setOrders(os => os.map(o => (o.date === T && o.cleared ? { ...o, cleared: false } : o)))}>
              ↩ Przywróć wyczyszczone dzisiaj ({orders.filter(o => o.date === T && o.cleared).length})</button>
          )}
          {todo.map(it => (
            <Card key={it.key} it={it}>
              {it.pickup
                ? <button type="button" className="primary sm" onClick={() => deliver(it)}>✓ Wydane</button>
                : <>
                    <span className="m">Kto wiezie:</span>
                    {list.map(d => (
                      <button key={d} type="button" className="dBtn" style={{ ['--c' as string]: driverColor(d) }}
                        onClick={() => send(it, d)}>🚗 {drv.label(d)}</button>
                    ))}
                    <button type="button" className="sm ghost" title="Dostarczone od razu" onClick={() => deliver(it)}>✓</button>
                  </>}
            </Card>
          ))}
        </section>

        <section className="tCol">
          <h2>W drodze <span className="cnt">{road.length}</span></h2>
          {!road.length && <p className="mute">Nikt teraz nie jedzie</p>}
          {groups.map(g => (
            <div key={g.k} className="tGroup" style={{ ['--c' as string]: driverColor(g.driver) }}>
              <div className="tGroupHd">
                <span>
                  <span className="dDot" />{g.driver ? drv.label(g.driver) : 'Bez kierowcy'}
                  <span className="m"> · {g.route ? `trasa, wyjazd ${clock(g.at)}` : 'pojedyncze'} · {g.items.length} adr.</span>
                </span>
                {g.back > 0 && (
                  <span className={'backAt' + (now > g.back ? ' late' : '')}
                    title="Szacowany powrót do Trzcina Bistro (z trasy na mapie, bez korków)">
                    🏠 powrót ~{clock(g.back)} {now > g.back ? `(+${Math.round((now - g.back) / 60000)} min)` : `(za ${Math.max(1, Math.round((g.back - now) / 60000))} min)`}
                  </span>
                )}
                <button type="button" className="primary sm" onClick={() => groupDone(g.items)}>✓ Cała trasa dostarczona</button>
              </div>
              {g.items.map(it => (
                <Card key={it.key} it={it}>
                  {it.seq != null && <span className="seqNo">{it.seq}</span>}
                  <button type="button" className="primary sm" onClick={() => deliver(it)}>✓ Dostarczone</button>
                  <button type="button" className="sm ghost" title="Cofnij do „Do wysłania”" onClick={() => back(it)}>↩</button>
                </Card>
              ))}
            </div>
          ))}
        </section>

        <section className="tCol">
          <h2>Dostarczone <span className="cnt">{done.length}</span>
            {done.length > 0 && <button type="button" className="linkBtn" style={{ marginLeft: 'auto' }} onClick={() => clear('done')}>🧹 Wyczyść</button>}</h2>
          {done.map(it => (
            <Card key={it.key} it={it}>
              <button type="button" className="sm ghost" title="Cofnij" onClick={() => back(it)}>↩ Cofnij</button>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
