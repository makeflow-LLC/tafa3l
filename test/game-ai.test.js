'use strict';

/**
 * مسار منشئ الألعاب: بوابةُ الحساب والاشتراك، ومهمّةٌ تُستطلَع بدل نداءٍ
 * معلّق، ومحادثةٌ تعيش على الخادم فلا يعيد المتصفّح ملفّ اللعبة مع كل رسالة.
 * نداء Evolink الحقيقي مُستبدَل بردٍّ مزيّف.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-gameai-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.EVOLINK_API_KEY = 'test-evolink-key';
// هذا الملف يختبر بوابة الاشتراك، فنُطفئ منحة التسجيل كي يكون المجاني مجانياً
process.env.PREMIUM_SIGNUP_TRIAL_DAYS = '0';
const { server, ready } = require('../server/index');
const storage = require('../server/storage');

const GAME = '<!doctype html>\n<html lang="ar" dir="rtl"><body><h1>لعبة الماء</h1></body></html>';
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
    async request(method, urlPath, body) {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* بلا جسم */
      }
      return { status: res.status, data };
    },
  };
}

/** جوجل مزيّفة للدخول، وEvolink مزيّفة للبناء */
function mockUpstream({ email, sub = 'g_gb_' + Math.random().toString(36).slice(2), evolink }) {
  const original = global.fetch;
  const seen = { calls: [] };
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub, email, email_verified: true, name: 'مدرب' }) };
    }
    if (u.includes('evolink.ai')) {
      const body = JSON.parse(opts.body);
      seen.calls.push({ url: u, body });
      return evolink(body, seen.calls.length);
    }
    return original(url, opts);
  };
  return { seen, restore: () => (global.fetch = original) };
}

const modelReply = (text) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
});

