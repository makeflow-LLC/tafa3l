'use strict';

/**
 * سجلّ الطالب: نتائجه عبر الحصص حين يشغّل معلّمه السجل على فصله.
 *
 * ما تحرسه هذه الاختبارات مرّتين: أن الأصل لم يُمسّ. فصلٌ بلا سجل، أو
 * طالبٌ يدخل ضيفاً، أو جلسةٌ بلا فصل — كلّها تمرّ كما كانت ولا تكتب شيئاً.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-records-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const storage = require('../server/storage');
const records = require('../server/records');

let base;
const openSockets = new Set();

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
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
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------ أدوات

function client() {
  let cookie = '';
  return {
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
    async login(name) {
      const mail = `rec.${Math.random().toString(36).slice(2)}@example.com`;
      const original = global.fetch;
      global.fetch = async (url, opts) => {
        const u = String(url);
        if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
        if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
          return { ok: true, json: async () => ({ sub: 'g_' + mail, email: mail, email_verified: true, name }) };
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
        cookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
      } finally {
        global.fetch = original;
      }
    },
  };
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUESTIONS = [
  { type: 'mc', text: 'عاصمة الأردن؟', timeLimit: 0, points: 1000, options: [{ id: 'o0', text: 'عمّان' }, { id: 'o1', text: 'دمشق' }], correct: ['o0'] },
  { type: 'truefalse', text: 'الشمس نجم', timeLimit: 0, points: 1000, correct: ['true'] },
];

/** معلّم بفصلٍ مُسجَّل وطالبَين، وجلسة حرّة مرتبطة بالفصل */
async function classroom({ record = true, sessionSettings = {} } = {}) {
  const teacher = client();
  await teacher.login('أ. ريم');
  const made = await teacher.request('POST', '/api/classes', { name: 'السابع أ', students: 'سارة\nليان', record });
  assert.equal(made.status, 201);
  const cls = made.data.class;
  const session = await teacher.request('POST', '/api/sessions', {
    title: 'اختبار الوحدة',
    settings: { pace: 'self', autoStart: true, countdown: false, roster: cls.students, recordClassId: cls.id, ...sessionSettings },
    questions: QUESTIONS,
  });
  assert.equal(session.status, 201);
  return { teacher, cls, code: session.data.code, hostToken: session.data.hostToken };
}

/** طالبٌ يدخل ويجيب عن السؤالين ويُنهي */
async function play(code, name, pin, answers = ['o0', 'true']) {
  const s = ws();
  await s.ready;
  s.send({ t: 'join', code, name, pin });
  const joined = await s.next((m) => m.t === 'joined' || m.t === 'error');
  if (joined.t === 'error') return { error: joined, socket: s };
  for (const value of answers) {
    const q = await s.next((m) => m.t === 'state' && m.phase === 'question');
    s.send({ t: 'answer', questionId: q.question.id, value });
    await s.next('answer:accepted');
    s.send({ t: 'next' });
  }
  await s.next((m) => m.t === 'state' && m.phase === 'final');
  return { joined, socket: s };
}

// ------------------------------------------------------------------ الوحدة

test('مواءمة الملفّات: الاسم الباقي يحتفظ بمعرّفه ورمزه، والجديد يأخذ جديداً، والرموز لا تتكرّر', () => {
  const first = records.syncPupils(['سارة', 'ليان']);
  assert.equal(first.length, 2);
  assert.match(first[0].pin, /^[1-9]\d{3}$/);
  assert.notEqual(first[0].pin, first[1].pin);
  const again = records.syncPupils(['ليان', 'كريم', 'سارة'], first);
  assert.equal(again.find((p) => p.name === 'سارة').id, first[0].id);
  assert.equal(again.find((p) => p.name === 'سارة').pin, first[0].pin);
  assert.ok(again.find((p) => p.name === 'كريم').id.startsWith('st_'));
  assert.equal(new Set(again.map((p) => p.pin)).size, 3);
});

