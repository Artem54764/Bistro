// Час їзди між точками і лінії маршрутів через публічний OSRM (дороги OpenStreetMap, авто).
// ?service=table&coords=lon,lat;lon,lat…  -> { durations: number[][] } (секунди)
// ?service=route&coords=…                 -> { geometry: [lat,lon][], duration }
const COORD = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const service = sp.get('service'), coords = sp.get('coords') ?? '';
  const pts = coords.split(';');
  if ((service !== 'table' && service !== 'route') || pts.length < 2 || pts.length > 80 || !pts.every(p => COORD.test(p))) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const url = service === 'table'
    ? `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`
    : `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const r = await fetch(url, { next: { revalidate: 3600 } });
    const j = await r.json();
    if (!r.ok || j.code !== 'Ok') return Response.json({ error: j.message ?? 'OSRM error' }, { status: 502 });
    if (service === 'table') return Response.json({ durations: j.durations });
    const route = j.routes[0];
    return Response.json({
      geometry: route.geometry.coordinates.map(([lon, lat]: number[]) => [lat, lon]),
      duration: route.duration,
    });
  } catch {
    return Response.json({ error: 'Brak połączenia z serwerem tras' }, { status: 502 });
  }
}
