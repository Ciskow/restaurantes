// Turns a pasted Google Maps or Instagram link into the fields of a place.
//
// A Maps link only carries the name and (usually) the coordinates. Address, website and opening
// hours come from one of two places:
//   - Google's Places API, when GOOGLE_PLACES_KEY is set in .env (complete, needs a Google Cloud key);
//   - otherwise OpenStreetMap, which is free but only knows part of the restaurants.
import { findVenue, geocodePlace, km, reverse } from './geocode.js';

const SP = { lat: -23.55, lng: -46.63 };
// New places can be anywhere in the state (Campinas, the coast...), not only in the capital.
const MAX_KM = 350;
const GOOGLE = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|share\.google|(www\.|maps\.)?google\.(com|com\.br))$/i;
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const STREET = /^(.*?)(?:\s+[-–]\s+|,\s+)((?:R\.|Rua|Av\.|Avenida|Al\.|Alameda|Praça|Pç?a\.|Largo|Travessa|Tv\.|Rod\.|Rodovia|Estr\.|Estrada)\s.+)$/i;

const decode = (s) => {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s.replace(/\+/g, ' '); }
};
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor((min % 1440) / 60))}:${pad(min % 60)}`;
const http = (v) => (/^https?:\/\//i.test(v || '') ? v : v ? `https://${v}` : '');

function titleFromHandle(handle) {
  return handle.replace(/[._]+/g, ' ').trim().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/** Follows redirects by hand so every hop is checked against the Google host list. */
async function follow(start) {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'https:' || !GOOGLE.test(url.hostname)) throw new Error('fora do Google Maps');
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    const next = res.headers.get('location');
    await res.body?.cancel();
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url);
      continue;
    }
    return url;
  }
  throw new Error('redirecionamentos demais');
}

/** Name, address and coordinates as far as the link itself tells. */
export function parseMapsUrl(url) {
  const href = decodeURI(url.href);
  const place = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  const label = place ? decode(place[1]) : decode(url.searchParams.get('q') || url.searchParams.get('query') || '');

  // Links shared from the phone app read "Name - R. Street, 123 - Bairro, City - SP, 01234-567".
  let name = label;
  let address = '';
  const m = STREET.exec(label);
  if (m) [, name, address] = m;
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(name)) name = '';
  address = address.replace(/,?\s*\d{5}-?\d{3}.*$/, '').replace(/,\s*Bra[sz]il$/i, '').trim();

  // !3d/!4d is the pin itself; @lat,lng is only where the map was centred. Coordinates inside the
  // page are not used: Google centres it wherever it guesses the visitor is.
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(href) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(href) ||
    /[?&](?:q|ll|query)=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(href);
  return { name: name.trim(), address, pos: pin ? { lat: Number(pin[1]), lng: Number(pin[2]) } : null };
}

// ---- OpenStreetMap opening hours ("Mo-Fr 12:00-15:00,19:00-23:00; Sa 12:00-24:00; Su off") ----
const OSM_DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

/** Seven texts in the app's own format, or null when the rule uses something not handled (months, holidays only...). */
export function parseOsmHours(text) {
  const src = String(text || '').trim().toLowerCase();
  if (!src) return null;
  if (src === '24/7') return Array(7).fill('00:00-00:00');
  const week = Array(7).fill(null);
  for (const rule of src.split(';').map((r) => r.trim()).filter(Boolean)) {
    const m = /^((?:(?:mo|tu|we|th|fr|sa|su|ph)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)*)(.*)$/.exec(rule);
    const days = new Set();
    for (const part of m[1].split(',').map((p) => p.trim()).filter(Boolean)) {
      const [from, to] = part.split('-').map((d) => OSM_DAYS.indexOf(d.trim()));
      if (from < 0) continue; // public holidays: ignored
      for (let d = from; ; d = (d + 1) % 7) {
        days.add(d);
        if (to === undefined || to < 0 || d === to) break;
      }
    }
    if (m[1].trim() && !days.size) continue; // a rule only about holidays
    const target = days.size ? [...days] : [0, 1, 2, 3, 4, 5, 6];
    const body = m[2].trim();
    let value;
    if (/^(off|closed)$/.test(body)) value = '';
    else {
      const spans = body.split(',').map((s) => /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/.exec(s.trim()));
      if (!spans.length || spans.some((s) => !s)) return null;
      value = spans.map((s) => `${hhmm(Number(s[1]) * 60 + Number(s[2]))}-${hhmm(Number(s[3]) * 60 + Number(s[4]))}`).join(', ');
    }
    for (const d of target) week[d] = value;
  }
  if (week.every((d) => d === null)) return null;
  return week.map((d) => d ?? '');
}

