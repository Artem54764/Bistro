// Menu dnia z trzcinabistro.pl: zupy, dania i opcje do «… dnia» i окремо «… miesiąca» + aktualne «Zupy 450ml».
import { parseDaily, type Catalogue } from '@/lib/daily';

const SITE = 'https://www.trzcinabistro.pl';
const PAGE = SITE + '/restauracja/trzcina-bistro-kielce';
const UA = 'Mozilla/5.0 (TrzcinaBistro-zamowienia)';

export async function GET() {
  try {
    const html = await (await fetch(PAGE, { headers: { 'User-Agent': UA }, next: { revalidate: 600 } })).text();
    const api = html.match(/"(\/api\/v1\/sites\/restaurant_menu\/[^"]+)"/)?.[1];
    if (!api) throw new Error('no menu url');
    const j = await (await fetch(SITE + api, { headers: { 'User-Agent': UA }, next: { revalidate: 600 } })).json();
    const d = parseDaily(j.result.catalogue as Catalogue);
    if (!d.soups.length && !d.mains.length) throw new Error('no daily menu');
    return Response.json({ ...d, at: Date.now() });
  } catch {
    return Response.json({ error: 'Nie udało się pobrać menu dnia ze strony' }, { status: 502 });
  }
}
