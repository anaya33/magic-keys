/**
 * Magic Keys service worker: keeps the piano on the device.
 *
 * After the first visit, the piano samples, fonts, icons and app code are served
 * from a local cache, so the piano is ready instantly and works offline.
 *  - Samples, fonts, icons and hashed build files never change, so: cache first.
 *  - The page itself may change between deploys, so: network first, cache as fallback.
 * Only this site's own files are touched; nothing is sent anywhere.
 */
const CACHE = 'magic-keys-v2';
const NEVER_CHANGES = /^\/(samples|assets|icons|fonts|models)\//;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  // Drop caches from older versions of the app.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (NEVER_CHANGES.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
    );
  }
});
