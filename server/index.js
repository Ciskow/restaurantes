import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env: rely on real env vars */ }

const {
  DATA_DIR, addVisit, backup, deletePlace, deleteVisit, ensureVisit, getMeta, getPlace, getVisit, insertPlace, listPlaces,
  setMeta, updatePlace, updateVisit,
} = await import('./db.js');
const { geocode, cleanAddress } = await import('./geocode.js');
const { importLink } = await import('./link.js');

const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const PORT = Number(process.env.PORT || 8480);
const PIN = (process.env.EDIT_PIN || '').trim();

// ---- auth: one shared PIN, exchanged for a token the browser keeps ----
let secret = getMeta('secret');
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  setMeta('secret', secret);
}
const tokenFor = (pin) => crypto.createHmac('sha256', secret).update(pin).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const attempts = new Map(); // ip -> { count, until }
function requireEdit(req, res, next) {
  if (PIN && safeEqual(req.get('x-edit-token') || '', tokenFor(PIN))) return next();
  res.status(401).json({ error: 'PIN necessário para editar.' });
}

// ---- input cleaning ----
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const url = (v) => {
  const s = str(v, 600);
  return /^https?:\/\//i.test(s) ? s : '';
};
const list = (v, max = 30) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, max);
const num = (v, lo, hi) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const rating = (v) => {
  const n = num(v, 0.5, 5);
  return n === null ? null : Math.round(n * 2) / 2;
};
function instagram(v) {
  const s = str(v, 300);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const handle = s.replace(/^@/, '').replace(/[^\w.]/g, '');
  return handle ? `https://www.instagram.com/${handle}/` : '';
}

