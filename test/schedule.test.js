'use strict';

/**
 * اختبار جدولة النشاط: يفتح في موعده تلقائياً، ويُقفل بعد انتهاء مدته،
 * ويبقى محفوظاً حتى يحين موعده.
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
const { server, ready } = require('../server/index');
const { normalizeQuiz } = require('../server/session');
const store = require('../server/store');

let base;
let wsBase;
const openSockets = new Set();

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
    next(match, timeout = 5000) {
      const fn = typeof match === 'function' ? match : (m) => m.t === match;
      const at = queue.findIndex(fn);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('انتهت المهلة بانتظار: ' + match)), timeout);
        waiters.push({ match: fn, resolve: (m) => (clearTimeout(timer), resolve(m)) });
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

const QUESTIONS = [
  { type: 'mc', text: 'س١', timeLimit: 0, points: 10, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'] },
  { type: 'mc', text: 'س٢', timeLimit: 0, points: 10, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'] },
];

// ------------------------------------------------------------------ وحدات

test('الموعد: يُقبل المستقبلي ويُرفض الماضي والبعيد جداً وغير الصالح', () => {
  const soon = Date.now() + 3600000;
  assert.equal(normalizeQuiz({ settings: { opensAt: soon }, questions: QUESTIONS }).settings.opensAt, soon);

  // نص ISO كما يرسله المتصفح مقبول أيضاً
  const iso = new Date(soon).toISOString();
  assert.equal(normalizeQuiz({ settings: { opensAt: iso }, questions: QUESTIONS }).settings.opensAt, soon);

  assert.equal(normalizeQuiz({ settings: { opensAt: Date.now() - 3600000 }, questions: QUESTIONS }).settings.opensAt, null, 'موعد مضى');
  assert.equal(normalizeQuiz({ settings: { opensAt: Date.now() + 200 * 86400000 }, questions: QUESTIONS }).settings.opensAt, null, 'بعيد جداً');
  assert.equal(normalizeQuiz({ settings: { opensAt: 'غداً' }, questions: QUESTIONS }).settings.opensAt, null);
  assert.equal(normalizeQuiz({ settings: {}, questions: QUESTIONS }).settings.opensAt, null);
});

test('المدة: تُقصّ بين صفر و٧٢٠ دقيقة', () => {
  assert.equal(normalizeQuiz({ settings: { durationMinutes: 30 }, questions: QUESTIONS }).settings.durationMinutes, 30);
  assert.equal(normalizeQuiz({ settings: { durationMinutes: 5000 }, questions: QUESTIONS }).settings.durationMinutes, 720);
  assert.equal(normalizeQuiz({ settings: { durationMinutes: -5 }, questions: QUESTIONS }).settings.durationMinutes, 0);
  assert.equal(normalizeQuiz({ settings: {}, questions: QUESTIONS }).settings.durationMinutes, 0);
});

// ------------------------------------------------------------------ التدفق

test('الاختبار المجدول يفتح تلقائياً في موعده', async () => {
  const opensAt = Date.now() + 900; // بعد أقل من ثانية كي يبقى الاختبار سريعاً
  const { data: created } = await post('/api/sessions', {
    title: 'اختبار مجدول',
    settings: { pace: 'host', requireName: true, countdown: false, opensAt },
    questions: QUESTIONS,
  });

  const player = ws();
  await player.ready;
  player.send({ t: 'join', code: created.code, name: 'ليان', avatar: { seed: 'l' } });
  await player.next('joined');

  const lobby = await player.next((m) => m.t === 'state' && m.status === 'lobby');
  assert.equal(lobby.scheduledAt, opensAt, 'المشارك يعرف موعد الفتح ليعرض عدّاداً');

  // بلا أي أمر من المدرب: الجلسة تبدأ وحدها
  const live = await player.next((m) => m.t === 'state' && m.phase === 'question', 5000);
  assert.equal(live.question.text, 'س١');
  assert.ok(Date.now() >= opensAt, 'لم تبدأ قبل موعدها');

  player.close();
});

test('مدة الاختبار تُقفله تلقائياً على الجميع', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'اختبار بمدة',
    settings: { pace: 'host', requireName: true, countdown: false, durationMinutes: 1 },
    questions: QUESTIONS,
  });

  const player = ws();
  await player.ready;
  player.send({ t: 'join', code: created.code, name: 'عمر', avatar: { seed: 'o' } });
  await player.next('joined');

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');
  host.send({ t: 'host:start' });

  const live = await player.next((m) => m.t === 'state' && m.phase === 'question');
  assert.ok(live.deadlineAt > Date.now(), 'المشارك يعرف متى ينتهي الاختبار');
  assert.ok(Math.abs(live.deadlineAt - (Date.now() + 60000)) < 3000, 'دقيقة واحدة من البدء');

  // نقرّب الموعد بدل انتظار دقيقة كاملة في الاختبار
  const session = store.getSession(created.code);
  session.settings.durationMinutes = 1;
  session.startedAt = Date.now() - 59500;
  session.armDeadline();

  const ended = await player.next((m) => m.t === 'state' && m.status === 'ended', 5000);
  assert.equal(ended.status, 'ended', 'أُقفل تلقائياً بانتهاء المدة');

  host.close();
  player.close();
});

test('البدء اليدوي قبل الموعد يلغي مؤقّت الفتح ويبدأ عدّ المدة من الآن', async () => {
  const opensAt = Date.now() + 60000;
  const { data: created } = await post('/api/sessions', {
    title: 'بدء مبكر',
    settings: { pace: 'host', requireName: true, countdown: false, opensAt, durationMinutes: 20 },
    questions: QUESTIONS,
  });

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  const lobby = await host.next('state');
  assert.equal(lobby.scheduledAt, opensAt);
  assert.equal(lobby.durationMinutes, 20);

  host.send({ t: 'host:start' });
  const live = await host.next((m) => m.t === 'state' && m.phase === 'question');
  assert.ok(live.deadlineAt > Date.now() + 19 * 60000, 'المدة تُحسب من البدء الفعلي لا من الموعد');

  const session = store.getSession(created.code);
  assert.equal(session._openTimer, null, 'مؤقّت الفتح أُلغي');

  host.close();
});

test('الجلسة المجدولة لا يمسحها المُنظِّف قبل موعدها', () => {
  const session = store.createSession({
    title: 'بعد يومين',
    settings: { opensAt: Date.now() + 2 * 86400000 },
    questions: QUESTIONS,
  });
  // نجعلها تبدو خاملة منذ يوم كامل
  session.lastActivity = Date.now() - 25 * 60 * 60 * 1000;
  store.sweep();
  assert.ok(store.getSession(session.code), 'بقيت محفوظة رغم الخمول');

  session.settings.opensAt = null;
  store.sweep();
  assert.equal(store.getSession(session.code), null, 'وبلا موعد تُمسح كالمعتاد');
});

test('تقرير النتائج يذكر الموعد والمدة', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'تقرير بمدة',
    settings: { pace: 'host', requireName: true, countdown: false, durationMinutes: 45 },
    questions: QUESTIONS,
  });
  const report = await fetch(`${base}/api/sessions/${created.code}/export?hostToken=${created.hostToken}`).then((r) => r.json());
  assert.equal(report.settings.durationMinutes, 45);
  assert.equal(report.settings.scheduledAt, null);
});
