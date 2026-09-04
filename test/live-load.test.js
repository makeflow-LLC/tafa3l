'use strict';

/**
 * ما يصل جهاز المعلّم في حصةٍ مزدحمة.
 *
 * لوحة الإحصاءات أثقل ما ترسله الجلسة بمراتب — أربعون كيلوبايت لصفٍّ من
 * ستين في عشرة أسئلة — وكانت تُبَثّ إلى كل مضيفٍ وكل شاشة عرضٍ مع كل دفعة
 * إجابات، بينما الواجهة تتجاهلها ما لم يكن المعلّم في تبويب «لوحة التحكم».
 * فصار بثّها بطلب. وهذه الاختبارات تحرس العقد الجديد.
 */

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

process.env.PORT = '0';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tafa3l-load-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
const { server, ready } = require('../server/index');

let base;
let hostCookie = '';
const openSockets = new Set();

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
  const original = global.fetch;
  const mail = `load.${Date.now()}@example.com`;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo'))
      return { ok: true, json: async () => ({ sub: 'g_' + mail, email: mail, email_verified: true, name: 'مدرب' }) };
    return original(url, opts);
  };
  try {
    const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
    const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cb = await fetch(`${base}/api/auth/google/callback?code=x&state=${state}`, { redirect: 'manual', headers: { Cookie: stateCookie.split(';')[0] } });
    hostCookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
  } finally {
    global.fetch = original;
  }
});

test.after(() => {
  for (const s of openSockets) {
    try {
      s.terminate();
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
  const seen = { dashboard: 0, state: 0, bytes: 0 };
  socket.on('message', (raw) => {
    seen.bytes += raw.length;
    const msg = JSON.parse(String(raw));
    if (msg.t === 'pong') return;
    if (msg.t === 'dashboard') seen.dashboard += 1;
    if (msg.t === 'state') seen.state += 1;
    const w = waiters.findIndex((x) => x.match(msg));
    if (w >= 0) waiters.splice(w, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  return {
    seen,
    ready: new Promise((res, rej) => {
      socket.once('open', res);
      socket.once('error', rej);
    }),
    send: (m) => socket.send(JSON.stringify(m)),
    next(match, timeout = 4000) {
      const fn = typeof match === 'string' ? (m) => m.t === match : match;
      const at = queue.findIndex(fn);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match: fn, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error('انتهت مهلة انتظار'));
          }
        }, timeout);
      });
    },
    close: () => socket.close(),
  };
}

const QUESTIONS = Array.from({ length: 6 }, (_, i) => ({
  type: 'mc',
  text: `سؤال ${i + 1}`,
  points: 1000,
  timeLimit: 0,
  options: [
    { id: 'o0', text: 'أ' },
    { id: 'o1', text: 'ب' },
  ],
  correct: ['o0'],
}));

async function launch(pace) {
  const r = await fetch(base + '/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: hostCookie },
    body: JSON.stringify({ title: 'حصة', settings: { pace, countdown: false, autoStart: true }, questions: QUESTIONS }),
  });
  return r.json();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('وضع المدرّب: اللوحة لا تُبَثّ إلا لمن طلبها', async () => {
  const created = await launch('host');
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  const hs = await host.next('state');

  const students = [];
  for (let i = 0; i < 8; i += 1) {
    const s = ws();
    await s.ready;
    s.send({ t: 'join', code: created.code, name: `طالب ${i + 1}` });
    await s.next('joined');
    students.push(s);
  }
  host.send({ t: 'host:start' });
  await students[0].next((m) => m.t === 'state' && m.phase === 'question');

  const before = host.seen.dashboard;
  const qid = hs.questions[0].id;
  students.forEach((s) => s.send({ t: 'answer', questionId: qid, value: 'o0' }));
  await wait(600);

  assert.equal(host.seen.dashboard, before, 'لا لوحة لمن لم يطلبها');
  assert.ok(host.seen.state > 0, 'لكن الحالة تصل — عليها يُبنى عدّ من أجاب');

  // يفتح تبويب اللوحة: تصله فوراً، ثم تتابعه مع الإجابات
  host.send({ t: 'host:dashboard' });
  const dash = await host.next('dashboard');
  assert.ok(Array.isArray(dash.data.perQuestion), 'اللوحة تصل فور طلبها');

  const afterOpen = host.seen.dashboard;
  // «السؤال التالي» في الواجهة هو host:skip — يقفز من النتائج إلى السؤال التالي
  host.send({ t: 'host:skip' });
  await host.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 1);
  const qid2 = hs.questions[1].id;
  students.forEach((s) => s.send({ t: 'answer', questionId: qid2, value: 'o1' }));
  await wait(1400);
  assert.ok(host.seen.dashboard > afterOpen, 'وتستمر ما دام التبويب مفتوحاً');

  // يخرج من التبويب: تتوقّف
  host.send({ t: 'host:dashboard:off' });
  await wait(200);
  const afterOff = host.seen.dashboard;
  host.send({ t: 'host:skip' });
  await host.next((m) => m.t === 'state' && m.phase === 'question' && m.index === 2);
  const qid3 = hs.questions[2].id;
  students.forEach((s) => s.send({ t: 'answer', questionId: qid3, value: 'o0' }));
  await wait(1400);
  assert.equal(host.seen.dashboard, afterOff, 'ومن أغلق التبويب لا تلاحقه');

  host.close();
  students.forEach((s) => s.close());
});

test('الوضع الحرّ: اللوحة تصل بلا طلب — مسرحه مرسومٌ منها', async () => {
  const created = await launch('self');
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  const hs = await host.next('state');

  const s = ws();
  await s.ready;
  s.send({ t: 'join', code: created.code, name: 'ليان' });
  await s.next('joined');
  s.send({ t: 'answer', questionId: hs.questions[0].id, value: 'o0' });
  await s.next('answer:accepted');

  const dash = await host.next('dashboard');
  assert.ok(dash.data.perQuestion.length, 'الوضع الحرّ لا ينتظر طلباً');
  host.close();
  s.close();
});

test('اللوحة تُخنق إلى مرّةٍ كل تسعمئة جزء من الثانية مهما تدفّقت الإجابات', async () => {
  const created = await launch('host');
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code: created.code, hostToken: created.hostToken });
  const hs = await host.next('state');
  host.send({ t: 'host:dashboard' });
  await host.next('dashboard');

  const students = [];
  for (let i = 0; i < 12; i += 1) {
    const c = ws();
    await c.ready;
    c.send({ t: 'join', code: created.code, name: `طالب ${i + 1}` });
    await c.next('joined');
    students.push(c);
  }
  host.send({ t: 'host:start' });
  await students[0].next((m) => m.t === 'state' && m.phase === 'question');

  const before = host.seen.dashboard;
  const qid = hs.questions[0].id;
  // اثنتا عشرة إجابة على دفعات خلال ثانية ونصف
  for (const c of students) {
    c.send({ t: 'answer', questionId: qid, value: 'o0' });
    await wait(120);
  }
  await wait(300);
  const sent = host.seen.dashboard - before;
  assert.ok(sent <= 3, `لوحات مرسلة ${sent} — الخنق لا يعمل`);
  assert.ok(sent >= 1, 'ومع ذلك تصل التحديثات');

  host.close();
  students.forEach((c) => c.close());
});
