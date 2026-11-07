/* Dig Deeper — service worker: офлайн-кэш всей игры, без сети после первой загрузки. */

/*
 * Ключ кэша в публикации — НЕ этот литерал: `tools/publish-pages.mjs` при сборке gh-pages
 * переписывает строку CACHE на отпечаток содержимого ASSETS (`dig-deeper-<12 hex>`), поэтому
 * любая правка игрового файла сама инвалидирует старый кэш у установленных клиентов.
 * Литерал ниже нужен только для локальной разработки (`python3 -m http.server`), чтобы
 * репозиторная копия оставалась рабочим standalone service worker'ом.
 */
// build: origin/main @c6ad96c · ключ кэша = отпечаток содержимого ASSETS
const CACHE = 'dig-deeper-9454cf864650';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.mjs',
  './src/config/economy.mjs',
  './src/config/loot.mjs',
  './src/config/upgrades.mjs',
  './src/engine/rng.mjs',
  './src/engine/world.mjs',
  './src/game/machine.mjs',
  './src/game/settlement.mjs',
  './src/game/state.mjs',
  './src/game/run.mjs',
  './src/game/day.mjs',
  './src/game/upgrades.mjs',
  './src/game/bot.mjs',
  './src/model/model-v1.mjs',
  './src/render/renderer.mjs',
  './src/render/machine-pose.mjs',
  './src/ui/hold.mjs',
  './src/ui/hud.mjs',
  './src/ui/town.mjs',
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

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