const plain = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Guards against picking the shop next door: one name has to contain the other, or its first two words. */
function sameName(asked, found) {
  const a = plain(asked);
  const b = plain(found);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || b.includes(a.split(' ').slice(0, 2).join(' '));
}

async function fromOsm(out, name, pos) {
  // The Google name often has extras ("A Casa do Porco Bar"); near a known point a shorter name is safe to try.
  const words = name.split(/\s+/);
  const tries = [name, ...(pos && words.length > 2 ? [words.slice(0, -1).join(' '), words.slice(0, 2).join(' ')] : [])];
  let venue = null;
  for (const q of [...new Set(tries)]) {
    venue = await findVenue(q, pos).catch(() => null);
    if (venue && (pos || km(SP, venue) < MAX_KM) && sameName(name, venue.name)) break;
    venue = null;
  }
  if (!venue) return false;
  const t = venue.tags;
  if (!pos) Object.assign(out, { lat: venue.lat, lng: venue.lng, geo_approx: false });
  if (!out.address && venue.address) out.address = venue.address;
  out.bairro = venue.bairro;
  out.city = venue.city;
  const site = http(t.website || t['contact:website'] || t.url);
  if (site) out.website = site;
  const insta = t['contact:instagram'] || '';
  if (insta) out.instagram = /^https?:/i.test(insta) ? insta : `https://www.instagram.com/${insta.replace(/^@/, '')}/`;
  const hours = parseOsmHours(t.opening_hours);
  if (hours) out.hours = hours;
  out.source = 'OpenStreetMap';
  return true;
}

const PRICE_LEVELS = ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'];

// Google's type ("Restaurante italiano", "Pizzaria", "Bar") -> the food types already used in the app.
const CATEGORY_RULES = [
  [/pizza/, 'Pizzaria'], [/hamb[uú]rg/, 'Hamburgueria'], [/sushi|japon/, 'Japonês'], [/l[aá]men|ramen/, 'Japonês'],
  [/churrasc|steak|carnes/, 'Churrascaria'], [/caf[eé]|padaria|confeitaria|brunch/, 'Café / Padaria'],
  [/sorvet|doceria|sobremesa|chocolat|doces/, 'Doceria / Sorveteria'], [/\bbar\b|pub|bares|boteco|choperia|cervej|gastrobar/, 'Boteco / Bar'],
  [/frutos do mar|peixe/, 'Frutos do mar'], [/vegan|vegetarian/, 'Vegetariano / Vegano'], [/[aá]rabe|liban|s[ií]ri|oriente m[eé]dio/, 'Árabe'],
  [/lanchonete|sandu[ií]che|fast.?food/, 'Lanchonete'], [/italian/, 'Italiano'], [/brasileir/, 'Brasileiro'], [/chin[eê]s/, 'Chinês'],
  [/corean/, 'Coreano'], [/franc[eê]s/, 'Francês'], [/espanh/, 'Espanhol'], [/tailand/, 'Tailandês'], [/mexican|taco|taqueria/, 'Mexicano'],
  [/indian/, 'Indiano'], [/peruan/, 'Peruano'], [/portugu/, 'Português'], [/asi[aá]tic/, 'Asiático'], [/nordestin/, 'Nordestino'],
  [/mediterr/, 'Mediterrâneo'], [/greg/, 'Grego'], [/vietnam/, 'Vietnamita'], [/contempor/, 'Contemporâneo'],
];
export function categoryFrom(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return '';
  const rule = CATEGORY_RULES.find(([re]) => re.test(t));
  if (rule) return rule[1];
  const rest = t.replace(/^restaurante( de| da| do)?\s*/, '').trim();
  return rest && rest !== 'restaurante' ? rest[0].toUpperCase() + rest.slice(1) : '';
}

/** Google's opening periods -> the app's seven texts (index 0 = Sunday). Null when Google has none. */
export function hoursFromPeriods(periods) {
  if (!periods?.length) return null;
  // Open around the clock comes as a single period with no closing time.
  if (periods.length === 1 && !periods[0].close) return Array(7).fill('00:00-00:00');
  const week = Array.from({ length: 7 }, () => []);
  for (const { open, close } of periods) {
    if (!open) continue;
    const end = close ? close.hour * 60 + (close.minute || 0) : 0;
    week[open.day].push(`${hhmm(open.hour * 60 + (open.minute || 0))}-${hhmm(end)}`);
  }
  return week.map((d) => d.join(', '));
}

