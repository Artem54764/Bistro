// Розбір меню дня з даних сайту Restaumatic (trzcinabistro.pl). Чиста функція — легко перевірити.
type L = Record<string, string> | string | undefined;
const pl = (d: L) => (typeof d === 'string' ? d : d?.pl ?? '');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const low = (s: string) => clean(s).toLowerCase();
const uniq = (xs: string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);

type Price = { values?: [unknown, number][] };
const cost = (p?: Price) => p?.values?.[0]?.[1] ?? 0;
type Opt = { name?: L; availability?: string; price?: Price };
type Mod = { name?: L; sections?: { items: [string, Opt][] }[] };
type Prod = { name?: L; description?: L; availability?: string; productModifiers?: string[]; price?: Price };
export type Catalogue = {
  products: Record<string, Prod>; modifiers: Record<string, Mod>;
  sections: Record<string, { name?: L; content: { items: [string, { itemProduct?: string }][] } }>;
  menus: Record<string, { sections: string[] }>;
};
/**
 * Ціни із сайту. Ключі — назви малими літерами.
 * opts: для кожної страви — її опції і всі їхні ціни (один соус буває і безкоштовний, і за +3).
 * adds: найвища ціна додатка на сайті — для додатків, яких сайт не пропонує саме до цієї страви.
 */
export type SitePrices = { dishes: Record<string, number>; opts: Record<string, Record<string, number[]>>; adds: Record<string, number> };
export type Daily = {
  soups: string[]; mains: string[]; opts: string[]; mSoups: string[]; mMains: string[]; mOpts: string[]; zupy: string[];
  prices: SitePrices; catAdds: Record<string, string[]>;
};

/** Назва на сайті -> наша коротка: «Surówka: lodowa, papryka…» -> «surówka lodowa», «Jabłko - mięta» -> «jabłko-mięta». */
export function shortAdd(name: string): string {
  const n = low(name).replace(/\s+-\s+/g, '-');
  const m = n.match(/^surówka:\s*([^,]+)/);
  if (!m) return n;
  const first = m[1].replace(/\s+na zimno$/, '').trim();
  return /^(lodowa|pekińska|grecka)$/.test(first) ? 'surówka ' + first : first;
}
const RENAME: Record<string, string> = {
  'nuggetsy z frytkami, surówka': 'nuggetsy z frytkami i surówką',
  'paluszki rybne z frytkami, surówka': 'paluszki rybne z frytkami i surówką',
};
/** Вибір «Coca Cola / Coca cola zero»: у нас це один додаток «zero», звичайний варіант не показуємо. */
const asAdd = (short: string) => (/ zero$/.test(short) ? 'zero' : /^(coca cola|sprite)$/.test(short) ? '' : short);

