// Offline support: the app shell, the last list of places and uploaded photos stay on the device.
const CACHE = 'bora-comer-v3';
const SHELL = ['/', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const save = async (key, res) => {
  if (res.ok) (await caches.open(CACHE)).put(key, res.clone());
  return res;
};

/** Fresh from the server when it answers in time; otherwise whatever was saved last. */
async function networkFirst(request, key = request, timeout = 5000) {
  try {
    return await save(key, await fetch(request, { signal: AbortSignal.timeout(timeout) }));
  } catch (err) {
    const cached = await caches.match(key);
    if (cached) return cached;
    throw err;
  }
}

/** Files whose name changes with their content never need a second download. */
async function cacheFirst(request) {
  return (await caches.match(request)) || save(request, await fetch(request));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Other sites (restaurant photos, map tiles) and anything that writes go straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') event.respondWith(networkFirst(request, '/'));
  else if (url.pathname === '/api/places') event.respondWith(networkFirst(request));
  else if (url.pathname.startsWith('/api/')) return;
  else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/uploads/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
