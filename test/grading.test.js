'use strict';

/**
 * اختبار السؤال النصّي الذي يصحّحه المدرب (علامة كاملة/جزئية/صفر)،
 * وحجب النتيجة عن الطالب حتى ينتهي التصحيح، وصورة السؤال.
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
const { server, ready } = require('../server/index');
const { normalizeQuestion } = require('../server/session');

let base;
let wsBase;

// صورة PNG صالحة ١×١ بكسل
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.before(async () => {
  await ready;
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
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

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

const QUIZ = {
  title: 'اختبار التصحيح اليدوي',
  settings: { pace: 'host', requireName: true, countdown: false, showLeaderboard: true },
  questions: [
    { type: 'open', text: 'اشرح دورة المياه بأسلوبك.', points: 5, timeLimit: 0, image: PNG },
    { type: 'open', text: 'ما رأيك بالدرس؟', timeLimit: 0 },
  ],
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

// ------------------------------------------------------------------ التدفق

test('صورة السؤال تُقدَّم كملف من الجلسة لا كنص داخل الحالة', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
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
