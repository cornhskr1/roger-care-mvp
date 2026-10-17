const CACHE = 'roger-care-v66';
const LIVE_RECORD_ORIGIN = 'https://gkotvodoqwdhmdeigrra.supabase.co';
const CORE = ['./','./index.html','./styles.css?v=45','./import-analysis.js?v=3','./app.js?v=66','./manifest.webmanifest?v=27','./data/seed.json','./icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('roger-care-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Shared-record and authentication reads must always reach the server.
  // HTTP cache options alone cannot bypass a response already in CacheStorage.
  if (new URL(event.request.url).origin === LIVE_RECORD_ORIGIN) {
    event.respondWith(fetch(event.request, {cache:'no-store'}));
    return;
  }

  const isAppShell =
    event.request.mode === 'navigate' ||
    event.request.url.includes('/app.js') ||
    event.request.url.includes('/styles.css') ||
    event.request.url.includes('/manifest.webmanifest') ||
    event.request.url.includes('/data/seed.json');

  if (isAppShell) {
    event.respondWith(
      fetch(event.request, {cache:'no-store'})
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
