'use strict';

/**
 * ما يراه الطالب على جهازه — ثلاثة مفاتيح في إعدادات النشاط، وكلٌّ منها
 * يُنفَّذ في الخادم لا في الواجهة وحدها:
 *   revealAnswer — الإجابة الصحيحة وشرحها وصحّة إجابته
 *   showScore    — نقاطه، علامته، ترتيبه، أوسمته
 *   showOthers   — عدد المشاركين، لوحة الترتيب، نتائج الصف على كل سؤال
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tafa3l-view-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
const { server, ready } = require('../server/index');
const { normalizeQuiz } = require('../server/session');

let base;
let hostCookie = '';
const openSockets = new Set();

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
  await loginHost();
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

function ws() {
  const socket = new WebSocket(base.replace('http', 'ws') + '/ws');
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
  const queue = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === 'pong') return;
    const waiter = waiters.find((w) => w.match(msg));
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(msg);
    } else queue.push(msg);
  });
  return {
    ready: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    send: (msg) => socket.send(JSON.stringify(msg)),
    next(match, timeout = 3000) {
      const fn = typeof match === 'string' ? (m) => m.t === match : match;
      const at = queue.findIndex(fn);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match: fn, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error('انتهت مهلة انتظار: ' + (typeof match === 'string' ? match : 'شرط')));
          }
        }, timeout);
      });
    },
    close: () => socket.close(),
  };
}

async function loginHost() {
  const original = global.fetch;
  const mail = `view.${Date.now()}@example.com`;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub: 'g_' + mail, email: mail, email_verified: true, name: 'مدرب' }) };
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
    hostCookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
  } finally {
    global.fetch = original;
  }
}

async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: hostCookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

const QUESTIONS = [
  {
    type: 'mc',
    text: 'عاصمة الأردن؟',
    explanation: 'عمّان.',
    timeLimit: 0,
    points: 1000,
    options: [{ id: 'o0', text: 'عمّان' }, { id: 'o1', text: 'دمشق' }],
    correct: ['o0'],
  },
];

/** جلسة بوضع المدرّب، وطالبان، وإجابة من الأول (خاطئة) والثاني (صحيحة) */
async function scenario(settings) {
  const { data } = await post('/api/sessions', { title: 'رؤية الطالب', settings: { pace: 'host', countdown: false, ...settings }, questions: QUESTIONS });
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: data.code, hostToken: data.hostToken });
  await host.next('state');
  const a = ws();
  await a.ready;
  a.send({ t: 'join', code: data.code, name: 'هدى' });
  await a.next('joined');
  const b = ws();
  await b.ready;
  b.send({ t: 'join', code: data.code, name: 'سعد' });
  await b.next('joined');
  host.send({ t: 'host:start' });
  const q = await a.next((m) => m.t === 'state' && m.phase === 'question');
  a.send({ t: 'answer', questionId: q.question.id, value: 'o1' });
  const ack = await a.next('answer:accepted');
  b.send({ t: 'answer', questionId: q.question.id, value: 'o0' });
  await b.next('answer:accepted');
  return { host, a, b, ack, lobbyState: q, code: data.code };
}

test('الإعدادات: اللوحة تابعةٌ للآخرين، والمفاتيح الثلاثة مفعّلة افتراضياً', () => {
  const def = normalizeQuiz({ questions: QUESTIONS }).settings;
  assert.equal(def.revealAnswer, true);
  assert.equal(def.showScore, true);
  assert.equal(def.showOthers, true);
  assert.equal(def.showLeaderboard, true);
  const hidden = normalizeQuiz({ questions: QUESTIONS, settings: { showOthers: false, showLeaderboard: true } }).settings;
  assert.equal(hidden.showLeaderboard, false, 'لا لوحة ترتيب لمن أخفى الآخرين');
});

test('الافتراضي: الطالب يرى صحّة إجابته ونقاطه والآخرين', async () => {
  const { host, a, ack } = await scenario({});
  assert.equal(ack.correct, false);
  assert.equal(typeof ack.points, 'number');
  const s = await a.next((m) => m.t === 'state' && m.answered);
  assert.equal(s.answered.correct, false);
  assert.equal(s.participants, 2);
  host.close();
  a.close();
});

test('revealAnswer مطفأ: لا صحّة ولا إجابة صحيحة — حتى بعد عرض النتائج، وفي المراجعة', async () => {
  const { host, a, b, ack } = await scenario({ revealAnswer: false });
  assert.equal(ack.correct, undefined, 'الإقرار لا يحمل الصحّة');
  const s = await a.next((m) => m.t === 'state' && m.answered);
  assert.equal(s.answered.correct, undefined, 'حالة الطالب لا تحمل الصحّة');
  assert.ok(s.question.options.every((o) => o.correct === undefined));

  // كان عرضُ النتائج يكشفها للجميع مهما كان الإعداد
  host.send({ t: 'host:results' });
  const r = await a.next((m) => m.t === 'state' && m.phase === 'results');
  assert.ok(r.question.options.every((o) => o.correct === undefined), 'لا كشف على الجوّال بعد عرض النتائج');
  assert.equal(r.question.explanation, '');
  assert.ok(r.results && r.results.options.every((o) => o.correct === undefined), 'أعمدة النتائج بلا علامة الصحيح');
  assert.equal(r.results.correctCount, undefined);

  host.send({ t: 'host:end' });
  await a.next((m) => m.t === 'state' && (m.phase === 'final' || m.status === 'ended'));
  a.send({ t: 'review' });
  const review = await a.next('review');
  assert.equal(review.items[0].right, '', 'المراجعة بلا إجابة صحيحة');
  assert.equal(review.items[0].correct, null);
  assert.equal(review.items[0].explanation, '');
  host.close();
  a.close();
  b.close();
});

