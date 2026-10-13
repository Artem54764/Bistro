// Адреса -> координати через Nominatim (OpenStreetMap). Шукаємо лише в межах Кельце.
// Політика Nominatim: ≤1 запит/с і власний User-Agent — клієнт шле запити по черзі (useGeocode).
const UA = 'TrzcinaBistro-zamowienia/1.0';
const VIEWBOX = '20.50,50.95,20.78,50.78';   // lon1,lat1,lon2,lat2 — Kielce

/** ?lat=&lon= — зворотний пошук: точка на карті -> "Kościuszki 50" */
async function reverse(lat: number, lon: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pl' }, next: { revalidate: 2592000 } });
    if (!r.ok) return Response.json(null, { status: 502 });
    const a = (await r.json()).address ?? {};
    const street = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? '';
    const adres = [street.replace(/^(ulica|ul\.)\s+/i, ''), a.house_number].filter(Boolean).join(' ');
    return Response.json({ adres: adres || null, city: a.city ?? a.town ?? a.village ?? '' });
  } catch {
    return Response.json(null, { status: 502 });
  }
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get('lat')), lon = Number(sp.get('lon'));
  if (sp.has('lat') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return reverse(lat, lon);
  }
  const q = sp.get('q')?.trim();
  if (!q || q.length > 200) return Response.json(null, { status: 400 });
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pl' }, next: { revalidate: 2592000 } });
    if (!r.ok) return Response.json(null, { status: 502 });
    const j = await r.json();
    const hit = Array.isArray(j) && j[0];
    return Response.json(hit ? { lat: +hit.lat, lon: +hit.lon } : null);
  } catch {
    return Response.json(null, { status: 502 });
  }
}
