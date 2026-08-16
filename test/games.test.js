'use strict';

/**
 * قسم الألعاب التفاعلية — ومحوره سؤال أمني واحد:
 *
 * نحن نستضيف شفرةً كتبها شخصٌ آخر ونشغّلها لطلاب لا يعرفونه. لو قُدّمت هذه
 * الشفرة على نطاقنا بلا عزل لقرأت كوكي جلسة كل من يفتحها وانتحلت شخصيته.
 * فما تثبّته هذه الاختبارات ليس «هل تُرفع اللعبة» بل **هل تبقى محبوسة**:
 * ترويسة `sandbox` بلا `allow-same-origin` (أصلٌ مبهم ⇒ لا كوكي)، و
 * `connect-src 'none'` (لا يغادر اللعبةَ شيءٌ يكتبه الطالب فيها).
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-games-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.ADMIN_EMAILS = 'owner@tapio.fun';
const { server, ready } = require('../server/index');

let base;

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

function client() {
  let cookie = '';
  return {
    set cookie(v) {
      cookie = v;
    },
    get cookie() {
      return cookie;
    },
    async request(method, p, body) {
      const res = await fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const raw of res.headers.getSetCookie?.() || []) {
        const pair = raw.split(';')[0];
        cookie = pair.endsWith('=') ? '' : pair;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* بلا جسم */
      }
      return { status: res.status, data, headers: res.headers };
    },
  };
}

let uniq = 0;

