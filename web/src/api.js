const KEY = 'bora-comer-auth';

export const PEOPLE = [
  { id: 'ciskow', label: 'Ciskow', field: 'rating_ciskow' },
  { id: 'andkiwii', label: 'Andkiwii', field: 'rating_andkiwii' },
];

export function loadAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (a?.token) return a;
  } catch { /* storage unavailable */ }
  return { token: '', who: '' };
}

export function saveAuth(auth) {
  try {
    if (auth.token) localStorage.setItem(KEY, JSON.stringify(auth));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

async function req(method, path, body, token) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Algo deu errado.'), { status: res.status });
  return data;
}

export const api = {
  // With the PIN the list includes ratings and visits; without it, the server leaves them out.
  places: (token) => req('GET', '/api/places', undefined, token),
  login: (pin) => req('POST', '/api/login', { pin }),
  create: (data, token) => req('POST', '/api/places', data, token),
  update: (id, data, token) => req('PUT', `/api/places/${id}`, data, token),
  remove: (id, token) => req('DELETE', `/api/places/${id}`, undefined, token),
  // Each visit call answers with the whole place, visits included.
  addVisit: (id, visit, token) => req('POST', `/api/places/${id}/visits`, visit, token),
  updateVisit: (id, visitId, visit, token) => req('PUT', `/api/places/${id}/visits/${visitId}`, visit, token),
  removeVisit: (id, visitId, token) => req('DELETE', `/api/places/${id}/visits/${visitId}`, undefined, token),
  prefs: (who) => req('GET', `/api/prefs/${who}`),
  savePrefs: (who, prefs, token) => req('PUT', `/api/prefs/${who}`, prefs, token),
  pois: (token) => req('GET', '/api/pois', undefined, token),
  addPoi: (poi, token) => req('POST', '/api/pois', poi, token),
  updatePoi: (id, poi, token) => req('PUT', `/api/pois/${id}`, poi, token),
  removePoi: (id, token) => req('DELETE', `/api/pois/${id}`, undefined, token),
  geocode: (q, token) => req('POST', '/api/geocode', { q }, token),
  importLink: (url, token) => req('POST', '/api/import-link', { url }, token),
  async upload(blob, token) {
    let res;
    try {
      res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Edit-Token': token }, body: blob });
    } catch {
      throw new Error('Sem conexão com o servidor.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Não consegui enviar a foto.'), { status: res.status });
    return data.url;
  },
};

// What the server keeps from visitors (server/index.js, PRIVATE).
const PRIVATE = ['rating_ciskow', 'rating_andkiwii', 'visits', 'last_visit'];
export const publicPlace = (p) => {
  const out = { ...p };
  for (const key of PRIVATE) delete out[key];
  return out;
};

/**
 * After signing out, the list kept for offline use (by sw.js) is rewritten without ratings and visits,
 * so a phone that was signed out shows only what any visitor sees, with or without a connection.
 */
export async function forgetPrivate() {
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const saved = await cache.match('/api/places');
      if (!saved) continue;
      const list = await saved.json();
      await cache.put('/api/places', new Response(JSON.stringify(list.map(publicPlace)), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  } catch { /* no cache storage here: nothing kept to forget */ }
}

/** Shrinks a photo in the browser (longest side 1600 px, JPEG) so phone pictures upload fast. */
export async function shrinkPhoto(file, max = 1600) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  // Screenshots and copied images can be transparent; JPEG would turn that black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Não consegui ler essa foto.');
  return blob;
}
