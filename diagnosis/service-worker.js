// Byte-for-byte сравнение импортированных скриптов при проверке обновления
// service worker'а поддерживается Chrome/Edge с версии 78 (2019) и Firefox —
// т.е. правкой одного version.js обновление у пользователя обнаружится сама.
// Для Safari/iOS это поведение не подтверждено официальной документацией —
// если аудитория когда-нибудь станет заметно iOS-центричной, стоит это
// перепроверить отдельно, а не полагаться на общее предположение.
importScripts('./version.js');

const CACHE_NAME = 'diagnosis-app-v' + VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './version.js',
  './css/style.css',
  './js/app.js',
  './js/data/index.json',
  './js/data/about.json',
  './js/data/hypertension.json',
  './js/data/heart_failure.json',
  './js/data/atrial_fibrillation.json',
  './js/data/coronary_artery_disease.json',
  './js/data/peptic_ulcer.json',
  './js/data/gerd.json',
  './js/data/ibs.json',
  './js/data/functional_dyspepsia.json',
  './js/data/cholelithiasis.json',
  './js/data/gout.json',
  './js/data/ankylosing_spondylitis.json',
  './js/data/chronic_kidney_disease.json',
  './js/data/obesity.json',
  './js/data/anemia.json',
  './js/data/pneumonia.json',
  './js/data/asthma.json',
  './js/data/chronic_obstructive_pulmonary_disease.json',
  './js/data/chronic_bronchitis.json',
  './js/data/chronic_pancreatitis.json',
  './js/data/diabetes_mellitus_type_2.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './icons/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // {cache: 'reload'} на каждый Request — иначе addAll() может молча взять файл
      // из обычного HTTP-кеша браузера (отдельный слой, не Cache API), даже когда
      // CACHE_NAME уже новый. Найдено на реальном тесте: версия/баннер обновлялись
      // корректно, но конкретный изменённый js/data/*.json в новом кеше оказывался
      // старым, если браузер уже кешировал его раньше по обычным HTTP-правилам.
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // Раньше здесь был безусловный self.skipWaiting() — новый worker активировался
  // мгновенно при каждом обновлении, минуя баннер и любое решение врача. Теперь
  // worker ждёт в состоянии "installed", пока страница явно не пришлёт SKIP_WAITING
  // (после нажатия "Обновить" на баннере, см. app.js) — см. message-обработчик ниже.
});

// Явная команда от страницы — единственный способ перевести ожидающий worker
// в активное состояние. Вызывается из app.js по нажатию "Обновить" на баннере.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Кеш-первый для оболочки приложения, сеть — для всего остального с фолбэком в кеш.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
