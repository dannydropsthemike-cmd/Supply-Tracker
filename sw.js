// ============================================================
// Service Worker - Filament Vault PWA
// Caches all assets for full offline functionality
// ============================================================

const CACHE_NAME = 'filament-vault-v12';

// All assets to cache for offline use
const ASSETS_TO_CACHE = [
  '/Filament-Tracker/',
  '/Filament-Tracker/index.html',
  '/Filament-Tracker/app.js',
  '/Filament-Tracker/styles.css',
  '/Filament-Tracker/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

// Install: cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app assets');
      // Cache local assets first, then try external
      const localAssets = ASSETS_TO_CACHE.filter(url => !url.startsWith('http'));
      const externalAssets = ASSETS_TO_CACHE.filter(url => url.startsWith('http'));
      
      return cache.addAll(localAssets).then(() => {
        // Cache external assets individually (don't fail if unavailable)
        return Promise.allSettled(
          externalAssets.map(url => cache.add(url).catch(e => console.warn('[SW] Could not cache:', url)))
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      // Not in cache - try network and cache result
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // Network failed and not in cache
        console.warn('[SW] Network request failed and no cache:', event.request.url);
      });
    })
  );
});
