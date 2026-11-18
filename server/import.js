// One-time import of the public guide spreadsheet into the local database.
// Safe to run again: places already present (same name + bairro) are skipped,
// and places still missing coordinates get another lookup attempt.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db, insertPlace, listPlaces, updatePlace } from './db.js';
import { geocodePlace } from './geocode.js';

const SHEET = 'https://docs.google.com/spreadsheets/d/1oGAQhIFtDnSgHfiwjQcNR0Aw8yShIU70R01oQic3SPk/gviz/tq?tqx=out:csv&sheet=Site';
const STREET = /(?:^|\s)(Rua|R\.|Avenida|Av\.?|Alameda|Al\.|Praça|Largo|Travessa|Estrada|Rodovia|Viaduto|Pátio|Complexo|Shopping|Mercado)\s/i;

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function addressFrom(mapsUrl, name) {
  let q = '';
  try { q = new URL(mapsUrl).searchParams.get('query') || ''; } catch { return ''; }
  q = q.trim();
  const m = STREET.exec(q);
  if (m) return q.slice(m.index).trim();
  if (q.toLowerCase().startsWith(name.toLowerCase())) return q.slice(name.length).trim();
  return q;
}

const local = path.join(DATA_DIR, 'source.csv');
let csv;
if (fs.existsSync(local)) csv = fs.readFileSync(local, 'utf8');
else {
  csv = await (await fetch(SHEET)).text();
  fs.writeFileSync(local, csv);
}

const [header, ...rows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const existing = new Set(listPlaces().map((p) => `${p.name}|${p.bairro}`.toLowerCase()));
let added = 0;

for (const r of rows) {
  const get = (h) => (r[col[h]] || '').trim();
  const name = get('Restaurante');
  if (!name) continue;
  const bairro = get('Bairro');
  if (existing.has(`${name}|${bairro}`.toLowerCase())) continue;
  const mapsUrl = get('Google Maps');
  insertPlace({
    name,
    city: get('Cidade'),
    region: get('Região'),
    bairro,
    address: addressFrom(mapsUrl, name),
    price: get('Preço').length || null,
    dish: get('Prato pra pedir'),
    notes: get('Observações'),
    instagram: get('Instagram'),
    maps_url: mapsUrl,
    photos: ['Foto', 'Foto 2', 'Foto 3', 'Foto 4'].map(get).filter(Boolean),
    categories: [get('Tipo de comida')].filter(Boolean),
    source: 'salveipracomer',
  });
  added++;
}
console.log(`Importados: ${added} (planilha tem ${rows.length})`);

if (!process.argv.includes('--no-geocode')) {
  const todo = listPlaces().filter((p) => p.lat == null);
  console.log(`Buscando coordenadas de ${todo.length} lugares...`);
  let exact = 0, approx = 0;
  const failed = [];
  for (const [i, p] of todo.entries()) {
    try {
      const hit = await geocodePlace(p);
      if (hit) {
        updatePlace(p.id, { lat: hit.lat, lng: hit.lng, geo_approx: hit.approx });
        hit.approx ? approx++ : exact++;
        console.log(`[${i + 1}/${todo.length}] ${hit.approx ? '~' : '✓'} ${p.name}`);
      } else {
        failed.push(p.name);
        console.log(`[${i + 1}/${todo.length}] ✗ ${p.name}`);
      }
    } catch (e) {
      failed.push(p.name);
      console.log(`[${i + 1}/${todo.length}] erro ${p.name}: ${e.message}`);
    }
  }
  console.log(`Exatos: ${exact}, aproximados: ${approx}, sem coordenadas: ${failed.length}`);
  if (failed.length) console.log('Sem coordenadas:', failed.join('; '));
}
db.close();
