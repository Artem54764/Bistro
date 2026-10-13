'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  MENU, SIDES, DEFAULT_DAY, DEFAULT_CAT_ADDS, blankForm, isEmpty, isDaily, isParen, norm, addrLine, fmtItem,
  buildText, warns, splitAddr, onlyDigits, fmtKwota, cleanTel, suggestStreets, catOf, whenLabel, topWhen, uwagiLine, type CatAdds, type Day, type Form, type Item, type Menu, type Order,
} from '@/lib/order';
import { useDrivers, useLS, useStreets } from '@/lib/hooks';

/** Імена в кінці страви — лише для «Pracownicy» (у чернетці лишаються, якщо випадково перемкнули режим). */
const forPrint = (f: Form): Form => (f.prac ? f : { ...f, items: f.items.map(({ kto, ...x }) => x) });

const pad = (x: number) => String(x).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowT = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const PAY = ['ONLINE', 'GOTÓWKA', 'TERMINAL', 'ZAPŁACONE'];
const MODES = [
  { l: 'Dostawa', odbior: false, prac: false },
  { l: 'Odbiór osobisty', odbior: true, prac: false },
  { l: 'Pracownicy', odbior: false, prac: true },
] as const;

/* ---------- Enter → наступне поле (поля в потоці позначені data-f) ---------- */
function nextField(from: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>('[data-f]')];
  all[all.indexOf(from) + 1]?.focus();
}
/** textarea росте під текст (довгий dopisek переноситься на новий рядок) */
const autoGrow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } };
/* ---------- стрілки: перехід між будь-якими полями/кнопками за розташуванням на екрані ---------- */
const NAV = '.app input:not([type=hidden]):not([disabled]), .app textarea, .app button:not([disabled])';
/** Найближчий елемент у напрямку стрілки: спочатку ті, що стоять на одній лінії (перекриваються), потім будь-які. */
function pickDir(from: DOMRect, rects: DOMRect[], key: string): number {
  const vert = key === 'ArrowUp' || key === 'ArrowDown', fwd = key === 'ArrowDown' || key === 'ArrowRight';
  const idx = rects.map((_, i) => i).filter(i => {
    const b = rects[i];
    if (vert) return fwd ? b.top >= from.bottom - 4 : b.bottom <= from.top + 4;
    return fwd ? b.left >= from.right - 4 : b.right <= from.left + 4;
  });
  const inLine = idx.filter(i => {
    const b = rects[i];
    return vert ? b.left < from.right && b.right > from.left : b.top < from.bottom && b.bottom > from.top;
  });
  const pool = inLine.length ? inLine : idx;
  if (!pool.length) return -1;
  const cx = (b: DOMRect) => b.left + b.width / 2, cy = (b: DOMRect) => b.top + b.height / 2;
  // відстань по напрямку руху важить більше, ніж зсув убік
  const score = (b: DOMRect) => vert
    ? Math.abs(fwd ? b.top - from.bottom : from.top - b.bottom) * 3 + Math.abs(cx(b) - cx(from))
    : Math.abs(fwd ? b.left - from.right : from.left - b.right) + Math.abs(cy(b) - cy(from)) * 3;
  return pool.reduce((a, i) => (score(rects[i]) < score(rects[a]) ? i : a));
}
function moveFocus(from: DOMRect, key: string, self?: Element): boolean {
  const els = [...document.querySelectorAll<HTMLElement>(NAV)]
    .filter(el => el !== self && el.tabIndex !== -1 && el.getClientRects().length);
  const i = pickDir(from, els.map(el => el.getBoundingClientRect()), key);
  if (i < 0) return false;
  const el = els[i]; el.focus();
  if (el instanceof HTMLInputElement && /^(text|tel|search|)$/.test(el.type)) el.select?.();
  el.scrollIntoView({ block: 'nearest' });
  return true;
}
/** Глобальний обробник: в текстовому полі ←/→ виходять лише з краю тексту, ↑/↓ у textarea — з першого/останнього рядка. */
function onArrowNav(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || !e.key.startsWith('Arrow') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = e.target as HTMLElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const textual = el instanceof HTMLTextAreaElement || /^(text|tel|search|)$/.test(el.type);
    if (el instanceof HTMLInputElement && el.type === 'time' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    if (textual) {
      const s = el.selectionStart ?? 0, en = el.selectionEnd ?? 0, v = el.value;
      const all = s === 0 && en === v.length;   // весь текст виділено (після переходу стрілкою) — можна йти далі
      if (e.key === 'ArrowLeft' && !all && (s !== 0 || en !== 0)) return;
      if (e.key === 'ArrowRight' && !all && s !== v.length) return;
      if (el instanceof HTMLTextAreaElement && !all) {
        if (e.key === 'ArrowUp' && v.lastIndexOf('\n', s - 1) !== -1) return;
        if (e.key === 'ArrowDown' && v.indexOf('\n', en) !== -1) return;
      }
    }
  }
  if (moveFocus(el.getBoundingClientRect(), e.key, el)) e.preventDefault();
}

