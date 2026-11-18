// Address lookup through OpenStreetMap's Nominatim (free, max 1 request per second).
const UA = 'bora-comer-selfhosted/1.0';
const SP = { lat: -23.55, lng: -46.63 };
let last = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function nominatim(endpoint, params) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/${endpoint}?` + new URLSearchParams({ format: 'jsonv2', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } });
  if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);
  return res.json();
}

/** `q` is free text, or { street, city } for a structured lookup. */
export async function geocode(q) {
  const params = typeof q === 'string' ? { q } : { ...q, country: 'Brasil' };
  const hit = (await nominatim('search', { limit: '1', countrycodes: 'br', ...params }))[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}

const addressOf = (a = {}) => ({
  address: [a.road || a.pedestrian || a.footway || '', a.house_number].filter(Boolean).join(', '),
  bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || '',
  city: a.city || a.town || a.municipality || a.village || '',
});

/**
 * Finds a business by name in OpenStreetMap, with whatever it knows about it (hours, website...).
 * With `near`, only a ~400 m box around that point is searched, so a loose name match is safe.
 */
export async function findVenue(name, near) {
  const box = near
    ? { viewbox: [near.lng - 0.004, near.lat + 0.004, near.lng + 0.004, near.lat - 0.004].join(','), bounded: '1' }
    : {};
  const hits = await nominatim('search', {
    q: near ? name : `${name}, São Paulo`, limit: '5', countrycodes: 'br', addressdetails: '1', extratags: '1', ...box,
  });
  const hit = hits.find((h) => ['amenity', 'shop', 'tourism', 'leisure', 'craft'].includes(h.category));
  if (!hit) return null;
  return {
    lat: Number(hit.lat), lng: Number(hit.lon), name: hit.name || '', tags: hit.extratags || {}, ...addressOf(hit.address),
  };
}

/** Coordinates -> street address, bairro and city. */
export async function reverse(lat, lng) {
  const hit = await nominatim('reverse', { lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1' });
  return hit?.address ? addressOf(hit.address) : null;
}

/** Expands abbreviations and separators so the free-text search has a better chance. */
export function cleanAddress(s) {
  return s
    .replace(/\bR\.\s*/g, 'Rua ')
    .replace(/\bAv\.\s*/g, 'Avenida ')
    .replace(/\bAl\.\s*/g, 'Alameda ')
    .replace(/\bPres\.\s*/g, 'Presidente ')
    .replace(/\bDr\.\s*/g, 'Doutor ')
    .replace(/\s+[-–]\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tries the full address, then the street without its number, then the bairro.
 * Anything but the full address is flagged as approximate.
 */
export async function geocodePlace({ address, bairro, city }, maxKm = 60) {
  const tries = [];
  const withCity = (s) => (city && !s.toLowerCase().includes(city.toLowerCase()) ? `${s}, ${city}` : s);
  if (address) {
    const a = cleanAddress(address);
    tries.push([withCity(a), false]);
    // "Rua X, 123 - Bairro ..." -> structured lookup with just street and number.
    const m = /^(\D+?),?\s+(\d+)\b/.exec(a);
    if (m) tries.push([{ street: `${m[2]} ${m[1].trim()}`, city: city || 'São Paulo' }, false]);
    const noNumber = a.replace(/,?\s*\d+[\w º°]*?(?=,|$| São| Santo)/, '').trim();
    if (noNumber !== a) tries.push([withCity(noNumber), true]);
  }
  const b = (bairro || '').replace(/\(.*?\)/g, '').split('/')[0].trim();
  if (b) tries.push([`${b}, ${city || 'São Paulo'}`, true]);
  else if (city) tries.push([city, true]);

  for (const [q, approx] of tries) {
    const hit = await geocode(q);
    if (hit && km(SP, hit) < maxKm) return { ...hit, approx, query: q };
  }
  return null;
}