test('الفصل بلا سجل لا ملفّات له، وتشغيله يُنشئها بلا أن يمسّ الأسماء', async () => {
  const teacher = client();
  await teacher.login('أ. سامي');
  const made = await teacher.request('POST', '/api/classes', { name: 'صف', students: 'سارة\nليان' });
  assert.equal(made.data.class.record, false);
  assert.deepEqual(made.data.class.pupils, []);
  assert.deepEqual(made.data.class.students, ['سارة', 'ليان']);

  const on = await teacher.request('PUT', '/api/classes/' + made.data.class.id, { record: true });
  assert.equal(on.data.class.record, true);
  assert.equal(on.data.class.pupils.length, 2);
  assert.deepEqual(on.data.class.students, ['سارة', 'ليان'], 'الكشف كما هو');
  assert.equal(on.data.class.pupils[0].key, undefined, 'مفتاح الطالب السرّي لا يغادر الخادم');

  // القائمة كذلك تُخفي المفتاح
  const list = await teacher.request('GET', '/api/classes');
  assert.equal(list.data.classes[0].pupils[0].key, undefined);
});

// ------------------------------------------------------------------ الدخول

test('الاسم من الكشف يحتاج رمزه: الخطأ يُرفض برمز pin، والصواب يدخل ويحمل رمز صفحته', async () => {
  const { cls, code } = await classroom();
  const sara = cls.pupils.find((p) => p.name === 'سارة');

  const wrong = await play(code, 'سارة', '0000');
  assert.equal(wrong.error?.code, 'pin');
  wrong.socket.close();

  const right = await play(code, 'سارة', sara.pin);
  assert.ok(right.joined.recordToken, 'رمز صفحة «سجلّي»');
  assert.ok(right.joined.recordToken.startsWith(cls.id + '.'));
  right.socket.close();
});

test('الاسم غير الموجود في الكشف يدخل ضيفاً بلا رمز ولا يُكتب له سجل', async () => {
  const { teacher, cls, code } = await classroom();
  const guest = await play(code, 'زائر');
  assert.equal(guest.joined.recordToken, undefined);
  guest.socket.close();
  await sleep(300);
  const rec = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  assert.equal(rec.data.sessions.length, 0, 'لا سطر للضيف');
});

test('فصلٌ بلا سجل مرتبطٌ بالجلسة: الدخول كما كان — بلا رمز، ولا يُكتب شيء', async () => {
  const { teacher, cls, code } = await classroom({ record: false });
  const info = await (await fetch(base + '/api/sessions/' + code)).json();
  assert.equal(info.record, false);
  const sara = await play(code, 'سارة');
  assert.equal(sara.joined.recordToken, undefined);
  sara.socket.close();
  await sleep(300);
  const rec = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  assert.equal(rec.data.students.length, 0);
  assert.equal(rec.data.sessions.length, 0);
});

// ------------------------------------------------------------------ الكتابة