const firstField = () => document.querySelector<HTMLElement>('[data-f]')?.focus();
const plainEnter = (e: KeyboardEvent) => e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey;
const onEnterNext = (e: KeyboardEvent<HTMLElement>) => { if (plainEnter(e)) { e.preventDefault(); nextField(e.currentTarget); } };

/* ---------- чек (однаковий для превʼю і друку) ---------- */
type RO = Form & { n?: number; time?: string };
function Row({ l, c, children }: { l: string; c: string; children: ReactNode }) {
  return <div className="r"><span className="l">{l}</span><div className={c}>{children}</div></div>;
}
function Receipt({ o, day }: { o: RO; day: Day }) {
  const pay = [o.plat, o.kwota && `${o.kwota} zł`].filter(Boolean).join(' ');
  const a = addrLine(o, false), its = o.items.filter(i => i.dish.trim());
  const uw = uwagiLine(o), when = topWhen(o);
  return (
    <div className="t">
      {(when || pay) && <div className="th">{when && <b className="twhen">{when.toUpperCase()}</b>}{pay && <span className="tpay">{pay}</span>}</div>}
      {a && <Row l="Adres" c="ta">{a}</Row>}
      {o.dop.trim() && <Row l="Dopisek" c="td">{o.dop.trim()}</Row>}
      {o.tel && <Row l="Nr" c="tn">{o.tel}</Row>}
      {its.length > 0 && <Row l="Zamówienie" c="ti">{its.map((i, k) => <div key={k}><b>{i.qty} × </b>{fmtItem(i, day)}</div>)}</Row>}
      {uw && <Row l="Uwagi" c="tu">{uw}</Row>}
    </div>
  );
}

/* ---------- адреса з підказками вулиць ---------- */
function StreetInput({ value, onChange, streets }: { value: string; onChange: (v: string) => void; streets: string[] }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const { q, rest } = splitAddr(value);
  const sug = useMemo(() => suggestStreets(q, streets), [q, streets]);
  // вулицю вже вибрано (точний збіг) — підказки не потрібні
  const show = open && sug.length > 0 && !sug.some(s => norm(s) === norm(q));
  const choose = (s: string) => { onChange(s + (rest || ' ')); setOpen(false); };
  return (
    <div className="street">
      <input data-f autoFocus value={value} placeholder="np. kosc 50 → Kościuszki 50" autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (show && e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, sug.length - 1)); return; }
          if (show && e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); return; }
          if (show && e.key === 'Tab') { e.preventDefault(); choose(sug[hi]); return; }
          if (!plainEnter(e)) return;
          e.preventDefault();
          // вулиця з підказки; якщо номер будинку вже є — одразу далі, інакше лишаємось дописати номер
          if (show) { choose(sug[hi]); if (/\d/.test(rest)) nextField(e.currentTarget); }
          else nextField(e.currentTarget);
        }} />
      {show && (
        <div className="sug">{sug.map((s, i) => (
          <button key={s} type="button" className={i === hi ? 'hi' : ''} onMouseDown={e => { e.preventDefault(); choose(s); }}>{s}</button>
        ))}</div>
      )}
    </div>
  );
}

/* ---------- меню та позиції ---------- */
type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
const isArrow = (k: string): k is Arrow => k.startsWith('Arrow');
/**
 * Стрілки по сітці кнопок — за реальним розташуванням на екрані:
 * ↓/↑ — сусідній рядок, кнопка, найближча по горизонталі; ←/→ — сусідня (у кінці рядка — на наступний).
 * Повертає індекс або -1, якщо далі в цьому напрямку нічого немає.
 */