export function parseDaily(c: Catalogue): Daily {
  const prods = Object.values(c.products);
  const byName = (n: string) => prods.find(p => low(pl(p.name)) === n);
  const options = (p?: Prod, re?: RegExp) => (p?.productModifiers ?? [])
    .map(id => c.modifiers[id]).filter(m => m && (!re || re.test(low(pl(m.name)))))
    .flatMap(m => (m.sections ?? []).flatMap(s => s.items.filter(([, o]) => o.availability === 'Available').map(([, o]) => low(pl(o.name)))));

  // --- dnia
  // Сайт пише по-різному: список вибору («Zupa do wyboru», «Danie do wyboru») або лише опис
  // («Pieczarkowa», «Zupa do wyboru: A, B + Danie: X z ryżem…»). Додатки — група «Dodatki do dania».
  const zestaw = byName('zestaw dnia'), danie = byName('danie dnia'), zupa = byName('zupa dnia');
  const SOUP = /zup/, OPTS = /dodat/, MAIN = (n: string) => /dani/.test(n) && !/dodat|zup/.test(n);
  const optsOf = (p: Prod | undefined, f: (n: string) => boolean) => (p?.productModifiers ?? [])
    .map(id => c.modifiers[id]).filter(m => m && f(low(pl(m.name))))
    .flatMap(m => (m.sections ?? []).flatMap(s => s.items.filter(([, o]) => o.availability === 'Available').map(([, o]) => low(pl(o.name)))));
  const opts = uniq([...optsOf(zestaw, n => OPTS.test(n)), ...optsOf(danie, n => OPTS.test(n))]);
  let soups = uniq([...optsOf(zestaw, n => SOUP.test(n)), ...optsOf(zupa, n => SOUP.test(n))]);
  let mains = uniq([...optsOf(zestaw, MAIN), ...optsOf(danie, MAIN)]);
  // з опису: «Zupa do wyboru: A, B» / «A lub B»; у zestawie — частина до « + »
  const zDesc = clean(pl(zestaw?.description)), [zSoup = '', zMain = ''] = zDesc.split(/\s+\+\s+/);
  const list = (t: string, label: RegExp, sep: RegExp) => clean(t).replace(label, '').split(sep).map(low).filter(Boolean);
  // супи: «A, B lub C»; страви — лише «X lub Y» (у назві страви бувають коми)
  if (!soups.length) soups = list(pl(zupa?.description) || zSoup, /^zupa( dnia)?( do wyboru)?:\s*/i, /\s*,\s*|\s+lub\s+/i);
  if (!mains.length) {
    // страва: без гарніру, який вибирається окремо («… z ryżem i surówką» при опції «z ryżem»)
    const side = /\s+(?:z|ze)\s+(?:ziemniak|frytk|ryż|kasz|makaron)/i;
    mains = list(pl(danie?.description) || zMain, /^danie( dnia)?( do wyboru)?:\s*/i, /\s+lub\s+/i).map(x => (opts.length ? low(x.split(side)[0]) : x));
  }
  // --- miesiąca (w opisie: «Zupa: X / …», «Danie: Y / …»)
  const part = (p: Prod | undefined, label: string) => {
    const m = pl(p?.description).match(new RegExp(label + ':\\s*([^\\n]+)', 'i'));
    return m ? low(m[1].split('/')[0]) : '';
  };
  const mSoup = part(byName('zupa miesiąca') ?? byName('zestaw miesiąca'), 'Zupa');
  const mMain = part(byName('danie miesiąca') ?? byName('zestaw miesiąca'), 'Danie');
  const mOpts = options(byName('zestaw miesiąca') ?? byName('danie miesiąca'), /dodat/);

  // --- «Zupy 450ml» (widoczne na stronie)
  const menu = Object.values(c.menus)[0];
  const sec = menu?.sections.map(id => c.sections[id]).find(s => /zup/i.test(pl(s?.name)) && !/dnia|miesi/i.test(pl(s?.name)));
  const zupy = (sec?.content.items ?? []).map(([, it]) => c.products[it.itemProduct ?? ''])
    .filter(p => p && p.availability !== 'Hidden').map(p => clean(pl(p.name)));


  // --- ціни страв і опцій
  const prices: SitePrices = { dishes: {}, opts: {}, adds: {} };
  for (const p of prods) {
    const n = low(pl(p.name)), key = RENAME[n] ?? n;
    if (n && !(key in prices.dishes)) prices.dishes[key] = cost(p.price);
    for (const id of p.productModifiers ?? []) for (const s of c.modifiers[id]?.sections ?? []) for (const [, o] of s.items) {
      if (o.availability !== 'Available') continue;
      const v = cost(o.price);
      for (const k of uniq([low(pl(o.name)), shortAdd(pl(o.name))])) {
        ((prices.opts[key] ??= {})[k] ??= []).push(v);
        if (v > (prices.adds[k] ?? 0)) prices.adds[k] = v;
      }
    }
  }

  // --- додатки категорій: усе, що сайт пропонує до видимих страв категорії (без «… dnia / miesiąca»)
  const catAdds: Record<string, string[]> = {};
  for (const id of menu?.sections ?? []) {
    const s = c.sections[id], name = clean(pl(s?.name));
    if (!name || /dnia|miesi/i.test(name)) continue;
    const list = (s.content.items ?? []).map(([, it]) => c.products[it.itemProduct ?? ''])
      .filter(p => p && p.availability !== 'Hidden')
      .flatMap(p => (p.productModifiers ?? []).flatMap(m => (c.modifiers[m]?.sections ?? []).flatMap(x => x.items)))
      .filter(([, o]) => o.availability === 'Available').map(([, o]) => asAdd(shortAdd(pl(o.name))));
    // спершу гарніри й салати, соуси в кінці
    if (list.some(Boolean)) { const u = uniq(list); catAdds[name] = [...u.filter(x => !x.startsWith('sos ')), ...u.filter(x => x.startsWith('sos '))]; }
  }

  return { soups, mains, opts, mSoups: mSoup ? [mSoup] : [], mMains: mMain ? [mMain] : [], mOpts, zupy, prices, catAdds };
}
