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
// حساب مالك واحد: صور الأسئلة ميزة بريميوم، ويلزم اختبارها من يملكها
process.env.ADMIN_EMAILS = 'owner.images@example.com';
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
  // الوجهة محفوظة، ومعها إعلامٌ بمنحة التسجيل — المرساة تبقى بعد المعامل
  assert.match(callback.headers.get('location'), /^\/host\.html\?welcome=1#\/mine$/);
  assert.ok(c.cookie.startsWith('tafa3l_sid='), 'يجب ضبط كوكي الجلسة');

  const me = await c.request('GET', '/api/auth/me');
  assert.equal(me.data.user.name, 'أ. محمد');
  assert.equal(me.data.user.email, mail);
  assert.ok(!('googleId' in me.data.user), 'لا يُسرَّب معرّف جوجل الداخلي للعميل');
  assert.equal(me.data.premium.onSignupTrial, true, 'وحسابه الجديد يبدأ بمنحة بريميوم');

  // والدخول الثاني بالحساب نفسه لا يُهنّئ مرّةً أخرى
  const again = await loginViaGoogle(client(), { email: mail, name: 'أ. محمد' });
  assert.doesNotMatch(again.headers.get('location'), /welcome=1/, 'التهنئة لأول مرّة فقط');
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
    // هذا المسار صار مقصداً مباشراً لأزرار الدخول، فعطبُه يهبط بالزائر على
    // صفحةٍ تشرح لا على JSON خام في نافذته
    const res = await fetch(base + '/api/auth/google', { redirect: 'manual' });
    assert.equal(res.status, 302);
    const to = res.headers.get('location') || '';
    assert.match(to, /^\/login\.html\?error=/, 'يعود إلى صفحة الدخول بالسبب');
    assert.match(decodeURIComponent(to), /غير مُفعّل/, 'والسبب مكتوب لا مبهم');
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

test('الإطلاق بلا تسجيل دخول مرفوض — لا نشاطَ بلا صاحبٍ يُنسب إليه', async () => {
  const anon = client();
  const created = await anon.request('POST', '/api/sessions', QUIZ);
  assert.equal(created.status, 401, 'كان مفتوحاً لأي زائر فصار يحتاج حساباً');

  // والمسجَّل يطلق ويُحفظ له نشاطه تلقائياً
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'معلّمة' });
  const ok = await c.request('POST', '/api/sessions', QUIZ);
  assert.equal(ok.status, 201);
  assert.ok(ok.data.activityId, 'ويُحفظ النشاط لصاحبه');
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

// ---------------------------------------------------------------- الفصول
//
// كشفُ أسماءٍ اختياري يكتبه المعلّم في حسابه. الوعد الأصلي لم يُمسّ: هذه
// ليست بياناتٍ جمعتها المنصة من الطلاب، ولا تُربط بإجابة أحد.

test('إنشاء فصل ينظّف الأسماء: يقصّ الفراغات ويُسقط الفارغ والمكرّر', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'أ. ريم' });
  const made = await c.request('POST', '/api/classes', {
    name: '  الصف السابع «أ»  ',
    students: 'سارة\n\n  ليان  \nكريم\nسارة\n',
  });
  assert.equal(made.status, 201);
  assert.equal(made.data.class.name, 'الصف السابع «أ»');
  assert.deepEqual(made.data.class.students, ['سارة', 'ليان', 'كريم']);
});

test('الأسماء تُقبل ملصوقةً بفواصل عربية أو إنجليزية أو أسطر', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'أ. غيث' });
  const made = await c.request('POST', '/api/classes', { name: 'صف', students: 'سارة، ليان; كريم,رنا' });
  assert.deepEqual(made.data.class.students, ['سارة', 'ليان', 'كريم', 'رنا']);
});

test('الفصل بلا اسم يُرفض', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'أ. منى' });
  assert.equal((await c.request('POST', '/api/classes', { name: '   ', students: 'سارة' })).status, 400);
});

test('تعديل الفصل وحذفه، والقائمة تعكسهما', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'أ. دانة' });
  const id = (await c.request('POST', '/api/classes', { name: 'قديم', students: 'سارة' })).data.class.id;

  const updated = await c.request('PUT', '/api/classes/' + id, { name: 'جديد', students: 'سارة\nليان' });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.class.name, 'جديد');
  assert.equal(updated.data.class.students.length, 2);
  assert.equal((await c.request('GET', '/api/classes')).data.classes.length, 1, 'التعديل لا يُنشئ فصلاً ثانياً');

  assert.equal((await c.request('DELETE', '/api/classes/' + id)).status, 200);
  assert.equal((await c.request('GET', '/api/classes')).data.classes.length, 0);
});

