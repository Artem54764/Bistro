// Офіційна назва вулиці Кельце для будь-якого написання: «Kościuszki», «ul. Kościuszki» -> «Generała Tadeusza Kościuszki».
// Потрібно і для порівняння адрес, і для пошуку на карті: з короткою назвою OpenStreetMap часто ставить точку
// посеред вулиці, а не біля будинку.
import { KIELCE_STREETS } from './streets';

/** Як norm() у order.ts + без крапок і зайвих пробілів (тут окремо, щоб не було циклічного імпорту). */
const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
  .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
const PREFIX = /^(ul|ulica|al|aleja|aleje|os|osiedle|pl|plac) /;
const OFFICIAL: [string, string][] = KIELCE_STREETS.map(s => [clean(s), s]);
const BY_KEY = new Map(OFFICIAL);

/**
 * Офіційна назва або null, якщо не впізнали. Точна назва лишається собою; коротка прив'язується до повної,
 * лише якщо така в Кельце одна («Zgoda» ≠ «Mała Zgoda», «1 Maja» ≠ «Plac Konstytucji 3 Maja»).
 */
export function officialStreet(q: string): string | null {
  const raw = clean(q);
  if (BY_KEY.has(raw)) return BY_KEY.get(raw)!;
  const n = raw.replace(PREFIX, '');
  if (BY_KEY.has(n)) return BY_KEY.get(n)!;
  const c = OFFICIAL.filter(([k]) => k.endsWith(' ' + n));
  return c.length === 1 ? c[0][1] : null;
}
/** Ключ вулиці для порівняння адрес (однаковий для короткої й повної назви). */
export function streetKeyOf(q: string): string {
  const o = officialStreet(q);
  return o ? clean(o) : clean(q).replace(PREFIX, '');
}
