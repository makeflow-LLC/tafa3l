'use strict';

/**
 * اختبار تكامل شامل للمسار: إنشاء جلسة ← دخول مشاركين ← إجابات ← نتائج ← لوحة الإحصاءات.
 * التشغيل: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
// عزل بيانات الاختبار عن بيانات التطوير
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tafa3l-test-'));
const { server, ready } = require('../server/index');

let base;

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});

// كل الاتصالات المفتوحة، حتى نغلقها بالقوة ولو فشل اختبار في منتصفه
const openSockets = new Set();

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

// ------------------------------------------------------------------ أدوات

function ws() {
  const url = base.replace('http', 'ws') + '/ws';
  const socket = new WebSocket(url);
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
  // العدّاد مطفأ في معظم الاختبارات حتى لا ننتظر ٣ ثوانٍ قبل كل سؤال
  settings: { requireName: true, allowLateJoin: true, showLeaderboard: true, countdown: false },
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
  // لوحة التحكم تعرض النتائج المجمّعة نفسها: سحابة الكلمات وأعمدة المقياس
  assert.equal(dashboard.perQuestion[1].results.words[0].text, 'ممتازة');
  assert.equal(dashboard.perQuestion[1].results.words[0].count, 2);
  assert.equal(dashboard.perQuestion[2].results.average, 4);
  assert.equal(dashboard.perQuestion[2].results.buckets.length, 5);

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

test('عدّاد «استعد» يمنع الإجابة المبكرة ويفتح السؤال بعده', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'مع عدّاد',
    settings: { countdown: true },
    questions: [
      {
        // مدة قصيرة: لو بدأ العدّ من لحظة «ابدأ» بدل لحظة الفتح لضاع أكثر من نصف الوقت
        type: 'mc',
        text: 'س؟',
        timeLimit: 6,
        points: 1000,
        options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
        correct: ['o0'],
      },
    ],
  });

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'ريم' });
  await p.next('joined');

  host.send({ t: 'host:start' });
  const q = await p.next((m) => m.t === 'state' && m.phase === 'question');
  assert.ok(q.opensAt > Date.now(), 'يجب أن يكون وقت الفتح في المستقبل');

  // إجابة أثناء العدّاد تُرفض
  p.send({ t: 'answer', questionId: q.question.id, value: 'o0' });
  const early = await p.next('answer:rejected');
  assert.match(early.message, /لم يبدأ/);

  // وبعد انتهاء العدّاد تُقبل
  await new Promise((resolve) => setTimeout(resolve, q.opensAt - Date.now() + 120));
  p.send({ t: 'answer', questionId: q.question.id, value: 'o0' });
  const accepted = await p.next('answer:accepted');
  assert.equal(accepted.correct, true);
  // الزمن يُحسب من لحظة الفتح لا من لحظة الضغط على «ابدأ»:
  // إجابة فورية ⇒ النقاط شبه كاملة (لو عُدّ زمن العدّاد لهبطت إلى ~٧٠٠)
  assert.ok(accepted.points > 900, 'النقاط: ' + accepted.points);
  assert.ok(accepted.points <= 1000, 'النقاط لا تتجاوز قيمة السؤال: ' + accepted.points);

  host.close();
  p.close();
});

test('التفاعلات تصل للمضيف وتُحدّ من التكرار السريع', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'ندى' });
  await p.next('joined');
  host.send({ t: 'host:start' });
  await p.next((m) => m.t === 'state' && m.phase === 'question');

  p.send({ t: 'reaction', emoji: '👏' });
  const reaction = await host.next('reaction');
  assert.equal(reaction.emoji, '👏');

  // إيموجي غير مسموح، ورشقة سريعة: لا شيء منها يصل
  p.send({ t: 'reaction', emoji: '💣' });
  p.send({ t: 'reaction', emoji: '🔥' });
  await assert.rejects(() => host.next('reaction', 700));

  host.close();
  p.close();
});

test('القوالب المشتركة صالحة على الخادم والمتصفح', async () => {
  const templates = await fetch(base + '/api/templates').then((r) => r.json());
  assert.ok(templates.templates.length >= 3);
  for (const template of templates.templates) {
    assert.ok(template.key && template.name && template.title);
    assert.ok(Array.isArray(template.questions) && template.questions.length > 0);
    // كل قالب يجب أن يُنشئ جلسة فعلياً
    const { status } = await post('/api/sessions', template);
    assert.equal(status, 201, 'فشل القالب: ' + template.key);
  }
});

// ------------------------------------------- أوضاع التقدّم ونظام التحفيز

test('الوضع التلقائي ينتقل وحده بعد عرض النتائج', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'تلقائي',
    settings: { pace: 'auto', autoAdvanceSec: 2, showLeaderboard: false, countdown: false },
    questions: [
      { type: 'poll', text: 'س١', timeLimit: 0, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }] },
      { type: 'poll', text: 'س٢', timeLimit: 0, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }] },
    ],
  });

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'سامي' });
  await p.next('joined');

  host.send({ t: 'host:start' });
  const q1 = await p.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 0);
  p.send({ t: 'answer', questionId: q1.question.id, value: 'o0' });
  await p.next('answer:accepted');

  // أجاب الجميع ⇒ نتائج، ثم انتقال تلقائي بلا أي تدخّل من المضيف
  await p.next((m) => m.t === 'state' && m.phase === 'results', 3000);
  const q2 = await p.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 1, 6000);
  assert.equal(q2.question.text, 'س٢');

  host.close();
  p.close();
});

test('الوضع الحر: كل متدرب يتقدّم بسرعته وبمؤقّت خاص به', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'حر',
    settings: { pace: 'self', countdown: false },
    questions: [
      {
        type: 'mc',
        text: 'س١',
        timeLimit: 0,
        points: 1000,
        options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
        correct: ['o0'],
      },
      { type: 'word', text: 'س٢', timeLimit: 0 },
    ],
  });

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const a = ws();
  const b = ws();
  await Promise.all([a.ready, b.ready]);
  a.send({ t: 'join', code: created.code, name: 'أمل' });
  b.send({ t: 'join', code: created.code, name: 'بدر' });
  await a.next('joined');
  await b.next('joined');

  host.send({ t: 'host:start' });
  const q1 = await a.next((m) => m.t === 'state' && m.phase === 'question');
  await b.next((m) => m.t === 'state' && m.phase === 'question');

  // «أمل» تجيب وتنتقل، بينما «بدر» ما زال على السؤال الأول
  a.send({ t: 'answer', questionId: q1.question.id, value: 'o0' });
  const ack = await a.next('answer:accepted');
  assert.equal(ack.correct, true);
  const feedback = await a.next((m) => m.t === 'state' && m.phase === 'feedback');
  assert.equal(feedback.index, 0, 'يبقى على سؤاله حتى يضغط التالي');

  a.send({ t: 'next' });
  const q2 = await a.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 1);
  assert.equal(q2.question.text, 'س٢');

  const hostView = await host.next((m) => m.t === 'state' && m.participants.some((p) => p.at === 2));
  const amal = hostView.participants.find((p) => p.name === 'أمل');
  const badr = hostView.participants.find((p) => p.name === 'بدر');
  assert.equal(amal.at, 2, 'أمل على السؤال الثاني');
  assert.equal(badr.at, 1, 'بدر ما زال على الأول');

  // لا يمكن القفز قبل الإجابة
  b.send({ t: 'next' });
  await b.next('answer:rejected');

  // إنهاء المسار كاملاً ⇒ حالة «انتهى»
  a.send({ t: 'answer', questionId: q2.question.id, value: 'رائع' });
  await a.next('answer:accepted');
  a.send({ t: 'next' });
  const done = await a.next((m) => m.t === 'state' && m.phase === 'final');
  assert.ok(done.rank, 'يظهر ترتيبه عند الانتهاء');
  assert.ok(Array.isArray(done.badges));

  host.close();
  a.close();
  b.close();
});

test('الوضع الحر: المتدرب يبدأ فور دخوله بلا انتظار المدرب', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'حر فوري',
    settings: { pace: 'self', autoStart: true, countdown: false },
    questions: [
      { type: 'mc', text: 'س١', timeLimit: 30, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'] },
      { type: 'mc', text: 'س٢', timeLimit: 30, options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'] },
    ],
  });

  // بلا أي مضيف متصل وبلا host:start
  const a = ws();
  await a.ready;
  a.send({ t: 'join', code: created.code, name: 'ريما' });
  await a.next('joined');
  const first = await a.next((m) => m.t === 'state' && m.phase === 'question');
  assert.equal(first.question.text, 'س١', 'يرى سؤاله مباشرة بلا انتظار');
  assert.ok(first.endsAt > Date.now(), 'مؤقّته الخاص يعمل');

  // ومن ينضم لاحقاً يبدأ فوراً كذلك بمؤقّته الخاص
  const b = ws();
  await b.ready;
  b.send({ t: 'join', code: created.code, name: 'سلمى' });
  await b.next('joined');
  const late = await b.next((m) => m.t === 'state' && m.phase === 'question');
  assert.equal(late.index, 0);
  assert.ok(late.endsAt > Date.now(), 'المنضم المتأخر يحصل على مؤقّت أيضاً');

  // وينتقل بنفسه
  a.send({ t: 'answer', questionId: first.question.id, value: 'o0' });
  await a.next('answer:accepted');
  a.send({ t: 'next' });
  const second = await a.next((m) => m.t === 'state' && m.index === 1 && m.phase === 'question');
  assert.equal(second.question.text, 'س٢');

  a.close();
  b.close();
});

test('الوضع الحر مع إطفاء البدء التلقائي ينتظر المدرب', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'حر بانتظار',
    settings: { pace: 'self', autoStart: false, countdown: false },
    questions: [{ type: 'word', text: 'س', timeLimit: 0 }],
  });
  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'فهد' });
  await p.next('joined');
  const lobby = await p.next((m) => m.t === 'state');
  assert.equal(lobby.phase, 'lobby', 'يبقى في القاعة حتى يبدأ المدرب');
  p.close();
});

test('احتساب النقاط: ثابتة، وبلا نقاط، ومضاعف السلاسل', async () => {
  async function runOnce(settings) {
    const { data } = await post('/api/sessions', {
      title: 'نقاط',
      settings: { countdown: false, ...settings },
      questions: [0, 1, 2].map((i) => ({
        type: 'mc',
        text: 'س' + i,
        timeLimit: 20,
        points: 1000,
        options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
        correct: ['o0'],
      })),
    });
    const host = ws();
    await host.ready;
    host.send({ t: 'host:hello', code: data.code, hostToken: data.hostToken });
    await host.next('state');
    const p = ws();
    await p.ready;
    p.send({ t: 'join', code: data.code, name: 'لينا' });
    await p.next('joined');
    host.send({ t: 'host:start' });

    const points = [];
    for (let i = 0; i < 3; i++) {
      const q = await p.next((m) => m.t === 'state' && m.phase === 'question' && m.index === i);
      p.send({ t: 'answer', questionId: q.question.id, value: 'o0' });
      const ack = await p.next('answer:accepted');
      points.push(ack.points);
      if (i < 2) host.send({ t: 'host:skip' });
    }
    host.close();
    p.close();
    return points;
  }

  // ثابتة بلا مضاعف: نفس القيمة رغم اختلاف السرعة
  const flat = await runOnce({ scoring: 'flat', streakBonus: false });
  assert.deepEqual(flat, [1000, 1000, 1000]);

  // بلا نقاط إطلاقاً
  const none = await runOnce({ scoring: 'none' });
  assert.deepEqual(none, [0, 0, 0]);

  // مضاعف السلاسل: ×1 ثم ×1.1 ثم ×1.2
  const streak = await runOnce({ scoring: 'flat', streakBonus: true });
  assert.deepEqual(streak, [1000, 1100, 1200]);
});

test('الأوسمة تُمنح حسب الأداء الفعلي', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'أوسمة',
    settings: { countdown: false, scoring: 'flat', streakBonus: false },
    questions: [0, 1, 2].map((i) => ({
      type: 'mc',
      text: 'س' + i,
      timeLimit: 20,
      points: 1000,
      options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
      correct: ['o0'],
    })),
  });

  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const a = ws();
  const b = ws();
  await Promise.all([a.ready, b.ready]);
  a.send({ t: 'join', code: created.code, name: 'نور' });
  b.send({ t: 'join', code: created.code, name: 'زيد' });
  await a.next('joined');
  await b.next('joined');
  host.send({ t: 'host:start' });

  for (let i = 0; i < 3; i++) {
    const q = await a.next((m) => m.t === 'state' && m.phase === 'question' && m.index === i);
    a.send({ t: 'answer', questionId: q.question.id, value: 'o0' }); // نور: كلها صحيحة وأسرع
    await a.next('answer:accepted');
    b.send({ t: 'answer', questionId: q.question.id, value: 'o1' }); // زيد: كلها خاطئة
    await b.next('answer:accepted');
    if (i < 2) host.send({ t: 'host:skip' });
  }

  host.send({ t: 'host:end' });
  const final = await a.next((m) => m.t === 'state' && m.status === 'ended');
  const labels = final.badges.map((badge) => badge.label);
  assert.ok(labels.includes('دقة كاملة'), 'أوسمة نور: ' + labels.join('، '));
  assert.ok(labels.includes('أطول سلسلة (3)'), 'أوسمة نور: ' + labels.join('، '));

  const zaid = await b.next((m) => m.t === 'state' && m.status === 'ended');
  assert.ok(!zaid.badges.some((badge) => badge.label === 'دقة كاملة'), 'زيد لا يستحق وسام الدقة');

  host.close();
  a.close();
  b.close();
});

test('الشرح والإجابة الصحيحة: تُكشف بعد الإجابة فقط، وتحترم إعداد المدرب', async () => {
  const questions = [
    {
      type: 'mc',
      text: 'ما هي عاصمة الأردن؟',
      explanation: 'عمّان هي العاصمة منذ ١٩٢١.',
      timeLimit: 0,
      points: 750, // علامة حرة يضعها المدرب
      options: [{ id: 'o0', text: 'عمّان' }, { id: 'o1', text: 'دمشق' }],
      correct: ['o0'],
    },
  ];

  // (أ) الكشف مفعّل
  const { data: on } = await post('/api/sessions', { title: 'مع كشف', settings: { revealAnswer: true, countdown: false }, questions });
  let host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: on.code, hostToken: on.hostToken });
  await host.next('state');
  let p = ws();
  await p.ready;
  p.send({ t: 'join', code: on.code, name: 'هدى' });
  await p.next('joined');
  host.send({ t: 'host:start' });

  const before = await p.next((m) => m.t === 'state' && m.phase === 'question');
  assert.equal(before.question.explanation, '', 'الشرح لا يُرسل قبل الإجابة');
  assert.ok(before.question.options.every((o) => o.correct === undefined), 'الإجابة الصحيحة مخفية قبل الإجابة');

  p.send({ t: 'answer', questionId: before.question.id, value: 'o1' }); // إجابة خاطئة
  const ack = await p.next('answer:accepted');
  assert.equal(ack.correct, false);

  const after = await p.next((m) => m.t === 'state' && m.answered);
  assert.equal(after.question.explanation, 'عمّان هي العاصمة منذ ١٩٢١.', 'الشرح يظهر بعد الإجابة');
  assert.equal(after.question.options.find((o) => o.id === 'o0').correct, true, 'تظهر الإجابة الصحيحة');
  host.close();
  p.close();

  // (ب) الكشف مُطفأ
  const { data: off } = await post('/api/sessions', { title: 'بلا كشف', settings: { revealAnswer: false, countdown: false }, questions });
  host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: off.code, hostToken: off.hostToken });
  await host.next('state');
  p = ws();
  await p.ready;
  p.send({ t: 'join', code: off.code, name: 'سعد' });
  await p.next('joined');
  host.send({ t: 'host:start' });
  const q = await p.next((m) => m.t === 'state' && m.phase === 'question');
  p.send({ t: 'answer', questionId: q.question.id, value: 'o1' });
  await p.next('answer:accepted');
  const still = await p.next((m) => m.t === 'state' && m.answered);
  assert.equal(still.question.explanation, '', 'لا شرح عندما يُطفئ المدرب الخيار');
  assert.ok(still.question.options.every((o) => o.correct === undefined), 'تبقى الإجابة مخفية');

  // العلامة الحرة محفوظة كما وضعها المدرب
  host.send({ t: 'host:results' });
  const results = await host.next((m) => m.t === 'state' && m.phase === 'results');
  assert.equal(results.question.points, 750);

  host.close();
  p.close();
});

test('المشارك يستطيع الخروج فيُحذف من الجلسة', async () => {
  const { data: created } = await post('/api/sessions', QUIZ);
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  await host.next('state');

  const p = ws();
  await p.ready;
  p.send({ t: 'join', code: created.code, name: 'وليد' });
  await p.next('joined');
  await host.next((m) => m.t === 'state' && m.participants.length === 1);

  p.send({ t: 'leave' });
  const after = await host.next((m) => m.t === 'state' && m.participants.length === 0, 4000);
  assert.equal(after.participants.length, 0, 'يختفي من قائمة المدرب فور خروجه');

  host.close();
  p.close();
});

test('نبضة إبقاء الخادم مستيقظاً تعمل فقط عند وجود جلسات', async () => {
  const { pingOnce } = require('../server/keepalive');
  const store = require('../server/store');

  // نظّف أي جلسات سابقة حتى يكون العدّ صفراً
  for (const code of [...store.sessions.keys()]) store.deleteSession(code);
  assert.equal(await pingOnce(base, store), false, 'بلا جلسات: لا نبضة (حتى لا نستهلك ساعات الخطة المجانية)');

  const { data } = await post('/api/sessions', QUIZ);
  const before = await fetch(base + '/api/health').then((r) => r.json());
  assert.equal(await pingOnce(base, store), true, 'مع وجود جلسة: تُرسل نبضة');

  // النبضة وصلت فعلاً إلى الخادم عبر HTTP
  const after = await fetch(base + '/api/health').then((r) => r.json());
  assert.ok(after.uptime >= before.uptime);
  assert.equal(after.config.sessionIdleMinutes, 180, 'الإعدادات مكشوفة للتشخيص');

  await fetch(`${base}/api/sessions/${data.code}?hostToken=${encodeURIComponent(data.hostToken)}`, { method: 'DELETE' });
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
