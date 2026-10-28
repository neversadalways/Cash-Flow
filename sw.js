/*
 * Service worker: שומר את קבצי האפליקציה במטמון כדי שתעבוד בלי אינטרנט.
 * בכל שינוי בקבצים יש להעלות את מספר הגרסה ב-CACHE כדי שהמכשירים יקבלו את העדכון.
 */
const CACHE = 'tazrim-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/calc.js',
  './js/storage.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// קודם מהמטמון (מהיר ועובד בלי רשת), וברקע מעדכנים את המטמון מהרשת.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(key, { ignoreSearch: true }).then(cached => {
        const network = fetch(req)
          .then(res => {
            if (res && res.ok) cache.put(key, res.clone());
            return res;
          })
          .catch(() => cached);
        if (cached) event.waitUntil(network);
        return cached || network;
      })
    )
  );
});