async function login(c) {
  const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  const location = start.headers.get('location');
  const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
  const state = new URL(location).searchParams.get('state');
  const callback = await fetch(`${base}/api/auth/google/callback?code=fake&state=${state}`, {
    redirect: 'manual',
    headers: { Cookie: stateCookie.split(';')[0] },
  });
  c.cookie = (callback.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
}

async function grantPremium(email) {
  const user = await storage.get().findUserByEmail(email);
  await storage.get().setPremiumUntil(user.id, Date.now() + 30 * 86400000);
  return user;
}

/** يستطلع المهمّة حتى تنتهي — كما تفعل الواجهة تماماً */
async function awaitJob(c, jobId) {
  for (let i = 0; i < 60; i += 1) {
    const res = await c.request('GET', '/api/game-ai/chat/' + jobId);
    if (res.data?.status !== 'working') return res;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('لم تنتهِ المهمّة');
}

// ------------------------------------------------------------------ البوابة

test('الحالة معلنة للجميع بلا تسريح المفتاح', async () => {
  const c = client();
  const res = await c.request('GET', '/api/game-ai/status');
  assert.equal(res.status, 200);
  assert.equal(res.data.configured, true);
  assert.equal(res.data.model, 'gemini-3.7-flash');
  assert.equal(res.data.signedIn, false);
  assert.ok(res.data.defaults.itemsPerRun > 0);
  assert.equal(JSON.stringify(res.data).includes('test-evolink-key'), false);
});

test('بلا حساب: لا بناء', async () => {
  const c = client();
  const res = await c.request('POST', '/api/game-ai/chat', { message: 'دورة الماء' });
  assert.equal(res.status, 401);
});

test('حسابٌ بلا اشتراك: بوابة البريميوم تسبق النداء', async () => {
  const email = 'free-gb@example.com';
  const mock = mockUpstream({ email, evolink: () => modelReply('لا ينبغي أن يُنادى') });
  try {
    const c = client();
    await login(c);
    const res = await c.request('POST', '/api/game-ai/chat', { message: 'دورة الماء' });
    assert.equal(res.status, 402);
    assert.equal(mock.seen.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ------------------------------------------------------------ دورة البناء

test('البناء مهمّة: الطلب يعود فوراً بمعرّف، ثم تُسلَّم اللعبة بلا شيفرة في الردّ', async () => {
  const email = 'builder@example.com';
  const mock = mockUpstream({ email, evolink: () => modelReply('تفضّل لعبتك 👇\n```html\n' + GAME + '\n```') });
  try {
    const c = client();
    await login(c);
    await grantPremium(email);

    const started = await c.request('POST', '/api/game-ai/chat', {
      message: 'الصف الرابع — دورة الماء',
      config: { correctPoints: 20, itemsPerRun: 8 },
    });
    assert.equal(started.status, 202);
    assert.ok(started.data.jobId);
    assert.ok(started.data.chatId);

    const done = await awaitJob(c, started.data.jobId);
    assert.equal(done.data.status, 'done');
    assert.equal(done.data.reply, 'تفضّل لعبتك 👇');
    assert.equal(done.data.html.trim(), GAME);
    assert.equal(done.data.truncated, false);
    // إعدادات المعلّم وصلت النموذج أرقاماً صريحة
    assert.match(mock.seen.calls[0].body.systemInstruction.parts[0].text, /CORRECT_POINTS\s+= 20/);
    assert.match(mock.seen.calls[0].body.systemInstruction.parts[0].text, /ITEMS_SHOWN_PER_RUN\s+= 8/);
  } finally {
    mock.restore();
  }
});

test('المحادثة تعيش على الخادم: الرسالة الثانية وحدها تُرسل والسياق كاملٌ عندنا', async () => {
  const email = 'ctx@example.com';
  const mock = mockUpstream({
    email,
    evolink: (_body, n) => modelReply(n === 1 ? 'لأي عمر أو صف هذه اللعبة؟' : 'تمام\n```html\n' + GAME + '\n```'),
  });
  try {
    const c = client();
    await login(c);
    await grantPremium(email);

    const first = await c.request('POST', '/api/game-ai/chat', { message: 'أريد لعبة عن الكسور' });
    const firstDone = await awaitJob(c, first.data.jobId);
    assert.equal(firstDone.data.html, '');
    assert.equal(firstDone.data.reply, 'لأي عمر أو صف هذه اللعبة؟');

    const second = await c.request('POST', '/api/game-ai/chat', { chatId: first.data.chatId, message: 'الصف الخامس' });
    assert.equal(second.data.chatId, first.data.chatId);
    await awaitJob(c, second.data.jobId);

    // النداء الثاني حمل الأدوار الثلاثة كلّها رغم أن المتصفّح أرسل رسالةً واحدة
    const roles = mock.seen.calls[1].body.contents.map((x) => x.role);
    assert.deepEqual(roles, ['user', 'model', 'user']);
    assert.match(mock.seen.calls[1].body.contents[1].parts[0].text, /لأي عمر/);
  } finally {
    mock.restore();
  }
});

test('الملفّ القديم يُختصر من السياق ويبقى الأخير كاملاً', async () => {
  const email = 'trim@example.com';
  const older = '<!doctype html>\n<html><body>القديمة</body></html>';
  const mock = mockUpstream({
    email,
    evolink: (_b, n) => modelReply('نسخة\n```html\n' + (n === 1 ? older : GAME) + '\n```'),
  });
  try {
    const c = client();
    await login(c);
    await grantPremium(email);

    const one = await c.request('POST', '/api/game-ai/chat', { message: 'ابنِ لعبة للصف الثالث' });
    await awaitJob(c, one.data.jobId);
    const two = await c.request('POST', '/api/game-ai/chat', { chatId: one.data.chatId, message: 'كبّر الخط' });
    await awaitJob(c, two.data.jobId);
    const three = await c.request('POST', '/api/game-ai/chat', { chatId: one.data.chatId, message: 'وأضف صوتاً' });
    await awaitJob(c, three.data.jobId);

    const sent = mock.seen.calls[2].body.contents.map((x) => x.parts[0].text);
    assert.equal(sent.filter((x) => x.includes('القديمة')).length, 0, 'الملفّ الأقدم لا يُرسل مرّتين');
    assert.equal(sent.filter((x) => x.includes('لعبة الماء')).length, 1, 'الملفّ الأخير يُرسل كاملاً مرّةً واحدة');
    assert.ok(sent.some((x) => x.includes('حُذف من السياق')), 'وموضعه يُذكر كي يعرف النموذج أنه بنى قبلاً');
  } finally {
    mock.restore();
  }
});

test('فشل النداء يصل المعلّم رسالةً لا صمتاً، ولا يبقى سؤاله في السياق', async () => {
  const email = 'boom@example.com';
  let fail = true;
  const mock = mockUpstream({
    email,
    evolink: () =>
      fail
        ? { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'upstream down' } }) }
        : modelReply('تمام'),
  });
  try {
    const c = client();
    await login(c);
    await grantPremium(email);

    const one = await c.request('POST', '/api/game-ai/chat', { message: 'ابنِ لعبة' });
    const failed = await awaitJob(c, one.data.jobId);
    assert.equal(failed.data.status, 'error');
    assert.match(failed.data.error, /upstream down/);

    fail = false;
    const two = await c.request('POST', '/api/game-ai/chat', { chatId: one.data.chatId, message: 'ابنِ لعبة' });
    await awaitJob(c, two.data.jobId);
    // السؤال الذي فشل لم يبقَ في السياق فيُحسب مرّتين
    const texts = mock.seen.calls[1].body.contents.map((x) => x.parts[0].text);
    assert.deepEqual(texts, ['ابنِ لعبة']);
  } finally {
    mock.restore();
  }
});

test('مهمّةُ معلّمٍ آخر لا تُقرأ، ورسالةٌ فارغة تُردّ', async () => {
  const owner = 'owner-gb@example.com';
  const ownerMock = mockUpstream({ email: owner, evolink: () => modelReply('تمام') });
  let jobId;
  try {
    const c = client();
    await login(c);
    await grantPremium(owner);
    const empty = await c.request('POST', '/api/game-ai/chat', { message: '   ' });
    assert.equal(empty.status, 400);
    const started = await c.request('POST', '/api/game-ai/chat', { message: 'ابنِ لعبة' });
    jobId = started.data.jobId;
    await awaitJob(c, jobId);
  } finally {
    ownerMock.restore();
  }

  const intruderMock = mockUpstream({ email: 'intruder-gb@example.com', evolink: () => modelReply('لا') });
  try {
    const other = client();
    await login(other);
    const res = await other.request('GET', '/api/game-ai/chat/' + jobId);
    assert.equal(res.status, 404);
  } finally {
    intruderMock.restore();
  }
});

// ------------------------------------------------------- معاينة قبل النشر

test('المعاينة تُقدَّم بترويسات العزل نفسها، ولصاحبها وحده', async () => {
  const email = 'frame@example.com';
  const mock = mockUpstream({ email, evolink: () => modelReply('تفضّل\n```html\n' + GAME + '\n```') });
  let jobId;
  let cookie;
  try {
    const c = client();
    await login(c);
    await grantPremium(email);
    const started = await c.request('POST', '/api/game-ai/chat', { message: 'ابنِ لعبة الماء' });
    jobId = started.data.jobId;
    await awaitJob(c, jobId);
    cookie = c.cookie;
  } finally {
    mock.restore();
  }

  const res = await fetch(`${base}/api/game-ai/chat/${jobId}/frame`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const csp = res.headers.get('content-security-policy');
  // العزل نفسه الذي تُقدَّم به اللعبة المنشورة — لا أوسع
  assert.match(csp, /sandbox allow-scripts/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.text()).trim(), GAME);

  // بلا جلسة: لا معاينة
  const anon = await fetch(`${base}/api/game-ai/chat/${jobId}/frame`);
  assert.equal(anon.status, 401);
});

test('اللعبة المنشورة والمعاينة تتقاسمان ترويسةً واحدة لا نسختين', () => {
  const { CSP } = require('../server/game-frame');
  const account = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes-account.js'), 'utf8');
  // لا تُكتب سياسة المحتوى في مسار اللعبة يدوياً: انحرافُ إحداهما عن الأخرى
  // يعني معاينةً أوسع صلاحيةً ممّا سيراه الطالب
  assert.equal(account.includes('sendGameFrame(res, game.html)'), true);
  assert.match(CSP, /connect-src 'none'/);
});
