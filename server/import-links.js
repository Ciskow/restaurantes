// Adds places from a list of Google Maps links (one per line), all marked "Queremos ir".
//   node server/import-links.js /data/links.txt          look up and add
//   node server/import-links.js /data/links.txt --dry    look up and report only
// A link that points at a place already in the list only gets "Queremos ir" switched on.
// Answers are kept in data/links-cache.json, so a second run never asks Google twice.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, insertPlace, listPlaces, updatePlace } from './db.js';
import { km } from './geocode.js';
import { importLink } from './link.js';

const file = process.argv[2];
const DRY = process.argv.includes('--dry');
const links = [...new Set(fs.readFileSync(file, 'utf8').split(/\s+/).filter((l) => /^https?:\/\//.test(l)))];
const CACHE = path.join(DATA_DIR, 'links-cache.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const plain = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const firstWords = (s) => plain(s).split(' ').filter((w) => w.length > 2).slice(0, 2).join(' ');
function alreadyThere(found, places) {
  return places.find((p) => {
    const a = plain(p.name), b = plain(found.name);
    const close = p.lat != null && found.lat != null && km(p, found) < 0.25;
    const sameName = a === b || a.includes(b) || b.includes(a) || firstWords(p.name) === firstWords(found.name);
    return sameName && (close || a === b);
  });
}

const report = { added: [], marked: [], failed: [] };
for (const url of links) {
  let found = cache[url];
  if (!found) {
    try {
      found = await importLink(url);
    } catch (e) {
      report.failed.push(`${url}: ${e.message}`);
      continue;
    }
    if (!found?.name) { report.failed.push(`${url}: sem nome`); continue; }
    cache[url] = found;
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  }
  const line = [found.name, found.categories?.[0] || '(sem tipo)', found.price ? '$'.repeat(found.price) : '', `${found.bairro || '?'}, ${found.city || '?'}`,
    found.address || '(sem endereço)', found.hours ? 'horário ok' : 'sem horário', found.lat != null ? '' : 'SEM COORDENADAS', found.source || 'sem fonte']
    .filter(Boolean).join(' | ');
  const existing = alreadyThere(found, listPlaces());
  if (existing) {
    if (!DRY && !existing.want) updatePlace(existing.id, { want: true });
    report.marked.push(`${existing.name}  (link: ${found.name})`);
    continue;
  }
  if (!DRY) {
    const { source, kind, photo, ...fields } = found;
    insertPlace({
      region: '', dish: '', notes: '', instagram: '', website: '', links: [], photos: [], categories: [], keywords: [], hours: [],
      ...fields, name: found.name.slice(0, 120), visited: false, want: true, source: 'links',
    });
  }
  report.added.push(line);
}
console.log(JSON.stringify({ mode: DRY ? 'dry run' : 'saved', links: links.length, counts: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])), ...report }, null, 1));
