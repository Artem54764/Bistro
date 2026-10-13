/** kto — ім'я (напр. працівника), пишеться в кінці рядка; у старих замовленнях поля немає */
export type Item = { dish: string; qty: number; adds: string[]; kto?: string };
export type Form = {
  adres: string; mieszk: string; pietro: string; dop: string; odbior: boolean;
  /** zamówienie dla pracowników (bez adresu i telefonu); у старих замовленнях поля немає */
  prac?: boolean;
  /** kiedy: 'ASAP' або 'Powiem kiedy' (+ ok — орієнтовна година); na — точна година, незалежна від них */
  kiedy?: string;
  ok?: string;
  tel: string; items: Item[]; uwagi: string; na: string; plat: string; kwota: string;
};
/** Трекер: немає статусу = «do wysłania». driver — номер водія, sentAt/doneAt — мітки часу (мс). */
export type Status = 'wyslane' | 'dostarczone';
export type Order = Form & {
  id: number; n: number; date: string; time: string; printed: boolean; sel: boolean;
  status?: Status; driver?: number; sentAt?: number; doneAt?: number;
  /** номер зупинки у відправленій трасі (1, 2, …) — трасу в трекері впізнаємо за driver + sentAt */
  seq?: number;
  /** розрахунок при відправці з карти: орієнтовний приїзд на адресу і повернення водія в бістро (мс) */
  etaAt?: number; backAt?: number;
  /** прибрано з карти й трекера (очищення) — замовлення лишається в історії */
  cleared?: boolean;
};
/** Trzcina Bistro — постійна точка виїзду (OpenStreetMap). */
export const BISTRO = { adres: 'al. Tysiąclecia Państwa Polskiego 7', lat: 50.8803685, lon: 20.6397281 };
export type Day = { soups: string[]; mains: string[]; opts: string[] };

export const blankForm = (): Form => ({
  adres: '', mieszk: '', pietro: '', dop: '', odbior: false, prac: false, tel: '',
  items: [{ dish: '', qty: 1, adds: [] }], uwagi: '', kiedy: '', ok: '', na: '', plat: '', kwota: '',
});
export const isEmpty = (f: Form) => !f.adres && !f.tel && !f.odbior && !f.prac && !f.items.some(i => i.dish.trim());

export const DEFAULT_DAY: Day = {
  soups: ['rosół', 'krem', 'barszcz'],
  mains: ['kurczak', 'żeberko'],
  opts: ['z frytkami', 'makaron osobno', 'bez zielonego', 'bez surówki'],
};
export const SIDES = ['frytki', 'ryż', 'ziemniaki', 'surówka', 'mizeria', 'sos czosnkowy', 'ketchup', 'zero'];
export const MENU: Record<string, string[]> = {
  Zestawy: ['Zestaw dnia', 'Danie dnia', 'Zupa dnia', 'Zestaw miesiąca', 'Danie miesiąca', 'Zupa miesiąca'],
  Zupy: ['Rosół', 'Krem', 'Barszcz', 'Żurek z jajkiem i kiełbasą', 'Kapuśniak', 'Serowo-brokułowa'],
  Obiady: ['Shoarma', 'Quesadilla', 'Jajka sadzone', 'Filet z kurczaka', 'Schabowy', 'Schabowy po hawajsku', 'Frytki'],
  Ryby: ['Dorsz', 'Dorsz grill', 'Łosoś na parze', 'Łosoś grill'],
  Makarony: ['Penne brokułowe', 'Penne kurkowe', 'Penne bazyliowe'],
  Przekąski: ['Cezar', 'Stripsy', 'Krążki cebulowe', 'Nuggetsy', 'Sos czosnkowy'],
  Napoje: ['Sok 0,33L', 'Woda niegazowana', 'Coca cola', 'Fanta', 'Sprite'],
  Słodkie: ['7days', 'Góralki', 'Mars', 'Prince Polo'],
};
export type Menu = Record<string, string[]>;

/** Власні додатки категорії (напр. Napoje → смаки соку). Якщо є — показуються замість загальних «Dodatki». */
export type CatAdds = Record<string, string[]>;

/** Меню текстом: "# Категорія", по одній страві в рядку, додатки категорії — рядки з "+ ". */
export const menuToText = (m: Menu, adds: CatAdds = {}) =>
  Object.entries(m).map(([c, xs]) => ['# ' + c, ...xs, ...(adds[c] ?? []).map(a => '+ ' + a)].join('\n')).join('\n\n');