async function fromPlacesApi(out, name, address, pos, key, storeImage) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.websiteUri,places.regularOpeningHours.periods,places.photos.name,places.primaryTypeDisplayName,places.priceLevel',
    },
    body: JSON.stringify({
      textQuery: [name, address].filter(Boolean).join(', '),
      languageCode: 'pt-BR',
      regionCode: 'BR',
      pageSize: 1,
      locationBias: { circle: { center: { latitude: (pos || SP).lat, longitude: (pos || SP).lng }, radius: pos ? 500 : 50000 } },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Places API respondeu ${res.status}`);
  const p = (await res.json()).places?.[0];
  if (!p) return false;
  const part = (...types) => p.addressComponents?.find((c) => types.some((t) => c.types?.includes(t)))?.longText || '';
  out.name = p.displayName?.text || out.name;
  out.address = [part('route'), part('street_number')].filter(Boolean).join(', ') || p.shortFormattedAddress || p.formattedAddress || out.address;
  out.bairro = part('sublocality_level_1', 'sublocality', 'neighborhood');
  out.city = part('administrative_area_level_2', 'locality');
  if (p.location) Object.assign(out, { lat: p.location.latitude, lng: p.location.longitude, geo_approx: false });
  if (p.websiteUri) {
    if (/instagram\.com/i.test(p.websiteUri)) out.instagram = p.websiteUri;
    else out.website = p.websiteUri;
  }
  const category = categoryFrom(p.primaryTypeDisplayName?.text);
  if (category) out.categories = [category];
  const price = PRICE_LEVELS.indexOf(p.priceLevel);
  if (price > 0) out.price = price;
  const hours = hoursFromPeriods(p.regularOpeningHours?.periods);
  if (hours) out.hours = hours;
  // Google's first photo of the place, copied to this server so it keeps working (one extra API call).
  const photo = p.photos?.[0]?.name;
  if (photo && storeImage) {
    try {
      const img = await fetch(`https://places.googleapis.com/v1/${photo}/media?maxWidthPx=1600`, {
        headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(12000),
      });
      if (!img.ok) throw new Error(`foto respondeu ${img.status}`);
      const saved = storeImage(Buffer.from(await img.arrayBuffer()));
      if (saved) out.photo = saved;
    } catch (e) { console.error('places photo:', e.message); }
  }
  out.source = 'Google';
  return true;
}

async function fromGoogle(start, opts) {
  const url = await follow(start);
  const { name, address, pos } = parseMapsUrl(url);
  // share.google links (the Share button of a Google search result) lead to a search page: it has
  // the name and nothing about where the place is. Only links from Google Maps itself carry that.
  const searchOnly = url.pathname.startsWith('/search') && !pos;
  const out = searchOnly ? { name, kind: 'search' } : { maps_url: start.href, name };
  if (address) out.address = address;
  if (pos) Object.assign(out, pos, { geo_approx: false });
  // A bare name can match a different business with a similar name, so nothing is looked up for it.
  if (searchOnly || (!name && !pos)) return out;

  const key = (process.env.GOOGLE_PLACES_KEY || '').trim();
  let found = false;
  if (key && name) {
    found = await fromPlacesApi(out, name, address, pos, key, opts.storeImage).catch((e) => { console.error('places:', e.message); return false; });
  }
  if (!found && name) found = await fromOsm(out, name, pos);

  // Nothing known about the business itself: at least place it by coordinates or by address.
  if (!found) {
    if (out.lat == null && address) {
      const hit = await geocodePlace({ address, bairro: '', city: '' }, MAX_KM).catch(() => null);
      if (hit) Object.assign(out, { lat: hit.lat, lng: hit.lng, geo_approx: hit.approx });
    }
    if (out.lat != null) {
      const where = await reverse(out.lat, out.lng).catch(() => null);
      if (where) {
        out.bairro = where.bairro;
        out.city = where.city;
        if (!out.address) out.address = where.address;
      }
    }
  }
  return out;
}

export async function importLink(raw, opts = {}) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (url.protocol === 'http:') url.protocol = 'https:';

  if (/(^|\.)instagram\.com$/i.test(url.hostname)) {
    const handle = url.pathname.split('/').filter(Boolean)[0] || '';
    if (!handle || ['p', 'reel', 'reels', 'explore', 'stories', 'tv'].includes(handle)) return null;
    return { instagram: `https://www.instagram.com/${handle}/`, name: titleFromHandle(handle) };
  }
  if (GOOGLE.test(url.hostname)) return fromGoogle(url, opts);
  return null;
}