const LOCAL_PHOTO = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/;
const photo = (v) => (LOCAL_PHOTO.test(String(v)) ? String(v) : url(v));
// One text per weekday (0 = Sunday): '' when closed, or "12:00-15:00, 19:00-23:00". [] means unknown.
const DAY_HOURS = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d(, ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d)*$/;
const hours = (v) => {
  if (!Array.isArray(v) || v.length !== 7) return [];
  const days = v.map((d) => (DAY_HOURS.test(String(d)) ? String(d) : ''));
  return days;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
/** A real calendar day (no 31/02), written YYYY-MM-DD, not after today in São Paulo. Null otherwise. */
function visitDate(v) {
  const s = String(v ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== s || +m[1] < 1900) return null;
  return s <= today() ? s : null;
}
const VISIT_NOTE_MAX = 300;

const CLEAN = {
  name: (v) => str(v, 120),
  city: (v) => str(v, 80),
  region: (v) => str(v, 80),
  bairro: (v) => str(v, 80),
  address: (v) => str(v, 300),
  dish: (v) => str(v, 400),
  notes: (v) => str(v, 4000),
  instagram,
  maps_url: url,
  website: url,
  price: (v) => { const n = num(v, 1, 5); return n === null ? null : Math.round(n); },
  lat: (v) => num(v, -90, 90),
  lng: (v) => num(v, -180, 180),
  geo_approx: (v) => !!v,
  visited: (v) => !!v,
  want: (v) => !!v,
  favorite: (v) => !!v,
  rating_ciskow: rating,
  rating_andkiwii: rating,
  categories: (v) => list(v),
  keywords: (v) => list(v, 40),
  photos: (v) => (Array.isArray(v) ? v : []).map(photo).filter(Boolean).slice(0, 12),
  hours,
  links: (v) =>
    (Array.isArray(v) ? v : [])
      .map((l) => ({ label: str(l?.label, 40), url: url(l?.url) }))
      .filter((l) => l.url)
      .slice(0, 10),
};

function clean(body, before) {
  const out = {};
  for (const [key, fn] of Object.entries(CLEAN)) {
    if (body && Object.hasOwn(body, key)) out[key] = fn(body[key]);
  }
  // A rating means you have been there.
  if (out.rating_ciskow != null || out.rating_andkiwii != null) out.visited = true;
  // Recorded visits are proof of having been there; the client explains why the switch stays on.
  if (out.visited === false && before?.visits?.length) out.visited = true;
  return out;
}

/** Marking a place as visited, or giving it a new rating, counts as a visit today. The random pick
 *  uses the newest visit to skip places visited recently. */
function beenThereNow(data, before) {
  const newlyVisited = data.visited === true && !before?.visited;
  const newRating = ['rating_ciskow', 'rating_andkiwii'].some((k) => data[k] != null && data[k] !== before?.[k]);
  return newlyVisited || newRating;
}

/** { date, note } from a request, or { error }. With partial, missing fields are left out (for edits). */
function cleanVisit(body, partial = false) {
  const out = {};
  if (!partial || Object.hasOwn(body || {}, 'date')) {
    out.date = visitDate(body?.date);
    if (!out.date) return { error: 'Data inválida. Use uma data de hoje ou do passado.' };
  }
  if (!partial || Object.hasOwn(body || {}, 'note')) {
    const note = String(body?.note ?? '').trim();
    if (note.length > VISIT_NOTE_MAX) return { error: `A observação pode ter até ${VISIT_NOTE_MAX} caracteres.` };
    out.note = note;
  }
  return out;
}

// ---- routes ----
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

app.get('/api/places', (req, res) => res.json(listPlaces()));

app.post('/api/login', (req, res) => {
  if (!PIN) return res.status(503).json({ error: 'Defina EDIT_PIN no arquivo .env do servidor.' });
  const now = Date.now();
  const a = attempts.get(req.ip) || { count: 0, until: 0 };
  if (a.until > now) {
    return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' });
  }
  if (!safeEqual(str(req.body?.pin, 64), PIN)) {
    a.count++;
    if (a.count >= 5) { a.until = now + 10 * 60_000; a.count = 0; }
    attempts.set(req.ip, a);
    return res.status(401).json({ error: 'PIN incorreto.' });
  }
  attempts.delete(req.ip);
  res.json({ token: tokenFor(PIN) });
});

app.get('/api/session', requireEdit, (req, res) => res.json({ ok: true }));

// ---- per-person preferences (for now only the theme), kept in the meta table as prefs:<person> ----
const PERSONS = new Set(['ciskow', 'andkiwii']);
const THEMES = new Set(['tomo', 'tomo-escuro']);
const readPrefs = (who) => {
  try { return JSON.parse(getMeta(`prefs:${who}`) || '{}'); } catch { return {}; }
};

app.get('/api/prefs/:who', (req, res) => {
  if (!PERSONS.has(req.params.who)) return res.status(404).json({ error: 'Pessoa desconhecida.' });
  res.json(readPrefs(req.params.who));
});

app.put('/api/prefs/:who', requireEdit, (req, res) => {
  const { who } = req.params;
  if (!PERSONS.has(who)) return res.status(404).json({ error: 'Pessoa desconhecida.' });
  const theme = str(req.body?.theme, 40);
  if (!THEMES.has(theme)) return res.status(400).json({ error: 'Tema desconhecido.' });
  const prefs = { ...readPrefs(who), theme };
  setMeta(`prefs:${who}`, JSON.stringify(prefs));
  res.json(prefs);
});

app.post('/api/places', requireEdit, (req, res) => {
  const data = clean(req.body);
  if (!data.name) return res.status(400).json({ error: 'O nome é obrigatório.' });
  const place = insertPlace(data);
  res.status(201).json(beenThereNow(data) ? ensureVisit(place.id, today()) : place);
});

app.put('/api/places/:id', requireEdit, (req, res) => {
  const id = Number(req.params.id);
  const before = getPlace(id);
  if (!before) return res.status(404).json({ error: 'Lugar não encontrado.' });
  const data = clean(req.body, before);
  if (data.name === '') return res.status(400).json({ error: 'O nome é obrigatório.' });
  const place = updatePlace(id, data);
  res.json(beenThereNow(data, before) ? ensureVisit(id, today()) : place);
});

// ---- visits: each answer is the whole place again, so the client can swap it in ----
app.post('/api/places/:id/visits', requireEdit, (req, res) => {
  const id = Number(req.params.id);
  if (!getPlace(id)) return res.status(404).json({ error: 'Lugar não encontrado.' });
  const visit = cleanVisit(req.body);
  if (visit.error) return res.status(400).json({ error: visit.error });
  res.status(201).json(addVisit(id, visit));
});

app.put('/api/places/:id/visits/:visitId', requireEdit, (req, res) => {
  const id = Number(req.params.id);
  const visitId = Number(req.params.visitId);
  if (!getVisit(id, visitId)) return res.status(404).json({ error: 'Visita não encontrada.' });
  const visit = cleanVisit(req.body, true);
  if (visit.error) return res.status(400).json({ error: visit.error });
  res.json(updateVisit(id, visitId, visit));
});

app.delete('/api/places/:id/visits/:visitId', requireEdit, (req, res) => {
  const id = Number(req.params.id);
  const visitId = Number(req.params.visitId);
  if (!getVisit(id, visitId)) return res.status(404).json({ error: 'Visita não encontrada.' });
  res.json(deleteVisit(id, visitId));
});

app.delete('/api/places/:id', requireEdit, (req, res) => {
  if (!deletePlace(Number(req.params.id))) return res.status(404).json({ error: 'Lugar não encontrado.' });
  res.json({ ok: true });
});

app.post('/api/geocode', requireEdit, async (req, res) => {
  const q = str(req.body?.q, 300);
  if (!q) return res.status(400).json({ error: 'Informe um endereço.' });
  try {
    const hit = await geocode(cleanAddress(q));
    if (!hit) return res.status(404).json({ error: 'Endereço não encontrado.' });
    res.json(hit);
  } catch (e) {
    res.status(502).json({ error: 'Busca de endereço indisponível agora.' });
  }
});

app.post('/api/import-link', requireEdit, async (req, res) => {
  try {
    const found = await importLink(str(req.body?.url, 800), { storeImage });
    if (!found) return res.status(400).json({ error: 'Cole um link do Google Maps ou do Instagram.' });
    res.json(found);
  } catch (e) {
    console.error('import-link:', e.message);
    res.status(502).json({ error: 'Não consegui ler esse link agora.' });
  }
});

// Photos arrive already shrunk by the browser; the first bytes say what they really are.
const SIGNATURES = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
];
/** Saves image bytes under a random name and returns the address to use, or null if it is not an image. */
function storeImage(body) {
  const kind = Buffer.isBuffer(body) && body.length > 12 && SIGNATURES.find(([, test]) => test(body));
  if (!kind) return null;
  const name = `${crypto.randomBytes(16).toString('hex')}.${kind[0]}`;
  fs.writeFileSync(path.join(UPLOADS, name), body);
  return `/uploads/${name}`;
}