export function textToMenu(t: string): { menu: Menu; adds: CatAdds } {
  const m: Menu = {}, adds: CatAdds = {}; let cur = '';
  const push = (xs: string[], v: string) => { if (v && !xs.some(x => norm(x) === norm(v))) xs.push(v); };
  for (const raw of t.split('\n')) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#')) { cur = l.replace(/^#+\s*/, '') || 'Bez nazwy'; m[cur] ??= []; continue; }
    if (!cur) { cur = 'Inne'; m[cur] ??= []; }
    if (l.startsWith('+')) push(adds[cur] ??= [], l.replace(/^\+\s*/, ''));
    else push(m[cur], l);
  }
  return { menu: m, adds };
}
/** Категорія, в якій є ця страва. */
export const catOf = (m: Menu, dish: string) =>
  Object.keys(m).find(c => m[c].some(x => norm(x) === norm(dish.trim())));

export const SEED_STREETS = ['Warszawska', 'Krakowska', 'Piotrkowska', 'Radomska', 'Zagnańska', 'Ściegiennego',
  'Henryka Sienkiewicza', 'Słowackiego', 'Stefana Żeromskiego', 'Paderewskiego', 'Kościuszki', 'Grunwaldzka',
  'Targowa', 'Zbożowa', 'Leszczyńska', 'Nowowiejska', 'Wydryńska', 'Artwińskiego', 'Lecha'];

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
export const isDaily = (n: string) =>
  /^(zestaw dnia|danie dnia|zupa dnia|zestaw miesiąca|danie miesiąca|zupa miesiąca)/i.test(n.trim());
export const isParen = (a: string) => /^bez |osobno$/i.test(a);

/** "zestaw dnia, rosół, kurczak (z frytkami, makaron osobno), Ania" */
/** "core (opcja, opcja), Imię" */
const withOpts = (core: string, opts: string[], kto?: string) =>
  core + (opts.length ? ` (${opts.join(', ')})` : '') + (kto ? ', ' + kto : '');

export function fmtItem(it: Item, day: Day): string {
  const d = it.dish.trim(), adds = it.adds, kto = it.kto?.trim();
  if (isDaily(d)) {
    const so = day.soups.map(norm), ma = day.mains.map(norm);
    const soup = adds.filter(a => so.includes(norm(a)));
    const main = adds.filter(a => ma.includes(norm(a)));
    const rest = adds.filter(a => !soup.includes(a) && !main.includes(a));
    return withOpts([d.toLowerCase(), ...soup, ...main].join(', '), rest, kto);
  }
  // "zero" — частина назви напою (Coca cola zero); опції (bez…, …osobno, з меню дня, свої) — у дужках
  const zero = adds.some(a => /^zero$/i.test(a));
  const op = day.opts.map(norm);
  const isOpt = (a: string) => isParen(a) || op.includes(norm(a));
  const com = adds.filter(a => !/^zero$/i.test(a) && !isOpt(a));
  return withOpts([d + (zero ? ' zero' : ''), ...com].join(', '), adds.filter(isOpt), kto);
}

/** withDop=false — без dopisku (на чеку він окремим рядком). */
export function addrLine(o: Pick<Form, 'adres' | 'mieszk' | 'pietro' | 'dop' | 'odbior' | 'prac'>, withDop = true): string {
  const dop = withDop && o.dop.trim() ? ' ' + o.dop.trim() : '';
  if (o.prac) return 'PRACOWNICY' + dop;
  if (o.odbior) return 'ODBIÓR' + dop;
  let a = o.adres.trim();
  if (o.mieszk) a += (a.includes('/') ? ' m. ' : '/') + o.mieszk;
  if (o.pietro) a += ' ' + (/^\d+$/.test(o.pietro) ? 'piętro ' + o.pietro : o.pietro);
  return (a + dop).trim();
}

