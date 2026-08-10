'use strict';

/** اختبار حسابات المدربين والأنشطة المحفوظة: التسجيل، الدخول، الملكية، الإطلاق. */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-acct-'));
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
    get: (p) => client.prototype, // غير مستخدم
  };
}

const QUIZ = {
  title: 'نشاط محفوظ',
  settings: { pace: 'self', scoring: 'flat' },
  questions: [
    { type: 'mc', text: 'س١', options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'] },
    { type: 'word', text: 'س٢' },
  ],
};

let uniq = 0;
const email = () => `teacher${++uniq}.${Date.now()}@example.com`;

// ------------------------------------------------------------- الاختبارات

test('التسجيل ينشئ حساباً ويفتح جلسة دخول', async () => {
  const c = client();
  const mail = email();
  const { status, data } = await c.request('POST', '/api/auth/signup', { email: mail, name: 'أ. محمد', password: 'sirr12345' });
  assert.equal(status, 201);
  assert.equal(data.user.email, mail);
  assert.ok(c.cookie.startsWith('tafa3l_sid='), 'يجب ضبط كوكي الجلسة');
  assert.ok(!('passwordHash' in data.user), 'لا تُسرَّب بيانات كلمة المرور');

  const me = await c.request('GET', '/api/auth/me');
  assert.equal(me.data.user.name, 'أ. محمد');
});

test('رفض المدخلات غير الصالحة والبريد المكرر', async () => {
  const c = client();
  const mail = email();
  assert.equal((await c.request('POST', '/api/auth/signup', { email: 'ليس بريداً', name: 'x', password: 'sirr12345' })).status, 400);
  assert.equal((await c.request('POST', '/api/auth/signup', { email: mail, name: 'اسم', password: 'قصيرة' })).status, 400);
  assert.equal((await c.request('POST', '/api/auth/signup', { email: mail, name: 'ا', password: 'sirr12345' })).status, 400);

  await c.request('POST', '/api/auth/signup', { email: mail, name: 'اسم', password: 'sirr12345' });
  const dup = await client().request('POST', '/api/auth/signup', { email: mail, name: 'آخر', password: 'sirr12345' });
  assert.equal(dup.status, 409);
});

test('الدخول يتحقق من كلمة المرور ويرفض الخاطئة برسالة واحدة', async () => {
  const mail = email();
  await client().request('POST', '/api/auth/signup', { email: mail, name: 'سعاد', password: 'sirr12345' });

  const wrong = await client().request('POST', '/api/auth/login', { email: mail, password: 'wrong-pass' });
  assert.equal(wrong.status, 401);
  const missing = await client().request('POST', '/api/auth/login', { email: 'nobody' + mail, password: 'wrong-pass' });
  assert.equal(missing.data.error, wrong.data.error, 'نفس الرسالة حتى لا يُكشف البريد المسجّل');

  const c = client();
  const ok = await c.request('POST', '/api/auth/login', { email: mail, password: 'sirr12345' });
  assert.equal(ok.status, 200);
  assert.equal((await c.request('GET', '/api/auth/me')).data.user.email, mail);
});

test('تسجيل الخروج يُبطل الجلسة', async () => {
  const c = client();
  await c.request('POST', '/api/auth/signup', { email: email(), name: 'ماجد', password: 'sirr12345' });
  await c.request('POST', '/api/auth/logout');
  assert.equal((await c.request('GET', '/api/auth/me')).data.user, null);
  assert.equal((await c.request('GET', '/api/activities')).status, 401, 'الأنشطة محمية بعد الخروج');
});

test('حفظ الأنشطة وتعديلها وحذفها', async () => {
  const c = client();
  await c.request('POST', '/api/auth/signup', { email: email(), name: 'ليلى', password: 'sirr12345' });

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
  await a.request('POST', '/api/auth/signup', { email: email(), name: 'أحمد', password: 'sirr12345' });
  await b.request('POST', '/api/auth/signup', { email: email(), name: 'بدر', password: 'sirr12345' });

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
  await c.request('POST', '/api/auth/signup', { email: email(), name: 'هند', password: 'sirr12345' });
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
  await c.request('POST', '/api/auth/signup', { email: email(), name: 'وسام', password: 'sirr12345' });
  const bad = await c.request('POST', '/api/activities', { title: 'فارغ', questions: [] });
  assert.equal(bad.status, 400);
});

test('الإطلاق المباشر من المحرّر يحفظ النشاط تلقائياً بلا تكرار', async () => {
  const c = client();
  await c.request('POST', '/api/auth/signup', { email: email(), name: 'ريم', password: 'sirr12345' });

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
  await c.request('POST', '/api/auth/signup', { email: email(), name: 'جود', password: 'sirr12345' });
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
  await other.request('POST', '/api/auth/signup', { email: email(), name: 'غيث', password: 'sirr12345' });
  assert.equal((await other.request('POST', `/api/activities/${id}/duplicate`)).status, 404);
});

test('كلمات المرور تُخزَّن مجزّأة لا كنص صريح', async () => {
  const storage = require('../server/storage');
  const mail = email();
  await client().request('POST', '/api/auth/signup', { email: mail, name: 'نايف', password: 'sirr12345' });
  const user = await storage.get().findUserByEmail(mail);
  assert.ok(user.passwordHash && user.salt);
  assert.ok(!user.passwordHash.includes('sirr12345'), 'لا تظهر كلمة المرور في التجزئة');
  assert.equal(user.passwordHash.length, 128, 'scrypt بطول 64 بايت');

  // نفس كلمة المرور لمستخدمين مختلفين تعطي تجزئة مختلفة (ملح عشوائي)
  const mail2 = email();
  await client().request('POST', '/api/auth/signup', { email: mail2, name: 'نوف', password: 'sirr12345' });
  const user2 = await storage.get().findUserByEmail(mail2);
  assert.notEqual(user.passwordHash, user2.passwordHash);
});
