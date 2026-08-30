'use strict';

/**
 * صفحةُ مشاركة اللعبة — `‎/g/<id>‎`.
 *
 * **لماذا صفحةٌ من الخادم ورابطُ اللعبة موجودٌ أصلاً؟**
 *
 * لأن رابط اللعبة كان `‎/games.html#/g/<id>‎`، وما بعد `#` **لا يصل الخادم
 * إطلاقاً** — لا يُرسله المتصفّح. فزاحفُ واتساب وفيسبوك يطلب `games.html`
 * وحدها فيقرأ عنوان المنصّة ووصفها العامّ: كل لعبةٍ في العالم تظهر ببطاقةٍ
 * واحدة بلا صورة ولا اسم. وهذه الزواحف **لا تشغّل جافاسكربت**، فلا ينفع أن
 * تكتب الصفحة وسومها بعد التحميل.
 *
 * فهذا العنوان يُبنى في الخادم: وسومُ `og:` كاملة في الرأس — عنوان اللعبة
 * ووصفها وصورتها بعنوانٍ مطلق — ثم يُنقل الزائر البشريّ إلى التطبيق. الزاحف
 * يأخذ ما يحتاج من الرأس ولا يتبع النقل، والإنسان لا يرى هذه الصفحة أصلاً
 * إلا لحظةً واحدة (أو كاملةً إن كانت جافاسكربت معطّلة عنده).
 */

/**
 * كلُّ نصٍّ يدخل هذه الصفحة كتبه معلّم: عنوان اللعبة ووصفه واسمه.
 * فالهروب ليس تجميلاً — عنوانُ لعبةٍ فيه `"` أو `<` يكسر الوسم ويكتب فيه ما
 * يشاء صاحبه. والعطف: `&` أولاً وإلا ضاعف هروبَ ما بعده.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** يقصّ نصّاً طويلاً عند حدٍّ معقول لبطاقة التواصل */
function trim(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * بطاقةُ اللعبة كما تظهر في واتساب وفيسبوك ثم في المتصفّح.
 *
 * @param {object} game اللعبة كما يعيدها التخزين
 * @param {string} origin أصل الموقع بلا شرطة أخيرة (`https://tapio.fun`)
 * @param {string} version بصمة النسخة لكسر التخزين المؤقّت للملفات الثابتة
 */
function gameSharePage(game, origin, version = '') {
  const id = String(game.id);
  const title = trim(game.title, 90) || 'لعبة تفاعلية';
  const author = trim(game.authorDisplayName || game.authorName || '', 40);
  const description =
    trim(game.description, 180) ||
    (author ? `لعبة تفاعلية من إعداد ${author} — العب مباشرةً على Tapio بلا تحميل ولا تسجيل.` : 'لعبة تفاعلية — العب مباشرةً على Tapio بلا تحميل ولا تسجيل.');

  /*
   * الصورة **بعنوانٍ مطلق**: الزاحف يقرأ الوسم خارج سياق الصفحة فلا يعرف
   * معنى `‎/api/…‎`. وبديلُها أيقونةُ المنصّة نقطيّةً لا SVG — واتساب لا
   * يرسم SVG، فتظهر البطاقة بلا صورة أصلاً.
   */
  const image = game.hasCover
    ? `${origin}/api/games/${id}/cover?v=${Number(game.updatedAt) || 0}`
    : `${origin}/assets/apple-touch-icon.png${version ? `?v=${version}` : ''}`;

  const url = `${origin}/g/${encodeURIComponent(id)}`;
  const play = `/games.html#/g/${encodeURIComponent(id)}`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)} — Tapio</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="theme-color" content="#171240" />
    <link rel="canonical" href="${esc(url)}" />
    <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Tapio" />
    <meta property="og:locale" content="ar_AR" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:secure_url" content="${esc(image)}" />
    <meta property="og:image:alt" content="${esc(title)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(image)}" />

    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
        background: #171240; color: #fff; font-family: system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif; line-height: 1.7; }
      .card { max-width: 420px; text-align: center; display: grid; gap: 14px; justify-items: center; }
      img.cover { width: 100%; max-width: 320px; border-radius: 16px; display: block; }
      h1 { font-size: 1.4rem; margin: 0; }
      p { margin: 0; color: #b9b4d8; }
      a.play { display: inline-block; padding: 12px 26px; border-radius: 99px; text-decoration: none;
        font-weight: 700; background: #6c3df4; color: #fff; }
    </style>
  </head>
  <body>
    <!--
      جسمٌ حقيقيّ لا شاشةَ انتظار: من عطّل جافاسكربت — أو وصل عبر متصفّحٍ
      داخل تطبيقٍ يمنعها — يجد اللعبة واسمها وزرّاً يفتحها، لا صفحةً بيضاء.
    -->
    <main class="card">
      <img class="cover" src="${esc(image)}" alt="${esc(title)}" />
      <h1>${esc(title)}</h1>
      <p>${esc(description)}</p>
      <a class="play" href="${esc(play)}">▶ العب الآن</a>
    </main>
    <script>
      // النقل بـ replace لا بتعيين href: زرّ الرجوع يعود إلى واتساب لا إلى
      // هذه الصفحة التي تعيد نقله إلى التطبيق في حلقة
      location.replace(${JSON.stringify(play)});
    </script>
  </body>
</html>
`;
}

module.exports = { gameSharePage, esc };
