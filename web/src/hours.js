// Opening hours: one text per weekday (index 0 = Sunday), '' when closed,
// "12:00-15:00, 19:00-23:00" otherwise. An empty list means nobody typed them in yet.

export const DAYS = [
  { i: 1, short: 'Seg', long: 'Segunda' },
  { i: 2, short: 'Ter', long: 'Terça' },
  { i: 3, short: 'Qua', long: 'Quarta' },
  { i: 4, short: 'Qui', long: 'Quinta' },
  { i: 5, short: 'Sex', long: 'Sexta' },
  { i: 6, short: 'Sáb', long: 'Sábado' },
  { i: 0, short: 'Dom', long: 'Domingo' },
];

const RANGE = /(\d{1,2})\s*(?:[:h.]\s*(\d{2}))?\s*h?\s*(?:-|–|—|às|as|a|até)\s*(\d{1,2})\s*(?:[:h.]\s*(\d{2}))?\s*h?/gi;
const pad = (n) => String(n).padStart(2, '0');

/** Minutes since midnight for each range of a day's text. */
export function ranges(text) {
  const out = [];
  for (const m of String(text || '').matchAll(RANGE)) {
    const start = Number(m[1]) * 60 + Number(m[2] || 0);
    const end = Number(m[3]) * 60 + Number(m[4] || 0);
    if (Number(m[1]) < 24 && Number(m[3]) <= 24 && start < 1440 && end <= 1440) out.push([start, end % 1440]);
  }
  return out;
}

/** "12h às 15h e 19-23" -> "12:00-15:00, 19:00-23:00". Null when text was typed but nothing could be read. */
export function normalizeDay(text) {
  const t = String(text || '').trim();
  if (!t || /^(fechado|-|—|x)$/i.test(t)) return '';
  const r = ranges(t);
  if (!r.length) return null;
  return r.map(([s, e]) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}-${pad(Math.floor(e / 60))}:${pad(e % 60)}`).join(', ');
}

/** Weekday and minute right now in São Paulo, whatever the phone's own time zone says. */
export function nowSP(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    min: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const clock = (min) => `${Math.floor(min / 60)}h${min % 60 ? pad(min % 60) : ''}`;

/** { open, text } such as "Aberto até 23h" or "Abre às 18h"; null when the hours are unknown. */
export function openStatus(hours, now) {
  const open = isOpen(hours, now);
  if (open === null) return null;
  if (open) {
    if (hours[now.day] === '00:00-00:00') return { open, text: 'Aberto 24 horas' };
    const today = ranges(hours[now.day]).find(([s, e]) => (e > s ? now.min >= s && now.min < e : now.min >= s));
    const late = ranges(hours[(now.day + 6) % 7]).find(([s, e]) => e <= s && now.min < e);
    const end = (today || late)[1];
    return { open, text: `Aberto até ${end === 0 ? 'meia-noite' : clock(end)}` };
  }
  const next = ranges(hours[now.day]).map(([s]) => s).filter((s) => s > now.min).sort((a, b) => a - b)[0];
  return { open, text: next != null ? `Abre às ${clock(next)}` : 'Fechado agora' };
}

/** true / false, or null when the hours are unknown. A range like 18:00-02:00 runs past midnight. */
export function isOpen(hours, now) {
  if (!Array.isArray(hours) || hours.length !== 7) return null;
  for (const [s, e] of ranges(hours[now.day])) {
    if (e > s ? now.min >= s && now.min < e : now.min >= s) return true;
  }
  for (const [s, e] of ranges(hours[(now.day + 6) % 7])) {
    if (e <= s && now.min < e) return true;
  }
  return false;
}
