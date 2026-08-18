'use strict';

/**
 * اختبار السؤال النصّي الذي يصحّحه المدرب (علامة كاملة/جزئية/صفر)،
 * وحجب النتيجة عن الطالب حتى ينتهي التصحيح، وصورة السؤال.
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
// صور الأسئلة ميزة بريميوم، والمالك مشترك دائماً — نستخدمه لاختبارات الصور
process.env.ADMIN_EMAILS = 'owner@tapio.fun';
const { server, ready } = require('../server/index');
const { normalizeQuestion } = require('../server/session');

let base;
let wsBase;

// صورة PNG صالحة ١×١ بكسل
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let hostCookie = '';

test.before(async () => {
  await ready;
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
  // إنشاء الجلسة يتطلّب حساباً — كوكي مدرب واحد يكفي لكل هذا الملف
  hostCookie = await loginFree();
});

test.after(() => {
  for (const socket of openSockets) {
    try {
      socket.terminate();
    } catch {
      /* تجاهل */
    }
  }
  server.closeAllConnections?.();
  server.close();
});

const openSockets = new Set();

function ws() {
  const socket = new WebSocket(wsBase);
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
  const queue = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const at = waiters.findIndex((w) => w.match(msg));
    if (at >= 0) waiters.splice(at, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  return {
    ready: new Promise((resolve) => socket.on('open', resolve)),
    send: (msg) => socket.send(JSON.stringify(msg)),
    close: () => socket.close(),
    next(match) {
      const test_ = typeof match === 'function' ? match : (m) => m.t === match;
      const at = queue.findIndex(test_);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('انتهت المهلة بانتظار: ' + match)), 4000);
        waiters.push({ match: test_, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      });
    },
  };
}

const post = async (path, body, cookie) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...((cookie || hostCookie) ? { Cookie: cookie || hostCookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

/** يسجّل دخول المالك (مشترك دائماً) عبر جوجل مزيّفة ويعيد كوكي الجلسة */

/** حساب مجاني (غير مالك) — الإنشاء صار يتطلّب حساباً ولو لم يكن مشتركاً */
async function loginFree() {
  const original = global.fetch;
  const mail = `free.${Date.now()}.${Math.round(performance.now())}@example.com`;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub: 'g_' + mail, email: mail, email_verified: true, name: 'مدرب مجاني' }) };
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
    return (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
  } finally {
    global.fetch = original;
  }
}