app.post('/api/uploads', requireEdit, express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
  const url = storeImage(req.body);
  if (!url) return res.status(400).json({ error: 'Envie uma foto JPG, PNG ou WebP.' });
  res.status(201).json({ url });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Não encontrado.' }));

app.use('/uploads', express.static(UPLOADS, { index: false, maxAge: '365d', immutable: true, fallthrough: false }));

const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, {
    index: false,
    maxAge: '1h',
    // The service worker must be re-checked on every visit, or updates never arrive.
    setHeaders: (res, file) => { if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.use((req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(DIST, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  if (err.status === 404) return res.status(404).json({ error: 'Não encontrado.' });
  if (err.status === 413) return res.status(413).json({ error: 'Arquivo grande demais.' });
  res.status(err.status === 400 ? 400 : 500).json({ error: 'Erro no servidor.' });
});

/** Uploaded photos that no place uses (form cancelled, photo removed) are deleted after a day. */
function sweepUploads() {
  const used = new Set(listPlaces().flatMap((p) => p.photos).filter((u) => LOCAL_PHOTO.test(u)).map((u) => u.slice(9)));
  for (const f of fs.readdirSync(UPLOADS)) {
    const file = path.join(UPLOADS, f);
    if (!used.has(f) && Date.now() - fs.statSync(file).mtimeMs > 24 * 3600_000) fs.rmSync(file);
  }
}

const safeBackup = () => {
  try { backup(); } catch (e) { console.error('backup falhou:', e.message); }
  try { sweepUploads(); } catch (e) { console.error('limpeza de fotos falhou:', e.message); }
};
safeBackup();
setInterval(safeBackup, 6 * 3600_000).unref();

app.listen(PORT, () => {
  console.log(`Bora Comer em http://localhost:${PORT}${PIN ? '' : '  (sem EDIT_PIN: edição desativada)'}`);
});
