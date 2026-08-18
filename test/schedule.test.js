'use strict';

/**
 * اختبار جدولة النشاط: يفتح في موعده تلقائياً، ويُقفل بعد انتهاء مدته،
 * ويبقى محفوظاً حتى يحين موعده.
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
// إنشاء الجلسة صار يتطلّب حساباً، والحساب يحتاج جوجل مهيّأة (مزيّفة هنا)
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
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

let hostCookie = '';

/** إنشاء الجلسة يتطلّب حساباً — كوكي مدرب واحد يكفي لهذا الملف */
async function loginHost() {
  const original = global.fetch;
  const mail = `sched.${Date.now()}@example.com`;
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

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(hostCookie ? { Cookie: hostCookie } : {}) },
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

test('نشاطٌ حرٌّ مجدول لا يبدأ بدخول طالبٍ مبكّر — الموعد موعد', () => {
  // كان «البدء التلقائي» يتجاهل الموعد فيُسقط الجدولة كلها: معلّم يضبط
  // «يفتح الأحد التاسعة» ويوزّع الرابط الخميس، فيفتحه أولُ فضوليٍّ ليلتها.
  const session = store.createSession({
    title: 'مجدول حرّ',
    settings: { pace: 'self', autoStart: true, opensAt: Date.now() + 3600000 },
    questions: QUESTIONS,
  });
  const early = session.addParticipant({ name: 'فضولي' });
  assert.equal(session.status, 'lobby', 'بقي في القاعة رغم البدء التلقائي');
  // `phase` يبدأ 'question' في البناء، فالدليل الحقيقي أن سؤالاً لم يُفتح بعد
  assert.equal(early.openedAt, null, 'ولم يُفتح له سؤال');

  // ثم يحين الموعد فيبدأ للجميع، ومن كان ينتظر يُفتح له فوراً
  session.settings.opensAt = Date.now() - 1000;
  session.start();
  assert.equal(session.status, 'live');
  assert.ok(early.openedAt, 'ومن انتظر يُفتح له عند الفتح');
  store.deleteSession(session.code);
});

test('والبدء المبكّر يبقى حقّ المعلّم وحده', () => {
  const session = store.createSession({
    title: 'مجدول حرّ',
    settings: { pace: 'self', autoStart: true, opensAt: Date.now() + 3600000 },
    questions: QUESTIONS,
  });
  session.start(); // المعلّم يضغط «بدء النشاط»
  assert.equal(session.status, 'live');
  const p = session.addParticipant({ name: 'ليان' });
  assert.ok(p.openedAt, 'ومن دخل بعد البدء يجد سؤاله مفتوحاً');
  store.deleteSession(session.code);
});

// ------------------------------------------------- الواجب: موعد التسليم
//
// «مدة الاختبار» مهلةٌ نسبية تبدأ من انطلاق الجلسة — تصلح لحصةٍ في قاعة.
// و«موعد التسليم» موعدٌ مطلق لا علاقة له بمتى فتح أولُ طالبٍ الرابط، وهو
// ما يعنيه المعلّم بـ«سلّموا قبل الأحد». والفرق يظهر في ثلاثة سلوكيات.

test('موعد التسليم يُقبل المستقبلي ويُرفض الماضي والبعيد جداً', () => {
  const soon = Date.now() + 3 * 86400000;
  assert.equal(normalizeQuiz({ settings: { dueAt: soon }, questions: QUESTIONS }).settings.dueAt, soon);
  assert.equal(normalizeQuiz({ settings: { dueAt: new Date(soon).toISOString() }, questions: QUESTIONS }).settings.dueAt, soon);
  assert.equal(normalizeQuiz({ settings: { dueAt: Date.now() - 3600000 }, questions: QUESTIONS }).settings.dueAt, null);
  assert.equal(normalizeQuiz({ settings: { dueAt: 'الأحد' }, questions: QUESTIONS }).settings.dueAt, null);
  assert.equal(normalizeQuiz({ settings: {}, questions: QUESTIONS }).settings.dueAt, null);
});

test('الواجب لا يمسحه المُنظِّف قبل موعد تسليمه مهما طال الخمول', () => {
  // هذه هي الحالة كلها: واجبٌ يُرسَل ليل الخميس ويُحلّ صباح السبت. ومهلة
  // الخمول ثلاث ساعات، فبلا هذا الاستثناء يموت الرابط قبل الفجر.
  const session = store.createSession({
    title: 'واجب نهاية الأسبوع',
    settings: { pace: 'self', dueAt: Date.now() + 3 * 86400000 },
    questions: QUESTIONS,
  });
  session.lastActivity = Date.now() - 25 * 60 * 60 * 1000;
  store.sweep();
  assert.ok(store.getSession(session.code), 'بقي حيّاً رغم يومٍ كامل من الخمول');

  session.settings.dueAt = null;
  store.sweep();
  assert.equal(store.getSession(session.code), null, 'وبلا موعد تسليم يُمسح كالمعتاد');
});

test('موعد التسليم يُقفل الواجب وحده وإن لم يمضِ من عمر الجلسة شيء', async () => {
  const { data: created } = await post('/api/sessions', {
    title: 'يُقفل بموعده',
    settings: { pace: 'self', requireName: true, countdown: false, autoStart: true, dueAt: Date.now() + 900 },
    questions: QUESTIONS,
  });
  const session = store.getSession(created.code);
  session.start();
  assert.equal(session.status, 'live');
  assert.equal(session.deadlineAt, session.settings.dueAt, 'الإقفال مضبوط على موعد التسليم لا على مدةٍ نسبية');

  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(session.status, 'ended', 'أُقفل في موعده وحده');
  store.deleteSession(created.code);
});

test('حين يجتمع الموعد والمدة يُقفل أقربهما', () => {
  const due = Date.now() + 10 * 60000;
  const session = store.createSession({
    title: 'الاثنان معاً',
    // ساعةٌ لكل طالب، على ألّا يتجاوز أحدٌ عشر دقائق من الآن
    settings: { pace: 'host', durationMinutes: 60, dueAt: due },
    questions: QUESTIONS,
  });
  session.start();
  assert.equal(session.deadlineAt, due, 'الموعد أقرب من المدة فهو الذي يحكم');
  store.deleteSession(session.code);

  const far = Date.now() + 10 * 86400000;
  const other = store.createSession({
    title: 'المدة أقرب',
    settings: { pace: 'host', durationMinutes: 30, dueAt: far },
    questions: QUESTIONS,
  });
  other.start();
  assert.ok(Math.abs(other.deadlineAt - (other.startedAt + 30 * 60000)) < 50, 'والمدة أقرب فهي التي تحكم');
  store.deleteSession(other.code);
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
