'use strict';

/**
 * اختبار تكامل شامل للمسار: إنشاء جلسة ← دخول مشاركين ← إجابات ← نتائج ← لوحة الإحصاءات.
 * التشغيل: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
const { server } = require('../server/index');

let base;

test.before(async () => {
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

// ------------------------------------------------------------------ أدوات

function ws() {
  const url = base.replace('http', 'ws') + '/ws';
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === 'pong') return;
    const waiter = waiters.find((w) => w.match(msg));
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(msg);
    } else {
      queue.push(msg);
    }
  });
  return {
    socket,
    ready: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    send(msg) {
      socket.send(JSON.stringify(msg));
    },
    /** ينتظر أول رسالة مطابقة (مع فحص ما وصل سابقاً) */
    next(match, timeout = 3000) {
      const test_ = typeof match === 'string' ? (m) => m.t === match : match;
      const index = queue.findIndex(test_);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match: test_, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) {
            waiters.splice(at, 1);
            reject(new Error('انتهت مهلة انتظار: ' + (typeof match === 'string' ? match : 'شرط')));
          }
        }, timeout);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function post(path, body, headers) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

const QUIZ = {
  title: 'اختبار تجريبي',
  settings: { requireName: true, allowLateJoin: true, showLeaderboard: true },
  questions: [
    {
      type: 'mc',
      text: 'ما هي عاصمة الأردن؟',
      timeLimit: 30,
      points: 1000,
      options: [
        { id: 'o0', text: 'عمّان' },
        { id: 'o1', text: 'بيروت' },
      ],
      correct: ['o0'],
    },
    { type: 'word', text: 'صف الحصة بكلمة', timeLimit: 0 },
    { type: 'scale', text: 'تقييمك؟', timeLimit: 0, scale: { min: 1, max: 5 } },
  ],
};

// ------------------------------------------------------------- الاختبارات

test('إنشاء جلسة يعيد رمزاً من ٦ أرقام ومفتاح مضيف', async () => {
  const { status, data } = await post('/api/sessions', QUIZ);
  assert.equal(status, 201);
  assert.match(data.code, /^\d{6}$/);
  assert.ok(data.hostToken.length > 10);
  assert.equal(data.questionCount, 3);
  assert.match(data.joinUrl, /\/j\/\d{6}$/);
});

test('رفض جلسة بلا أسئلة', async () => {
  const { status } = await post('/api/sessions', { title: 'فارغ', questions: [] });
  assert.equal(status, 400);
});

test('لوحة التحكم محمية بمفتاح المضيف', async () => {
  const { data } = await post('/api/sessions', QUIZ);
  const bad = await fetch(`${base}/api/sessions/${data.code}/dashboard?hostToken=خطأ`);
  assert.equal(bad.status, 403);
  const good = await fetch(`${base}/api/sessions/${data.code}/dashboard?hostToken=${encodeURIComponent(data.hostToken)}`);
  assert.equal(good.status, 200);
});

test('المسار الكامل: دخول، إجابة، تصحيح، نتائج، إحصاءات', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
  const code = created.code;

  // المضيف
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code, hostToken: created.hostToken });
  const hostState = await host.next('state');
  assert.equal(hostState.role, 'host');
  assert.equal(hostState.status, 'lobby');

  // مشاركان
  const a = ws();
  const b = ws();
  await Promise.all([a.ready, b.ready]);
  a.send({ t: 'join', code, name: 'سارة', avatar: { seed: 's', bg: 1, body: 2, face: 3, accessory: 0 } });
  b.send({ t: 'join', code, name: 'خالد', avatar: { seed: 'k', bg: 2, body: 3, face: 1, accessory: 1 } });
  const joinedA = await a.next('joined');
  await b.next('joined');
  assert.ok(joinedA.participantToken);

  await a.next((m) => m.t === 'state' && m.phase === 'lobby');

  // بدء النشاط
  host.send({ t: 'host:start' });
  const qA = await a.next((m) => m.t === 'state' && m.phase === 'question');
  assert.equal(qA.question.text, 'ما هي عاصمة الأردن؟');
  // لا تُكشف الإجابة الصحيحة أثناء السؤال
  assert.ok(qA.question.options.every((o) => o.correct === undefined));

  // إجابات
  a.send({ t: 'answer', questionId: qA.question.id, value: 'o0' });
  const ackA = await a.next('answer:accepted');
  assert.equal(ackA.correct, true);
  assert.ok(ackA.points > 0);

  b.send({ t: 'answer', questionId: qA.question.id, value: 'o1' });
  const ackB = await b.next('answer:accepted');
  assert.equal(ackB.correct, false);
  assert.equal(ackB.points, 0);

  // بعد إجابة الجميع تُعرض النتائج تلقائياً
  const resultsA = await a.next((m) => m.t === 'state' && m.phase === 'results');
  const correctOption = resultsA.results.options.find((o) => o.id === 'o0');
  assert.equal(correctOption.count, 1);
  assert.equal(correctOption.percent, 50);

  // منع الإجابة المكررة / بعد الإغلاق
  a.send({ t: 'answer', questionId: qA.question.id, value: 'o0' });
  const rejected = await a.next('answer:rejected');
  assert.ok(rejected.message);

  // السؤال الثاني: سحابة كلمات
  host.send({ t: 'host:skip' });
  const q2 = await a.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 1);
  a.send({ t: 'answer', questionId: q2.question.id, value: 'ممتازة' });
  b.send({ t: 'answer', questionId: q2.question.id, value: 'ممتازة' });
  const words = await host.next((m) => m.t === 'state' && m.phase === 'results' && m.index === 1);
  assert.equal(words.results.words[0].count, 2);

  // السؤال الثالث: مقياس
  host.send({ t: 'host:skip' });
  const q3 = await a.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 2);
  a.send({ t: 'answer', questionId: q3.question.id, value: 5 });
  b.send({ t: 'answer', questionId: q3.question.id, value: 3 });
  const scale = await host.next((m) => m.t === 'state' && m.phase === 'results' && m.index === 2);
  assert.equal(scale.results.average, 4);

  // قيمة خارج المدى تُرفض
  const c = ws();
  await c.ready;
  c.send({ t: 'join', code, name: 'ليان' });
  await c.next('joined');
  c.send({ t: 'answer', questionId: q3.question.id, value: 99 });
  await c.next('answer:rejected');
  c.close();

  // الإحصاءات
  const dashboard = await fetch(
    `${base}/api/sessions/${code}/dashboard?hostToken=${encodeURIComponent(created.hostToken)}`
  ).then((r) => r.json());
  assert.equal(dashboard.summary.participants, 3);
  assert.equal(dashboard.perQuestion[0].correct, 1);
  assert.equal(dashboard.perQuestion[0].accuracy, 50);
  assert.ok(dashboard.participants[0].score > 0);
  assert.equal(dashboard.participants[0].name, 'سارة');

  // الإنهاء
  host.send({ t: 'host:end' });
  const final = await a.next((m) => m.t === 'state' && m.status === 'ended');
  assert.equal(final.rank.rank, 1);

  host.close();
  a.close();
  b.close();
});