function arrowMove(els: HTMLElement[], from: number, key: Arrow): number {
  if (key === 'ArrowRight') return from + 1 < els.length ? from + 1 : -1;
  if (key === 'ArrowLeft') return from - 1;
  const r = els.map(e => e.getBoundingClientRect()), c = r[from], cx = c.left + c.width / 2;
  const down = key === 'ArrowDown';
  const cand = r.map((b, i) => ({ b, i })).filter(({ b }) => (down ? b.top >= c.bottom - 2 : b.bottom <= c.top + 2));
  if (!cand.length) return -1;
  const rowTop = down ? Math.min(...cand.map(x => x.b.top)) : Math.max(...cand.map(x => x.b.top));
  const row = cand.filter(x => Math.abs(x.b.top - rowTop) < 4);
  const dist = (b: DOMRect) => Math.abs(b.left + b.width / 2 - cx);
  return row.reduce((a, x) => (dist(x.b) < dist(a.b) ? x : a)).i;
}
const focusSearch = () => document.getElementById('dish-search')?.focus();
/** До поля імені (є лише в режимі «Pracownicy»), інакше — до пошуку наступної страви. */
const focusKto = (row: number) => {
  const el = document.querySelector<HTMLElement>(`.row[data-i="${row}"] .kto`);
  if (el) el.focus(); else focusSearch();
};

