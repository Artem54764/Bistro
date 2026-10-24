/**
 * Помічники швидкого введення: сума за цінами сайту (для орієнтиру), перевірка «нічого не забув»,
 * постійні клієнти (за телефоном / адресою) і найчастіші страви.
 */
import { ADD_PRICES, DISH_PRICES, FREE_ADDS, FREE_FIRST } from './prices';
import { isDaily, norm, setLists, splitAddr, type Day, type Form, type Item, type Order } from './order';

/* ---------- ціни (лише показуємо, у «Kwota» нічого не вписуємо) ---------- */
const byNorm = (rec: Record<string, number>) => new Map(Object.entries(rec).map(([k, v]) => [norm(k), v]));
const DISH = byNorm(DISH_PRICES), ADD = byNorm(ADD_PRICES);
const FREE = new Map(Object.entries(FREE_ADDS).map(([k, v]) => [norm(k), new Set(v.map(norm))]));
const FIRST = new Map(Object.entries(FREE_FIRST).map(([k, v]) => [norm(k), new Set(v.map(norm))]));
/** Ціна позиції (з платними додатками, × кількість) або null, якщо страви немає в цінах сайту. */
export function itemPrice(it: Item): number | null {
  const d = norm(it.dish.trim()), base = DISH.get(d);
  if (base == null) return null;
  const free = FREE.get(d), first = FIRST.get(d);
  let usedFirst = false, add = 0;
  for (const a of it.adds) {
    const k = norm(a);
    if (free?.has(k)) continue;
    if (first?.has(k) && !usedFirst) { usedFirst = true; continue; }
    add += ADD.get(k) ?? 0;
  }
  return (base + add) * Math.max(1, it.qty);
}
/** Сума за цінником і страви без ціни (вписані вручну / не з сайту). */
export function orderTotal(items: Item[]): { total: number; unknown: string[] } {
  let total = 0; const unknown: string[] = [];
  for (const it of items) {
    if (!it.dish.trim()) continue;
    const p = itemPrice(it);
    if (p == null) unknown.push(it.dish.trim()); else total += p;
  }
  return { total: Math.round(total * 100) / 100, unknown };
}
export const fmtZl = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
/** «45,50» -> 45.5 */
export const parseZl = (s: string) => parseFloat(s.replace(',', '.')) || 0;

/* ---------- «нічого не забув» ---------- */
export type Check = { key: string; label: string; ok: boolean; must: boolean; row?: number };
/** Чек-ліст замовлення. must — без цього не варто зберігати (спитаємо). */
export function checklist(f: Form, day: Day, kwota: string): Check[] {
  const delivery = !f.odbior && !f.prac;
  const items = f.items.map((it, i) => ({ it, i })).filter(x => x.it.dish.trim());
  const has = (it: Item, list: string[]) => it.adds.some(a => list.some(t => norm(t) === norm(a)));
  const out: Check[] = [];
  if (delivery) {
    out.push({ key: 'adres', label: 'Adres', ok: /\d/.test(f.adres) && !!splitAddr(f.adres).q, must: true });
    out.push({ key: 'tel', label: 'Telefon', ok: f.tel.replace(/\D/g, '').length >= 9, must: true });
  }
  out.push({ key: 'dania', label: 'Dania', ok: items.length > 0, must: true });
  // zestaw / danie / zupa dnia чи miesiąca — чи вибрано zupę і danie
  for (const { it, i } of items) {
    if (!isDaily(it.dish)) continue;
    const d = norm(it.dish);
    const needSoup = d.startsWith('zestaw') || d.startsWith('zupa');
    const needMain = d.startsWith('zestaw') || d.startsWith('danie');
    const L = setLists(it.dish, day);
    if (needSoup && L.soups.length) out.push({ key: 'zupa' + i, label: `${it.dish.trim()}: zupa`, ok: has(it, L.soups), must: true, row: i });
    if (needMain && L.mains.length) out.push({ key: 'danie' + i, label: `${it.dish.trim()}: danie`, ok: has(it, L.mains), must: true, row: i });
  }
  out.push({ key: 'kiedy', label: 'Na kiedy', ok: !!(f.na || f.kiedy), must: true });   // обов'язково — легко забути
  out.push({ key: 'plat', label: 'Płatność', ok: !!f.plat, must: true });
  out.push({ key: 'kwota', label: 'Kwota', ok: !!kwota.trim(), must: false });
  return out;
}

