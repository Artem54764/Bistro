// Server-side fetch of Kielce street names from OpenStreetMap (Overpass), cached for 30 days by Next.
export const revalidate = 2592000; // 30 днів

const HW = '["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"]';
const QUERY = `[out:json][timeout:60];area["name"="Kielce"]["boundary"="administrative"]->.a;way(area.a)(50.78,20.50,50.95,20.78)["name"]${HW};out tags;`;
const HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export async function GET() {
  for (const host of HOSTS) {
    try {
      const r = await fetch(`${host}?data=${encodeURIComponent(QUERY)}`, { next: { revalidate } });
      if (!r.ok) continue;
      const j = await r.json();
      const names = [...new Set<string>((j.elements ?? []).map((e: any) => e.tags?.name).filter(Boolean))]
        .map(n => n.replace(/^ulica\s+/i, ''))
        .sort((a, b) => a.localeCompare(b, 'pl'));
      if (names.length) return Response.json(names);
    } catch { /* try next mirror */ }
  }
  return Response.json([], { status: 502 });
}
