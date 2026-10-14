// Назви вулиць Кельце з OpenStreetMap (Overpass), кеш Next на 30 днів.
// Спершу повний список (усі названі дороги, площі, «вулиці»-зв'язки); якщо Overpass не відповідає —
// старий, вужчий запит (зазвичай уже лежить у кеші). Відповідь: { streets, full }.
export const revalidate = 2592000; // 30 днів

const AREA = 'area["name"="Kielce"]["boundary"="administrative"]->.a;';
const FULL = `[out:json][timeout:90];${AREA}(way(area.a)["highway"]["name"];way(area.a)["place"="square"]["name"];relation(area.a)["type"="street"]["name"];);out tags;`;
const HW = '["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"]';
const BASIC = `[out:json][timeout:60];${AREA}way(area.a)(50.78,20.50,50.95,20.78)["name"]${HW};out tags;`;
const HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function load(query: string): Promise<string[] | null> {
  for (const host of HOSTS) {
    try {
      const r = await fetch(`${host}?data=${encodeURIComponent(query)}`, { next: { revalidate }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const j = await r.json();
      const names = [...new Set<string>((j.elements ?? []).map((e: { tags?: { name?: string } }) => e.tags?.name).filter(Boolean))]
        .map(n => n.replace(/^ulica\s+/i, ''))
        .sort((a, b) => a.localeCompare(b, 'pl'));
      if (names.length) return names;
    } catch { /* наступне дзеркало */ }
  }
  return null;
}

export async function GET() {
  const full = await load(FULL);
  if (full) return Response.json({ streets: full, full: true });
  const basic = await load(BASIC);
  if (basic) return Response.json({ streets: basic, full: false });
  return Response.json({ streets: [], full: false }, { status: 502 });
}
