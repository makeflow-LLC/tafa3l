'use strict';

/**
 * المكتبة العامة: معلّم ينشر نشاطه، ومعلّم آخر ينسخه.
 *
 * ما يستحق التثبيت هنا ليس «هل يعمل النسخ» بل الحدود:
 * الأسئلة لا تُعطى لزائر بلا حساب (فيها إجابات صحيحة)، والنسخة مستقلة
 * تماماً عن أصلها فلا يسحبها صاحبها من تحت من نسخها، وسحب النشر يُخفي
 * النشاط من الفهرس فوراً.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-lib-'));
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
      return { status: res.status, data };
    },
  };
}

let uniq = 0;

async function login(c, name) {
  const original = global.fetch;
  const email = `lib${++uniq}.${Date.now()}@example.com`;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub: 'g_' + email, email, email_verified: true, name }) };
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
    const sid = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid='));
    c.cookie = sid.split(';')[0];
  } finally {
    global.fetch = original;
  }
}

const MC = (n) => ({
  type: 'mc',
  text: 'سؤال ' + n,
  options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
  correct: ['o0'],
  points: 1000,
  timeLimit: 0,
});

const QUIZ = (title) => ({ title, settings: { pace: 'host', scoring: 'flat' }, questions: [MC(1), MC(2), MC(3)] });

test('النشر ثم التصفّح والنسخ — والنسخة مستقلة عن أصلها', async () => {
  const author = client();
  await login(author, 'سلمى المعلّمة');
  const made = await author.request('POST', '/api/activities', QUIZ('دورة الماء'));
  assert.equal(made.status, 201);
  const id = made.data.activity.id;

  const pub = await author.request('POST', `/api/activities/${id}/publish`, { subject: 'علوم', grade: 'الخامس' });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.published, true);

  // زائر بلا حساب يرى الفهرس
  const guest = client();
  const list = await guest.request('GET', '/api/library?q=' + encodeURIComponent('دورة'));
  assert.equal(list.status, 200);
  const row = list.data.items.find((x) => x.id === id);
  assert.ok(row, 'النشاط المنشور يظهر في الفهرس');
  assert.equal(row.subject, 'علوم');
  assert.equal(row.author, 'سلمى', 'الاسم الأول وحده');
  assert.equal(row.questionCount, 3);
  assert.equal(JSON.stringify(row).includes('correct'), false, 'الفهرس لا يحمل الإجابات الصحيحة');

  // ...لكنه لا يفتح الأسئلة بلا حساب
  const peek = await guest.request('GET', '/api/library/' + id);
  assert.equal(peek.status, 401, 'الأسئلة تحتاج حساباً — فيها الإجابات الصحيحة');

  const copier = client();
  await login(copier, 'مروان');
  const preview = await copier.request('GET', '/api/library/' + id);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.activity.questions.length, 3);

  const copied = await copier.request('POST', `/api/library/${id}/copy`);
  assert.equal(copied.status, 201);
  const copyId = copied.data.activity.id;
  assert.notEqual(copyId, id);

  const mine = await copier.request('GET', '/api/activities');
  const own = mine.data.activities.find((a) => a.id === copyId);
  assert.ok(own, 'النسخة صارت في أنشطته');
  assert.equal(own.published, false, 'النسخة لا تُنشر تلقائياً');

  // عدّاد النسخ ارتفع عند الأصل
  const after = await guest.request('GET', '/api/library');
  assert.equal(after.data.items.find((x) => x.id === id).copies, 1);

  // صاحب الأصل يسحب النشر: يختفي من الفهرس، ونسخة مروان تبقى له
  const off = await author.request('POST', `/api/activities/${id}/unpublish`);
  assert.equal(off.status, 200);
  const gone = await guest.request('GET', '/api/library');
  assert.equal(gone.data.items.some((x) => x.id === id), false, 'اختفى من الفهرس');
  const still = await copier.request('GET', '/api/activities/' + copyId);
  assert.equal(still.status, 200, 'النسخة تبقى لصاحبها بعد سحب الأصل');
});

test('لا ينشر أحد نشاط غيره ولا يسحبه', async () => {
  const a = client();
  await login(a, 'صاحب');
  const id = (await a.request('POST', '/api/activities', QUIZ('نشاطي'))).data.activity.id;

  const b = client();
  await login(b, 'متطفّل');
  assert.equal((await b.request('POST', `/api/activities/${id}/publish`, {})).status, 404);
  await a.request('POST', `/api/activities/${id}/publish`, {});
  assert.equal((await b.request('POST', `/api/activities/${id}/unpublish`)).status, 404);

  const list = await b.request('GET', '/api/library');
  assert.equal(list.data.items.some((x) => x.id === id), true, 'ومع ذلك يراه منشوراً — المنع على الإدارة لا على القراءة');
});

test('لا يُنشر نشاط أقلّ من ثلاثة أسئلة', async () => {
  const c = client();
  await login(c, 'مجرّب');
  const id = (await c.request('POST', '/api/activities', {
    title: 'تجربة',
    settings: { pace: 'host' },
    questions: [MC(1)],
  })).data.activity.id;
  const res = await c.request('POST', `/api/activities/${id}/publish`, {});
  assert.equal(res.status, 400);
  assert.match(res.data.error, /٣ أسئلة/);
});

test('نسخ نشاط غير منشور مرفوض — النشر هو الإذن', async () => {
  const a = client();
  await login(a, 'كاتب');
  const id = (await a.request('POST', '/api/activities', QUIZ('خاصّ'))).data.activity.id;
  const b = client();
  await login(b, 'ناسخ');
  assert.equal((await b.request('POST', `/api/library/${id}/copy`)).status, 404);
  assert.equal((await b.request('GET', '/api/library/' + id)).status, 404);
});

test('البحث والتصفية يضيّقان الفهرس', async () => {
  const c = client();
  await login(c, 'ناشر');
  const one = (await c.request('POST', '/api/activities', QUIZ('الجبر والمعادلات'))).data.activity.id;
  const two = (await c.request('POST', '/api/activities', QUIZ('تاريخ الأندلس'))).data.activity.id;
  await c.request('POST', `/api/activities/${one}/publish`, { subject: 'رياضيات', grade: 'التاسع' });
  await c.request('POST', `/api/activities/${two}/publish`, { subject: 'تاريخ', grade: 'التاسع' });

  const byText = await c.request('GET', '/api/library?q=' + encodeURIComponent('الأندلس'));
  assert.equal(byText.data.items.some((x) => x.id === two), true);
  assert.equal(byText.data.items.some((x) => x.id === one), false);

  const bySubject = await c.request('GET', '/api/library?subject=' + encodeURIComponent('رياضيات'));
  assert.equal(bySubject.data.items.some((x) => x.id === one), true);
  assert.equal(bySubject.data.items.some((x) => x.id === two), false);

  const byGrade = await c.request('GET', '/api/library?grade=' + encodeURIComponent('التاسع'));
  assert.ok(byGrade.data.total >= 2);
});
