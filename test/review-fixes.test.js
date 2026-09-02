'use strict';

/**
 * ما كشفته المراجعة الشاملة — كلُّ اختبارٍ هنا كان يسقط قبل إصلاحه.
 *
 *  ١) الوضع الحرّ مع البدء التلقائي (وهو المبدأ) لم يكن يسلّح مهلة الإقفال
 *     ولا موعد التسليم: يقبل الإجابات بعد موعدها إلى الأبد.
 *  ٢) تعديلُ النشاط قبل بدئه لم يكن يُعيد تسليح موعد الفتح ولا يعيد بناء
 *     الفرق، ولا يُكتب إلى القرص فيعود بعد إعادة النشر بأسئلته القديمة.
 *  ٣) جسمٌ مكسور على `/api` كان يُردّ عليه بصفحة HTML فيها تتبّع المكدّس.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-review-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

const { server, ready } = require('../server/index');
const { Session, normalizeQuiz } = require('../server/session');
const store = require('../server/store');

let base;
test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

const MC = { type: 'mc', text: 'س؟', options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'], points: 100 };

test('الوضع الحرّ يبدأ بـstart() فتُسلَّح المهلة وموعد التسليم من أول داخل', () => {
  const dueAt = Date.now() + 3600000;
  const session = new Session('000201', normalizeQuiz({ questions: [MC], settings: { pace: 'self', autoStart: true, durationMinutes: 30, dueAt } }));
  assert.equal(session.status, 'lobby');
  session.addParticipant({ name: 'ليان' });
  try {
    assert.equal(session.status, 'live');
    assert.ok(session.startedAt, 'لحظة الانطلاق مسجّلة — منها تُحسب المدة');
    assert.ok(session.deadlineAt, 'مهلة الإقفال مسلّحة');
    // ٣٠ دقيقة أقرب من الموعد، فهي التي تُقفل
    assert.ok(Math.abs(session.deadlineAt - (session.startedAt + 30 * 60000)) < 1000);
    assert.ok(session._deadlineTimer, 'ومؤقّتها يعمل فعلاً');
  } finally {
    session.dispose?.();
  }
});

test('تعديل النشاط قبل البدء يُعيد تسليح الموعد ويُعيد بناء الفرق', () => {
  const soon = Date.now() + 60 * 60000;
  const session = new Session('000202', normalizeQuiz({ title: 'قديم', questions: [MC], settings: { pace: 'host', teamMode: true, teamCount: 4, opensAt: soon } }));
  try {
    assert.equal(session.teams.length, 4);
    const oldTimer = session._openTimer;
    assert.ok(oldTimer, 'موعدٌ مسلّح ابتداءً');

    session.applyEdit(normalizeQuiz({ title: 'جديد', questions: [MC, MC], settings: { pace: 'host', teamMode: true, teamCount: 2, opensAt: soon + 30 * 60000 } }));
    assert.equal(session.title, 'جديد');
    assert.equal(session.questions.length, 2);
    assert.equal(session.teams.length, 2, 'الفرق بعددها الجديد');
    assert.ok(session._openTimer && session._openTimer !== oldTimer, 'مؤقّتُ الفتح أُعيد تسليحه على الموعد الجديد');

    // ومن كان موزَّعاً على فريقٍ لم يعد موجوداً يُعاد توزيعه
    session.addParticipant({ name: 'كريم' });
    for (const p of session.participants.values()) assert.ok(p.teamId < 2, 'لا مشاركَ على فريقٍ محذوف');
  } finally {
    session.dispose?.();
  }
});

test('التعديل يُعيد كتابة الصفّ كاملاً لا تحديثاً خفيفاً — فيبقى بعد إعادة النشر', async () => {
  const session = store.createSession(normalizeQuiz({ title: 'قبل', questions: [MC], settings: { pace: 'host' } }));
  try {
    await store.flush();
    session.applyEdit(normalizeQuiz({ title: 'بعد', questions: [MC, MC], settings: { pace: 'host' } }));
    store.rewrite(session);
    await store.flush();
    const storage = require('../server/storage').get();
    const snap = (await storage.listLiveSessions()).find((s) => s.code === session.code);
    assert.ok(snap, 'الجلسة على القرص');
    assert.equal(snap.title, 'بعد', 'العنوان الجديد على القرص');
    assert.equal((snap.questions || []).length, 2, 'والأسئلة الجديدة معه');
  } finally {
    store.deleteSession(session.code);
  }
});

test('جسمٌ مكسور على /api يُردّ عليه JSON لا صفحة HTML بتتبّع المكدّس', async () => {
  const res = await fetch(base + '/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  });
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.text();
  assert.ok(JSON.parse(body).error, 'رسالةٌ مفهومة');
  assert.equal(/node_modules|at parse|SyntaxError/.test(body), false, 'ولا مسارَ خادمٍ ولا مكدّس');
});

test('ملفٌّ أكبر من الحدّ يُردّ عليه JSON بحالة 413 ورسالةٍ تقول ماذا يفعل', async () => {
  const huge = JSON.stringify({ x: 'a'.repeat(300 * 1024) });
  const res = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: huge });
  assert.equal(res.status, 413);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.match((await res.json()).error, /أكبر من الحدّ/);
});

test('معرّفٌ من سلسلة الأوّليات لا يعيد كائناً وهمياً', async () => {
  for (const id of ['__proto__', 'constructor', 'toString']) {
    const res = await fetch(`${base}/api/games/${id}`);
    assert.equal(res.status, 404, id);
    assert.equal((await fetch(`${base}/api/teachers/${id}`)).status, 404, id);
  }
});
