/*
 * عامل خدمة بأقلّ ما يلزم — عمداً.
 *
 * وجوده شرطٌ يفرضه المتصفح لإتاحة تثبيت التطبيق على الجوال: بلا عامل خدمة
 * يعالج fetch لا يُطلق كروم حدث beforeinstallprompt إطلاقاً، فلا يظهر زر
 * التثبيت مهما فعلنا.
 *
 * ولا يخزّن شيئاً من ملفات التطبيق تلقائياً. السبب: الجلسات حيّة والحالة في
 * ذاكرة الخادم، وأي نسخة مخبّأة قديمة تعني معلّماً يرى واجهة لا تطابق خادمها
 * بعد النشر — وهو عطل أسوأ بكثير من ثوانٍ تحميل.
 *
 * الاستثناء الوحيد: **ألعابٌ يطلب الطالب صراحةً حفظها** للّعب بلا إنترنت.
 * وهو استثناءٌ مضبوط بثلاثة قيود:
 *   ١) لا يُخزَّن شيء إلا برسالةٍ صريحة من الصفحة (لا خلسةً لكل زائر).
 *   ٢) مستندُ اللعبة وصورتها فقط — مفتاحُهما معرّف اللعبة، ومحتواهما ثابت.
 *   ٣) قشرةُ صفحة الألعاب تُقرأ **من الشبكة أولاً** والمخبّأ بديلٌ عند
 *      انقطاعها — فلا تعود مشكلةُ الواجهة القديمة التي كُتب هذا الملف
 *      لتفاديها، لأن المتصل يرى دائماً آخر نسخة.
 *
 * والعزل يبقى كاملاً وهي محفوظة: Cache API تحفظ الاستجابة بترويساتها، فترويسة
 * `sandbox` تعود معها، ويبقى أصل اللعبة مبهماً بلا كوكي ولا وصول إلى الـAPI.
 */

const OFFLINE_CACHE = 'tapio-offline-v1';
const GAMES_CACHE = 'tapio-games-v1';
const SHELL_CACHE = 'tapio-shell-v1';
const KEEP = [OFFLINE_CACHE, GAMES_CACHE, SHELL_CACHE];
const OFFLINE_URL = '/offline.html';

/** ما يلزم لفتح صفحة لعبة محفوظة بلا شبكة — ولا شيء غيره */
const SHELL = ['/games.html', '/assets/css/app.css', '/assets/css/tapio-base.css', '/assets/css/participant.css', '/assets/css/teacher.css', '/assets/js/i18n.js', '/assets/js/theme.js', '/assets/js/common.js', '/assets/js/participant-ui.js', '/assets/js/teacher-ui.js', '/assets/js/footer.js', '/assets/js/games.js'];

/**
 * ثلاثة عناوين لكل لعبة محفوظة: بطاقتها (JSON) ومستندها وصورتها. نسيانُ
 * البطاقة يعني صفحةً تفتح بلا شبكة ثم تفشل في معرفة ماذا تعرض.
 */
const gameUrls = (id) => [`/api/games/${id}`, `/api/games/${id}/frame`, `/api/games/${id}/cover`];
const isGameAsset = (url) => /^\/api\/games\/[\w-]+(\/(frame|cover))?$/.test(url.pathname);

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
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** الصفحة تطلب حفظ لعبة أو إزالتها — لا نحفظ شيئاً من تلقائنا */
self.addEventListener('message', (event) => {
  const { type, id } = event.data || {};
  if (!id || !/^[\w-]+$/.test(id)) return;
  const urls = gameUrls(id);

  if (type === 'saveGame') {
    event.waitUntil(
      (async () => {
        try {
          // القشرة أولاً: لعبةٌ محفوظة لا تُفتح إن لم تُفتح صفحتها
          const shell = await caches.open(SHELL_CACHE);
          await shell.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
          const games = await caches.open(GAMES_CACHE);
          await games.addAll(urls.map((u) => new Request(u, { cache: 'reload' })));
          event.source?.postMessage({ type: 'gameSaved', id, ok: true });
        } catch (err) {
          event.source?.postMessage({ type: 'gameSaved', id, ok: false, error: String(err && err.message) });
        }
      })()
    );
  }

  if (type === 'dropGame') {
    event.waitUntil(
      caches.open(GAMES_CACHE).then(async (c) => {
        await Promise.all(urls.map((u) => c.delete(u)));
        event.source?.postMessage({ type: 'gameDropped', id });
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isGameAsset(url)) {
    const isCard = /^\/api\/games\/[\w-]+$/.test(url.pathname);
    event.respondWith(
      isCard
        // البطاقة تحمل عدّاد اللعب والتقييم: الشبكة أولاً كي لا تتجمّد أرقامها
        ? fetch(request).catch(() => caches.open(GAMES_CACHE).then((c) => c.match(request)).then((hit) => hit || Response.error()))
        // المستند والصورة ثابتان لهذه اللعبة: المحفوظ أولاً وهذا كل معنى «بلا إنترنت»
        : caches.open(GAMES_CACHE).then((c) => c.match(request)).then((hit) => hit || fetch(request))
    );
    return;
  }

  // بقية نداءات الواجهة تمرّ كما هي — لا تخبئة لبيانات حيّة
  if (url.pathname.startsWith('/api/')) return;

  // القشرة: الشبكة أولاً كي لا يرى المتصل واجهةً قديمة، والمخبّأ بديلٌ عند انقطاعها
  if (request.mode === 'navigate' || SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && SHELL.includes(url.pathname)) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          // الصفحة تطلب الأصول ببصمة إصدار (‎?v=1.54.0‎) بينما نخزّنها بلا
          // بصمة، فبلا ignoreSearch لا يطابق شيءٌ شيئاً ويسقط «بلا إنترنت»
          const hit = await caches.match(request, { ignoreSearch: true });
          if (hit) return hit;
          if (request.mode === 'navigate') return (await caches.match(OFFLINE_URL)) || Response.error();
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(fetch(request));
});
