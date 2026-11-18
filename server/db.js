import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'restaurantes.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    bairro TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL,
    geo_approx INTEGER NOT NULL DEFAULT 0,
    price INTEGER,
    dish TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    maps_url TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '[]',
    photos TEXT NOT NULL DEFAULT '[]',
    categories TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '[]',
    visited INTEGER NOT NULL DEFAULT 0,
    want INTEGER NOT NULL DEFAULT 0,
    rating_ciskow REAL,
    rating_andkiwii REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Columns added after the first version; older databases get them on start-up.
const existing = new Set(db.prepare('PRAGMA table_info(places)').all().map((c) => c.name));
for (const [col, type] of [['hours', "TEXT NOT NULL DEFAULT '[]'"], ['last_visit', 'TEXT'], ['favorite', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!existing.has(col)) db.exec(`ALTER TABLE places ADD COLUMN ${col} ${type}`);
}

// Every time we went somewhere. places.last_visit stays as a copy of the newest date (see syncVisits)
// so anything reading the places table alone still sees when we last went.
db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS visits_place ON visits (place_id, date);
`);

/** Keeps a place's last_visit equal to its newest visit, and a place with visits marked as visited. */
function syncVisits(placeId, touch = true) {
  db.prepare(`
    UPDATE places SET
      last_visit = (SELECT MAX(date) FROM visits WHERE place_id = :id),
      visited = CASE WHEN EXISTS (SELECT 1 FROM visits WHERE place_id = :id) THEN 1 ELSE visited END
      ${touch ? ', updated_at = :now' : ''}
    WHERE id = :id
  `).run(touch ? { id: placeId, now: new Date().toISOString() } : { id: placeId });
}

// One-time conversion from the single "last visit" date: each such date becomes a visit.
// The NOT EXISTS keeps it harmless even if the flag were lost and it ran again.
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'visits-converted'").get()) {
  db.exec('BEGIN');
  try {
    const moved = db.prepare(`
      INSERT INTO visits (place_id, date, note, created_at)
      SELECT id, last_visit, '', ? FROM places
      WHERE last_visit GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND NOT EXISTS (SELECT 1 FROM visits WHERE visits.place_id = places.id)
    `).run(new Date().toISOString()).changes;
    for (const { place_id: id } of db.prepare('SELECT DISTINCT place_id FROM visits').all()) syncVisits(id, false);
    db.prepare("INSERT INTO meta (key, value) VALUES ('visits-converted', ?)").run(new Date().toISOString());
    db.exec('COMMIT');
    if (moved) console.log(`visitas: ${moved} datas de última visita convertidas`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const JSON_COLS = ['links', 'photos', 'categories', 'keywords', 'hours'];
const BOOL_COLS = ['geo_approx', 'visited', 'want', 'favorite'];
// last_visit is not here on purpose: only syncVisits writes it.
export const COLUMNS = [
  'name', 'city', 'region', 'bairro', 'address', 'lat', 'lng', 'geo_approx', 'price', 'dish', 'notes',
  'instagram', 'maps_url', 'website', 'links', 'photos', 'categories', 'keywords',
  'visited', 'want', 'rating_ciskow', 'rating_andkiwii', 'source', 'hours', 'favorite',
];

const VISITS_SQL = 'SELECT id, place_id, date, note FROM visits';
const VISIT_ORDER = 'ORDER BY date DESC, id DESC';
const visitOut = ({ id, date, note }) => ({ id, date, note });

function fromRow(row, visits = []) {
  if (!row) return null;
  const p = { ...row };
  for (const c of JSON_COLS) {
    try { p[c] = JSON.parse(p[c]); } catch { p[c] = []; }
  }
  for (const c of BOOL_COLS) p[c] = !!p[c];
  p.visits = visits.map(visitOut);
  if (p.visits.length) p.last_visit = p.visits[0].date;
  return p;
}

function toDb(col, value) {
  if (JSON_COLS.includes(col)) return JSON.stringify(value ?? []);
  if (BOOL_COLS.includes(col)) return value ? 1 : 0;
  return value ?? null;
}

export function listPlaces() {
  const byPlace = new Map();
  for (const v of db.prepare(`${VISITS_SQL} ${VISIT_ORDER}`).all()) {
    if (!byPlace.has(v.place_id)) byPlace.set(v.place_id, []);
    byPlace.get(v.place_id).push(v);
  }
  return db.prepare('SELECT * FROM places ORDER BY name COLLATE NOCASE').all()
    .map((row) => fromRow(row, byPlace.get(row.id)));
}

export function getPlace(id) {
  const row = db.prepare('SELECT * FROM places WHERE id = ?').get(id);
  return row ? fromRow(row, db.prepare(`${VISITS_SQL} WHERE place_id = ? ${VISIT_ORDER}`).all(id)) : null;
}

export function getVisit(placeId, visitId) {
  return db.prepare(`${VISITS_SQL} WHERE id = ? AND place_id = ?`).get(visitId, placeId) || null;
}

export function addVisit(placeId, { date, note = '' }) {
  db.prepare('INSERT INTO visits (place_id, date, note, created_at) VALUES (?, ?, ?, ?)')
    .run(placeId, date, note, new Date().toISOString());
  syncVisits(placeId);
  return getPlace(placeId);
}

/** Marks having been somewhere on this date, unless a visit on that day is already there. */
export function ensureVisit(placeId, date) {
  if (db.prepare('SELECT 1 FROM visits WHERE place_id = ? AND date = ?').get(placeId, date)) return getPlace(placeId);
  return addVisit(placeId, { date });
}

export function updateVisit(placeId, visitId, { date, note }) {
  db.prepare('UPDATE visits SET date = COALESCE(?, date), note = COALESCE(?, note) WHERE id = ? AND place_id = ?')
    .run(date ?? null, note ?? null, visitId, placeId);
  syncVisits(placeId);
  return getPlace(placeId);
}

export function deleteVisit(placeId, visitId) {
  db.prepare('DELETE FROM visits WHERE id = ? AND place_id = ?').run(visitId, placeId);
  syncVisits(placeId);
  return getPlace(placeId);
}

export function insertPlace(data) {
  const now = new Date().toISOString();
  const cols = COLUMNS.filter((c) => data[c] !== undefined);
  const sql = `INSERT INTO places (${[...cols, 'created_at', 'updated_at'].join(', ')})
               VALUES (${[...cols, 0, 0].map(() => '?').join(', ')})`;
  const info = db.prepare(sql).run(...cols.map((c) => toDb(c, data[c])), now, now);
  return getPlace(Number(info.lastInsertRowid));
}

export function updatePlace(id, data) {
  const cols = COLUMNS.filter((c) => data[c] !== undefined);
  if (cols.length) {
    const sql = `UPDATE places SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    db.prepare(sql).run(...cols.map((c) => toDb(c, data[c])), new Date().toISOString(), id);
  }
  return getPlace(id);
}

export function deletePlace(id) {
  // Explicit rather than trusting ON DELETE CASCADE, which only works while foreign keys are switched on.
  db.prepare('DELETE FROM visits WHERE place_id = ?').run(id);
  return db.prepare('DELETE FROM places WHERE id = ?').run(id).changes > 0;
}

export function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/** One snapshot per day in data/backups, keeping the last 14. */
export function backup() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `restaurantes-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(target)) return;
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -14);
  for (const f of old) fs.rmSync(path.join(dir, f));
}
