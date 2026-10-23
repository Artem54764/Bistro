'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  SIDES, DEFAULT_DAY, blankForm, isEmpty, isDaily, isParen, setLists, norm, addrLine, fmtItem,
  buildText, warns, splitAddr, onlyDigits, fmtKwota, cleanTel, suggestStreets, catOf, whenLabel, topWhen, uwagiLine, type CatAdds, type Day, type Form, type Item, type Menu, type Order,
} from '@/lib/order';
import { useDrivers, useLS, useMenuData, useStreets } from '@/lib/hooks';
import { checklist, fetchDaily, findClient, fmtZl, frequentDishes, itemPrice, mergeDaily, orderTotal, parseZl, type Check } from '@/lib/smart';

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
      <input data-f id="f-adres" autoFocus value={value} placeholder="np. kosc 50 → Kościuszki 50" autoComplete="off"
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
/** Не переносити фокус на кнопку при кліку (лишається в пошуку страви). */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();
/** До поля імені (є лише в режимі «Pracownicy»), інакше — до пошуку наступної страви. */
const focusKto = (row: number) => {
  const el = document.querySelector<HTMLElement>(`.row[data-i="${row}"] .kto`);
  if (el) el.focus(); else focusSearch();
};

/**
 * Пошук і вибір страви. Стрілки ходять по всьому блоку як на екрані:
 * пошук → ряд(и) категорій → сітка страв (↑↓ — сусідній рядок, ←→ — сусідня кнопка).
 * Категорія під підсвіткою одразу показує свої страви; Enter на категорії — до її страв, на страві — додати.
 */
