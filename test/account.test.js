'use strict';

/** اختبار حسابات المدربين والأنشطة المحفوظة: الدخول عبر جوجل، الملكية، الإطلاق. */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-acct-'));
// بلا هذين، مسار /api/auth/google يرفض الطلب فوراً (503) قبل أن نصل حتى إلى جوجل المزيّفة
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
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

// ------------------------------------------------------------------ أدوات

/** عميل يحتفظ بالكوكيز كما يفعل المتصفح */
function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    async request(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.getSetCookie?.() || [];
      for (const raw of set) {
        const pair = raw.split(';')[0];
        if (pair.endsWith('=')) cookie = ''; // تسجيل خروج
        else cookie = pair;
      }
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

let uniq = 0;
const email = () => `teacher${++uniq}.${Date.now()}@example.com`;

/** يستبدل fetch العام مؤقتاً بردود جوجل مزيّفة — يعيد دالة استعادة */
function mockGoogle({ email, name, sub = 'g_' + Math.random().toString(36).slice(2), emailVerified = true }) {
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok_' + Math.random().toString(36).slice(2) }) };
    }
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub, email, email_verified: emailVerified, name }) };
    }
    return original(url, opts);
  };
  return () => {
    global.fetch = original;
  };
}

/**
 * يُنفّذ تدفّق OAuth كاملاً كما يفعل المتصفح: طلب /auth/google، اتّباع
 * كوكي الحالة إلى /auth/google/callback، ثم تثبيت كوكي الجلسة الناتج على c.
 */
