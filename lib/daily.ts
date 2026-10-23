// Розбір меню дня з даних сайту Restaumatic (trzcinabistro.pl). Чиста функція — легко перевірити.
type L = Record<string, string> | string | undefined;
const pl = (d: L) => (typeof d === 'string' ? d : d?.pl ?? '');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const low = (s: string) => clean(s).toLowerCase();
const uniq = (xs: string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);

type Opt = { name?: L; availability?: string };
type Mod = { name?: L; sections?: { items: [string, Opt][] }[] };
type Prod = { name?: L; description?: L; availability?: string; productModifiers?: string[] };
export type Catalogue = {
  products: Record<string, Prod>; modifiers: Record<string, Mod>;
  sections: Record<string, { name?: L; content: { items: [string, { itemProduct?: string }][] } }>;
  menus: Record<string, { sections: string[] }>;
};
export type Daily = { soups: string[]; mains: string[]; opts: string[]; mSoups: string[]; mMains: string[]; mOpts: string[]; zupy: string[] };

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


  return { soups, mains, opts, mSoups: mSoup ? [mSoup] : [], mMains: mMain ? [mMain] : [], mOpts, zupy };
}