/** Plain-text version in your notes format (for .txt export). */
export function buildText(o: Form & { n?: number; time?: string }, day: Day, head = false): string {
  const L: string[] = [];
  if (head) L.push(`№${o.n ?? ''}  ${o.time ?? ''}`);
  const w = topWhen(o); if (w) L.push('Na kiedy: ' + w);
  const a = addrLine(o); if (a) L.push('Adres: ' + a);
  if (o.tel) L.push('Nr: ' + o.tel);
  const it = o.items.filter(i => i.dish.trim()).map(i => `${i.qty} x ${fmtItem(i, day)}`);
  if (it.length) L.push('Zamówienie:\n' + it.join('\n'));
  const uw = uwagiLine(o); if (uw) L.push('Uwagi: ' + uw);
  const pay = [o.plat, o.kwota && `${o.kwota} zł`].filter(Boolean).join(' '); if (pay) L.push('Płatność: ' + pay);
  return L.join('\n');
}

export function fmtTel(v: string): string {
  let d = v.replace(/\D/g, ''); if (d.length === 11 && d.startsWith('48')) d = d.slice(2);
  return d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : v.trim();
}
/** "zol 5" -> { q: "zol", rest: " 5" } */
export function splitAddr(v: string) {
  const m = v.match(/^(\D*?)(\s*\d.*)?$/)!;
  const q = m[1].replace(/^(ul\.?|ulica)\s+/i, '').trim();
  return q ? { q, rest: m[2] ?? '' } : { q: v.trim(), rest: '' };
}
export const warns = (o: Form): string[] => [
  !o.odbior && !o.prac && !o.adres && 'brak adresu', !o.odbior && !o.prac && !o.tel && 'brak numeru',
  !o.items.some(i => i.dish.trim()) && 'brak dań', !o.plat && 'brak płatności',
].filter(Boolean) as string[];

/* ---------- фільтри для цифрових полів ---------- */
export const onlyDigits = (v: string, max = 4) => v.replace(/\D/g, '').slice(0, max);
/** Kwota: тільки цифри і одна кома, до 2 знаків після коми, без мінуса. "12.5" -> "12,5" */
export const fmtKwota = (v: string) =>
  v.replace(/[^\d.,]/g, '').match(/^\d{0,6}(?:[.,]\d{0,2})?/)![0].replace('.', ',');
/** Telefon: тільки цифри (макс. 11 з кодом 48), 9 цифр -> "508 661 781". */
export const cleanTel = (v: string) => fmtTel(v.replace(/\D/g, '').slice(0, 11));
type When = Pick<Form, 'na' | 'kiedy' | 'ok'>;
/** Верх чека: лише точна година. */
export const topWhen = (o: When) => (o.na ? 'na ' + o.na : '');
/** Низ чека (у Uwagi): "ASAP" або "Powiem kiedy ok. 14:00". */
export const laterWhen = (o: When) =>
  o.kiedy === 'ASAP' ? 'ASAP' : o.kiedy === 'Powiem kiedy' ? 'Powiem kiedy' + (o.ok ? ' ok. ' + o.ok : '') : '';
/** Для списку замовлень — усе, що вибрано. */
export const whenLabel = (o: When) => [topWhen(o), laterWhen(o)].filter(Boolean).join(' · ');
/** Рядок Uwagi на чеку: спершу ASAP / «Powiem kiedy ok. …», потім текст приміток. */
export const uwagiLine = (o: When & Pick<Form, 'uwagi'>) => [laterWhen(o), o.uwagi.trim()].filter(Boolean).join(', ');
/** Рядок для пошуку координат: "Kościuszki 50, Kielce" (без квартири/поверху). */
export function geoQuery(o: Pick<Form, 'adres' | 'odbior' | 'prac'>): string | null {
  if (o.odbior || o.prac || !o.adres.trim()) return null;
  const { q, rest } = splitAddr(o.adres);
  const num = rest.match(/^\s*(\d+[A-Za-z]?)/)?.[1];
  return `${q}${num ? ' ' + num : ''}, Kielce`;
}
/** Підказки вулиць: "kosc" -> Kościuszki (спершу з початку назви, потім з початку слова, потім будь-де). */
export function suggestStreets(q: string, streets: string[], limit = 6): string[] {
  const nq = norm(q.trim()); if (!nq) return [];
  return streets
    .map(s => { const n = norm(s); return [n.startsWith(nq) ? 0 : n.includes(' ' + nq) ? 1 : n.includes(nq) ? 2 : -1, s] as const; })
    .filter(([p]) => p >= 0).sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], 'pl')).slice(0, limit).map(x => x[1]);
}