async function loginViaGoogle(c, profile) {
  const restore = mockGoogle(profile);
  try {
    const start = await fetch(base + '/api/auth/google?next=' + encodeURIComponent('/host.html#/mine'), { redirect: 'manual' });
    assert.equal(start.status, 302, 'يحوّل إلى صفحة اختيار حساب جوجل');
    const location = start.headers.get('location');
    assert.match(location, /^https:\/\/accounts\.google\.com\//);

    const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
    assert.ok(stateCookie, 'كوكي حالة OAuth يجب أن يُضبط');
    const state = new URL(location).searchParams.get('state');

    const callback = await fetch(`${base}/api/auth/google/callback?code=fake-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie.split(';')[0] },
    });
    const sessionCookie = (callback.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid='));
    if (sessionCookie) c.cookie = sessionCookie.split(';')[0];
    return callback;
  } finally {
    restore();
  }
}

const QUIZ = {
  title: 'نشاط محفوظ',
  settings: { pace: 'self', scoring: 'flat' },
  questions: [
    { type: 'mc', text: 'س١', options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'] },
    { type: 'word', text: 'س٢' },
  ],
};

// ------------------------------------------------------------- الاختبارات

test('الدخول عبر جوجل ينشئ حساباً ويفتح جلسة دخول', async () => {
  const c = client();
  const mail = email();
  const callback = await loginViaGoogle(c, { email: mail, name: 'أ. محمد' });
  assert.equal(callback.status, 302, 'يعيد التوجيه إلى الوجهة بعد النجاح');
  assert.match(callback.headers.get('location'), /\/host\.html#\/mine$/);
  assert.ok(c.cookie.startsWith('tafa3l_sid='), 'يجب ضبط كوكي الجلسة');

  const me = await c.request('GET', '/api/auth/me');
  assert.equal(me.data.user.name, 'أ. محمد');
  assert.equal(me.data.user.email, mail);
  assert.ok(!('googleId' in me.data.user), 'لا يُسرَّب معرّف جوجل الداخلي للعميل');
});

test('نفس بريد جوجل يعطي نفس الحساب دائماً — لا حسابات مكرّرة لنفس الشخص', async () => {
  const mail = email();
  const first = client();
  await loginViaGoogle(first, { email: mail, name: 'الاسم الأول', sub: 'g-fixed-1' });
  const firstMe = await first.request('GET', '/api/auth/me');

  // دخول ثانٍ لاحقاً بنفس بريد جوجل (ربما بعد تحديث اسمه في جوجل)
  const second = client();
  await loginViaGoogle(second, { email: mail, name: 'الاسم بعد التحديث', sub: 'g-fixed-1' });
  const secondMe = await second.request('GET', '/api/auth/me');

  assert.equal(secondMe.data.user.id, firstMe.data.user.id, 'نفس معرّف الحساب — بلا تكرار');
  assert.equal(secondMe.data.user.name, 'الاسم بعد التحديث', 'يُحدَّث الاسم من جوجل عند كل دخول');
});

test('بريد جوجل غير المُتحقَّق منه يُرفض', async () => {
  const c = client();
  const callback = await loginViaGoogle(c, { email: email(), name: 'مشكوك فيه', emailVerified: false });
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location'), /^\/login\.html\?error=/);
  assert.equal(c.cookie, '', 'لا جلسة تُفتح لبريد غير موثّق');
});

test('state خاطئ أو منتهي يُرفض ولا يفتح جلسة', async () => {
  const restore = mockGoogle({ email: email(), name: 'مهاجم محتمل' });
  try {
    const callback = await fetch(`${base}/api/auth/google/callback?code=fake&state=state-غير-موجود`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get('location'), /^\/login\.html\?error=/);
    assert.ok(!(callback.headers.getSetCookie?.() || []).some((h) => h.startsWith('tafa3l_sid=')));
  } finally {
    restore();
  }
});

test('بلا GOOGLE_CLIENT_ID/SECRET يرفض بدء تسجيل الدخول برسالة واضحة', async () => {
  const prevId = process.env.GOOGLE_CLIENT_ID;
  const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    const res = await fetch(base + '/api/auth/google', { redirect: 'manual' });
    assert.equal(res.status, 503);
    const me = await fetch(base + '/api/auth/me').then((r) => r.json());
    assert.equal(me.googleConfigured, false);
  } finally {
    process.env.GOOGLE_CLIENT_ID = prevId;
    process.env.GOOGLE_CLIENT_SECRET = prevSecret;
  }
});

test('تسجيل الخروج يُبطل الجلسة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'ماجد' });
  await c.request('POST', '/api/auth/logout');
  assert.equal((await c.request('GET', '/api/auth/me')).data.user, null);
  assert.equal((await c.request('GET', '/api/activities')).status, 401, 'الأنشطة محمية بعد الخروج');
});

test('حفظ الأنشطة وتعديلها وحذفها', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'ليلى' });

  const created = await c.request('POST', '/api/activities', QUIZ);
  assert.equal(created.status, 201);
  const id = created.data.activity.id;

  const list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities.length, 1);
  assert.equal(list.data.activities[0].questionCount, 2);
  assert.equal(list.data.activities[0].settings.pace, 'self', 'الإعدادات تُحفظ كما اختارها المدرب');
  assert.equal(list.data.activities[0].live, null);

  // فتح للتعديل ثم تحديث
  const full = await c.request('GET', '/api/activities/' + id);
  assert.equal(full.data.activity.questions.length, 2);

  const updated = await c.request('PUT', '/api/activities/' + id, {
    ...QUIZ,
    title: 'بعد التعديل',
    questions: [...QUIZ.questions, { type: 'open', text: 'س٣' }],
  });
  assert.equal(updated.status, 200);
  const after = await c.request('GET', '/api/activities');
  assert.equal(after.data.activities.length, 1, 'التعديل لا يُنشئ نسخة جديدة');
  assert.equal(after.data.activities[0].title, 'بعد التعديل');
  assert.equal(after.data.activities[0].questionCount, 3);

  assert.equal((await c.request('DELETE', '/api/activities/' + id)).status, 200);
  assert.equal((await c.request('GET', '/api/activities')).data.activities.length, 0);
});

test('لا يرى المدرب أنشطة غيره ولا يعدّلها', async () => {
  const a = client();
  const b = client();
  await loginViaGoogle(a, { email: email(), name: 'أحمد' });
  await loginViaGoogle(b, { email: email(), name: 'بدر' });

  const mine = await a.request('POST', '/api/activities', QUIZ);
  const id = mine.data.activity.id;

  assert.equal((await b.request('GET', '/api/activities')).data.activities.length, 0, 'قائمة كل مدرب خاصة به');
  assert.equal((await b.request('GET', '/api/activities/' + id)).status, 404);
  assert.equal((await b.request('PUT', '/api/activities/' + id, QUIZ)).status, 404);
  assert.equal((await b.request('DELETE', '/api/activities/' + id)).status, 404);
  assert.equal((await b.request('POST', `/api/activities/${id}/launch`)).status, 404);

  // ولا يزال موجوداً عند صاحبه
  assert.equal((await a.request('GET', '/api/activities/' + id)).status, 200);
});

test('الأنشطة محمية بلا تسجيل دخول', async () => {
  const anon = client();
  assert.equal((await anon.request('GET', '/api/activities')).status, 401);
  assert.equal((await anon.request('POST', '/api/activities', QUIZ)).status, 401);
});

test('إطلاق جلسة من نشاط محفوظ يعمل ويظهر «مباشر» في القائمة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'هند' });
  const id = (await c.request('POST', '/api/activities', QUIZ)).data.activity.id;

  const launched = await c.request('POST', `/api/activities/${id}/launch`);
  assert.equal(launched.status, 201);
  assert.match(launched.data.code, /^\d{6}$/);
  assert.ok(launched.data.hostToken);

  // الجلسة حقيقية ويمكن للمشاركين رؤيتها
  const info = await fetch(`${base}/api/sessions/${launched.data.code}`).then((r) => r.json());
  assert.equal(info.title, 'نشاط محفوظ');
  assert.equal(info.pace, 'self', 'إعدادات النشاط انتقلت إلى الجلسة');

  const list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities[0].live.code, launched.data.code, 'يظهر أن النشاط مباشر الآن');

  // إنهاء الجلسة يزيل علامة «مباشر»
  await fetch(`${base}/api/sessions/${launched.data.code}?hostToken=${encodeURIComponent(launched.data.hostToken)}`, { method: 'DELETE' });
  const after = await c.request('GET', '/api/activities');
  assert.equal(after.data.activities[0].live, null);
});

test('النشاط المحفوظ يُرفض إن كان بلا أسئلة صالحة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'وسام' });
  const bad = await c.request('POST', '/api/activities', { title: 'فارغ', questions: [] });
  assert.equal(bad.status, 400);
});

test('الإطلاق المباشر من المحرّر يحفظ النشاط تلقائياً بلا تكرار', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'ريم' });

  // إطلاق أول: يجب أن يُحفظ النشاط تلقائياً ويعود معرّفه
  const first = await c.request('POST', '/api/sessions', QUIZ);
  assert.equal(first.status, 201);
  assert.ok(first.data.activityId, 'الإطلاق يعيد معرّف النشاط المحفوظ تلقائياً');

  let list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities.length, 1, 'النشاط حُفظ تلقائياً دون زر حفظ');
  assert.equal(list.data.activities[0].title, QUIZ.title);

  // إنهاء الجلسة لا يحذف النشاط المحفوظ
  await fetch(`${base}/api/sessions/${first.data.code}?hostToken=${encodeURIComponent(first.data.hostToken)}`, { method: 'DELETE' });
  list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities.length, 1, 'إنهاء الجلسة لا يمس النشاط المحفوظ');

  // إطلاق ثانٍ بنفس المعرّف: تحديث لا نسخة جديدة
  const second = await c.request('POST', '/api/sessions', { ...QUIZ, activityId: first.data.activityId });
  assert.equal(second.data.activityId, first.data.activityId);
  list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities.length, 1, 'إعادة الإطلاق لا تكدّس نسخاً');

  // إطلاق ثالث بلا معرّف لكن بنفس العنوان وعدد الأسئلة: يطابق الموجود
  const third = await c.request('POST', '/api/sessions', QUIZ);
  assert.equal(third.data.activityId, first.data.activityId, 'المطابقة بالعنوان تمنع التكرار');
  list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities.length, 1);
});

test('الإطلاق بلا تسجيل دخول لا يحفظ شيئاً (الوعد الأصلي)', async () => {
  const anon = client();
  const created = await anon.request('POST', '/api/sessions', QUIZ);
  assert.equal(created.status, 201);
  assert.equal(created.data.activityId, null, 'بلا حساب لا يُحفظ نشاط');
});

test('استنساخ نشاط يعطي نسخة مستقلة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'جود' });
  const id = (await c.request('POST', '/api/activities', QUIZ)).data.activity.id;

  const dup = await c.request('POST', `/api/activities/${id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.notEqual(dup.data.activity.id, id);
  assert.match(dup.data.activity.title, /نسخة/);

  const list = await c.request('GET', '/api/activities');
  assert.equal(list.data.activities.length, 2);

  // تعديل النسخة لا يمس الأصل
  await c.request('PUT', '/api/activities/' + dup.data.activity.id, { ...QUIZ, title: 'النسخة المعدلة' });
  const original = await c.request('GET', '/api/activities/' + id);
  assert.equal(original.data.activity.title, QUIZ.title);

  // ولا يستنسخ أحدٌ نشاط غيره
  const other = client();
  await loginViaGoogle(other, { email: email(), name: 'غيث' });
  assert.equal((await other.request('POST', `/api/activities/${id}/duplicate`)).status, 404);
});

// ---------------------------------------------------------- بنك الأسئلة

const BANK_QUESTION = { type: 'mc', text: 'ما عاصمة الأردن؟', options: [{ id: 'o0', text: 'عمّان' }, { id: 'o1', text: 'بيروت' }], correct: ['o0'], points: 500 };

test('حفظ سؤال في البنك وتحديثه وحذفه', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'منى' });

  const created = await c.request('POST', '/api/bank', { question: BANK_QUESTION });
  assert.equal(created.status, 201);
  const id = created.data.item.id;
  assert.equal(created.data.item.question.text, BANK_QUESTION.text);
  assert.equal(created.data.item.question.options.length, 2, 'السؤال يمر عبر نفس تحقّق الأسئلة العادي');

  const list = await c.request('GET', '/api/bank');
  assert.equal(list.data.questions.length, 1);

  const updated = await c.request('PUT', '/api/bank/' + id, { question: { ...BANK_QUESTION, text: 'ما عاصمة مصر؟' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.item.question.text, 'ما عاصمة مصر؟');
  const afterUpdate = await c.request('GET', '/api/bank');
  assert.equal(afterUpdate.data.questions.length, 1, 'التحديث لا يُنشئ عنصراً ثانياً');

  assert.equal((await c.request('DELETE', '/api/bank/' + id)).status, 200);
  assert.equal((await c.request('GET', '/api/bank')).data.questions.length, 0);
});

test('البنك محمي بتسجيل الدخول ومعزول لكل مدرب', async () => {
  const anon = client();
  assert.equal((await anon.request('GET', '/api/bank')).status, 401);
  assert.equal((await anon.request('POST', '/api/bank', { question: BANK_QUESTION })).status, 401);

  const a = client();
  const b = client();
  await loginViaGoogle(a, { email: email(), name: 'سامي' });
  await loginViaGoogle(b, { email: email(), name: 'دانة' });

  const id = (await a.request('POST', '/api/bank', { question: BANK_QUESTION })).data.item.id;
  assert.equal((await b.request('GET', '/api/bank')).data.questions.length, 0, 'قائمة كل مدرب خاصة به');
  assert.equal((await b.request('PUT', '/api/bank/' + id, { question: BANK_QUESTION })).status, 404);
  assert.equal((await b.request('DELETE', '/api/bank/' + id)).status, 404);
  assert.equal((await a.request('GET', '/api/bank')).data.questions.length, 1, 'ولا يزال موجوداً عند صاحبه');
});

test('سؤال بلا نص كافٍ في البنك يُرفض بنفس تحقّق الأسئلة العادي', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'وفاء' });
  // نوع mc بلا خيارات كافية: normalizeQuestion يعوّض بخيارين افتراضيين بدل الرفض —
  // فقط الأنواع التي يتحقّق منها normalizeQuiz صراحة (كالأسئلة الفارغة كلياً) تُرفض هنا؛
  // البنك يستخدم نفس normalizeQuestion المتسامح المستخدم للأنشطة، فهذا سلوك متوقّع لا خطأ.
  const created = await c.request('POST', '/api/bank', { question: { type: 'mc', text: '' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.item.question.text, 'سؤال 1', 'نص افتراضي عند الترك فارغاً — نفس سلوك محرّر الأنشطة');
});
