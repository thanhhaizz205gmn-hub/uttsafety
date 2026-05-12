const CACHE_NAME = 'vtv-safety-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './src/script.js',
  './assets/logo.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
  './models/best.onnx',
  './models/bestcone.onnx',
  'https://unpkg.com/lucide@latest',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching Assets');
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // BYPASS cache for dynamic API and Camera Stream
  if (url.pathname.includes('/api/') || url.pathname.includes('/video_feed/')) {
    return event.respondWith(fetch(event.request));
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).catch(() => {
        return null;
      });
    })
  );
});