function MenuPicker({ menu, onPick }: { menu: Menu; onPick: (n: string) => number }) {
  const cats = Object.keys(menu);
  const [catSel, setCat] = useState(cats[0]);
  const cat = menu[catSel] ? catSel : cats[0];   // збережена категорія могла зникнути з меню
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(-1);   // підсвічена страва (стрілки); -1 = нічого
  // одна страва може бути в кількох категоріях (напр. «Frytki») — без повторів
  const res = q ? [...new Set(Object.values(menu).flat())].filter(n => norm(n).includes(norm(q))) : menu[cat] ?? [];
  const cur = q && hi < 0 ? 0 : hi;   // під час пошуку перший результат підсвічений одразу
  const pick = (n: string) => { onPick(n); setQ(''); setHi(-1); };   // курсор лишається в пошуку — можна вписувати наступну страву
  const lastEnter = useRef(0);
  const [armed, setArmed] = useState(false);   // перший порожній Enter — підказка, другий — далі
  const grid = useRef<HTMLDivElement>(null);
  const btns = () => [...(grid.current?.querySelectorAll<HTMLElement>('button') ?? [])];
  useEffect(() => { if (hi >= 0) btns()[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  return (
    <div>
      <input data-f id="dish-search" className="search" value={q} autoComplete="off"
        placeholder="Szukaj dania: sch, rosol, sprite…   Enter — dodaj · strzałki — wybór · ←→ kategoria"
        onChange={e => { setQ(e.target.value); setHi(-1); }}
        onKeyDown={e => {
          // ←→ рухають по сітці лише коли вже щось підсвічено стрілками; інакше — курсор у тексті / категорії
          if (isArrow(e.key) && (hi >= 0 || e.key === 'ArrowDown' || (q && e.key === 'ArrowUp'))) {
            if (!res.length) return;
            e.preventDefault();
            if (hi < 0 && !q) { setHi(0); return; }
            const to = arrowMove(btns(), cur, e.key);
            if (to >= 0) setHi(to);
            else if (e.key === 'ArrowDown' && grid.current) { setHi(-1); setQ(''); moveFocus(grid.current.getBoundingClientRect(), 'ArrowDown'); }
            else if (e.key === 'ArrowUp') setHi(-1);
            return;
          }
          if (!q && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
            e.preventDefault();
            const i = (cats.indexOf(cat) + (e.key === 'ArrowRight' ? 1 : -1) + cats.length) % cats.length;
            setCat(cats[i]); setHi(-1); return;
          }
          if (e.key === 'Escape') { setQ(''); setHi(-1); return; }
          if (!plainEnter(e)) return;
          e.preventDefault();
          if (cur >= 0 && res[cur]) { pick(res[cur]); lastEnter.current = 0; return; }
          if (q) return;
          // порожній пошук: два Enter підряд → блок 3 (Uwagi)
          const now = Date.now();
          if (now - lastEnter.current < 1500) { lastEnter.current = 0; setArmed(false); nextField(e.currentTarget); }
          else { lastEnter.current = now; setArmed(true); setTimeout(() => setArmed(false), 1500); }
        }} />
      {armed && <div className="armHint">Naciśnij <kbd>Enter</kbd> jeszcze raz → Uwagi</div>}
      <div className="cats">{cats.map(k => <button key={k} type="button" tabIndex={-1} className={!q && k === cat ? 'on' : ''} onClick={() => { setCat(k); setQ(''); setHi(-1); }}>{k}</button>)}</div>
      <div className="menu" ref={grid}>
        {res.map((n, i) => <button key={n} type="button" tabIndex={-1} className={i === cur ? 'hi' : ''} onClick={() => pick(n)}>{n}</button>)}
        {!res.length && <span className="mute">Brak wyników</span>}
      </div>
    </div>
  );
}

/** Ім'я в кінці рядка страви: підказки зі списку працівників, ↑↓ + Enter. Enter → назад до пошуку страви. */
function NameInput({ value, onChange, names }: { value: string; onChange: (v: string) => void; names: string[] }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const sug = names.filter(n => norm(n).startsWith(norm(value.trim())) && norm(n) !== norm(value.trim())).slice(0, 8);
  const show = open && sug.length > 0;
  const choose = (n: string) => { onChange(n); setOpen(false); setHi(-1); };
  return (
    <div className="street kwrap">
      <input className="add kto" placeholder="Imię (na końcu)  ↑↓" value={value} autoComplete="off"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { onChange(e.target.value); setOpen(true); setHi(-1); }}
        onKeyDown={e => {
          // по підказках; з останньої/першої (або коли підказок немає) — стрілка йде на сусіднє поле
          if (show && e.key === 'ArrowDown' && hi < sug.length - 1) { e.preventDefault(); setHi(hi + 1); return; }
          if (show && e.key === 'ArrowUp' && hi >= 0) { e.preventDefault(); setHi(hi - 1); return; }
          if (e.key === 'Escape') { setOpen(false); focusSearch(); return; }
          if (!plainEnter(e)) return;
          e.preventDefault();
          if (show && hi >= 0) choose(sug[hi]); else { setOpen(false); focusSearch(); }
        }} />
      {show && (
        <div className="sug">{sug.map((n, i) => (
          <button key={n} type="button" tabIndex={-1} className={i === hi ? 'hi' : ''} onMouseDown={e => { e.preventDefault(); choose(n); }}>{n}</button>
        ))}</div>
      )}
    </div>
  );
}

function ItemRow({ i, it, day, sides, names, menu, catAdds, prac, onChange, onRemove }:
  { i: number; prac: boolean; it: Item; day: Day; sides: string[]; names: string[]; menu: Menu; catAdds: CatAdds; onChange: (i: Item) => void; onRemove: () => void }) {
  const own = catAdds[catOf(menu, it.dish) ?? ''] ?? [];
  const has = (t: string) => it.adds.some(a => norm(a) === norm(t));
  const groups = (isDaily(it.dish)
    ? [{ l: 'Zupa', t: day.soups, single: true }, { l: 'Danie', t: day.mains, single: true }, { l: 'Opcje', t: day.opts, single: false }]
    : own.length
      ? [{ l: 'Dodatki', t: own, single: false }]   // власні додатки категорії (напр. смаки соку)
      : [{ l: 'Dodatki', t: [...sides, ...day.opts.filter(isParen)], single: false }]).filter(g => g.t.length);
  const toggle = (t: string, gi: number, el: HTMLElement) => {
    const g = groups[gi], on = has(t);
    let adds = it.adds;
    if (on) adds = adds.filter(a => norm(a) !== norm(t));
    else { if (g.single) adds = adds.filter(a => !g.t.some(x => norm(x) === norm(a))); adds = [...adds, t]; }
    onChange({ ...it, adds });
    // вибір в одиночній групі (zupa / danie) — одразу до наступної групи
    if (g.single && !on) {
      const next = el.closest('.chips')?.querySelector<HTMLElement>(`button[data-g="${gi + 1}"]`);
      if (next) next.focus(); else focusKto(i);
    }
  };
  /** Стрілки по опціях: ←→ сусідня, ↑↓ інша група, Enter/пробіл — вибрати, Tab — до імені, Esc — до пошуку. */
  const chipsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.dataset.g == null) return;
    const btns = [...e.currentTarget.querySelectorAll<HTMLElement>('button[data-g]')];
    // ←→ — по порядку (з кінця рядка на наступний); ↑↓ і краї — загальна навігація за екраном
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const to = arrowMove(btns, btns.indexOf(t), e.key);
      if (to >= 0) { e.preventDefault(); btns[to].focus(); }
    } else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusKto(i); }
    else if (e.key === 'Escape') focusSearch();
  };
  return (
    <div className="row" data-i={i}>
      <input value={it.dish} placeholder="Danie" list="menu-list" onChange={e => onChange({ ...it, dish: e.target.value })} />
      <div className="qtyBox">
        <button type="button" aria-label="Mniej" onClick={() => onChange({ ...it, qty: Math.max(1, it.qty - 1) })}>−</button>
        <input className="qty" inputMode="numeric" value={it.qty} aria-label="Ilość"
          onChange={e => onChange({ ...it, qty: Math.max(1, +onlyDigits(e.target.value, 2) || 1) })} onFocus={e => e.target.select()} />
        <button type="button" aria-label="Więcej" onClick={() => onChange({ ...it, qty: it.qty + 1 })}>+</button>
      </div>
      <button type="button" className="x" aria-label="Usuń pozycję" onClick={onRemove}>✕</button>
      {it.dish.trim() && (
        <div className="chips" onKeyDown={chipsKey}>
          {groups.map((g, gi) => (
            <div key={g.l} className="g"><span className="gl">{g.l}</span>
              {g.t.map(t => <button key={t} type="button" data-g={gi} className={has(t) ? 'on' : ''} onClick={e => toggle(t, gi, e.currentTarget)}>{t}</button>)}
            </div>
          ))}
          {it.adds.filter(a => !groups.some(g => g.t.some(t => norm(t) === norm(a)))).map(a => (
            <button key={a} type="button" className="on" title="Usuń" onClick={() => onChange({ ...it, adds: it.adds.filter(x => x !== a) })}>{a} ✕</button>
          ))}
          <div className="addRow">
            <input className="add" placeholder="Własny dodatek + Enter"
              onKeyDown={e => {
                if (!plainEnter(e)) return;
                e.preventDefault(); const v = e.currentTarget.value.trim();
                if (v) { onChange({ ...it, adds: [...it.adds, v] }); e.currentTarget.value = ''; } else focusKto(i);
              }} />
            {prac && <NameInput value={it.kto ?? ''} names={names} onChange={v => onChange({ ...it, kto: v })} />}
          </div>
          <span className="keys">←→↑↓ wybór · Enter zaznacz · {prac ? 'Tab → imię · ' : ''}Esc → następne danie</span>
        </div>
      )}
    </div>
  );
}