test('الفصول محميّة بتسجيل الدخول ومعزولة لكل معلّم', async () => {
  assert.equal((await client().request('GET', '/api/classes')).status, 401);
  assert.equal((await client().request('POST', '/api/classes', { name: 'صف' })).status, 401);

  const a = client();
  const b = client();
  await loginViaGoogle(a, { email: email(), name: 'أ. سامي' });
  await loginViaGoogle(b, { email: email(), name: 'أ. وفاء' });
  const id = (await a.request('POST', '/api/classes', { name: 'صفّ سامي', students: 'سارة' })).data.class.id;

  assert.equal((await b.request('GET', '/api/classes')).data.classes.length, 0);
  assert.equal((await b.request('PUT', '/api/classes/' + id, { name: 'سرقة' })).status, 404);
  assert.equal((await b.request('DELETE', '/api/classes/' + id)).status, 404);
  assert.equal((await a.request('GET', '/api/classes')).data.classes.length, 1, 'ولا يزال عند صاحبه');
});

// ------------------------------------------------------ «أسئلتي السابقة»
//
// حلّت محلّ بنك الأسئلة: لا حفظَ مسبقاً ولا مكانَ ثانياً تعيش فيه الأسئلة —
// بحثٌ واحد يمرّ على أنشطة المعلّم المحفوظة (وعلى بنكه القديم إن كان له بنك،
// فلا يضيع ما جمعه قبل الحذف).

const REUSE_Q = (text) => ({ type: 'mc', text, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'], points: 500 });

test('«أسئلتي السابقة» تجمع أسئلة الأنشطة المحفوظة وتُسمّي مصدرها', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'منى' });

  await c.request('POST', '/api/activities', {
    title: 'مراجعة الوحدة الأولى',
    settings: {},
    questions: [REUSE_Q('ما عاصمة الأردن؟'), REUSE_Q('كم عدد القارات؟')],
  });

  const all = await c.request('GET', '/api/my-questions');
  assert.equal(all.status, 200);
  assert.equal(all.data.questions.length, 2);
  const capital = all.data.questions.find((x) => x.question.text === 'ما عاصمة الأردن؟');
  assert.ok(capital, 'السؤال ظهر بلا أن يحفظه أحد في بنك');
  assert.equal(capital.from, 'مراجعة الوحدة الأولى', 'ويُسمّى النشاط الذي جاء منه');

  const hit = await c.request('GET', '/api/my-questions?q=' + encodeURIComponent('قارات'));
  assert.equal(hit.data.questions.length, 1, 'البحث يصفّي بالنص');
  assert.equal(hit.data.questions[0].question.text, 'كم عدد القارات؟');

  const miss = await c.request('GET', '/api/my-questions?q=' + encodeURIComponent('كيمياء'));
  assert.equal(miss.data.questions.length, 0);
});

test('السؤال المكرّر في نشاطين يظهر مرة واحدة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'سامي' });
  for (const title of ['حصة الأحد', 'حصة الاثنين']) {
    await c.request('POST', '/api/activities', { title, settings: {}, questions: [REUSE_Q('سؤالٌ أعدتُه')] });
  }
  const all = await c.request('GET', '/api/my-questions');
  assert.equal(all.data.questions.length, 1, 'القائمة للاختيار لا للجرد');
});

test('«أسئلتي السابقة» محميّة بتسجيل الدخول ومعزولة لكل مدرب', async () => {
  assert.equal((await client().request('GET', '/api/my-questions')).status, 401);

  const a = client();
  const b = client();
  await loginViaGoogle(a, { email: email(), name: 'دانة' });
  await loginViaGoogle(b, { email: email(), name: 'غيث' });
  await a.request('POST', '/api/activities', { title: 'خاصّ بدانة', settings: {}, questions: [REUSE_Q('سؤال دانة')] });

  assert.equal((await b.request('GET', '/api/my-questions')).data.questions.length, 0);
  assert.equal((await a.request('GET', '/api/my-questions')).data.questions.length, 1);
});

