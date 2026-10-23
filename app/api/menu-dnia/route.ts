// Menu dnia z trzcinabistro.pl: zupy, dania i opcje do «Zestaw/Danie/Zupa dnia» i «… miesiąca»
// + aktualne «Zupy 450ml». Strona zmienia format (danie raz w opisie, raz jako wybór) — czytamy oba.
const SITE = 'https://www.trzcinabistro.pl';
const PAGE = SITE + '/restauracja/trzcina-bistro-kielce';
const UA = 'Mozilla/5.0 (TrzcinaBistro-zamowienia)';

type L = Record<string, string> | string | undefined;
const pl = (d: L) => (typeof d === 'string' ? d : d?.pl ?? '');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const low = (s: string) => clean(s).toLowerCase();
const uniq = (xs: string[]) => xs.filter((x, i) => x && xs.findIndex(y => y === x) === i);

type Opt = { name?: L; availability?: string };
type Mod = { name?: L; sections?: { items: [string, Opt][] }[] };
type Prod = { name?: L; description?: L; availability?: string; productModifiers?: string[] };

export async function GET() {
  try {
    const html = await (await fetch(PAGE, { headers: { 'User-Agent': UA }, next: { revalidate: 600 } })).text();
    const api = html.match(/"(\/api\/v1\/sites\/restaurant_menu\/[^"]+)"/)?.[1];
    if (!api) throw new Error('no menu url');
    const j = await (await fetch(SITE + api, { headers: { 'User-Agent': UA }, next: { revalidate: 600 } })).json();
    const c = j.result.catalogue as {
      products: Record<string, Prod>; modifiers: Record<string, Mod>;
      sections: Record<string, { name?: L; content: { items: [string, { itemProduct?: string }][] } }>;
      menus: Record<string, { sections: string[] }>;
    };
    const prods = Object.values(c.products);
    const byName = (n: string) => prods.find(p => low(pl(p.name)) === n);
    const options = (p?: Prod, re?: RegExp) => (p?.productModifiers ?? [])
      .map(id => c.modifiers[id]).filter(m => m && (!re || re.test(low(pl(m.name)))))
      .flatMap(m => (m.sections ?? []).flatMap(s => s.items.filter(([, o]) => o.availability === 'Available').map(([, o]) => low(pl(o.name)))));

    // --- dnia
    const zestaw = byName('zestaw dnia'), danie = byName('danie dnia'), zupa = byName('zupa dnia');
    const soups = uniq([...options(zestaw, /zup/), ...options(zupa, /zup/)]);
    let mains = uniq([...options(zestaw, /dani/), ...options(danie, /dani/)]);
    const opts = uniq([...options(zestaw, /dodat/), ...options(danie, /dodat/)]);
    if (!mains.length && danie) {
      // danie tylko w opisie: «Danie: X z ziemniakami…» / «Danie do wyboru: X lub Y»
      const d = clean(pl(danie.description)).replace(/^danie( do wyboru)?:\s*/i, '');
      mains = d.split(/\s+lub\s+/i).map(x => low(opts.length ? x.split(/\s+(?:z|ze)\s+(?:ziemniak|frytk|ryż)/i)[0] : x)).filter(Boolean);
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

    if (!soups.length && !mains.length) throw new Error('no daily menu');
    // окремо: «… dnia» і «… miesiąca»
    return Response.json({
      soups, mains, opts,
      mSoups: mSoup ? [mSoup] : [], mMains: mMain ? [mMain] : [], mOpts,
      zupy, at: Date.now(),
    });
  } catch {
    return Response.json({ error: 'Nie udało się pobrać menu dnia ze strony' }, { status: 502 });
  }
}
