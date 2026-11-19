/**
 * Magic Keys service worker: keeps the piano on the device.
 *
 * After the first visit, the piano samples, fonts, icons and app code are served
 * from a local cache, so the piano is ready instantly and works offline.
 *  - Samples, fonts, icons and hashed build files never change, so: cache first.
 *  - The page itself may change between deploys, so: network first, cache as fallback.
 * Only this site's own files are touched; nothing is sent anywhere.
 */
const CACHE = 'magic-keys-v7'; // bump to make every device drop old files (e.g. icons)
const NEVER_CHANGES = /^(samples|assets|icons|fonts|models)\//;
/** The app's base path ("/" locally, "/magic-keys/" on GitHub Pages). */
const SCOPE_PATH = new URL(self.registration.scope).pathname;

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

  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  const path = url.pathname.slice(SCOPE_PATH.length); // e.g. "samples/A4.mp3"

  if (NEVER_CHANGES.test(path)) {
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
        .catch(() => caches.match(request).then((hit) => hit || caches.match(SCOPE_PATH))),
    );
  }
});