test('الوضع الحرّ: من يُنهي تُكتب نتيجته فوراً، بملخّصٍ للفصل وملفٍّ للطالب يحمل أخطاءه', async () => {
  const { teacher, cls, code } = await classroom();
  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const layan = cls.pupils.find((p) => p.name === 'ليان');
  const info = await (await fetch(base + '/api/sessions/' + code)).json();
  assert.equal(info.record, true, 'صفحة الدخول تعرف أن الرمز مطلوب');

  const a = await play(code, 'سارة', sara.pin, ['o0', 'true']);
  const b = await play(code, 'ليان', layan.pin, ['o1', 'false']);
  await sleep(400);

  const summary = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  assert.equal(summary.status, 200);
  assert.equal(summary.data.class.record, true);
  assert.equal(summary.data.sessions.length, 1);
  assert.equal(summary.data.sessions[0].code, code);
  const rowSara = summary.data.students.find((s) => s.id === sara.id);
  const rowLayan = summary.data.students.find((s) => s.id === layan.id);
  assert.equal(rowSara.attempts, 1);
  assert.equal(rowSara.avgPercent, 100);
  assert.equal(rowSara.pin, sara.pin, 'المعلّم يرى الرمز ليُعطيه للطالب');
  assert.equal(rowLayan.avgPercent, 0);
  assert.deepEqual(rowLayan.trend, [0]);
  assert.equal(summary.data.avgPercent, 50);

  const file = await teacher.request('GET', `/api/classes/${cls.id}/record/${layan.id}`);
  assert.equal(file.data.records.length, 1);
  assert.equal(file.data.records[0].wrong, 2);
  assert.equal(file.data.records[0].items.length, 2, 'الأخطاء وحدها تُحفظ لا كل الأسئلة');
  assert.equal(file.data.records[0].items[0].right, 'عمّان');
  assert.equal(file.data.weak[0].times, 1);
  const fileSara = await teacher.request('GET', `/api/classes/${cls.id}/record/${sara.id}`);
  assert.equal(fileSara.data.records[0].items.length, 0, 'الإجابات الصحيحة لا تُفصَّل');

  a.socket.close();
  b.socket.close();
});

test('إنهاء المعلّم الجلسة يكتب سطراً واحداً لكل طالب مهما تكرّر، ولا يكتب لجلسةٍ بلا فصل', async () => {
  const { teacher, cls, code, hostToken } = await classroom({ sessionSettings: { pace: 'host' } });
  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const host = ws();
  await host.ready;
  host.send({ t: 'host:hello', code, hostToken });
  await host.next('state');
  const s = ws();
  await s.ready;
  s.send({ t: 'join', code, name: 'سارة', pin: sara.pin });
  await s.next('joined');
  host.send({ t: 'host:start' });
  const q = await s.next((m) => m.t === 'state' && m.phase === 'question');
  s.send({ t: 'answer', questionId: q.question.id, value: 'o0' });
  await s.next('answer:accepted');
  host.send({ t: 'host:end' });
  await s.next((m) => m.t === 'state' && (m.phase === 'final' || m.status === 'ended'));
  await sleep(400);

  const summary = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  const row = summary.data.students.find((x) => x.id === sara.id);
  assert.equal(row.attempts, 1);
  assert.equal(row.avgPercent, 50, 'أجابت عن سؤالٍ من اثنين');

  // جلسة ثانية بلا فصل: لا تكتب شيئاً ولو دخل الاسم نفسه
  const plain = await teacher.request('POST', '/api/sessions', { title: 'بلا فصل', settings: { pace: 'self', autoStart: true, countdown: false }, questions: QUESTIONS });
  const g = await play(plain.data.code, 'سارة');
  assert.equal(g.joined.recordToken, undefined);
  await sleep(300);
  const after = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  assert.equal(after.data.students.find((x) => x.id === sara.id).attempts, 1);
  host.close();
  s.close();
  g.socket.close();
});

test('السجل يصمد بعد إعادة قراءة التخزين من القرص', async () => {
  const { teacher, cls, code } = await classroom();
  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const a = await play(code, 'سارة', sara.pin);
  a.socket.close();
  await sleep(500);
  await storage.init();
  const rows = await storage.get().listRecords(cls.id, sara.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, code);
  const again = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  assert.equal(again.data.students.find((x) => x.id === sara.id).attempts, 1);
});

// ------------------------------------------------------------------ الطالب

test('صفحة الطالب «سجلّي» برمزه: محاولاته وأخطاؤه بحدود ما سمح به المعلّم، والرمز المزوّر يُرفض', async () => {
  const { cls, code } = await classroom();
  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const a = await play(code, 'سارة', sara.pin, ['o1', 'true']);
  a.socket.close();
  await sleep(300);

  const me = await (await fetch(base + '/api/record/me?token=' + encodeURIComponent(a.joined.recordToken))).json();
  assert.equal(me.name, 'سارة');
  assert.equal(me.className, 'السابع أ');
  assert.equal(me.records.length, 1);
  assert.equal(me.records[0].percent, 50);
  assert.equal(me.records[0].items.length, 1);
  assert.equal(me.records[0].items[0].right, 'عمّان');

  const forged = await fetch(base + '/api/record/me?token=' + encodeURIComponent(cls.id + '.' + sara.id + '.xxxxxxxxxxxxxxxx'));
  assert.equal(forged.status, 404);
  assert.equal((await fetch(base + '/api/record/me?token=abc')).status, 404);
});