async function login(c, name, email) {
  const original = global.fetch;
  const mail = email || `game${++uniq}.${Date.now()}@example.com`;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub: 'g_' + mail, email: mail, email_verified: true, name }) };
    }
    return original(url, opts);
  };
  try {
    const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
    const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cb = await fetch(`${base}/api/auth/google/callback?code=x&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie.split(';')[0] },
    });
    c.cookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
  } finally {
    global.fetch = original;
  }
}

const HTML = '<!doctype html><html><body><h1>لعبة الجمع</h1><script>let s=0</script></body></html>';

/** أصغر PNG صالحة — بكسل واحد شفّاف */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const GAME = (over) => ({ title: 'لعبة الجمع', subject: 'math', grades: ['g3', 'g4'], html: HTML, cover: PNG, ...over });

// ------------------------------------------------------------------ الأمان

test('مستند اللعبة يُقدَّم بأصل مبهم: sandbox بلا allow-same-origin', async () => {
  const c = client();
  await login(c, 'سلمى');
  const { data } = await c.request('POST', '/api/games', GAME());
  const res = await fetch(`${base}/api/games/${data.game.id}/frame`);
  const csp = res.headers.get('content-security-policy') || '';

  assert.match(csp, /sandbox /, 'ترويسة sandbox موجودة');
  assert.equal(/allow-same-origin/.test(csp), false, 'ولا تمنح الأصل نفسه — وإلا قرأت كوكي الجلسة');
  assert.equal(/allow-top-navigation/.test(csp), false, 'ولا تنقل الصفحة الأمّ إلى موقع تصيّد');
  assert.equal(/allow-popups(?!-)/.test(csp), false, 'ولا تفتح نوافذ');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('اللعبة لا تستطيع إرسال شيء إلى الخارج: connect-src و form-action ممنوعان', async () => {
  const c = client();
  await login(c, 'سلمى');
  const { data } = await c.request('POST', '/api/games', GAME());
  const csp = (await fetch(`${base}/api/games/${data.game.id}/frame`)).headers.get('content-security-policy');
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-src 'none'/, 'ولا تُدخل صفحةً أخرى داخلها');
});

test('الشفرة تُحفظ كما رفعها المعلّم بلا تنقية — العزل هو الضمانة لا التنقية', async () => {
  const c = client();
  await login(c, 'سلمى');
  const evil = '<script>document.cookie</script><img src=x onerror="fetch(1)">';
  const { data } = await c.request('POST', '/api/games', GAME({ html: '<!doctype html>' + evil }));
  const body = await (await fetch(`${base}/api/games/${data.game.id}/frame`)).text();
  assert.ok(body.includes(evil), 'لا نكسر اللعبة بتنقية وهمية');
  // ومع ذلك لا تصل إلى شيء: الأصل مبهم
  const csp = (await fetch(`${base}/api/games/${data.game.id}/frame`)).headers.get('content-security-policy');
  assert.equal(/allow-same-origin/.test(csp), false);
});

// ------------------------------------------------------------------ الرفع

test('الرفع يتطلّب حساباً، ويرفض الفارغ وغير HTML والضخم', async () => {
  const guest = client();
  assert.equal((await guest.request('POST', '/api/games', GAME())).status, 401);

  const c = client();
  await login(c, 'سلمى');
  assert.equal((await c.request('POST', '/api/games', GAME({ title: '' }))).status, 400);
  assert.equal((await c.request('POST', '/api/games', GAME({ html: '   ' }))).status, 400);
  const notHtml = await c.request('POST', '/api/games', GAME({ html: 'مرحباً، هذه ليست لعبة' }));
  assert.equal(notHtml.status, 400);
  assert.match(notHtml.data.error, /HTML/);
  const huge = await c.request('POST', '/api/games', GAME({ html: '<html>' + 'x'.repeat(2.1 * 1024 * 1024) }));
  assert.equal(huge.status, 413);
});

test('البطاقة لا تحمل شفرة اللعبة — القائمة لا تُحمَّل بميغابايتات', async () => {
  const c = client();
  await login(c, 'سلمى');
  const made = await c.request('POST', '/api/games', GAME());
  assert.equal(made.status, 201);
  assert.equal(made.data.game.html, undefined);
  const list = await client().request('GET', '/api/games');
  assert.equal(JSON.stringify(list.data).includes('<script>'), false, 'ولا الفهرس');
  const one = await client().request('GET', '/api/games/' + made.data.game.id);
  assert.equal(one.data.game.html, undefined);
});

test('لا يعدّل أحد لعبة غيره ولا يحذفها — والمالك يحذف أي لعبة', async () => {
  const owner = client();
  await login(owner, 'سلمى');
  const id = (await owner.request('POST', '/api/games', GAME())).data.game.id;

  const other = client();
  await login(other, 'متطفّل');
  assert.equal((await other.request('PUT', '/api/games/' + id, GAME({ title: 'سرقتها' }))).status, 404);
  assert.equal((await other.request('DELETE', '/api/games/' + id)).status, 404);

  const admin = client();
  await login(admin, 'المالك', 'owner@tapio.fun');
  assert.equal((await admin.request('DELETE', '/api/games/' + id)).status, 200, 'الإشراف شرطُ فتح باب الرفع');
});

// ------------------------------------------------------------- التصفّح

test('البحث والتصفية بالمادة والصف — و«كل المراحل» تطابق أي صفّ', async () => {
  const c = client();
  await login(c, 'ناشر');
  await c.request('POST', '/api/games', GAME({ title: 'جدول الضرب', subject: 'رياضيات', grades: ['الثالث'] }));
  await c.request('POST', '/api/games', GAME({ title: 'الأفعال الإنجليزية', subject: 'إنجليزي', grades: ['السابع'] }));
  await c.request('POST', '/api/games', GAME({ title: 'لعبة الذاكرة', subject: 'عام', grades: [] }));

  const guest = client();
  const byText = await guest.request('GET', '/api/games?q=' + encodeURIComponent('الضرب'));
  assert.equal(byText.data.items.some((g) => g.title === 'جدول الضرب'), true);
  assert.equal(byText.data.items.some((g) => g.title === 'الأفعال الإنجليزية'), false);

  const bySubject = await guest.request('GET', '/api/games?subject=' + encodeURIComponent('إنجليزي'));
  assert.equal(bySubject.data.items.every((g) => g.subject === 'إنجليزي'), true);

  const byGrade = await guest.request('GET', '/api/games?grade=' + encodeURIComponent('الثالث'));
  const titles = byGrade.data.items.map((g) => g.title);
  assert.ok(titles.includes('جدول الضرب'));
  assert.ok(titles.includes('لعبة الذاكرة'), '«كل المراحل» تظهر لكل صفّ');
  assert.equal(titles.includes('الأفعال الإنجليزية'), false);
});

test('ألعاب معلّم بعينه — بروفايله', async () => {
  const a = client();
  await login(a, 'سلمى');
  const mine = (await a.request('POST', '/api/games', GAME({ title: 'لعبة سلمى' }))).data.game;
  const b = client();
  await login(b, 'مروان');
  await b.request('POST', '/api/games', GAME({ title: 'لعبة مروان' }));

  const list = await client().request('GET', '/api/games?teacher=' + mine.authorId);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].title, 'لعبة سلمى');
  assert.equal(list.data.items[0].author, 'سلمى', 'الاسم الأول وحده');
});

test('عدّاد الزيارات يرتفع بالتشغيل ولا يتضاعف بالتحديث المتكرّر', async () => {
  const c = client();
  await login(c, 'سلمى');
  const id = (await c.request('POST', '/api/games', GAME())).data.game.id;
  await fetch(`${base}/api/games/${id}/frame`);
  await fetch(`${base}/api/games/${id}/frame`);
  const one = await client().request('GET', '/api/games/' + id);
  assert.equal(one.data.game.plays, 1, 'زيارتان من العنوان نفسه = واحدة');
});

test('التقييم من ١ إلى ٥، ومرة واحدة لكل زائر', async () => {
  const c = client();
  await login(c, 'سلمى');
  const id = (await c.request('POST', '/api/games', GAME())).data.game.id;
  const guest = client();
  assert.equal((await guest.request('POST', `/api/games/${id}/rate`, { stars: 9 })).status, 400);
  assert.equal((await guest.request('POST', `/api/games/${id}/rate`, { stars: 0 })).status, 400);

  const first = await guest.request('POST', `/api/games/${id}/rate`, { stars: 4 });
  assert.equal(first.status, 200);
  assert.equal(first.data.rating, 4);
  assert.equal((await guest.request('POST', `/api/games/${id}/rate`, { stars: 5 })).status, 429, 'لا تكرار');
});

test('الترتيب: الأكثر زيارة، والأعلى تقييماً بترجيح لا بمتوسّط خام', async () => {
  const c = client();
  await login(c, 'ناشر');
  const popular = (await c.request('POST', '/api/games', GAME({ title: 'شعبية' }))).data.game.id;
  const rated = (await c.request('POST', '/api/games', GAME({ title: 'مقيَّمة' }))).data.game.id;

  const db = require('../server/storage').get();
  for (let i = 0; i < 50; i += 1) await db.bumpGamePlays(popular);
  for (let i = 0; i < 30; i += 1) await db.rateGame(rated, 5);
  await db.rateGame(popular, 3);

  const byPlays = await client().request('GET', '/api/games?sort=popular');
  assert.equal(byPlays.data.items[0].title, 'شعبية');

  const byRating = await client().request('GET', '/api/games?sort=rated');
  assert.equal(byRating.data.items[0].title, 'مقيَّمة');

  // لعبة قيّمها واحدٌ بخمس نجوم لا تتصدّر لعبةً قيّمها ثلاثون
  const lucky = (await c.request('POST', '/api/games', GAME({ title: 'محظوظة' }))).data.game.id;
  await db.rateGame(lucky, 5);
  const again = await client().request('GET', '/api/games?sort=rated');
  assert.equal(again.data.items[0].title, 'مقيَّمة', 'الترجيح يمنع تصدّر تقييمٍ واحد');
});

// -------------------------------------------------------- الصورة المصغّرة

test('الصورة المصغّرة مطلوبة، وبأنواعٍ نعرف تقديمها بأمان', async () => {
  const c = client();
  await login(c, 'سلمى');

  const bare = await c.request('POST', '/api/games', GAME({ cover: '' }));
  assert.equal(bare.status, 400, 'لا لعبة بلا صورة تدلّ عليها');
  assert.match(bare.data.error, /صورة/);

  // رابط خارجي ليس صورةً نملكها — نرفض ما لا نستطيع تقديمه بأنفسنا
  assert.equal((await c.request('POST', '/api/games', GAME({ cover: 'https://x.test/a.png' }))).status, 400);
  // SVG مستندٌ كامل لا صورة — نغلق البابَ ولا نفتحه من أجل بطاقة
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  assert.equal((await c.request('POST', '/api/games', GAME({ cover: svg }))).status, 400);

  const huge = 'data:image/png;base64,' + Buffer.alloc(401 * 1024, 1).toString('base64');
  assert.equal((await c.request('POST', '/api/games', GAME({ cover: huge }))).status, 413);
});

test('الصورة تُقدَّم من مسارها الخاص، والبطاقة تحمل وجودها لا بايتاتها', async () => {
  const c = client();
  await login(c, 'سلمى');
  const id = (await c.request('POST', '/api/games', GAME())).data.game.id;

  const list = await client().request('GET', '/api/games');
  const card = list.data.items.find((g) => g.id === id);
  assert.equal(card.cover, true, 'البطاقة تقول إنّ لها صورة');
  assert.equal(JSON.stringify(list.data).includes('base64'), false, 'ولا تحمل بايتاتها — القائمة تبقى خفيفة');

  const res = await fetch(`${base}/api/games/${id}/cover`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control') || '', /max-age=/, 'تُخزَّن في المتصفّح فلا تُطلب مع كل تصفّح');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', 'وبايتاتها صورة PNG حقيقية');

  assert.equal((await fetch(`${base}/api/games/g_nope/cover`)).status, 404);
});

// ------------------------------------------------- دليل المعلّمين والأوفلاين

test('دليل المعلّمين يجمع كل معلّم مع عدد ألعابه ولعِباتها', async () => {
  const a = client();
  await login(a, 'هدى الشمري');
  await a.request('POST', '/api/games', GAME({ title: 'أ١' }));
  await a.request('POST', '/api/games', GAME({ title: 'أ٢' }));
  const b = client();
  await login(b, 'وليد');
  const only = (await b.request('POST', '/api/games', GAME({ title: 'ب١' }))).data.game.id;
  await require('../server/storage').get().bumpGamePlays(only);

  const { data } = await client().request('GET', '/api/game-teachers');
  const huda = data.items.find((x) => x.name === 'هدى');
  const walid = data.items.find((x) => x.name === 'وليد');
  assert.ok(huda && huda.games >= 2, 'يعدّ ألعاب كل معلّم');
  assert.ok(walid && walid.plays >= 1, 'ويجمع لعِباتها');
  // الاسم الأول فقط — كما في المكتبة، فالمعلّم نشر لعبة لا سيرةً ذاتية
  assert.equal(data.items.some((x) => /الشمري/.test(x.name)), false);
  assert.equal(JSON.stringify(data).includes('@'), false, 'ولا بريد أحد');
});

test('صاحب اللعبة وحده يقرّر السماح بحفظها للّعب بلا إنترنت', async () => {
  const c = client();
  await login(c, 'سلمى');

  const open = (await c.request('POST', '/api/games', GAME({ title: 'مسموحة' }))).data.game;
  assert.equal(open.offlineOk, true, 'والافتراضي مسموح');

  const closed = (await c.request('POST', '/api/games', GAME({ title: 'ممنوعة', offlineOk: false }))).data.game;
  assert.equal(closed.offlineOk, false);

  // والقرار يبقى مع اللعبة في القائمة كما في بطاقتها المفردة
  const list = await client().request('GET', '/api/games?q=' + encodeURIComponent('ممنوعة'));
  assert.equal(list.data.items[0].offlineOk, false);
  const one = await client().request('GET', '/api/games/' + closed.id);
  assert.equal(one.data.game.offlineOk, false);
});