async function loginOwner() {
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub: 'g_owner', email: 'owner@tapio.fun', email_verified: true, name: 'المالك' }) };
    }
    return original(url, opts);
  };
  try {
    const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
    const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cb = await fetch(`${base}/api/auth/google/callback?code=fake&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie.split(';')[0] },
    });
    return (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
  } finally {
    global.fetch = original;
  }
}

const QUIZ = {
  title: 'اختبار التصحيح اليدوي',
  settings: { pace: 'host', requireName: true, countdown: false, showLeaderboard: true },
  questions: [
    { type: 'open', text: 'اشرح دورة المياه بأسلوبك.', points: 5, timeLimit: 0 },
    { type: 'open', text: 'ما رأيك بالدرس؟', timeLimit: 0 },
  ],
};

const IMAGE_QUIZ = {
  title: 'اختبار مصوّر',
  settings: { pace: 'host', requireName: true, countdown: false },
  questions: [{ type: 'open', text: 'انظر إلى الصورة واشرح.', points: 5, timeLimit: 0, image: PNG }],
};

// ------------------------------------------------------------------ وحدات

test('السؤال المفتوح: علامة أكبر من صفر تجعله يدوي التصحيح، وصفر يبقيه رأياً حرّاً', () => {
  const graded = normalizeQuestion({ type: 'open', text: 'اشرح', points: 5 }, 0);
  assert.equal(graded.points, 5);
  assert.equal(graded.manual, true);

  const free = normalizeQuestion({ type: 'open', text: 'رأيك؟' }, 0);
  assert.equal(free.points, 0, 'بلا علامة افتراضياً — لا يرث ١٠٠٠');
  assert.equal(free.manual, false);
});

test('الصورة تُقبل كـ data URL فقط، ولا تُقبل الروابط الخارجية', () => {
  assert.equal(normalizeQuestion({ type: 'mc', text: 'س', image: PNG }, 0).image, PNG);
  assert.equal(normalizeQuestion({ type: 'mc', text: 'س', image: 'https://evil.example/x.png' }, 0).image, null);
  assert.equal(normalizeQuestion({ type: 'mc', text: 'س', image: 'javascript:alert(1)' }, 0).image, null);
  assert.equal(normalizeQuestion({ type: 'mc', text: 'س' }, 0).image, null);
});

test('صورة أكبر من الحد تُرفض برسالة واضحة', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(900001);
  assert.throws(() => normalizeQuestion({ type: 'mc', text: 'س', image: huge }, 0), /حجم الصورة كبير/);
});

test('أكمل الفراغ: عدد الفراغات من النص، والعلامة الافتراضية علامة لكل فراغ', () => {
  const q = normalizeQuestion({ type: 'blank', text: 'عاصمة الأردن ___ وعاصمة مصر ___.', blanks: ['عمّان', 'القاهرة'] }, 0);
  assert.equal(q.blanks.length, 2);
  assert.deepEqual(q.blanks, ['عمّان', 'القاهرة']);
  assert.equal(q.points, 2, 'علامة لكل فراغ افتراضياً');
  assert.equal(q.manual, true, 'التصحيح يدوي');

  // إجابات متوقعة أكثر من الفراغات تُقصّ، وبلا إجابات متوقعة يبقى العدد صحيحاً
  const one = normalizeQuestion({ type: 'blank', text: 'الماء يغلي عند ___ درجة.', points: 5 }, 0);
  assert.deepEqual(one.blanks, ['']);
  assert.equal(one.points, 5);
});

// ------------------------------------------------------------------ التدفق

test('صورة السؤال ميزة بريميوم: تُرفض من حساب مجاني وتُقبل من المشترك', async () => {
  const freeCookie = await loginFree();
  const free = await post('/api/sessions', IMAGE_QUIZ, freeCookie);
  assert.equal(free.status, 402, 'حساب بلا اشتراك لا يرفع صوراً');
  assert.match(free.data.error, /بريميوم/);
  assert.match(free.data.error, /970597034066/);

  const cookie = await loginOwner();
  const paid = await post('/api/sessions', IMAGE_QUIZ, cookie);
  assert.equal(paid.status, 201, 'المشترك يرفع الصور');
});

test('صورة السؤال تُقدَّم كملف من الجلسة لا كنص داخل الحالة', async () => {
  const cookie = await loginOwner();
  const { data: created } = await post('/api/sessions', IMAGE_QUIZ, cookie);
  const player = ws();
  await player.ready;
  player.send({ t: 'join', code: created.code, name: 'ليان', avatar: { seed: 'l' } });
  await player.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });

  const state = await player.next((m) => m.t === 'state' && m.phase === 'question');
  assert.match(state.question.imageUrl, /^\/api\/sessions\/\d{6}\/questions\/q_/);
  assert.equal(JSON.stringify(state).includes('base64'), false, 'الصورة لا تُبثّ داخل الحالة');

  const image = await fetch(base + state.question.imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.ok(Number(image.headers.get('content-length')) > 20);

  const missing = await fetch(`${base}/api/sessions/${created.code}/questions/q_ghost/image`);
  assert.equal(missing.status, 404);

  host.close();
  player.close();
});

test('الإجابة النصّية تبقى «بانتظار التصحيح» حتى يمنح المدرب علامة جزئية', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);

  const a = ws();
  const b = ws();
  await a.ready;
  await b.ready;
  a.send({ t: 'join', code: created.code, name: 'ليان', avatar: { seed: 'l' } });
  b.send({ t: 'join', code: created.code, name: 'عمر', avatar: { seed: 'o' } });
  const joinedA = await a.next('joined');
  await b.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });

  const q1 = await a.next((m) => m.t === 'state' && m.phase === 'question');
  const qid = q1.question.id;
  assert.equal(q1.question.manual, true, 'السؤال معلَّم كيدوي التصحيح');

  a.send({ t: 'answer', questionId: qid, value: 'تبخّر ثم تكاثف ثم هطول' });
  const accepted = await a.next('answer:accepted');
  assert.equal(accepted.pending, true, 'الإجابة تنتظر التصحيح');

  const pendingState = await a.next((m) => m.t === 'state' && m.answered);
  assert.equal(pendingState.answered.pending, true);
  assert.equal(pendingState.answered.points, 0);
  assert.equal(pendingState.answered.maxPoints, 5);
  assert.equal(pendingState.me.score, 0, 'لا نقاط قبل التصحيح');
  assert.equal(pendingState.pendingGrades, 1);

  b.send({ t: 'answer', questionId: qid, value: 'الماء يتبخر' });
  await b.next('answer:accepted');

  // المدرب يرى قائمة التصحيح بالنصوص
  const dash = await host.next((m) => m.t === 'dashboard' && m.data.grading[0].answers.length === 2);
  const item = dash.data.grading[0];
  assert.equal(item.maxPoints, 5);
  assert.equal(item.pending, 2);
  const lian = item.answers.find((x) => x.name === 'ليان');
  assert.equal(lian.text, 'تبخّر ثم تكاثف ثم هطول');
  assert.equal(lian.pending, true);

  // علامة جزئية ٣ من ٥
  host.send({ t: 'host:grade', participantId: lian.participantId, questionId: qid, points: 3 });
  const graded = await a.next((m) => m.t === 'state' && m.answered && m.answered.pending === false);
  assert.equal(graded.answered.points, 3);
  assert.equal(graded.answered.correct, 'partial');
  assert.equal(graded.me.score, 3);
  assert.equal(graded.pendingGrades, 0);

  // تعديل العلامة لاحقاً يصحّح المجموع فرقياً لا تراكمياً
  host.send({ t: 'host:grade', participantId: lian.participantId, questionId: qid, points: 5 });
  const regraded = await a.next((m) => m.t === 'state' && m.me.score === 5);
  assert.equal(regraded.answered.correct, true);

  // علامة أكبر من الحد تُقصّ، والصفر يعني خطأ
  host.send({ t: 'host:grade', participantId: lian.participantId, questionId: qid, points: 99 });
  const capped = await a.next((m) => m.t === 'state' && m.me.score === 5 && m.answered.points === 5);
  assert.equal(capped.answered.points, 5, 'لا يتجاوز العلامة القصوى');

  host.send({ t: 'host:grade', participantId: lian.participantId, questionId: qid, points: 0 });
  const zero = await a.next((m) => m.t === 'state' && m.answered && m.answered.pending === false && m.answered.points === 0);
  assert.equal(zero.answered.correct, false);

  void joinedA;
  host.close();
  a.close();
  b.close();
});

test('الطالب لا يرى نتيجته النهائية قبل انتهاء تصحيح المدرب', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
  const a = ws();
  await a.ready;
  a.send({ t: 'join', code: created.code, name: 'سالم', avatar: { seed: 's' } });
  await a.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });

  const q1 = await a.next((m) => m.t === 'state' && m.phase === 'question');
  a.send({ t: 'answer', questionId: q1.question.id, value: 'جواب نصّي' });
  await a.next('answer:accepted');

  host.send({ t: 'host:end' });
  const ended = await a.next((m) => m.t === 'state' && m.status === 'ended');
  assert.equal(ended.pendingGrades, 1, 'النتيجة النهائية محجوبة حتى التصحيح');

  host.send({ t: 'host:dashboard' });
  const dash = await host.next((m) => m.t === 'dashboard' && m.data.grading[0]?.answers.length === 1);
  const answer = dash.data.grading[0].answers[0];
  host.send({ t: 'host:grade', participantId: answer.participantId, questionId: dash.data.grading[0].id, points: 4 });

  const after = await a.next((m) => m.t === 'state' && m.answered && m.answered.pending === false);
  assert.equal(after.pendingGrades, 0);
  assert.equal(after.me.score, 4);
  assert.ok(after.rank, 'الترتيب صار متاحاً بعد التصحيح');

  host.close();
  a.close();
});

test('أكمل الفراغ: الطالب يملأ الفراغات، والمدرب يرى المتوقع ويضع صح أو علامة', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'أكمل الفراغ',
    settings: { pace: 'host', requireName: true, countdown: false },
    questions: [
      { type: 'blank', text: 'عاصمة الأردن ___ وعاصمة مصر ___.', blanks: ['عمّان', 'القاهرة'], points: 2, timeLimit: 0 },
    ],
  });

  const a = ws();
  await a.ready;
  a.send({ t: 'join', code: created.code, name: 'ندى', avatar: { seed: 'n' } });
  await a.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });

  const q = await a.next((m) => m.t === 'state' && m.phase === 'question');
  assert.equal(q.question.type, 'blank');
  assert.equal(q.question.blankCount, 2, 'الطالب يعرف عدد الفراغات');
  assert.deepEqual(q.question.blanks, [], 'الإجابات المتوقعة لا تُكشف للطالب قبل الإجابة');

  a.send({ t: 'answer', questionId: q.question.id, value: ['عمّان', 'الإسكندرية'] });
  const accepted = await a.next('answer:accepted');
  assert.equal(accepted.pending, true);

  host.send({ t: 'host:dashboard' });
  const dash = await host.next((m) => m.t === 'dashboard' && m.data.grading[0]?.answers.length === 1);
  const item = dash.data.grading[0];
  assert.equal(item.type, 'blank');
  assert.deepEqual(item.expected, ['عمّان', 'القاهرة'], 'المدرب يرى الإجابة المتوقعة');
  assert.equal(item.answers[0].text, 'عمّان · الإسكندرية');
  assert.deepEqual(item.answers[0].parts, ['عمّان', 'الإسكندرية']);

  // نصف العلامة: فراغ صحيح وآخر خاطئ
  host.send({ t: 'host:grade', participantId: item.answers[0].participantId, questionId: item.id, points: 1 });
  const graded = await a.next((m) => m.t === 'state' && m.answered && m.answered.pending === false);
  assert.equal(graded.answered.points, 1);
  assert.equal(graded.answered.correct, 'partial');
  assert.equal(graded.me.score, 1);

  // «صح» = العلامة الكاملة
  host.send({ t: 'host:grade', participantId: item.answers[0].participantId, questionId: item.id, points: 2 });
  const full = await a.next((m) => m.t === 'state' && m.me.score === 2);
  assert.equal(full.answered.correct, true);

  host.close();
  a.close();
});

test('أكمل الفراغ: إجابة فارغة تماماً تُرفض', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'فراغ',
    settings: { pace: 'host', requireName: true, countdown: false },
    questions: [{ type: 'blank', text: 'الماء يغلي عند ___ درجة.', points: 1, timeLimit: 0 }],
  });
  const a = ws();
  await a.ready;
  a.send({ t: 'join', code: created.code, name: 'سالم', avatar: { seed: 's' } });
  await a.next('joined');
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });
  const q = await a.next((m) => m.t === 'state' && m.phase === 'question');

  a.send({ t: 'answer', questionId: q.question.id, value: ['   '] });
  const rejected = await a.next('answer:rejected');
  assert.match(rejected.message, /غير صالحة/);

  host.close();
  a.close();
});

test('لا يمكن تصحيح سؤال غير مخصّص للتصحيح اليدوي', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
  const a = ws();
  await a.ready;
  a.send({ t: 'join', code: created.code, name: 'ندى', avatar: { seed: 'n' } });
  const joined = await a.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  const state = await host.next((m) => m.t === 'state' && Array.isArray(m.questions));
  assert.equal(state.questions.length, 2, 'السؤالان وصلا للمضيف: ' + JSON.stringify(state.questions));
  const freeQuestionId = state.questions[1].id;

  host.send({ t: 'host:grade', participantId: joined.participantId, questionId: freeQuestionId, points: 5 });
  const error = await host.next('error');
  assert.equal(error.code, 'grade');

  host.close();
  a.close();
});

test('ملف النتائج يحمل بطاقة النشاط وإحصاء كل سؤال ودرجة كل طالب بنسبتها', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'اختبار التقرير',
    settings: { pace: 'host', requireName: true, countdown: false, scoring: 'flat' },
    questions: [
      { type: 'mc', text: 'ما عاصمة الأردن؟', timeLimit: 0, points: 10, options: [{ id: 'o0', text: 'عمّان' }, { id: 'o1', text: 'إربد' }], correct: ['o0'] },
      { type: 'mc', text: 'كم يساوي ٢+٢؟', timeLimit: 0, points: 10, options: [{ id: 'o0', text: '٤' }, { id: 'o1', text: '٥' }], correct: ['o0'] },
    ],
  });

  const a = ws();
  const b = ws();
  await a.ready;
  await b.ready;
  a.send({ t: 'join', code: created.code, name: 'ليان', avatar: { seed: 'l' } });
  b.send({ t: 'join', code: created.code, name: 'عمر', avatar: { seed: 'o' } });
  await a.next('joined');
  await b.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });

  const q1 = await a.next((m) => m.t === 'state' && m.phase === 'question');
  a.send({ t: 'answer', questionId: q1.question.id, value: 'o0' });
  await a.next('answer:accepted');
  b.send({ t: 'answer', questionId: q1.question.id, value: 'o1' });
  await b.next('answer:accepted');

  host.send({ t: 'host:skip' });
  const q2 = await a.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 1);
  a.send({ t: 'answer', questionId: q2.question.id, value: 'o0' });
  await a.next('answer:accepted');
  host.send({ t: 'host:end' });
  await a.next((m) => m.t === 'state' && m.status === 'ended');

  const report = await fetch(`${base}/api/sessions/${created.code}/export?hostToken=${created.hostToken}`).then((r) => r.json());

  // بطاقة النشاط
  assert.equal(report.title, 'اختبار التقرير');
  assert.equal(report.questionCount, 2);
  assert.equal(report.participantCount, 2);
  assert.equal(report.maxScore, 20, 'مجموع علامات الأسئلة المصحَّحة');
  assert.ok(report.durationMinutes >= 1);
  assert.ok(Date.parse(report.startedAt) > 0 && Date.parse(report.endedAt) > 0);
  assert.equal(report.settings.scoring, 'flat');

  // إحصاء الأسئلة
  const first = report.questions[0];
  assert.equal(first.responses, 2);
  assert.equal(first.correctCount, 1);
  assert.equal(first.wrongCount, 1);
  assert.equal(first.accuracy, 50);
  assert.equal(first.maxPoints, 10);
  const second = report.questions[1];
  assert.equal(second.responses, 1, 'سؤال أجاب عنه واحد فقط');
  assert.equal(second.accuracy, 100);

  // الطلاب: درجة ونسبة وترتيب
  const lian = report.participants.find((p) => p.name === 'ليان');
  const omar = report.participants.find((p) => p.name === 'عمر');
  assert.equal(lian.score, 20);
  assert.equal(lian.percent, 100);
  assert.equal(lian.rank, 1);
  assert.equal(lian.answered, 2);
  assert.equal(lian.correctCount, 2);
  assert.equal(omar.rank, 2);
  assert.equal(omar.percent, 0);
  assert.equal(omar.unanswered, 1);
  assert.equal(omar.answers[0].maxPoints, 10);

  host.close();
  a.close();
  b.close();
});