test('showScore مطفأ: لا نقاط ولا ترتيب ولا أوسمة ولا علامة — والصحّة تبقى إن كان الكشف مفعّلاً', async () => {
  const { host, a, b, ack } = await scenario({ showScore: false, reward: 'marks', totalMark: 20 });
  assert.equal(ack.correct, false, 'الصحّة تصل لأن الكشف مفعّل');
  assert.equal(ack.points, undefined, 'النقاط لا تصل');
  const s = await a.next((m) => m.t === 'state' && m.answered);
  assert.equal(s.answered.points, undefined);
  assert.equal(s.answered.maxPoints, undefined);
  assert.equal(s.me.score, 0);

  host.send({ t: 'host:results' });
  await a.next((m) => m.t === 'state' && m.phase === 'results');
  host.send({ t: 'host:leaderboard' });
  const lb = await b.next((m) => m.t === 'state' && m.phase === 'leaderboard');
  assert.equal(lb.rank, undefined, 'الترتيب رقمٌ عن النتيجة فلا يصل');
  assert.ok(lb.leaderboard?.length, 'لكن لوحة الآخرين تصل لأن الآخرين ظاهرون');

  host.send({ t: 'host:end' });
  const fin = await b.next((m) => m.t === 'state' && (m.phase === 'final' || m.status === 'ended'));
  assert.equal(fin.mark, undefined, 'العلامة لا تصل');
  assert.equal(fin.badges, undefined, 'الأوسمة لا تصل');
  b.send({ t: 'review' });
  const review = await b.next('review');
  assert.equal(review.items[0].points, 0);
  assert.equal(review.items[0].maxPoints, 0);
  assert.equal(review.items[0].correct, true, 'الصحّة تبقى في المراجعة');
  host.close();
  a.close();
  b.close();
});

test('showOthers مطفأ: لا عدد ولا لوحة ولا نتائج صفّ ولا ترتيب — ونتيجته هو تصل', async () => {
  const { host, a, b, ack } = await scenario({ showOthers: false });
  assert.equal(typeof ack.points, 'number');
  const s = await a.next((m) => m.t === 'state' && m.answered);
  assert.equal(s.participants, null, 'العدد لا يُرسل');

  host.send({ t: 'host:results' });
  const r = await a.next((m) => m.t === 'state' && m.phase === 'results');
  assert.equal(r.results, null, 'لا توزيع لإجابات الصف');
  assert.equal(r.question.options.find((o) => o.id === 'o0').correct, true, 'لكن الإجابة الصحيحة تُكشف له');

  host.send({ t: 'host:leaderboard' });
  const lb = await b.next((m) => m.t === 'state' && m.phase === 'leaderboard');
  assert.equal(lb.leaderboard, undefined);
  assert.equal(lb.teamLeaderboard, undefined);
  assert.equal(lb.rank, undefined, 'الترتيب مقارنةٌ بالآخرين');

  host.send({ t: 'host:end' });
  const fin = await b.next((m) => m.t === 'state' && (m.phase === 'final' || m.status === 'ended'));
  assert.ok(fin.badges, 'أوسمته هو تصل');
  assert.equal(fin.leaderboard, undefined);
  assert.ok(fin.me.score > 0, 'ونقاطه تصل');
  host.close();
  a.close();
  b.close();
});

test('الوضع الحرّ يحترم المفاتيح نفسها', async () => {
  const { data } = await post('/api/sessions', {
    title: 'حرّ',
    settings: { pace: 'self', autoStart: true, revealAnswer: false, showScore: false, showOthers: false, countdown: false },
    questions: QUESTIONS,
  });
  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: data.code, name: 'ليان' });
  await p.next('joined');
  const q = await p.next((m) => m.t === 'state' && m.question);
  assert.equal(q.participants, null);
  p.send({ t: 'answer', questionId: q.question.id, value: 'o1' });
  const ack = await p.next('answer:accepted');
  assert.equal(ack.correct, undefined);
  assert.equal(ack.points, undefined);
  const fb = await p.next((m) => m.t === 'state' && m.answered);
  assert.equal(fb.answered.correct, undefined);
  assert.equal(fb.answered.points, undefined);
  assert.ok(fb.question.options.every((o) => o.correct === undefined));
  assert.equal(fb.results, null);
  p.send({ t: 'next' });
  const done = await p.next((m) => m.t === 'state' && m.phase === 'final');
  assert.equal(done.rank, undefined);
  assert.equal(done.badges, undefined);
  assert.equal(done.leaderboard, undefined);
  p.close();
});