test('الاستطلاع المجهول لا يطلب اسماً ولا يكشف هوية المجيبين', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'استطلاع',
    settings: { requireName: false, showLeaderboard: false },
    questions: [{ type: 'open', text: 'رأيك؟', timeLimit: 0 }],
  });

  const info = await fetch(`${base}/api/sessions/${created.code}`).then((r) => r.json());
  assert.equal(info.requireName, false);

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'اسم مُرسل رغم الوضع المجهول' });
  await p.next('joined');

  host.send({ t: 'host:start' });
  const q = await p.next((m) => m.t === 'state' && m.phase === 'question');
  p.send({ t: 'answer', questionId: q.question.id, value: 'رأيي أن الحصة مفيدة' });
  await p.next('answer:accepted');

  host.send({ t: 'host:results' });
  const results = await host.next((m) => m.t === 'state' && m.phase === 'results');
  assert.equal(results.results.responses.length, 1);
  assert.equal(results.results.responses[0].name, null, 'يجب ألا يُنسب النص لأي مشارك');
  assert.equal(results.participants[0].name, 'مشارك مجهول');

  host.close();
  p.close();
});

test('إعادة الاتصال تحافظ على النقاط والإجابات', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'مازن' });
  const joined = await p.next('joined');

  host.send({ t: 'host:start' });
  const q = await p.next((m) => m.t === 'state' && m.phase === 'question');
  p.send({ t: 'answer', questionId: q.question.id, value: 'o0' });
  await p.next('answer:accepted');
  p.close();

  const again = ws();
  await again.ready;
  again.send({
    t: 'rejoin',
    code: created.code,
    participantId: joined.participantId,
    participantToken: joined.participantToken,
  });
  const state = await again.next('state');
  assert.ok(state.me.score > 0, 'يجب أن تبقى النقاط بعد إعادة الاتصال');
  assert.ok(state.answered, 'يجب أن تبقى الإجابة مسجلة');

  // رمز خاطئ يُرفض
  const impostor = ws();
  await impostor.ready;
  impostor.send({ t: 'rejoin', code: created.code, participantId: joined.participantId, participantToken: 'مزيّف' });
  const error = await impostor.next('error');
  assert.equal(error.code, 'no_participant');

  host.close();
  again.close();
  impostor.close();
});

test('توليد رمز QR بصيغة SVG', async () => {
  const response = await fetch(base + '/api/qr?text=' + encodeURIComponent('https://example.com/j/123456'));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /^<\?xml|^<svg/);
});

test('تنظيف المدخلات: تقصير النصوص وتجاهل الخيارات الفارغة', async () => {
  const { data } = await post('/api/sessions', {
    title: 'ع'.repeat(500),
    questions: [
      {
        type: 'mc',
        text: 'س'.repeat(500),
        options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: '   ' }, { id: 'o2', text: 'ب' }],
        correct: ['o1'],
      },
    ],
  });
  const dashboard = await fetch(
    `${base}/api/sessions/${data.code}/dashboard?hostToken=${encodeURIComponent(data.hostToken)}`
  ).then((r) => r.json());
  assert.equal(dashboard.title.length, 120);
  assert.equal(dashboard.perQuestion[0].text.length, 300);
  // الخيار الفارغ حُذف، والإجابة الصحيحة المشيرة إليه أُسقطت
  assert.equal(dashboard.hasScores, false);
});
