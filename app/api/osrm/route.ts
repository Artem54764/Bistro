// Час їзди між точками через публічний OSRM (дороги OpenStreetMap, авто) — для оцінки повернення водія в трекері.
// ?service=table&coords=lon,lat;lon,lat…  -> { durations: number[][] } (секунди)
const COORD = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const service = sp.get('service'), coords = sp.get('coords') ?? '';
  const pts = coords.split(';');
  if (service !== 'table' || pts.length < 2 || pts.length > 80 || !pts.every(p => COORD.test(p))) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`;
  try {
    const r = await fetch(url, { next: { revalidate: 3600 } });
    const j = await r.json();
    if (!r.ok || j.code !== 'Ok') return Response.json({ error: j.message ?? 'OSRM error' }, { status: 502 });
    return Response.json({ durations: j.durations });
  } catch {
    return Response.json({ error: 'Brak połączenia z serwerem tras' }, { status: 502 });
  }
}