test('صور الأسئلة لا تُحمَّل في قائمة إعادة الاستخدام', async () => {
  const c = client();
  await loginViaGoogle(c, { email: 'owner.images@example.com', name: 'وفاء' });
  const image = 'data:image/png;base64,' + 'A'.repeat(2000);
  const saved = await c.request('POST', '/api/activities', {
    title: 'بالصور',
    settings: {},
    questions: [{ ...REUSE_Q('سؤال مصوَّر'), image }],
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  const all = await c.request('GET', '/api/my-questions');
  const one = all.data.questions[0];
  // قائمةٌ من مئة سؤال مصوَّر تصير ميغابايتات لو حملت الصور، والقائمة نصٌّ يُقرأ
  assert.equal(one.question.image, undefined, 'الصورة لا تُرسل مع القائمة');
  assert.equal(one.question.hasImage, true, 'لكن يُقال إن للسؤال صورة');
});

test('قائمة البلدان لا تحتوي إسرائيل، والخادم يرفضها مهما أرسل المتصفّح', async () => {
  const countries = require('../server/countries');

  // القائمة المعروضة
  const res = await fetch(base + '/api/countries');
  assert.equal(res.status, 200);
  const list = await res.json();
  const all = [...list.arab, ...list.rest];
  assert.equal(all.includes('IL'), false, 'إسرائيل ليست في القائمة');
  assert.equal(all.length > 200, true, `${all.length} بلداً`);
  assert.equal(new Set(all).size, all.length, 'بلا تكرار');
  assert.equal(list.arab[0], 'PS', 'فلسطين رأس قائمة البلدان العربية');
  assert.equal(list.overrides.ar.PS, 'فلسطين', 'ولا تُسمّى «الأراضي الفلسطينية»');

  // والوحدة نفسها ترفضها مهما جاءت
  for (const bad of ['IL', 'il', 'Il', ' IL ']) {
    assert.equal(countries.isValid(bad), false, bad);
    assert.equal(countries.clean(bad), '', bad);
  }
  // ورموزٌ لا وجود لها
  assert.equal(countries.clean('ZZ'), '');
  assert.equal(countries.clean('XX'), '');
  assert.equal(countries.clean(''), '');
  assert.equal(countries.clean(null), '');
  // والصالحة تمرّ ولو بأحرفٍ صغيرة
  assert.equal(countries.clean('jo'), 'JO');
  assert.equal(countries.clean('PS'), 'PS');
});

test('المعلّم يحفظ بلده ويغيّره، والخادم يرفض ما ليس في القائمة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'أ. سُهى' });

  const before = await c.request('GET', '/api/profile');
  assert.equal(before.data.profile.country, '', 'الحساب الجديد بلا بلد حتى يختار');

  const saved = await c.request('PUT', '/api/profile', { country: 'JO' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.profile.country, 'JO');

  // إسرائيل مرفوضة من المسار نفسه لا من الواجهة وحدها
  const refused = await c.request('PUT', '/api/profile', { country: 'IL' });
  assert.equal(refused.status, 400, 'تُرفض');
  assert.match(refused.data.error, /اختر بلداً/);
  assert.equal((await c.request('GET', '/api/profile')).data.profile.country, 'JO', 'والبلد المحفوظ لم يُمَسّ');

  // ورمزٌ مخترع
  assert.equal((await c.request('PUT', '/api/profile', { country: 'QQ' })).status, 400);

  // والتغيير إلى فلسطين يعمل، والمسح كذلك
  assert.equal((await c.request('PUT', '/api/profile', { country: 'PS' })).data.profile.country, 'PS');
  assert.equal((await c.request('PUT', '/api/profile', { country: '' })).data.profile.country, '');

  // وحفظ الاسم وحده لا يمسح البلد
  await c.request('PUT', '/api/profile', { country: 'EG' });
  await c.request('PUT', '/api/profile', { displayName: 'أ. سُهى' });
  assert.equal((await c.request('GET', '/api/profile')).data.profile.country, 'EG', 'البلد باقٍ');
});

test('استعلامات المستخدم تجلب كل عمودٍ يقرؤه صفّه — لا حقلَ يُحفظ ثم يعود فارغاً', () => {
  const src = fs.readFileSync(require.resolve('../server/storage'), 'utf8');

  // الأعمدة التي يقرؤها `userRow` من الصفّ (r.xxx)، وما تجلبه استعلاماته
  const rowBody = src.slice(src.indexOf('const userRow = (r) =>'), src.indexOf('const rowToActivity'));
  const read = [...rowBody.matchAll(/r\.([a-z_]+)/g)].map((m) => m[1]);
  const columns = src.slice(src.indexOf('const USER_COLUMNS ='), src.indexOf('const userRow = (r) =>'));

  const missing = [...new Set(read)].filter((c) => !columns.includes(c));
  assert.deepEqual(missing, [], `أعمدة يقرؤها userRow ولا تجلبها الاستعلامات: ${missing.join(', ')}`);

  // ولا استعلام مستخدمٍ بأعمدة مكتوبة يدوياً خارج القائمة الموحّدة:
  // تلك بالضبط هي الطريقة التي ضاع بها `country` و`trial_granted_at`
  const handWritten = [...src.matchAll(/SELECT\s+id,\s*email,\s*name[^`]*FROM users/g)];
  assert.equal(handWritten.length, 0, 'استعلام مستخدمٍ يكتب أعمدته يدوياً بدل USER_COLUMNS');
});

test('البلد يبقى بعد إعادة تحميل الصفحة — لا يُحفظ ثم يختفي', async () => {
  const c = client();
  await loginViaGoogle(c, { email: email(), name: 'أ. رند' });

  // الحفظ يردّ البلد…
  const saved = await c.request('PUT', '/api/profile', { country: 'PS' });
  assert.equal(saved.data.profile.country, 'PS', 'ردّ الحفظ يحمل البلد');

  // …وقراءةٌ جديدة تردّه أيضاً. هذان مساران مختلفان في الخادم، وكان أحدهما
  // ينسى العمود — فينجح الحفظ ثم يجده المعلّم فارغاً حين يعود.
  const reloaded = await c.request('GET', '/api/profile');
  assert.equal(reloaded.data.profile.country, 'PS', 'وقراءةٌ جديدة تردّه كذلك');

  // ونفس الشيء لمنحة التسجيل: تمرّ بالمسار نفسه
  const me = await c.request('GET', '/api/auth/me');
  assert.equal(me.data.premium.onSignupTrial, true, 'ومنحة التسجيل معروفةٌ بعد إعادة القراءة');
  assert.equal(me.data.user.country, 'PS', 'والبلد يصل مع المستخدم في كل طلب');
});

// ------------------------------------------------- نبذة المعلّم ورقمه

test('النبذة تُحفظ وتظهر في البروفايل العلني', async () => {
  const c = client();
  await loginViaGoogle(c, { email: 'bio@example.com' });
  {
    const saved = await c.request('PUT', '/api/profile', { bio: '  معلّم علوم منذ عشر سنوات  ' });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.profile.bio, 'معلّم علوم منذ عشر سنوات');
    const me = await c.request('GET', '/api/auth/me');
    const pub = await c.request('GET', '/api/teachers/' + me.data.user.id);
    assert.equal(pub.data.teacher.bio, 'معلّم علوم منذ عشر سنوات');
  }
});

test('الرقم لا يخرج للعموم إلا بإذن المعلّم — والحجب على الخادم', async () => {
  const c = client();
  await loginViaGoogle(c, { email: 'phone-vis@example.com' });
  {
    const me = await c.request('GET', '/api/auth/me');
    const id = me.data.user.id;

    // حسابٌ كتب رقمه ولم يمسّ الراية: يبقى ظاهراً كما كان قبل وجودها
    await c.request('PUT', '/api/profile', { phone: '+970591234567' });
    let pub = await c.request('GET', '/api/teachers/' + id);
    assert.equal(pub.data.teacher.phone, '+970591234567');

    // أطفأها: لا يخرج الرقم من الخادم أصلاً
    const off = await c.request('PUT', '/api/profile', { phonePublic: false });
    assert.equal(off.data.profile.phonePublic, false);
    assert.equal(off.data.profile.phone, '+970591234567', 'ويبقى محفوظاً لصاحبه');
    pub = await c.request('GET', '/api/teachers/' + id);
    assert.equal(pub.data.teacher.phone, '', 'ولا يُرسل إلى العموم');

    // وأعادها
    await c.request('PUT', '/api/profile', { phonePublic: true });
    pub = await c.request('GET', '/api/teachers/' + id);
    assert.equal(pub.data.teacher.phone, '+970591234567');
  }
});

test('«ما ينقص البروفايل» دعوةٌ محسوبة لا رسالةٌ ثابتة', async () => {
  const c = client();
  await loginViaGoogle(c, { email: 'missing@example.com' });
  {
    const fresh = await c.request('GET', '/api/profile');
    // حسابٌ جديد: أربعتها فارغة — والبلد يُسأل عنه في بوّابته لا هنا
    assert.deepEqual([...fresh.data.profile.missing].sort(), ['bio', 'country', 'displayName', 'photo']);

    await c.request('PUT', '/api/profile', { displayName: 'أ. سلمى', bio: 'نبذة', country: 'ps' });
    const after = await c.request('GET', '/api/profile');
    assert.deepEqual(after.data.profile.missing, ['photo'], 'ما مُلئ يخرج من القائمة');
  }
});
