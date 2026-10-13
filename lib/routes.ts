/**
 * Розподіл доставок між водіями і порядок об'їзду.
 * D — матриця часу їзди в секундах, індекс 0 — lokal (старт і повернення), 1..n — адреси.
 * Мета: щоб найдовший маршрут був якомога коротшим (усі водії повертаються приблизно разом),
 * а при рівності — менший сумарний час.
 */
/** Кольори водіїв (карта, трекер). */
export const COLORS = ['#e8590c', '#1c7ed6', '#2b8a3e', '#ae3ec9', '#f59f00', '#0c8599'];
export const driverColor = (d?: number) => COLORS[((d ?? 1) - 1) % COLORS.length];

/**
 * Вулиця, додана вручну на карті (не з замовлення). id < 0.
 * stage: немає = до розвезення, 'road' = в дорозі, 'done' = доставлено. Спільне для карти й трекера (route_extra_v1).
 */
export type Extra = {
  id: number; adres: string; lat: number; lon: number; on: boolean;
  stage?: 'road' | 'done'; driver?: number; sentAt?: number; doneAt?: number; seq?: number; etaAt?: number; backAt?: number;
};

export type Plan = { routes: number[][]; times: number[]; eta: number[][] };

/** Час на адресі: одне число для всіх точок або масив по індексах матриці (svc[0] — lokal). */
export type Service = number | number[];
const svcAt = (s: Service, i: number) => (Array.isArray(s) ? s[i] ?? 0 : s);

export function routeTime(D: number[][], r: number[], service: Service): number {
  if (!r.length) return 0;
  let t = D[0][r[0]] + D[r[r.length - 1]][0];
  for (const c of r) t += svcAt(service, c);
  for (let i = 0; i + 1 < r.length; i++) t += D[r[i]][r[i + 1]];
  return t;
}

/** Порівняння планів: спершу найдовший маршрут, потім сума. */
const cost = (times: number[]) => [Math.max(0, ...times), times.reduce((a, b) => a + b, 0)] as const;
const better = (a: readonly [number, number], b: readonly [number, number]) =>
  a[0] < b[0] - 0.5 || (Math.abs(a[0] - b[0]) <= 0.5 && a[1] < b[1] - 0.5);

/** 2-opt усередині одного маршруту (матриця може бути несиметричною — рахуємо повний час). */
function twoOpt(D: number[][], r: number[], service: Service): number[] {
  let best = r, bt = routeTime(D, r, service), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const ct = routeTime(D, cand, service);
        if (ct < bt - 0.5) { best = cand; bt = ct; improved = true; }
      }
    }
  }
  return best;
}

export function planRoutes(D: number[][], drivers: number, service: Service = 180): Plan {
  const n = D.length - 1, K = Math.max(1, drivers);
  const routes: number[][] = Array.from({ length: K }, () => []);

  // 1) вставка: найдальші адреси першими, кожну — туди, де найменше зросте найдовший маршрут
  const order = Array.from({ length: n }, (_, i) => i + 1).sort((a, b) => D[0][b] - D[0][a]);
  for (const c of order) {
    const times = routes.map(r => routeTime(D, r, service));
    let pick = { k: 0, p: 0, c: [Infinity, Infinity] as readonly [number, number] };
    routes.forEach((r, k) => {
      for (let p = 0; p <= r.length; p++) {
        const t = [...times]; t[k] = routeTime(D, [...r.slice(0, p), c, ...r.slice(p)], service);
        const cc = cost(t);
        if (better(cc, pick.c)) pick = { k, p, c: cc };
      }
    });
    routes[pick.k].splice(pick.p, 0, c);
  }

  // 2) покращення: 2-opt у кожному маршруті + перенесення адрес між водіями
  for (let iter = 0; iter < 50; iter++) {
    for (let k = 0; k < K; k++) routes[k] = twoOpt(D, routes[k], service);
    let moved = false;
    const times = routes.map(r => routeTime(D, r, service));
    let cur = cost(times);
    for (let a = 0; a < K && !moved; a++) {
      for (let i = 0; i < routes[a].length && !moved; i++) {
        const c = routes[a][i], ra = routes[a].filter((_, x) => x !== i);
        for (let b = 0; b < K && !moved; b++) {
          if (b === a) continue;
          for (let p = 0; p <= routes[b].length; p++) {
            const rb = [...routes[b].slice(0, p), c, ...routes[b].slice(p)];
            const t = [...times]; t[a] = routeTime(D, ra, service); t[b] = routeTime(D, rb, service);
            const cc = cost(t);
            if (better(cc, cur)) { routes[a] = ra; routes[b] = rb; cur = cc; moved = true; break; }
          }
        }
      }
    }
    if (!moved) break;
  }

  // ETA кожної адреси (секунди від виїзду)
  const eta = routes.map(r => {
    let t = 0, prev = 0;
    return r.map(c => { t += D[prev][c]; prev = c; const at = t; t += svcAt(service, c); return at; });
  });
  return { routes, times: routes.map(r => routeTime(D, r, service)), eta };
}

/**
 * Очищення карти й трекера (замовлення не видаляються, лише ховаються — cleared).
 * 'done' — прибрати доставлені; 'day' — кінець дня: прибрати все, включно з ручними вулицями.
 */
export function clearBoard<O extends { status?: string; cleared?: boolean }, E extends { stage?: string }>(
  mode: 'done' | 'day', orders: O[], extras: E[],
): { orders: O[]; extras: E[] } {
  return mode === 'done'
    ? { orders: orders.map(o => (o.status === 'dostarczone' ? { ...o, cleared: true } : o)), extras: extras.filter(e => e.stage !== 'done') }
    : { orders: orders.map(o => (o.cleared ? o : { ...o, cleared: true })), extras: [] };
}
export const CLEAR_CONFIRM = {
  done: 'Wyczyścić dostarczone z mapy i trackera?\nZamówienia zostają w historii.',
  day: 'Koniec dnia: wyczyścić wszystko z mapy i trackera (także niedostarczone i dodane ręcznie)?\nZamówienia zostają w historii.',
};
