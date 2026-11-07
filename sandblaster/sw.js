/*
 * Sandblaster — service worker: холодный офлайн-старт.
 *
 * Ключ кэша в публикации — НЕ этот литерал: `tools/publish-pages.mjs` при сборке gh-pages
 * переписывает `const CACHE` на отпечаток содержимого ASSETS (`sandblaster-<12 hex>`).
 * Поэтому любая правка игрового файла сама инвалидирует старый кэш у установленных клиентов.
 * Литерал ниже — рабочая dev-копия для `python3 -m http.server`.
 *
 * ВАЖНО: новый модуль в src/ обязан попасть в ASSETS, иначе на холодном старте он не
 * закэшируется и офлайн отдаст index.html вместо JS. Это проверяет tests/sw-assets.test.mjs.
 */
// build: HEAD @6ab21c8 · ключ кэша = отпечаток содержимого ASSETS
const CACHE = 'sandblaster-2c18b7ae91d6';
const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname);
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.mjs',
  './src/game/config.mjs',
  './src/game/rng.mjs',
  './src/game/shapes.mjs',
  './src/game/grid.mjs',
  './src/game/upgrades.mjs',
  './src/game/orders.mjs',
  './src/game/economy.mjs',
  './src/game/pay.mjs',
  './src/game/state.mjs',
  './src/game/idle.mjs',
  './src/game/session.mjs',
  './src/game/autopilot.mjs',
  './src/game/flow.mjs',
  './src/game/delivery.mjs',
  './src/render/renderer.mjs',
  './src/render/viewport.mjs',
  './src/ui/hud.mjs',
  './src/ui/shop.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Локальная разработка: сеть впереди кэша, иначе правка main.mjs не видна до
  // ручного unregister — ровно та ловушка, что была в IDIGIT-12. Офлайн всё равно
  // работает: при падении сети отдаём кэш.
  if (DEV) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
