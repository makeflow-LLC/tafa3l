/*
 * عامل خدمة بأقلّ ما يلزم — عمداً.
 *
 * وجوده شرطٌ يفرضه المتصفح لإتاحة تثبيت التطبيق على الجوال: بلا عامل خدمة
 * يعالج fetch لا يُطلق كروم حدث beforeinstallprompt إطلاقاً، فلا يظهر زر
 * التثبيت مهما فعلنا.
 *
 * ولا يخزّن شيئاً من ملفات التطبيق. السبب: الجلسات حيّة والحالة في ذاكرة
 * الخادم، وأي نسخة مخبّأة قديمة تعني معلّماً يرى واجهة لا تطابق خادمها بعد
 * النشر — وهو عطل أسوأ بكثير من ثوانٍ تحميل. فنمرّر كل طلب إلى الشبكة،
 * ونحتفظ فقط بصفحة اعتذار تُعرض حين ينقطع الاتصال تماماً.
 */

const OFFLINE_CACHE = 'tapio-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .catch(() => {
        /* غياب صفحة الاعتذار لا يمنع التثبيت */
      })
  );
  self.skipWaiting(); // النسخة الجديدة تعمل فوراً بلا انتظار إغلاق كل التبويبات
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // لا نتدخّل في غير طلبات القراءة، ولا في مقابس الويب ولا في نداءات الواجهة
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) return;

  // صفحات التنقّل فقط لها بديل عند انقطاع الشبكة
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())));
    return;
  }

  event.respondWith(fetch(request));
});
