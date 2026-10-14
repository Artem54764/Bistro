'use client';
import { useEffect, useMemo, useState } from 'react';
import { SEED_STREETS, norm } from './order';

/** useState that persists to localStorage (hydration-safe: loads after mount). */
export function useLS<T>(key: string, init: T) {
  const [v, setV] = useState<T>(init);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw) setV(JSON.parse(raw)); } catch {}
    setReady(true);
    // інша вкладка змінила значення (напр. меню) — підхопити
    const h = (e: StorageEvent) => { if (e.key === key && e.newValue) try { setV(JSON.parse(e.newValue)); } catch {} };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }, [key]);
  useEffect(() => {
    if (ready) try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  }, [key, v, ready]);
  return [v, setV, ready] as const;
}

/**
 * Вулиці Кельце: сервер (OpenStreetMap) -> кеш у браузері -> + вбудований список.
 * Список оновлюється сам: повний — раз на 30 днів, неповний (Overpass не відповів) — що 6 год.
 * Якщо оновлення не вдалося, лишається попередній список (і старий кеш streets_v1).
 */
export function useStreets(learned: string[] = []) {
  type Cache = { at: number; full: boolean; list: string[] };
  const [cache, setCache, ready] = useLS<Cache | null>('streets_v2', null);
  const [legacy] = useLS<string[]>('streets_v1', []);
  useEffect(() => {
    if (!ready) return;
    const ttl = cache?.full ? 30 * 864e5 : 6 * 36e5;
    if (cache && Date.now() - cache.at < ttl && cache.list.length) return;
    fetch('/api/streets').then(r => r.json())
      .then(d => {
        const list: string[] = Array.isArray(d) ? d : d?.streets;
        if (Array.isArray(list) && list.length) setCache({ at: Date.now(), full: !Array.isArray(d) && !!d.full, list });
      }).catch(() => {});
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const seen = new Set<string>(), out: string[] = [];
    [...(cache?.list ?? []), ...legacy, ...learned, ...SEED_STREETS].forEach(s => { const k = norm(s); if (!seen.has(k)) { seen.add(k); out.push(s); } });
    return out.sort((a, b) => a.localeCompare(b, 'pl'));
  }, [cache, legacy, learned]);
}

export type Coord = { lat: number; lon: number } | null;
/** Адреси -> координати. По одному запиту на ~1.1 с (ліміт Nominatim), результат кешується в браузері. */
export function useGeocode(queries: string[]) {
  const [cache, setCache, ready] = useLS<Record<string, Coord>>('geo_v1', {});
  const [tick, setTick] = useState(0);   // повтор після помилки мережі
  const todo = queries.filter(q => !(q in cache));
  const key = todo.join('|');
  useEffect(() => {
    if (!ready || !todo.length) return;
    const q = todo[0];
    const t = setTimeout(async () => {
      let val: Coord = null;
      try {
        const r = await fetch('/api/geocode?q=' + encodeURIComponent(q));
        if (r.ok) { const j = await r.json(); if (j && typeof j.lat === 'number') val = j; }
        else throw new Error();
      } catch {   // помилка мережі — не записуємо «не знайдено», повторимо за 5 с
        setTimeout(() => setTick(x => x + 1), 5000); return;
      }
      setCache(c => ({ ...c, [q]: val }));
    }, 1100);
    return () => clearTimeout(t);
  }, [ready, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Забути «не знайдено», щоб пошукати знову. */
  const retry = () => setCache(c => Object.fromEntries(Object.entries(c).filter(([, v]) => v)));
  /** Вручну вказане місце (клік на карті) замість знайденого. */
  const setCoord = (q: string, c: Coord) => setCache(x => ({ ...x, [q]: c }));
  return { cache, setCoord, pending: todo.length, retry };
}

/** Водії: кількість і імена (спільні для трекера, карти й списку замовлень). */
export function useDrivers() {
  const [count, setCount] = useLS<number>('drivers_v1', 2);
  const [names, setNames] = useLS<string[]>('driver_names_v1', []);
  /** Ім'я водія d (1, 2, …) або «K1», якщо не підписаний. */
  const label = (d?: number) => (d ? names[d - 1]?.trim() || `K${d}` : '?');
  const setName = (d: number, v: string) => setNames(ns => { const x = [...ns]; x[d - 1] = v; return x; });
  return { count, setCount: (n: number) => setCount(Math.min(8, Math.max(1, n))), names, label, setName };
}
