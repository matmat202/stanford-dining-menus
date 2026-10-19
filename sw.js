/* Service worker for the dining site.
 *
 * Shell is cache-first so the app opens instantly and works with no signal.
 * Menu data is network-first with a cache fallback: a stale menu shown offline is
 * useful, but a stale menu shown while online would be a lie — and the page's own
 * freshness banner only helps if the data it reports is the data it fetched.
 */
const VERSION = 'dining-v6';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './cafes-logic.js', './libraries-logic.js',
  './saved-logic.js', './url-state.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // addAll fails the whole install if any one request fails; add individually
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let the CDN and tiles pass through

  const isData = url.pathname.endsWith('site.json');
  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('index.html');

  if (isData || isDoc) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }))
  );
});