/* ---------- постійні клієнти ---------- */
const digits = (s: string) => s.replace(/\D/g, '').replace(/^48(?=\d{9}$)/, '');
/** Ключ адреси: вулиця + номер будинку (без квартири). */
export const addrKey = (adres: string) => {
  const { q, rest } = splitAddr(adres);
  const num = rest.match(/^\s*(\d+[A-Za-z]?)/)?.[1] ?? '';
  return q && num ? norm(q) + ' ' + norm(num) : '';
};
export type Client = { last: Order; count: number; by: 'tel' | 'adres' };
/**
 * Хто вже замовляв. За телефоном (9 цифр) — одна людина.
 * За адресою (вулиця + номер) — усі різні люди з цієї адреси (офіс, лікарня, багатоквартирний будинок):
 * людину розрізняємо за телефоном, а без нього — за квартирою й dopiskiem. Найсвіжіші першими.
 */
export function findClients(orders: Order[], f: Pick<Form, 'tel' | 'adres'>, skipId?: number | null): Client[] {
  const tel = digits(f.tel), ak = addrKey(f.adres);
  const pool = orders.filter(o => o.id !== skipId).sort((a, b) => b.id - a.id);
  if (tel.length === 9) {
    const m = pool.filter(o => digits(o.tel) === tel);
    if (m.length) return [{ last: m[0], count: m.length, by: 'tel' }];
  }
  if (!ak) return [];
  const groups = new Map<string, Order[]>();
  for (const o of pool.filter(o => addrKey(o.adres) === ak)) {
    const k = digits(o.tel) || `m:${norm(o.mieszk)}|${norm(o.dop)}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  return [...groups.values()].map(g => ({ last: g[0], count: g.length, by: 'adres' as const }));
}

/* ---------- найчастіші страви ---------- */
/** До n страв, які найчастіше замовляли (лише ті, що є в меню). */
export function frequentDishes(orders: Order[], menuDishes: string[], n = 10): string[] {
  const inMenu = new Map(menuDishes.map(d => [norm(d), d]));
  const cnt = new Map<string, number>();
  for (const o of orders) for (const it of o.items) {
    const k = norm(it.dish.trim()); if (inMenu.has(k)) cnt.set(k, (cnt.get(k) ?? 0) + Math.max(1, it.qty));
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => inMenu.get(k)!);
}

/* ---------- меню дня з сайту ---------- */
export type DailyFromSite = { soups: string[]; mains: string[]; opts: string[]; mSoups: string[]; mMains: string[]; mOpts: string[]; zupy: string[] };
/** Завантажити меню дня з trzcinabistro.pl (через /api/menu-dnia). null — не вдалося. */
export async function fetchDaily(): Promise<DailyFromSite | null> {
  try {
    const r = await fetch('/api/menu-dnia');
    const j = await r.json();
    return r.ok && Array.isArray(j.soups) ? j : null;
  } catch { return null; }
}
/** Нове меню дня й місяця: супи й страви — з сайту; опції — з сайту + ваші «bez …» / «… osobno». */
export function mergeDaily(day: Day, d: DailyFromSite): Day {
  const keep = day.opts.filter(o => /^bez |osobno$/i.test(o) && !d.opts.some(x => norm(x) === norm(o)));
  return { soups: d.soups, mains: d.mains, opts: [...d.opts, ...keep], mSoups: d.mSoups ?? [], mMains: d.mMains ?? [], mOpts: d.mOpts ?? [] };
}