/* ---------- сторінка ---------- */
export default function Page() {
  const [orders, setOrders] = useLS<Order[]>('orders_v1', []);
  const [day] = useLS<Day>('day_v2', DEFAULT_DAY);
  const [menu] = useLS<Menu>('menu_v2', MENU);
  const [sides] = useLS<string[]>('sides_v2', SIDES);
  const [names, setNames] = useLS<string[]>('names_v1', []);
  const [catAdds] = useLS<CatAdds>('catadds_v2', DEFAULT_CAT_ADDS);
  const drv = useDrivers();
  const streets = useStreets();
  // чернетка: форма зберігається в браузері, тож не губиться при переході на «Menu», оновленні чи закритті вкладки
  const [form, setForm] = useLS<Form>('draft_v1', blankForm());
  const [editing, setEditing] = useLS<number | null>('draft_edit_v1', null);
  const [cleared, setCleared] = useState<{ form: Form; editing: number | null } | null>(null);
  const [forced, setForced] = useState<number[] | null>(null);
  const [undo, setUndo] = useState<Order | null>(null);
  const [msg, setMsg] = useState('');

  const T = todayStr();
  const mode = form.prac ? 'Pracownicy' : form.odbior ? 'Odbiór osobisty' : 'Dostawa';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const nextN = () => Math.max(0, ...orders.filter(o => o.date === T).map(o => o.n)) + 1;
  const todays = orders.filter(o => o.date === T).sort((a, b) => a.n - b.n);

  // що друкуємо: або лише щойно додане, або всі відмічені галочкою
  const sheetIds = forced ?? todays.filter(o => o.sel).map(o => o.id);
  const sheet = todays.filter(o => sheetIds.includes(o.id));
  const sheetKey = sheetIds.join(',');

  useEffect(() => { if (forced) window.print(); }, [forced]);           // «Dodaj i drukuj»
  useEffect(() => {                                                       // після друку: позначити ✓
    const h = () => { setOrders(os => os.map(o => (sheetIds.includes(o.id) ? { ...o, printed: true, sel: false } : o))); setForced(null); };
    window.addEventListener('afterprint', h);
    return () => window.removeEventListener('afterprint', h);
  }, [sheetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);
  useEffect(() => { if (!cleared) return; const t = setTimeout(() => setCleared(null), 8000); return () => clearTimeout(t); }, [cleared]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t); }, [msg]);

  /** Додає страву; повертає номер рядка нової позиції (або -1, якщо лише +1 до кількості). */
  const pick = (n: string) => {
    const items = [...form.items];
    const same = items.findIndex(i => i.dish === n && !i.adds.length && !i.kto);
    let row = -1;
    if (same >= 0) items[same] = { ...items[same], qty: items[same].qty + 1 };
    else {
      row = items.findIndex(i => !i.dish.trim());
      if (row >= 0) items[row] = { ...items[row], dish: n };
      else { row = items.length; items.push({ dish: n, qty: 1, adds: [] }); }
    }
    setForm({ ...form, items });
    return row;
  };

  function save(print: boolean) {
    if (isEmpty(form)) { setMsg('Formularz jest pusty'); return; }
    // редаговане замовлення могли вже видалити — тоді зберігаємо як нове
    const ed = editing != null && orders.some(o => o.id === editing) ? editing : null;
    const data = forPrint(form);
    const id = ed ?? Date.now();
    const n = ed != null ? orders.find(o => o.id === ed)?.n : nextN();
    setOrders(os => ed != null
      ? os.map(o => (o.id === ed ? { ...o, ...data, printed: false, sel: true } : o))
      : [...os, { ...data, id, n: nextN(), date: T, time: nowT(), printed: false, sel: true }]);
    // нові імена запам'ятовуємо для підказок
    const fresh = data.items.map(i => i.kto?.trim() ?? '').filter(k => k && !names.some(x => norm(x) === norm(k)));
    if (fresh.length) setNames([...names, ...new Set(fresh)]);
    setForm(blankForm()); setEditing(null);
    setMsg(`Zamówienie №${n} ${ed != null ? 'zapisane' : 'dodane'}`);
    if (print) setForced([id]);
    setTimeout(firstField, 0);
  }
  function edit(o: Order) {
    const { id, n, date, time, printed, sel, ...f } = o;
    setForm(f); setEditing(id); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clear() { setForm(blankForm()); setEditing(null); setTimeout(firstField, 0); }
  /** «Wyczyść» з можливістю повернути */
  function clearWithUndo() { if (!isEmpty(form)) setCleared({ form, editing }); clear(); }
  function del(o: Order) { setOrders(os => os.filter(x => x.id !== o.id)); setUndo(o); if (editing === o.id) clear(); }
  function printSelected() { sheet.length ? window.print() : setMsg('Zaznacz zamówienia do druku'); }
  const dayText = () => todays.map(o => buildText(o, day, true)).join('\n\n');
  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([dayText()], { type: 'text/plain;charset=utf-8' }));
    a.download = `zamowienia-${T}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }

  const preview: RO = { ...forPrint(form), n: editing != null ? orders.find(o => o.id === editing)?.n : nextN(), time: nowT() };
  const total = todays.reduce((s, o) => s + (parseFloat(o.kwota.replace(',', '.')) || 0), 0);

  return (
    <>
      <main className="app" onKeyDown={e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(false); return; }
        onArrowNav(e);
      }}>
        <section className="ui">
          {editing != null && (
            <div className="editBar">Edytujesz zamówienie №{preview.n}<button type="button" onClick={clear}>Anuluj</button></div>
          )}

          <div className="card">
            <h3><span className="step">1</span>Adres i kontakt</h3>
            <div className="seg">
              {MODES.map(m => (
                <button key={m.l} type="button" className={mode === m.l ? 'on' : ''}
                  onClick={() => setForm(f => ({ ...f, odbior: m.odbior, prac: m.prac }))}>{m.l}</button>
              ))}
            </div>
            {mode === 'Dostawa' && (
              <>
                <label>Adres<StreetInput value={form.adres} onChange={v => set('adres', v)} streets={streets} /></label>
                <div className="trio">
                  <label>Mieszkanie<input data-f value={form.mieszk} onKeyDown={onEnterNext} onChange={e => set('mieszk', e.target.value)} /></label>
                  <label>Piętro<input data-f value={form.pietro} onKeyDown={onEnterNext} onChange={e => set('pietro', e.target.value)} /></label>
                </div>
                <div className="fld">
                  <div className="fldHd"><span>Dopisek (kod, szpital…)</span></div>
                  <textarea data-f className="grow" rows={1} ref={autoGrow} value={form.dop} onKeyDown={onEnterNext} onChange={e => set('dop', e.target.value)} />
                </div>
              </>
            )}
            {mode === 'Odbiór osobisty' && (
              <div className="fld">
                <div className="fldHd"><span>Dopisek</span></div>
                <textarea data-f className="grow" rows={1} ref={autoGrow} autoFocus value={form.dop} onKeyDown={onEnterNext} onChange={e => set('dop', e.target.value)} />
              </div>
            )}
            {mode !== 'Pracownicy' && <label>Telefon<input data-f type="tel" inputMode="numeric" value={form.tel} placeholder="508 661 781" onKeyDown={onEnterNext}
              onChange={e => set('tel', cleanTel(e.target.value))} /></label>}
          </div>

          <div className="card">
            <h3><span className="step">2</span>Zamówienie<span className="stepHint">Enter — dodaje danie · <kbd>Enter</kbd> <kbd>Enter</kbd> — dalej do 3</span></h3>
            <MenuPicker menu={menu} onPick={pick} />
            <div className="items">
              {form.items.map((it, i) => (
                <ItemRow key={i} i={i} it={it} day={day} sides={sides} names={names} menu={menu} catAdds={catAdds} prac={!!form.prac}
                  onChange={n => set('items', form.items.map((x, k) => (k === i ? n : x)))}
                  onRemove={() => set('items', form.items.length > 1 ? form.items.filter((_, k) => k !== i) : blankForm().items)} />
              ))}
            </div>
            <button type="button" className="ghost" onClick={() => set('items', [...form.items, { dish: '', qty: 1, adds: [] }])}>+ Pozycja</button>
          </div>

          <div className="card">
            <h3><span className="step">3</span>Uwagi</h3>
            <div className="pays">
              {/* ASAP або «Powiem kiedy» (+ ok. година) — друкуються внизу; «Na godz.» — окремо, зверху чека */}
              {['ASAP', 'Powiem kiedy'].map(t => {
                const on = form.kiedy === t;
                return <button key={t} type="button" className={on ? 'on' : ''}
                  onClick={() => setForm(f => ({ ...f, kiedy: on ? '' : t, ok: t === 'Powiem kiedy' && !on ? f.ok : '' }))}>{t}</button>;
              })}
              <label className={'inl ok' + (form.ok ? ' on' : '')}>ok.<input data-f type="time" value={form.ok ?? ''} onKeyDown={onEnterNext}
                onChange={e => { const ok = e.target.value; setForm(f => ({ ...f, ok, kiedy: ok ? 'Powiem kiedy' : f.kiedy })); }} /></label>
              <label className={'inl' + (form.na ? ' on' : '')}>Na godz.<input data-f type="time" value={form.na} onKeyDown={onEnterNext}
                onChange={e => set('na', e.target.value)} /></label>
            </div>
            <textarea data-f className="grow" rows={2} ref={autoGrow} value={form.uwagi} placeholder="Enter → dalej, Shift+Enter → nowa linia"
              onKeyDown={onEnterNext} onChange={e => set('uwagi', e.target.value)} />
          </div>

          <div className="card">
            <h3><span className="step">4</span>Płatność</h3>
            <div className="pays">{PAY.map(p => <button key={p} type="button" className={form.plat === p ? 'on' : ''} onClick={() => set('plat', form.plat === p ? '' : p)}>{p}</button>)}</div>
            <label>Kwota<div className="money">
              <input data-f inputMode="decimal" placeholder="0,00" value={form.kwota}
                onKeyDown={e => { if (plainEnter(e)) { e.preventDefault(); save(false); } }}
                onChange={e => set('kwota', fmtKwota(e.target.value))} /><span>zł</span>
            </div></label>
          </div>

          <div className="actions">
            <button type="button" className="primary" onClick={() => save(false)}>
              {editing != null ? 'Zapisz zmiany' : 'Dodaj'} <kbd>Ctrl ↵</kbd>
            </button>
            <button type="button" className="ghost" onClick={clearWithUndo}>Wyczyść</button>
            {!isEmpty(form) && <span className="draftNote">✓ Szkic zapisany</span>}
          </div>
        </section>

        <aside className="side">
          <div className="card">
            <h2>Podgląd paragonu</h2>
            <div className="paper">{isEmpty(form) ? <span className="mute">Wypełnij formularz</span> : <Receipt o={preview} day={day} />}</div>
          </div>
          <div className="card">
            <h2>Dzisiaj · {todays.length} {total > 0 && <span className="mute">· {total.toFixed(2).replace('.', ',')} zł</span>}</h2>
            {!todays.length && <p className="mute">Brak zamówień na dziś</p>}
            <div className="olist">
            {todays.map(o => (
              <div key={o.id} className={'o' + (o.id === editing ? ' cur' : '')}>
                <input type="checkbox" checked={o.sel} aria-label={`Zaznacz №${o.n}`}
                  onChange={e => setOrders(os => os.map(x => (x.id === o.id ? { ...x, sel: e.target.checked } : x)))} />
                <div className="oMain" title={buildText(o, day)}>
                  <div className="oTop">
                    {whenLabel(o) ? <b className="when">{whenLabel(o)}</b> : <span className="when none">bez godz.</span>}
                    <span className="m">№{o.n} · {o.time}</span>
                  </div>
                  <div className="ad">{addrLine(o) || '—'}</div>
                </div>
                <span className="m">{[o.plat, o.kwota && o.kwota + ' zł'].filter(Boolean).join(' ')}{o.printed ? ' 🖨' : ''}</span>
                {o.status && <span className={'stBadge ' + o.status} title={o.status === 'wyslane' ? 'W drodze' : 'Dostarczone'}>
                  {o.status === 'wyslane' ? `🚗 ${drv.label(o.driver)}` : '✓'}</span>}
                {warns(o).length > 0 && <span className="w" title={warns(o).join(', ')}>⚠</span>}
                <button type="button" className="ic" title="Edytuj" onClick={() => edit(o)}>✎</button>
                <button type="button" className="ic" title="Usuń" onClick={() => del(o)}>✕</button>
              </div>
            ))}
            </div>
            <div className="lc">
              {/* все відмічено → «Odznacz wszystko», інакше → «Zaznacz wszystko» */}
              {todays.length > 0 && (() => {
                const all = todays.every(o => o.sel);
                return <button type="button" onClick={() => setOrders(os => os.map(o => (o.date === T ? { ...o, sel: !all } : o)))}>
                  {all ? '☐ Odznacz wszystko' : '☑ Zaznacz wszystko'}</button>;
              })()}
              <button type="button" onClick={download}>Zapisz .txt</button>
            </div>
            <button type="button" className="primary printBtn" onClick={printSelected}>
              🖨 Drukuj{sheet.length > 0 && <span className="cnt">{sheet.length}</span>}
            </button>
          </div>
        </aside>
      </main>

      {/* Друк: усі вибрані чеки одне під одним */}
      <div className="sheet">{sheet.map(o => <Receipt key={o.id} o={o} day={day} />)}</div>

      <datalist id="menu-list">{[...new Set(Object.values(menu).flat())].map(n => <option key={n} value={n} />)}</datalist>
      {(undo || msg) && (
        <div className="toast">{undo ? `№${undo.n} usunięte` : msg}
          {undo && <button type="button" onClick={() => { setOrders(os => [...os, undo]); setUndo(null); }}>Cofnij</button>}
        </div>
      )}
      {cleared && !undo && !msg && (
        <div className="toast">Formularz wyczyszczony
          <button type="button" onClick={() => { setForm(cleared.form); setEditing(cleared.editing); setCleared(null); }}>Cofnij</button>
        </div>
      )}
    </>
  );
}
