// Service worker — makes the installed app usable without a connection.
// manifest.json has always asked to be installed; without this, an installed
// copy opened offline was simply blank.
//
// Strategy by resource:
//   app shell + scripts   stale-while-revalidate — instant, updates in background
//   data/*.js             network-first — a stale media list is worse than a wait
//   thumbs/*.jpg          cache-first — content-addressed, so never stale
//   media + proxy         never cached — far too large, and not ours to hold
const VERSION = 'vault-v1';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';
const THUMBS = VERSION + '-thumbs';

const SHELL_URLS = [
  '/', '/index.html', '/manifest.json',
  '/vault-core.js', '/vault-home.js', '/vault.js',
  '/vault-lock.js', '/vault-additions.js',
  '/vault-video-engine.js', '/vault-image-engine.js',
  '/vault-favourites-engine.js',
  '/vendor/hls.min.js',
  '/assets/favicon.svg', '/assets/favicon.png'
];

self.addEventListener('install', (e) => {
  // Precache what we can; a single 404 must not fail the whole install.
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  const keep = [SHELL, DATA, THUMBS];
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
}

function networkFirst(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cache.match(req))
  );
}

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }))
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only ever handle this origin. Media, the proxy and the admin worker are
  // all cross-origin and must go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Health logs must always be current — a cached one would show stale state.
  if (url.pathname.startsWith('/health/')) return;

  if (url.pathname.startsWith('/data/')) { e.respondWith(networkFirst(req, DATA)); return; }
  if (url.pathname.startsWith('/thumbs/')) { e.respondWith(cacheFirst(req, THUMBS)); return; }

  if (req.mode === 'navigate') {
    e.respondWith(
      networkFirst(req, SHELL).then((res) => res || caches.match('/index.html'))
    );
    return;
  }

  e.respondWith(staleWhileRevalidate(req, SHELL));
});
