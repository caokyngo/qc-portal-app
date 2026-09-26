const CACHE_NAME = 'qc-portal-cache-v3'; // Đã tăng lên v3 để ép trình duyệt xóa sạch cache cũ

// Danh sách các file cốt lõi cần lưu lại để dùng khi mất mạng (Offline)
const urlsToCache = [
  './',
  './index.html',
  './device_manage.html',
  './device_info.html',
  './manifest.json'
  // Đã xóa các link CDN bên ngoài (Tailwind, ChartJS, SheetJS...) để tránh lỗi CORS
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Đang lưu trữ cache các file cốt lõi...');
      return cache.addAll(urlsToCache);
    })
  );
  // Ép Service Worker mới ngay lập tức cài đặt xong
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Xóa tất cả các cục cache cũ (v1, v2) không còn trùng tên với CACHE_NAME hiện tại
          if (cacheName !== CACHE_NAME) {
            console.log('Đã dọn dẹp cache cũ:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Yêu cầu Service Worker kiểm soát các client ngay lập tức
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Bỏ qua các request có scheme không phải http/https (như extension của Chrome)
  if (!(event.request.url.startsWith('http:') || event.request.url.startsWith('https:'))) {
      return;
  }

  // CHIẾN LƯỢC: NETWORK-FIRST (ƯU TIÊN LẤY TỪ INTERNET TRƯỚC)
  // Giải quyết dứt điểm tình trạng mọi người nhìn thấy bản code HTML cũ
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Nếu có mạng -> Tải file mới nhất về -> Cập nhật luôn vào Cache dự phòng
        return caches.open(CACHE_NAME).then((cache) => {
          // Chỉ lưu cache với các request GET hợp lệ
          if (event.request.method === 'GET') {
              cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        });
      })
      .catch(() => {
        // Rớt mạng (Offline) -> Lấy file đã lưu trong Cache ra để App vẫn chạy được
        return caches.match(event.request);
      })
  );
});
