const SHELL_CACHE = 'darkroom-v95';
const THUMB_CACHE = 'darkroom-thumbs-v1';
const THUMB_MAX = 500;

const STATIC = [
  '/',
  '/favicon.png',
  '/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans:wght@300;400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys
      .filter(k => k !== SHELL_CACHE && k !== THUMB_CACHE)
      .map(k => caches.delete(k))
    )
  ));
  self.clients.claim();
});

function isThumb(url) {
  return url.pathname.startsWith('/api/immich/thumb/') ||
         url.pathname.startsWith('/api/public/thumb/');
}

async function trimThumbCache() {
  const cache = await caches.open(THUMB_CACHE);
  const keys = await cache.keys();
  const excess = keys.length - THUMB_MAX;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(THUMB_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res && res.ok) {
      cache.put(req, res.clone()).then(trimThumbCache).catch(() => {});
    }
    return res;
  });
  return cached || networkPromise;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isThumb(url)) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  if (url.pathname.startsWith('/api/') || /\/(app|album)\.js/.test(url.pathname)) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
