// The random pick: rules that narrow the pool, weights that tilt it, and vetoes that last one day.

const OPTS_KEY = 'bora-comer-sorteio';
const VETO_KEY = 'bora-comer-vetos';
export const REST_DAYS = 30;

/** Today in São Paulo as YYYY-MM-DD, whatever the phone's own time zone says. */
export const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export function loadDrawOpts() {
  try {
    return { fresh: false, rest: false, ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') };
  } catch { return { fresh: false, rest: false }; }
}
export function saveDrawOpts(opts) {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* storage unavailable */ }
}

/** Vetoes are kept per day, so tomorrow everything is back in the hat. */
export function loadVetoes() {
  try {
    const v = JSON.parse(localStorage.getItem(VETO_KEY) || 'null');
    if (v?.day === dayKey() && Array.isArray(v.ids)) return v.ids;
  } catch { /* storage unavailable */ }
  return [];
}
export function saveVetoes(ids) {
  try { localStorage.setItem(VETO_KEY, JSON.stringify({ day: dayKey(), ids })); } catch { /* storage unavailable */ }
}

export function daysSince(isoDate) {
  if (!isoDate) return null;
  return Math.floor((Date.parse(dayKey()) - Date.parse(isoDate)) / 86_400_000);
}

export function drawPool(list, opts, vetoes) {
  return list.filter((p) => {
    if (vetoes.includes(p.id)) return false;
    if (opts.rest && p.visited) {
      const d = daysSince(p.last_visit);
      if (d != null && d < REST_DAYS) return false;
    }
    return true;
  });
}

/** With "fresh" on, a place you have never been to is three times as likely (four if it is on the wish list). */
export function pick(pool, opts, avoidId) {
  const from = pool.length > 1 ? pool.filter((p) => p.id !== avoidId) : pool;
  if (!from.length) return null;
  const weight = (p) => (opts.fresh && !p.visited ? (p.want ? 4 : 3) : 1);
  let roll = Math.random() * from.reduce((sum, p) => sum + weight(p), 0);
  for (const p of from) {
    roll -= weight(p);
    if (roll < 0) return p;
  }
  return from[from.length - 1];
}
