// Fills opening hours from Google's Places API for places that have none.
//   node server/fetch-hours.js            look up and save
//   node server/fetch-hours.js --dry      look up and report only
// One API call per place. Every answer is kept in data/google-hours.json, so a second run
// (after a daily quota stop, for example) never asks about the same place twice.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, listPlaces, updatePlace } from './db.js';
import { km } from './geocode.js';
import { hoursFromPeriods } from './link.js';

const KEY = (process.env.GOOGLE_PLACES_KEY || '').trim();
if (!KEY) { console.error('GOOGLE_PLACES_KEY não está definido.'); process.exit(1); }
const DRY = process.argv.includes('--dry');
const FILE = path.join(DATA_DIR, 'google-hours.json');
const seen = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};

const plain = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const GENERIC = new Set(['pizzaria', 'padaria', 'restaurante', 'bar', 'casa', 'cafe', 'trattoria', 'cucina', 'bistro', 'taverna',
  'lanchonete', 'hamburgueria', 'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'the', 'sp']);
const tokens = (s) => plain(s).split(' ').filter((w) => w && !GENERIC.has(w));

/** Same business? Ignoring words like "Pizzaria", the first distinctive word and at least half of the rest must be in Google's name. */
function sameName(a, b) {
  if (plain(a).replace(/ /g, '') === plain(b).replace(/ /g, '')) return true;
  const mine = tokens(a);
  const theirs = new Set(tokens(b));
  if (!mine.length || !theirs.has(mine[0])) return false;
  return mine.filter((w) => theirs.has(w)).length >= mine.length / 2;
}

const STREET_WORDS = new Set(['rua', 'r', 'avenida', 'av', 'alameda', 'al', 'praca', 'largo', 'travessa', 'doutor', 'dr', 'sao', 'paulo', 'sp']);
/** Same street and number in our address and Google's: proof of the same branch even when our pin is off. */
function sameStreet(ours, googles) {
  const number = /\b(\d{1,5})\b/.exec(ours || '')?.[1];
  const g = new Set(plain(googles || '').split(' '));
  if (!number || !g.has(number)) return false;
  return plain(ours.split(/\d/)[0]).split(' ').some((w) => w.length > 3 && !STREET_WORDS.has(w) && g.has(w));
}

async function ask(p) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.websiteUri,places.businessStatus,places.regularOpeningHours.periods',
    },
    body: JSON.stringify({
      textQuery: [p.name, p.address || p.bairro, p.city].filter(Boolean).join(', '),
      languageCode: 'pt-BR',
      regionCode: 'BR',
      pageSize: 1,
      ...(p.lat != null
        ? { locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: p.geo_approx ? 3000 : 600 } } }
        : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw Object.assign(new Error(`Places API respondeu ${res.status}`), { status: res.status });
  return (await res.json()).places?.[0] || null;
}

const todo = listPlaces().filter((p) => p.hours.length !== 7);
const report = { saved: [], noHours: [], closed: [], mismatch: [], pinOff: [], notFound: [], failed: [] };

// --pins: no Google calls. Uses the answers already saved to move map pins that sit away from
// where Google has the same place (same name, and same street and number or close by).
if (process.argv.includes('--pins')) {
  const moved = [];
  const left = [];
  for (const p of listPlaces()) {
    const g = seen[p.id];
    if (!g?.location || p.lat == null) continue;
    const spot = { lat: g.location.latitude, lng: g.location.longitude };
    const metres = Math.round(km(p, spot) * 1000);
    if (metres <= 150 && !p.geo_approx) continue;
    const street = sameStreet(p.address, g.formattedAddress);
    const near = metres <= (p.geo_approx ? 4000 : 800);
    const line = `${p.name}: ${metres} m${p.geo_approx ? ' (era aproximado)' : ''} -> ${g.formattedAddress}`;
    // A pin only moves on proof of the same address, or when ours was a rough guess to begin with.
    // Same name on another street may be a different branch, so those are left for a person to check.
    if (!sameName(p.name, g.displayName?.text || '') || !(street || (p.geo_approx && near))) {
      left.push(`${line}  [nosso endereço: ${p.address || '-'}]`);
      continue;
    }
    if (!DRY) updatePlace(p.id, { lat: spot.lat, lng: spot.lng, geo_approx: false });
    moved.push(line);
  }
  console.log(JSON.stringify({ mode: DRY ? 'dry run' : 'saved', moved, leftAlone: left }, null, 1));
  process.exit(0);
}

for (const p of todo) {
  let g = seen[p.id];
  if (g === undefined) {
    try {
      g = await ask(p);
    } catch (e) {
      report.failed.push(`${p.name}: ${e.message}`);
      if (e.status === 429 || e.status === 403) { console.error('Parando: cota ou permissão.', e.message); break; }
      continue;
    }
    seen[p.id] = g;
    fs.writeFileSync(FILE, JSON.stringify(seen, null, 1));
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!g) { report.notFound.push(p.name); continue; }
  const gName = g.displayName?.text || '';
  const metres = p.lat != null && g.location
    ? Math.round(km(p, { lat: g.location.latitude, lng: g.location.longitude }) * 1000) : null;
  const street = sameStreet(p.address, g.formattedAddress);
  const near = metres == null || metres <= (p.geo_approx ? 4000 : 800);
  if (!(near || street) || !sameName(p.name, gName)) {
    report.mismatch.push(`${p.name} [${p.address || p.bairro}]  ≠  ${gName} (${metres ?? '?'} m, ${g.formattedAddress || ''})`);
    continue;
  }
  if (street && metres > 300) report.pinOff.push(`${p.name}: ${metres} m`);
  if (g.businessStatus && g.businessStatus !== 'OPERATIONAL') report.closed.push(`${p.name}: ${g.businessStatus}`);
  const hours = hoursFromPeriods(g.regularOpeningHours?.periods);
  if (!hours) { report.noHours.push(p.name); continue; }
  if (!DRY) updatePlace(p.id, { hours });
  report.saved.push(p.name);
}

console.log(JSON.stringify({
  mode: DRY ? 'dry run' : 'saved', withoutHoursBefore: todo.length,
  counts: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])),
  ...Object.fromEntries(Object.entries(report).filter(([k]) => k !== 'saved')),
}, null, 1));
