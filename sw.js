// Service Worker — Supply Tracker PWA

const CACHE_NAME = 'supply-tracker-v99';

const ASSETS = [
  '/Supply-Tracker/',
  '/Supply-Tracker/index.html',
  '/Supply-Tracker/app.js',
  '/Supply-Tracker/styles.css',
  '/Supply-Tracker/manifest.json',
  '/Supply-Tracker/icons/icon-192.png',
  '/Supply-Tracker/icons/icon-512.png',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match('/Supply-Tracker/index.html'));
    })
  );
});
