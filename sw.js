/* Math Quest service worker: network-first so updates show up right away,
   with a cached copy of every page so the games also work offline. */
const CACHE = 'math-quest-v10';
const FILES = [
  './', 'index.html', 'portal.css', 'portal.js', 'manifest.webmanifest',
  'shared/core.js', 'shared/style.css',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'games/coin-crossing/index.html', 'games/coin-crossing/game.css', 'games/coin-crossing/game.js',
  'games/number-flow/index.html', 'games/number-flow/game.css', 'games/number-flow/game.js',
  'games/clock-tower/index.html', 'games/clock-tower/game.css', 'games/clock-tower/game.js',
  'games/castle-climb/index.html', 'games/castle-climb/game.css', 'games/castle-climb/game.js', 'games/castle-climb/problems.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
