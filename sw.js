const CACHE_NAME = 'qc-portal-cache-v2'; // Đổi sang v2 để ép trình duyệt cập nhật cache mới
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
  // Đã xóa các link CDN bên ngoài (Tailwind, ChartJS, SheetJS...) để tránh lỗi CORS
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Bỏ qua các request có scheme không phải http/https (như extension của Chrome)
  if (!(event.request.url.startsWith('http:') || event.request.url.startsWith('https:'))) {
      return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Trả về file từ cache nếu có, nếu không thì fetch từ internet
      return response || fetch(event.request);
    })
  );
});