/** Що чекає вибору цифрою: зупа / danie для щойно доданого zestawu. */
type Pending = { label: string; list: string[] };
function MenuPicker({ menu, onPick, pending, onPending, last, onQty }: {
  menu: Menu; onPick: (n: string) => number; pending: Pending | null; onPending: (k: number) => void;
  last: Item | null; onQty: (d: number) => void;
}) {
  // ряд категорій можна сховати; тоді стрілки ходять лише по стравах (nc = 0), ←→ у пошуку — далі перемикають категорію
  const [showCats, setShowCats] = useLS<boolean>('show_cats_v1', true);
  const cats = Object.keys(menu), nc = showCats ? cats.length : 0;
  const [catSel, setCat] = useState(cats[0]);
  const cat = menu[catSel] ? catSel : cats[0];   // збережена категорія могла зникнути з меню
  const [q, setQ] = useState('');
  // підсвітка: 0..nc-1 — категорія, nc.. — страва; -1 = нічого (курсор у пошуку)
  const [hi, setHi] = useState(-1);
  // одна страва може бути в кількох категоріях (напр. «Frytki») — без повторів
  const res = q ? [...new Set(Object.values(menu).flat())].filter(n => norm(n).includes(norm(q))) : menu[cat] ?? [];
  const cur = q && hi < 0 ? (res.length ? nc : -1) : hi;   // під час пошуку перший результат підсвічений одразу
  const pick = (n: string) => { onPick(n); setQ(''); setHi(-1); };   // курсор лишається в пошуку — можна вписувати наступну страву
  const lastEnter = useRef(0);
  const [armed, setArmed] = useState(false);   // перший порожній Enter — підказка, другий — далі
  const box = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null);
  /** Усі кнопки блоку в порядку: категорії, потім страви. */
  const els = () => [...(box.current?.querySelectorAll<HTMLElement>('.cats button, .menu button') ?? [])];
  useEffect(() => { if (hi >= 0) els()[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Підсвітити елемент; категорія (без пошуку) одразу відкриває свої страви. */
  const go = (i: number) => { setHi(i); if (i < nc && !q) setCat(cats[i]); };

  return (
    <div ref={box}>
      <input data-f id="dish-search" className="search" value={q} autoComplete="off"
        placeholder="Szukaj dania, potem cyfra 1–9 — wybór · Enter — pierwsze · strzałki — kategorie i dania"
        onChange={e => { setQ(e.target.value); setHi(-1); }}
        onKeyDown={e => {
          // + / − (поки пошук порожній): кількість останньої доданої страви
          if (!q && (e.key === '+' || e.key === '=' || e.key === '-') && !e.ctrlKey && !e.metaKey) {
            e.preventDefault(); onQty(e.key === '-' ? -1 : 1); return;
          }
          // цифри 1–9: під час пошуку — знайдена страва з цим номером;
          // з порожнім пошуком — спершу zupa / danie для zestawu, інакше страва з видимої вкладки
          if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && (!q || res.length)) {
            e.preventDefault();
            const k = +e.key - 1;
            if (!q && pending) { if (pending.list[k]) onPending(k); }
            else if (res[k]) pick(res[k]);
            return;
          }
          if (isArrow(e.key)) {
            // з тексту: ↓ — у меню; ↑ — у попереднє поле (загальна навігація); ←→ — категорія або курсор у тексті
            if (hi < 0 && !q) {
              if (e.key === 'ArrowDown') { e.preventDefault(); go(showCats ? cats.indexOf(cat) : 0); }
              else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const i = (cats.indexOf(cat) + (e.key === 'ArrowRight' ? 1 : -1) + cats.length) % cats.length;
                setCat(cats[i]);
              }
              return;
            }
            if (hi < 0 && q && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;   // курсор у тексті пошуку
            if (cur < 0) return;
            e.preventDefault();
            const to = arrowMove(els(), cur, e.key);
            if (to >= 0) go(to);
            else if (e.key === 'ArrowUp') setHi(-1);                            // вище категорій — назад у пошук
            else if (e.key === 'ArrowDown' && grid.current) {                   // нижче страв — до наступних полів
              setHi(-1); moveFocus(grid.current.getBoundingClientRect(), 'ArrowDown');
            }
            return;
          }
          if (e.key === 'Escape') { setQ(''); setHi(-1); return; }
          if (!plainEnter(e)) return;
          e.preventDefault();
          if (cur >= 0 && cur < nc) { setCat(cats[cur]); setQ(''); setHi(menu[cats[cur]]?.length ? nc : cur); return; }   // категорія → її перша страва
          if (cur >= nc && res[cur - nc]) { pick(res[cur - nc]); lastEnter.current = 0; return; }
          if (q) return;
          // порожній пошук: два Enter підряд → блок 3 (Uwagi)
          const now = Date.now();
          if (now - lastEnter.current < 1500) { lastEnter.current = 0; setArmed(false); nextField(e.currentTarget); }
          else { lastEnter.current = now; setArmed(true); setTimeout(() => setArmed(false), 1500); }
        }} />
      {last && !q && (
        <div className="lastLine">
          Ostatnio: <b className={'qN' + (last.qty > 1 ? ' many' : '')}>{last.qty}×</b> {last.dish}
          <span className="m"> — <kbd>+</kbd> / <kbd>−</kbd> zmienia ilość</span>
        </div>
      )}
      {armed && <div className="armHint">Naciśnij <kbd>Enter</kbd> jeszcze raz → Uwagi</div>}
      {/* клік мишкою не забирає курсор з пошуку — стрілки далі ходять по меню */}
      <div className="catsBar">
        <button type="button" tabIndex={-1} className="linkBtn catsToggle" onMouseDown={keepFocus}
          onClick={() => { setShowCats(!showCats); setHi(-1); focusSearch(); }}>
          {showCats ? '▾ Kategorie' : `▸ Kategorie · ${cat}`}
        </button>
        {!showCats && <span className="mute catsHint">← → zmienia kategorię</span>}
      </div>
      {showCats && <div className="cats">{cats.map((k, i) => (
        <button key={k} type="button" tabIndex={-1} className={(!q && k === cat ? 'on' : '') + (cur === i ? ' hi' : '')}
          onMouseDown={keepFocus} onClick={() => { setCat(k); setQ(''); setHi(-1); focusSearch(); }}>{k}</button>
      ))}</div>}
      {pending && (
        <div className="pendBar">
          <span className="pendL">{pending.label} — naciśnij cyfrę:</span>
          {pending.list.slice(0, 9).map((x, k) => (
            <button key={x} type="button" tabIndex={-1} onMouseDown={keepFocus} onClick={() => { onPending(k); focusSearch(); }}>
              <kbd>{k + 1}</kbd> {x}
            </button>
          ))}
        </div>
      )}
      <div className="menu" ref={grid}>
        {res.map((n, i) => (
          <button key={n} type="button" tabIndex={-1} className={cur === nc + i ? 'hi' : ''}
            onMouseDown={keepFocus} onMouseEnter={() => setHi(nc + i)} onClick={() => { pick(n); focusSearch(); }}>
            {(q || !pending) && i < 9 && <kbd className="dNum">{i + 1}</kbd>}{n}
          </button>
        ))}
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

function ItemRow({ i, it, day, sides, names, menu, catAdds, prac, open, onOpen, onChange, onRemove }: {
  i: number; prac: boolean; it: Item; day: Day; sides: string[]; names: string[]; menu: Menu; catAdds: CatAdds;
  /** розгорнутий рядок (з кнопками додатків); інші — один рядок тексту */
  open: boolean; onOpen: () => void; onChange: (i: Item) => void; onRemove: () => void;
}) {
  // власні додатки категорії; порожній список (напр. «Sosy») — без додатків; немає запису — загальні
  const own = catAdds[catOf(menu, it.dish) ?? ''];
  const has = (t: string) => it.adds.some(a => norm(a) === norm(t));
  const L = setLists(it.dish, day);   // «… dnia» — меню дня, «… miesiąca» — меню місяця
  const groups = (isDaily(it.dish)
    ? [{ l: 'Zupa', t: L.soups, single: true }, { l: 'Danie', t: L.mains, single: true }, { l: 'Opcje', t: L.opts, single: false }]
    : own
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
  const price = it.dish.trim() ? itemPrice(it) : null;
  const qty = (
    <div className="qtyBox">
      <button type="button" aria-label="Mniej" onClick={() => onChange({ ...it, qty: Math.max(1, it.qty - 1) })}>−</button>
      <input className={'qty' + (it.qty > 1 ? ' many' : '')} inputMode="numeric" value={it.qty} aria-label="Ilość"
        onChange={e => onChange({ ...it, qty: Math.max(1, +onlyDigits(e.target.value, 2) || 1) })} onFocus={e => e.target.select()} />
      <button type="button" aria-label="Więcej" onClick={() => onChange({ ...it, qty: it.qty + 1 })}>+</button>
    </div>
  );
  // згорнутий: «Kotlet schabowy, frytki, mizeria · 44 zł» — клік розгортає
  if (!open && it.dish.trim()) return (
    <div className="row mini" data-i={i}>
      <button type="button" className="miniBody" onClick={onOpen} title="Kliknij, żeby zmienić dodatki">
        <span className="miniTxt">{fmtItem(it, day)}</span>
        <span className="miniPrice">{price != null ? `${fmtZl(price)} zł` : 'bez ceny'}</span>
      </button>
      {qty}
      <button type="button" className="x" aria-label="Usuń pozycję" onClick={onRemove}>✕</button>
    </div>
  );
  return (
    <div className="row" data-i={i}>
      <input value={it.dish} placeholder="Danie" list="menu-list" onChange={e => onChange({ ...it, dish: e.target.value })} />
      {qty}
      <button type="button" className="x" aria-label="Usuń pozycję" onClick={onRemove}>✕</button>
      {it.dish.trim() && <span className="rowPrice">{price != null ? `${fmtZl(price)} zł` : 'bez ceny'}</span>}
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

/* ---------- перевірка кількостей перед «Dodaj» ----------
 * ↑↓ — рядок, + / − або цифра — кількість, Enter — додати, Esc — повернутися до форми. */
function QtyReview({ items, day, kwota, onQty, onOk, onCancel, onNever }: {
  items: Item[]; day: Day; kwota: string; onQty: (i: number, q: number) => void; onOk: () => void; onCancel: () => void; onNever: () => void;
}) {
  const list = items.map((it, i) => ({ it, i })).filter(x => x.it.dish.trim());
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const set = (k: number, q: number) => { const x = list[k]; if (x) onQty(x.i, Math.min(99, Math.max(1, q))); };
  const total = list.reduce((s, x) => s + x.it.qty, 0);
  return (
    <div className="modalBg" onMouseDown={onCancel}>
      <div className="modal" ref={box} tabIndex={-1} role="dialog" aria-label="Sprawdź ilości" onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          const q = list[sel]?.it.qty ?? 1;
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
          else if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') { e.preventDefault(); set(sel, q + 1); }
          else if (e.key === '-' || e.key === 'ArrowLeft') { e.preventDefault(); set(sel, q - 1); }
          else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); set(sel, +e.key); }
          else if (e.key === 'Enter') { e.preventDefault(); onOk(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}>
        <h2>Sprawdź ilości</h2>
        <p className="hint"><kbd>↑</kbd><kbd>↓</kbd> wybór · <kbd>+</kbd> <kbd>−</kbd> lub cyfra — ilość · <kbd>Enter</kbd> dodaj · <kbd>Esc</kbd> wróć</p>
        <div className="qList">
          {list.map(({ it }, k) => (
            <div key={k} className={'qRow' + (k === sel ? ' sel' : '')} onMouseEnter={() => setSel(k)}>
              <div className="qtyBox big">
                <button type="button" tabIndex={-1} aria-label="Mniej" onClick={() => set(k, it.qty - 1)}>−</button>
                <b className={'qN' + (it.qty > 1 ? ' many' : '')}>{it.qty}</b>
                <button type="button" tabIndex={-1} aria-label="Więcej" onClick={() => set(k, it.qty + 1)}>+</button>
              </div>
              <div className="qName">{fmtItem(it, day)}</div>
            </div>
          ))}
        </div>
        <div className="qSum">{(() => { const s = orderTotal(list.map(x => x.it)); return s.total > 0 ? <>Wg cennika: <b>{fmtZl(s.total)} zł</b>{s.unknown.length > 0 && ' + bez ceny'}{kwota && <> · Kwota: <b>{kwota} zł</b></>} · </> : null; })()}Razem: <b>{total}</b> {total === 1 ? 'porcja' : total < 5 ? 'porcje' : 'porcji'} · {list.length} {list.length === 1 ? 'pozycja' : 'pozycje'}</div>
        <div className="actions qAct">
          <button type="button" className="primary" onClick={onOk}>✓ Dodaj <kbd>Enter</kbd></button>
          <button type="button" className="ghost" onClick={onCancel}>Wróć <kbd>Esc</kbd></button>
          <button type="button" className="linkBtn" onClick={onNever}>Dodaj i nie pytaj więcej</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- сторінка ---------- */
export default function Page() {
  const [orders, setOrders] = useLS<Order[]>('orders_v1', []);
  const [day, setDay, dayReady] = useLS<Day>('day_v2', DEFAULT_DAY);
  const { menu, setMenu, catAdds } = useMenuData();
  const [sides] = useLS<string[]>('sides_v2', SIDES);
  const [names, setNames] = useLS<string[]>('names_v1', []);
  const drv = useDrivers();
  const streets = useStreets();
  // чернетка: форма зберігається в браузері, тож не губиться при переході на «Menu», оновленні чи закритті вкладки
  const [form, setForm] = useLS<Form>('draft_v1', blankForm());
  const [editing, setEditing] = useLS<number | null>('draft_edit_v1', null);
  const [cleared, setCleared] = useState<{ form: Form; editing: number | null } | null>(null);
  // перевірка кількостей перед «Dodaj» (можна вимкнути)
  const [askQty, setAskQty] = useLS<boolean>('ask_qty_v1', true);
  const [showKeys, setShowKeys] = useLS<boolean>('show_keys_v1', false);   // підказки клавіш (за замовчуванням сховані)
  const [copiesRaw, setCopies] = useLS<number>('print_copies_v1', 1);
  const copies = Math.min(5, Math.max(1, copiesRaw || 1));
  const [review, setReview] = useState(false);
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
    setOpenRow(null);   // нова страва — розгорнута вона
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

  /** reviewed — уже пройшли «Nie zapomnij» і перевірку кількостей. */
  function save(reviewed = false) {
    if (isEmpty(form)) { setMsg('Formularz jest pusty'); return; }
    if (!reviewed) {
      // нічого не забули? якщо бракує обов'язкового — питаємо
      const miss = checks.filter(c => c.must && !c.ok);
      if (miss.length && !confirm(`Brakuje: ${miss.map(c => c.label).join(', ')}.\n\nDodać mimo to?`)) { goCheck(miss[0]); return; }
      // кількості: показати вікно перевірки (Enter — додати)
      if (askQty && form.items.some(i => i.dish.trim())) { setReview(true); return; }
    }
    // редаговане замовлення могли вже видалити — тоді зберігаємо як нове
    const ed = editing != null && orders.some(o => o.id === editing) ? editing : null;
    const data = { ...forPrint(form), kwota };
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

  /* ---------- швидке введення ---------- */
  // меню дня з trzcinabistro.pl — автоматично раз на день (при першому відкритті)
  const [dailyAt, setDailyAt, dailyReady] = useLS<string>('daily_fetched_v3', '');   // v3: виправлений розбір меню дня (перезавантажити сьогодні)
  useEffect(() => {
    if (!dayReady || !dailyReady || dailyAt === T) return;
    setDailyAt(T);
    fetchDaily().then(d => {
      if (!d) return;
      setDay(cur => mergeDaily(cur, d));
      if (d.zupy.length) setMenu(m => (m['Zupy 450ml'] ? { ...m, 'Zupy 450ml': d.zupy } : m));
      setMsg(`Menu dnia ze strony: ${[...d.soups, ...d.mains].slice(0, 4).join(', ')}…`);
    });
  }, [dayReady, dailyReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // цифри для zestawu: останній доданий zestaw / danie / zupa dnia без вибраної zupy чи dania
  const pending = useMemo((): (Pending & { row: number }) | null => {
    for (let i = form.items.length - 1; i >= 0; i--) {
      const it = form.items[i];
      if (!it.dish.trim()) continue;
      if (!isDaily(it.dish)) return null;
      const d = norm(it.dish), has = (l: string[]) => it.adds.some(a => l.some(t => norm(t) === norm(a)));
      const L = setLists(it.dish, day);
      if ((d.startsWith('zestaw') || d.startsWith('zupa')) && L.soups.length && !has(L.soups)) return { row: i, label: `${it.dish.trim()}: zupa`, list: L.soups };
      if ((d.startsWith('zestaw') || d.startsWith('danie')) && L.mains.length && !has(L.mains)) return { row: i, label: `${it.dish.trim()}: danie`, list: L.mains };
      return null;
    }
    return null;
  }, [form.items, day]);
  /** Остання додана страва (для +/− у пошуку). */
  const lastIdx = (() => { for (let i = form.items.length - 1; i >= 0; i--) if (form.items[i].dish.trim()) return i; return -1; })();
  // розгорнутий рядок страви: вибраний кліком або останній доданий
  const [openRow, setOpenRow] = useState<number | null>(null);
  const activeRow = openRow != null && openRow < form.items.length ? openRow : lastIdx;
  const bumpLast = (d: number) => lastIdx >= 0 && setForm(f => ({
    ...f, items: f.items.map((it, i) => (i === lastIdx ? { ...it, qty: Math.min(99, Math.max(1, it.qty + d)) } : it)),
  }));
  const setQty = (i: number, q: number) => setForm(f => ({ ...f, items: f.items.map((it, k) => (k === i ? { ...it, qty: q } : it)) }));
  function choosePending(k: number) {
    if (!pending || !pending.list[k]) return;
    const { row, list } = pending;
    setForm(f => ({ ...f, items: f.items.map((it, i) => (i !== row ? it
      : { ...it, adds: [...it.adds.filter(a => !list.some(t => norm(t) === norm(a))), list[k]] })) }));
  }

  /** ASAP / Powiem kiedy (кнопки й літери A / P). */
  function setKiedy(t: string) {
    setForm(f => {
      const on = f.kiedy === t;
      return t === 'ASAP'
        ? { ...f, kiedy: on ? '' : 'ASAP', ok: '', na: on ? f.na : '' }
        : { ...f, kiedy: on ? '' : 'Powiem kiedy', ok: on ? '' : f.ok };
    });
  }
  /** Літери: O G T Z — płatność, A — ASAP, P — Powiem kiedy. Працюють на кнопках і в полі «Kwota» (не в текстових полях). */
  function letterKey(e: KeyboardEvent<HTMLElement>): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return false;
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.id !== 'f-kwota' && t.type !== 'checkbox');
    if (typing) return false;
    const k = e.key.toUpperCase();
    const pay = ({ O: 'ONLINE', G: 'GOTÓWKA', T: 'TERMINAL', Z: 'ZAPŁACONE' } as Record<string, string>)[k];
    if (pay) { e.preventDefault(); setForm(f => ({ ...f, plat: f.plat === pay ? '' : pay })); return true; }
    if (k === 'A' || k === 'P') { e.preventDefault(); setKiedy(k === 'A' ? 'ASAP' : 'Powiem kiedy'); return true; }
    return false;
  }
  const kwota = form.kwota;   // сума — лише вручну
  // для орієнтиру: сума за цінами сайту (нічого не вписує сама)
  const sum = orderTotal(forPrint(form).items);
  const diff = kwota.trim() && sum.total > 0 && !sum.unknown.length ? parseZl(kwota) - sum.total : 0;
  // «Nie zapomnij»: що ще не заповнено
  const checks = checklist(form, day, kwota);
  function goCheck(c: Check) {
    const el = (id: string) => document.getElementById(id);
    if (c.key === 'adres') el('f-adres')?.focus();
    else if (c.key === 'tel') el('f-tel')?.focus();
    else if (c.key === 'dania') focusSearch();
    else if (c.row != null) { setOpenRow(c.row); setTimeout(() => document.querySelector<HTMLElement>(`.row[data-i="${c.row}"] .chips button[data-g]`)?.focus(), 0); }
    else if (c.key === 'kiedy') el('f-na')?.focus();
    else if (c.key === 'plat') el('f-plat')?.querySelector<HTMLElement>('button')?.focus();
    else if (c.key === 'kwota') el('f-kwota')?.focus();
    document.activeElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // постійний клієнт: за телефоном або адресою з попередніх замовлень
  const client = useMemo(() => (form.tel || form.adres ? findClient(orders, form, editing) : null),
    [orders, form.tel, form.adres, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsFill = !!client && ((!form.adres && !!client.last.adres) || (!form.tel && !!client.last.tel)
    || (!form.mieszk && !!client.last.mieszk) || (!form.pietro && !!client.last.pietro) || (!form.dop && !!client.last.dop));
  /** Дописати порожні поля з останнього замовлення клієнта (нічого не перезаписує). */
  function fillClient() {
    if (!client) return;
    const l = client.last;
    setForm(f => ({ ...f, adres: f.adres || l.adres, mieszk: f.mieszk || l.mieszk, pietro: f.pietro || l.pietro, dop: f.dop || l.dop, tel: f.tel || l.tel }));
  }
  // знайшли за телефоном, а адреса ще порожня — підставляємо одразу
  const autoTel = useRef('');
  useEffect(() => {
    if (client?.by === 'tel' && !form.adres && !form.mieszk && autoTel.current !== form.tel) {
      autoTel.current = form.tel; fillClient(); setMsg('Adres z poprzedniego zamówienia');
    }
  }, [client?.last.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Повторити останнє замовлення клієнта: страви + оплата (дані адреси теж доповнюються). */
  function repeatClient() {
    if (!client) return;
    const l = client.last;
    setForm(f => ({
      ...f, adres: f.adres || l.adres, mieszk: f.mieszk || l.mieszk, pietro: f.pietro || l.pietro, dop: f.dop || l.dop, tel: f.tel || l.tel,
      items: l.items.map(i => ({ ...i, adds: [...i.adds] })), plat: f.plat || l.plat,
    }));
    setMsg('Skopiowano ostatnie zamówienie — sprawdź i dodaj');
  }
  // «★ Częste» — найчастіші страви першою вкладкою меню
  const freq = useMemo(() => frequentDishes(orders, Object.values(menu).flat()), [orders, menu]);
  const pickerMenu = useMemo(() => (freq.length >= 3 ? { '★ Częste': freq, ...menu } : menu), [freq, menu]);

  const preview: RO = { ...forPrint(form), kwota, n: editing != null ? orders.find(o => o.id === editing)?.n : nextN(), time: nowT() };
  const total = todays.reduce((s, o) => s + (parseFloat(o.kwota.replace(',', '.')) || 0), 0);

  return (
    <>
      <main className={'app' + (showKeys ? ' showKeys' : '')} onKeyDown={e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); return; }
        if (letterKey(e)) return;
        onArrowNav(e);
      }}>
        <section className="ui">
          {editing != null && (
            <div className="editBar">Edytujesz zamówienie №{preview.n}<button type="button" onClick={clear}>Anuluj</button></div>
          )}

          <div className="card c1">
            <div className="cardHd">
              <h3><span className="step">1</span>Adres i kontakt</h3>
              <div className="seg">
                {MODES.map(m => (
                  <button key={m.l} type="button" className={mode === m.l ? 'on' : ''}
                    onClick={() => setForm(f => ({ ...f, odbior: m.odbior, prac: m.prac }))}>{m.l}</button>
                ))}
              </div>
            </div>
            {mode === 'Dostawa' && (
              <>
                {/* рядок 1: адреса | квартира | поверх */}
                <div className="addrRow">
                  <label>Adres<StreetInput value={form.adres} onChange={v => set('adres', v)} streets={streets} /></label>
                  <label>M.<input data-f value={form.mieszk} onKeyDown={onEnterNext} onChange={e => set('mieszk', e.target.value)} /></label>
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
            {mode !== 'Pracownicy' && <label>Telefon<input data-f id="f-tel" type="tel" inputMode="numeric" value={form.tel} placeholder="508 661 781" onKeyDown={onEnterNext}
              onChange={e => set('tel', cleanTel(e.target.value))} /></label>}
            {client && (
              <div className="client">
                <div className="clientInfo">
                  <b>👤 Stały klient</b> · {client.count} {client.count === 1 ? 'zamówienie' : 'zamówień'} · ostatnio {client.last.date.slice(5).split('-').reverse().join('.')}
                  <div className="m">{addrLine(client.last) || '—'}{client.last.tel && ` · ${client.last.tel}`}</div>
                  <div className="m">{client.last.items.filter(i => i.dish.trim()).map(i => `${i.qty}× ${i.dish}`).join(', ')}</div>
                </div>
                <div className="clientAct">
                  {needsFill && <button type="button" className="sm" onClick={fillClient}>Uzupełnij dane</button>}
                  <button type="button" className="sm primary" onClick={repeatClient}>↻ Powtórz zamówienie</button>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3><span className="step">2</span>Zamówienie<span className="stepHint">Enter — dodaje danie · <kbd>Enter</kbd> <kbd>Enter</kbd> — dalej do 3</span></h3>
            <MenuPicker menu={pickerMenu} onPick={pick} pending={pending} onPending={choosePending}
              last={lastIdx >= 0 ? form.items[lastIdx] : null} onQty={bumpLast} />
            <div className="items">
              {form.items.map((it, i) => (
                <ItemRow key={i} i={i} it={it} day={day} sides={sides} names={names} menu={menu} catAdds={catAdds} prac={!!form.prac}
                  open={i === activeRow} onOpen={() => setOpenRow(i)}
                  onChange={n => set('items', form.items.map((x, k) => (k === i ? n : x)))}
                  onRemove={() => { setOpenRow(null); set('items', form.items.length > 1 ? form.items.filter((_, k) => k !== i) : blankForm().items); }} />
              ))}
            </div>
            <button type="button" className="ghost" onClick={() => set('items', [...form.items, { dish: '', qty: 1, adds: [] }])}>+ Pozycja</button>
          </div>

          {/* 3 і 4 поруч (на широкому екрані) */}
          <div className="duo">
          <div className="card">
            <h3><span className="step">3</span>Uwagi<span className="stepHint"><kbd>←</kbd><kbd>→</kbd> wybór · <kbd>Enter</kbd> zaznacz i dalej</span></h3>
            {/* ASAP — без години; інакше можна вказати орієнтовну (ok.) та/або точну (na) годину */}
            <div className="pays whenRow">
              {['ASAP', 'Powiem kiedy'].map(t => {
                const on = form.kiedy === t;
                const choose = () => setKiedy(t);
                return (
                  <button key={t} type="button" data-f className={'whenBtn' + (on ? ' on' : '')} onClick={choose}
                    onKeyDown={e => {
                      // Enter — вибрати цю кнопку і перейти далі (за обидві кнопки: до години або «Kwota»); ←→ — інша кнопка
                      if (plainEnter(e)) {
                        e.preventDefault(); choose();
                        setTimeout(() => { const all = document.querySelectorAll<HTMLElement>('.whenBtn'); nextField(all[all.length - 1]); }, 0);
                      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        const all = [...document.querySelectorAll<HTMLElement>('.whenBtn')];
                        all[(all.indexOf(e.currentTarget) + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
                      }
                    }}>
                    {t === 'ASAP' ? '⚡ ASAP' : '🕐 Powiem kiedy'} <kbd>{t[0]}</kbd>
                  </button>
                );
              })}
            </div>
            {form.kiedy === 'ASAP'
              ? <p className="hint">Jak najszybciej — bez godziny.</p>
              : (
                <div className="pays timeRow">
                  {/* «ok.» — орієнтовна година; завжди видно (крім ASAP), вписали — вмикається «Powiem kiedy» */}
                  <label className={'inl ok' + (form.ok ? ' on' : '')}>ok.<input data-f type="time" value={form.ok ?? ''} onKeyDown={onEnterNext}
                    onChange={e => { const ok = e.target.value; setForm(f => ({ ...f, ok, kiedy: ok ? 'Powiem kiedy' : f.kiedy })); }} /></label>
                  <label className={'inl ok' + (form.na ? ' on' : '')}>Na godz.<input data-f id="f-na" type="time" value={form.na} onKeyDown={onEnterNext}
                      onChange={e => set('na', e.target.value)} /></label>
                </div>
              )}
            {/* старі замовлення могли мати текст у «Uwagi» — показуємо, щоб не загубився */}
            {form.uwagi.trim() && (
              <div className="oldNote">Uwagi: <b>{form.uwagi}</b>
                <button type="button" className="linkBtn" onClick={() => set('uwagi', '')}>usuń</button></div>
            )}
          </div>

          <div className="card">
            <h3><span className="step">4</span>Płatność</h3>
            {/* у порядку Enter: після блоку 3 — спершу оплата (←→ вибір, Enter — вибрати й до «Kwota»), потім сума */}
            <div className="pays" id="f-plat">{PAY.map(p => (
              <button key={p} type="button" data-f className={'payBtn' + (form.plat === p ? ' on' : '')}
                onClick={() => set('plat', form.plat === p ? '' : p)}
                onFocus={e => {
                  // прийшли ззовні (Enter з блоку 3) — стати на вже вибрану оплату; стрілки всередині групи не чіпаємо
                  const from = e.relatedTarget as HTMLElement | null;
                  if (from?.classList.contains('payBtn') || e.currentTarget.matches(':hover')) return;
                  const sel = document.querySelector<HTMLElement>('.payBtn.on');
                  if (sel && sel !== e.currentTarget) sel.focus();
                }}
                onKeyDown={e => {
                  if (plainEnter(e)) {
                    e.preventDefault();
                    setForm(f => ({ ...f, plat: p }));   // Enter — завжди вибирає (не знімає)
                    const all = document.querySelectorAll<HTMLElement>('.payBtn');
                    nextField(all[all.length - 1]);
                  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const all = [...document.querySelectorAll<HTMLElement>('.payBtn')];
                    all[(all.indexOf(e.currentTarget) + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
                  }
                }}>{p} <kbd>{p[0]}</kbd></button>
            ))}</div>
            <span className="hint">Litery w polu „Kwota” lub na przyciskach: <kbd>O</kbd> <kbd>G</kbd> <kbd>T</kbd> <kbd>Z</kbd> — płatność, <kbd>A</kbd> ASAP, <kbd>P</kbd> Powiem kiedy.</span>
            <div className="fld">
              <div className="fldHd"><span>Kwota</span></div>
              <div className="money">
                <input data-f id="f-kwota" inputMode="decimal" placeholder="0,00" value={kwota}
                  onKeyDown={e => { if (plainEnter(e)) { e.preventDefault(); save(); } }}
                  onChange={e => set('kwota', fmtKwota(e.target.value))} /><span>zł</span>
              </div>
              {sum.total > 0 && (
                <div className={'priceRef' + (Math.abs(diff) >= 0.5 ? ' off' : '')}>
                  Wg cennika: <b>{fmtZl(sum.total)} zł</b>
                  {sum.unknown.length > 0 && <span className="m"> + bez ceny: {sum.unknown.join(', ')}</span>}
                  {Math.abs(diff) >= 0.5 && <span> · wpisano o {fmtZl(Math.abs(diff))} zł {diff > 0 ? 'więcej' : 'mniej'}</span>}
                  {!kwota.trim() && <button type="button" className="linkBtn" onClick={() => set('kwota', fmtZl(sum.total))}>wpisz</button>}
                </div>
              )}
            </div>
          </div>

          </div>

          {showKeys && (
            <div className="keysHelp">
              <b>Skróty:</b> <kbd>Enter</kbd> — dalej · <kbd>Enter</kbd><kbd>Enter</kbd> w szukaniu — do Uwag ·
              cyfry <kbd>1</kbd>–<kbd>9</kbd> — danie / zupa / danie zestawu · <kbd>+</kbd> <kbd>−</kbd> — ilość ostatniego ·
              <kbd>A</kbd> ASAP · <kbd>P</kbd> Powiem kiedy · <kbd>O</kbd> <kbd>G</kbd> <kbd>T</kbd> <kbd>Z</kbd> — płatność (w „Kwota”) ·
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> — Dodaj · strzałki — po polach i menu
            </div>
          )}
          {!isEmpty(form) && (
            <div className="checks" aria-label="Sprawdź zamówienie">
              <span className="checksL">{checks.some(c => !c.ok && c.must) ? 'Brakuje:' : 'Nie zapomnij:'}</span>
              {checks.every(c => c.ok || !c.must) && <span className="chk ok">✓ Wszystko OK</span>}
              {checks.filter(c => !c.ok).map(c => (
                <button key={c.key} type="button" className={'chk ' + (c.ok ? 'ok' : c.must ? 'bad' : 'opt')} onClick={() => goCheck(c)}
                  title={c.ok ? 'OK' : c.must ? 'Brakuje — kliknij, żeby uzupełnić' : 'Opcjonalne'}>
                  {c.ok ? '✓' : c.must ? '✗' : '○'} {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="actions">
            <button type="button" className="primary" onClick={() => save()}>
              {editing != null ? 'Zapisz zmiany' : 'Dodaj'} <kbd>Ctrl ↵</kbd>
            </button>
            <button type="button" className="ghost" onClick={clearWithUndo}>Wyczyść</button>
            <label className="askQty"><input type="checkbox" checked={askQty} onChange={e => setAskQty(e.target.checked)} /> Sprawdzaj ilości</label>
            <button type="button" className={'linkBtn keysBtn' + (showKeys ? ' on' : '')} onClick={() => setShowKeys(!showKeys)}>⌨ Skróty</button>
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
            {/* скільки копій кожного чека (напр. кухня + kierowca) */}
            <div className="copiesRow">
              <span>Kopie każdego paragonu:</span>
              <div className="qtyBox">
                <button type="button" aria-label="Mniej kopii" onClick={() => setCopies(Math.max(1, copies - 1))}>−</button>
                <b className="stepVal">{copies}</b>
                <button type="button" aria-label="Więcej kopii" onClick={() => setCopies(Math.min(5, copies + 1))}>+</button>
              </div>
            </div>
            <button type="button" className="primary printBtn" onClick={printSelected}>
              🖨 Drukuj{sheet.length > 0 && <span className="cnt">{sheet.length}</span>}{copies > 1 && <span className="copiesX">× {copies}</span>}
            </button>
          </div>
        </aside>
      </main>

      {/* Друк: усі вибрані чеки одне під одним */}
      {/* кожен чек — стільки копій, скільки вибрано (копії одного замовлення підряд) */}
      <div className="sheet">{sheet.flatMap(o => Array.from({ length: copies }, (_, k) => <Receipt key={`${o.id}-${k}`} o={o} day={day} />))}</div>

      <datalist id="menu-list">{[...new Set(Object.values(menu).flat())].map(n => <option key={n} value={n} />)}</datalist>
      {review && (
        <QtyReview items={form.items} day={day} kwota={kwota} onQty={setQty}
          onOk={() => { setReview(false); save(true); }} onCancel={() => { setReview(false); focusSearch(); }}
          onNever={() => { setAskQty(false); setReview(false); save(true); }} />
      )}
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