test('revealAnswer مطفأ: صفحة الطالب بلا أخطاء مفصّلة، والمعلّم يراها كاملة', async () => {
  const { teacher, cls, code } = await classroom({ sessionSettings: { revealAnswer: false, showScore: false } });
  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const a = await play(code, 'سارة', sara.pin, ['o1', 'false']);
  a.socket.close();
  await sleep(300);
  const me = await (await fetch(base + '/api/record/me?token=' + encodeURIComponent(a.joined.recordToken))).json();
  assert.deepEqual(me.records[0].items, []);
  assert.equal(me.records[0].percent, null);
  const file = await teacher.request('GET', `/api/classes/${cls.id}/record/${sara.id}`);
  assert.equal(file.data.records[0].items.length, 2);
  assert.equal(file.data.records[0].percent, 0);
});

// ------------------------------------------------------------------ الإدارة

test('تجديد الرمز يُبطل القديم، وحذف سجلّ الطالب أو الفصل قرارٌ صريح، وكلّه معزولٌ عن معلّمٍ آخر', async () => {
  const { teacher, cls, code } = await classroom();
  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const a = await play(code, 'سارة', sara.pin);
  a.socket.close();
  await sleep(300);

  const other = client();
  await other.login('أ. وفاء');
  assert.equal((await other.request('GET', '/api/classes/' + cls.id + '/record')).status, 404);
  assert.equal((await other.request('DELETE', '/api/classes/' + cls.id + '/record')).status, 404);
  assert.equal((await other.request('POST', `/api/classes/${cls.id}/record/${sara.id}/pin`)).status, 404);

  const renewed = await teacher.request('POST', `/api/classes/${cls.id}/record/${sara.id}/pin`);
  assert.equal(renewed.status, 200);
  assert.notEqual(renewed.data.student.pin, sara.pin);
  const second = await teacher.request('POST', '/api/sessions', {
    title: 'ثانية',
    settings: { pace: 'self', autoStart: true, countdown: false, roster: cls.students, recordClassId: cls.id },
    questions: QUESTIONS,
  });
  const old = await play(second.data.code, 'سارة', sara.pin);
  assert.equal(old.error?.code, 'pin', 'الرمز القديم لم يعد يفتح الملف');
  old.socket.close();

  assert.equal((await teacher.request('DELETE', `/api/classes/${cls.id}/record/${sara.id}`)).status, 200);
  const after = await teacher.request('GET', '/api/classes/' + cls.id + '/record');
  assert.equal(after.data.students.find((x) => x.id === sara.id).attempts, 0);
  assert.equal(after.data.students.length, 2, 'الملفّ باقٍ وإن مُحي سجلّه');

  assert.equal((await teacher.request('DELETE', '/api/classes/' + cls.id)).status, 200);
  assert.equal((await storage.get().listRecords(cls.id)).length, 0, 'حذف الفصل يمحو سجلّه');
});

test('معرّف فصلٍ مشوّه في إعدادات الجلسة يُهمَل، ولا يُقبل إلا بصيغة cl_', async () => {
  const teacher = client();
  await teacher.login('أ. منى');
  const made = await teacher.request('POST', '/api/sessions', {
    title: 'x',
    settings: { pace: 'self', recordClassId: '../etc' },
    questions: QUESTIONS,
  });
  const info = await (await fetch(base + '/api/sessions/' + made.data.code)).json();
  assert.equal(info.record, false);
});
