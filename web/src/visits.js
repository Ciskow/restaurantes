// Visit dates are plain days (YYYY-MM-DD). They are read at noon UTC so no time zone can move them to another day.

export const NOTE_MAX = 300;

const atNoon = (iso) => new Date(`${iso}T12:00:00Z`);
const fmt = (opts) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts });
const WEEKDAY_LONG = fmt({ weekday: 'long' });
const WEEKDAY_SHORT = fmt({ weekday: 'short' });
const MONTH_LONG = fmt({ month: 'long' });
const MONTH_SHORT = fmt({ month: 'short' });

export const brDate = (iso) => iso.split('-').reverse().join('/');
export const weekday = (iso) => WEEKDAY_LONG.format(atNoon(iso));
/** "sáb", without the dot Intl adds. */
export const weekdayShort = (iso) => WEEKDAY_SHORT.format(atNoon(iso)).replace('.', '');

/** Month 0-11 -> "março" / "mar". */
export const monthName = (m) => MONTH_LONG.format(new Date(Date.UTC(2000, m, 15)));
export const monthShort = (m) => MONTH_SHORT.format(new Date(Date.UTC(2000, m, 15))).replace('.', '');

export const visitsLabel = (n) => (n === 1 ? '1 visita' : `${n} visitas`);

/** A real day in YYYY-MM-DD that is not after today. */
export function validDate(iso, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === iso && +m[1] >= 1900 && iso <= today;
}
