'use strict';

/**
 * الواجبات ونشاط المراجعة.
 *
 * ما تحرسه هذه الاختبارات: أن الواجب يعرف **من لم يسلّم** — وهو الفرق كلّه
 * بينه وبين رابطٍ يُرسل — وأن نتيجته هي نفسها التي في ملفّ الطالب لا نسخةٌ
 * ثانية تفترق عنها، وأن المراجعة تُبنى من أسئلة المعلّم لا من فراغ.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-homework-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const homework = require('../server/homework');
const review = require('../server/review');

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
      const mail = `hw.${Math.random().toString(36).slice(2)}@example.com`;
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

const QUESTIONS = [
  {
    type: 'mc',
    text: 'عاصمة الأردن؟',
    skill: 'عواصم',
    timeLimit: 0,
    points: 1000,
    options: [{ id: 'o0', text: 'عمّان' }, { id: 'o1', text: 'دمشق' }],
    correct: ['o0'],
  },
  { type: 'truefalse', text: 'الشمس نجم', timeLimit: 0, points: 1000, correct: ['true'] },
];

/** معلّم بفصلٍ مُسجَّل من ثلاث طالبات في مجموعتين، ونشاطٍ محفوظ */
async function teacherWithClass() {
  const teacher = client();
  await teacher.login('أ. ريم');
  const made = await teacher.request('POST', '/api/classes', {
    name: 'السابع أ',
    students: '# مجموعة الدعم\nسارة\nليان\n# مجموعة الإثراء\nهدى',
    record: true,
  });
  assert.equal(made.status, 201);
  const activity = await teacher.request('POST', '/api/activities', {
    title: 'اختبار الوحدة',
    settings: { pace: 'self', autoStart: true, countdown: false, timeMode: 'none' },
    questions: QUESTIONS,
  });
  assert.equal(activity.status, 201);
  return { teacher, cls: made.data.class, activityId: activity.data.activity.id };
}

/** طالبةٌ تدخل الواجب بملفّها وتجيب ثم تُنهي */
async function solve(code, name, pin, answers) {
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

test('التكليف: مجموعةٌ تُختار فيُكلَّف طلابها، وبلا اختيارٍ يُكلَّف الفصل كلّه', () => {
  const pupils = [
    { id: 'st_1', name: 'سارة', group: 'الدعم' },
    { id: 'st_2', name: 'ليان', group: 'الدعم' },
    { id: 'st_3', name: 'هدى', group: 'الإثراء' },
  ];
  assert.deepEqual(homework.pickStudents(pupils, { groups: ['الدعم'] }), ['st_1', 'st_2']);
  assert.deepEqual(homework.pickStudents(pupils, { studentIds: ['st_3'] }), ['st_3']);
  // مجموعةٌ وطالبٌ من غيرها: اتّحادٌ لا تقاطع
  assert.deepEqual(homework.pickStudents(pupils, { groups: ['الإثراء'], studentIds: ['st_1'] }), ['st_1', 'st_3']);
  assert.deepEqual(homework.pickStudents(pupils, {}), ['st_1', 'st_2', 'st_3']);
});

test('رموز الواجب: الحاليّ وما سبقه بلا تكرار — من سلّم قبل إعادة الفتح لا يُنسى', () => {
  assert.deepEqual(homework.codesOf({ code: '222222', codes: ['111111', '222222'] }), ['111111', '222222']);
  assert.deepEqual(homework.codesOf({ code: '333333' }), ['333333']);
  // رمزٌ غير صالح لا يمرّ إلى المقارنة
  assert.deepEqual(homework.codesOf({ code: 'x', codes: ['111111'] }), ['111111']);
});

test('المتابعة: من سلّم بنتيجته، ومن بدأ ولم يُنهِ، ومن لم يبدأ — والمتأخّر يُوسم', () => {
  const assignment = { code: '222222', codes: ['111111'], studentIds: ['st_1', 'st_2', 'st_3'], dueAt: 1000 };
  const pupils = [
    { id: 'st_1', name: 'سارة', group: 'الدعم' },
    { id: 'st_2', name: 'ليان', group: 'الدعم' },
    { id: 'st_3', name: 'هدى', group: 'الإثراء' },
    // طالبةٌ في الفصل لم تُكلَّف — لا تظهر في متابعة هذا الواجب
    { id: 'st_4', name: 'رنا', group: 'الإثراء' },
  ];
  const rows = [
    { code: '111111', studentId: 'st_1', at: 500, percent: 80, pending: 0 },
    { code: '222222', studentId: 'st_2', at: 1500, percent: 40, pending: 2 },
    // سطرٌ من نشاطٍ آخر على الفصل نفسه: ليس من هذا الواجب
    { code: '999999', studentId: 'st_3', at: 900, percent: 100, pending: 0 },
  ];
  const { rows: out, totals } = homework.progress({ assignment, pupils, records: rows, started: ['st_3'] });
  assert.equal(out.length, 3);
  assert.equal(out.find((r) => r.id === 'st_1').status, 'done');
  assert.equal(out.find((r) => r.id === 'st_1').late, false);
  assert.equal(out.find((r) => r.id === 'st_2').late, true);
  assert.equal(out.find((r) => r.id === 'st_3').status, 'started');
  assert.equal(totals.assigned, 3);
  assert.equal(totals.done, 2);
  assert.equal(totals.started, 1);
  assert.equal(totals.missing, 0);
  assert.equal(totals.pending, 2);
  assert.equal(totals.avgPercent, 60);
});

test('المتابعة: إعادة الفتح تُبقي آخر محاولةٍ هي المعروضة', () => {
  const assignment = { code: '222222', codes: ['111111'], studentIds: ['st_1'] };
  const pupils = [{ id: 'st_1', name: 'سارة' }];
  const rows = [
    { code: '111111', studentId: 'st_1', at: 100, percent: 30 },
    { code: '222222', studentId: 'st_1', at: 900, percent: 90 },
  ];
  const { rows: out } = homework.progress({ assignment, pupils, records: rows });
  assert.equal(out[0].percent, 90);
});

test('المراجعة: السؤال الذي أخطؤوا فيه أوّلاً، ثم سؤالٌ آخر على المهارة نفسها', () => {
  const rows = [
    { items: [{ text: 'عاصمة الأردن؟', skill: 'عواصم', ok: false }] },
    { items: [{ text: 'عاصمة الأردن؟', skill: 'عواصم', ok: false }] },
  ];
  const questions = [
    { id: 'q_a', type: 'mc', text: 'الشمس نجم', skill: 'فلك' },
    { id: 'q_b', type: 'mc', text: 'عاصمة مصر؟', skill: 'عواصم' },
    { id: 'q_c', type: 'mc', text: 'عاصمة الأردن؟', skill: 'عواصم' },
  ];
  const picked = review.pickReviewQuestions({ records: rows, questions });
  assert.equal(picked.questions.length, 2);
  assert.equal(picked.questions[0].text, 'عاصمة الأردن؟');
  assert.equal(picked.questions[1].text, 'عاصمة مصر؟');
  assert.equal(picked.direct, 1);
  assert.equal(picked.bySkill, 1);
  // بلا معرّفات: النشاط الجديد يولّدها فلا يصطدم سؤالان جاءا من نشاطين
  assert.ok(!('id' in picked.questions[0]));
  // سؤالٌ لا يقابل خطأً ولا مهارةً متعثّرة لا يدخل المراجعة
  assert.ok(!picked.questions.some((q) => q.text === 'الشمس نجم'));
});

test('المراجعة: بلا خطأٍ يقابله سؤالٌ عند المعلّم لا تُبنى مراجعة', () => {
  const picked = review.pickReviewQuestions({
    records: [{ items: [{ text: 'سؤالٌ من نشاطٍ محذوف', ok: false }] }],
    questions: [{ type: 'mc', text: 'سؤالٌ آخر لا علاقة له' }],
  });
  assert.equal(picked.questions.length, 0);
});

// ---------------------------------------------------------------- المسارات

test('الواجب: يُنشأ لمجموعةٍ، فيرى المعلّم من سلّم ومن لم يبدأ — والنتيجة في ملفّ الطالبة', async () => {
  const { teacher, cls, activityId } = await teacherWithClass();
  const made = await teacher.request('POST', '/api/assignments', {
    activityId,
    classId: cls.id,
    groups: ['مجموعة الدعم'],
    studentIds: cls.pupils.filter((p) => p.group === 'مجموعة الدعم').map((p) => p.id),
  });
  assert.equal(made.status, 201);
  const hw = made.data.assignment;
  assert.equal(hw.assigned, 2);
  assert.match(hw.code, /^\d{6}$/);

  const sara = cls.pupils.find((p) => p.name === 'سارة');
  const played = await solve(hw.code, 'سارة', sara.pin, ['o1', 'true']);
  assert.ok(!played.error, 'دخلت الطالبة بملفّها');
  played.socket.close();

  const view = await teacher.request('GET', '/api/assignments/' + hw.id);
  assert.equal(view.status, 200);
  assert.equal(view.data.totals.assigned, 2);
  assert.equal(view.data.totals.done, 1);
  assert.equal(view.data.totals.missing, 1);
  const row = view.data.students.find((r) => r.name === 'سارة');
  assert.equal(row.status, 'done');
  assert.equal(row.percent, 50);
  assert.equal(view.data.students.find((r) => r.name === 'ليان').status, 'none');
  // هدى في مجموعةٍ أخرى فليست في الواجب أصلاً
  assert.ok(!view.data.students.some((r) => r.name === 'هدى'));

  // النتيجة نفسها في ملفّ الطالبة — لا نسخةٌ ثانية تفترق عنها
  const file = await teacher.request('GET', `/api/classes/${cls.id}/record/${sara.id}`);
  assert.equal(file.data.records.length, 1);
  assert.equal(file.data.records[0].percent, 50);
  assert.equal(file.data.records[0].code, hw.code);

  // والقائمة تحمل المجاميع نفسها بلا فتح التفاصيل
  const list = await teacher.request('GET', '/api/assignments');
  assert.equal(list.data.assignments.length, 1);
  assert.equal(list.data.assignments[0].totals.done, 1);
  assert.equal(list.data.assignments[0].link, 'open');
});

test('الواجب: فصلٌ بلا سجلٍّ يُرفض بسببٍ مفهوم — النتيجة تُكتب في ملفّ الطالب', async () => {
  const teacher = client();
  await teacher.login('أ. سامي');
  const cls = (await teacher.request('POST', '/api/classes', { name: 'الثامن', students: 'زيد', record: false })).data.class;
  const activity = await teacher.request('POST', '/api/activities', { title: 'مراجعة', questions: QUESTIONS });
  const made = await teacher.request('POST', '/api/assignments', { activityId: activity.data.activity.id, classId: cls.id });
  assert.equal(made.status, 409);
  assert.match(made.data.error, /سجلّ الطلاب/);
});

test('الواجب: نشاطُ معلّمٍ آخر لا يُكلَّف به، وفصلُ غيره لا يُرى', async () => {
  const mine = await teacherWithClass();
  const other = await teacherWithClass();
  const cross = await mine.teacher.request('POST', '/api/assignments', { activityId: other.activityId, classId: mine.cls.id });
  assert.equal(cross.status, 404);
  const stolen = await other.teacher.request('POST', '/api/assignments', { activityId: other.activityId, classId: mine.cls.id });
  assert.equal(stolen.status, 404);
});

test('حذف الواجب: يُغلق رابطه ولا يمسّ سجلّ من سلّم', async () => {
  const { teacher, cls, activityId } = await teacherWithClass();
  const hw = (await teacher.request('POST', '/api/assignments', { activityId, classId: cls.id })).data.assignment;
  const hoda = cls.pupils.find((p) => p.name === 'هدى');
  const played = await solve(hw.code, 'هدى', hoda.pin, ['o0', 'true']);
  assert.ok(!played.error);
  played.socket.close();

  const gone = await teacher.request('DELETE', '/api/assignments/' + hw.id);
  assert.equal(gone.status, 200);
  assert.equal((await teacher.request('GET', '/api/assignments/' + hw.id)).status, 404);
  // الجلسة أُغلقت مع الواجب
  assert.equal((await teacher.request('GET', '/api/sessions/' + hw.code)).status, 404);
  // وسجلّ هدى باقٍ: السجل ملكُ الطالبة لا ملحقُ الواجب
  const file = await teacher.request('GET', `/api/classes/${cls.id}/record/${hoda.id}`);
  assert.equal(file.data.records.length, 1);
  assert.equal(file.data.records[0].percent, 100);
});

test('إعادة الفتح: جلسةٌ حيّة تُمدَّد بالرمز نفسه', async () => {
  const { teacher, cls, activityId } = await teacherWithClass();
  const hw = (await teacher.request('POST', '/api/assignments', { activityId, classId: cls.id })).data.assignment;
  const due = Date.now() + 3 * 86400000;
  const again = await teacher.request('POST', `/api/assignments/${hw.id}/reopen`, { dueAt: due });
  assert.equal(again.status, 200);
  assert.equal(again.data.assignment.code, hw.code);
  assert.equal(again.data.assignment.dueAt, due);
  assert.equal(again.data.link, 'open');
});

test('نشاط المراجعة: يُبنى من السؤال الذي أخطأت فيه الطالبة ويُحفظ نشاطاً', async () => {
  const { teacher, cls, activityId } = await teacherWithClass();
  const hw = (await teacher.request('POST', '/api/assignments', { activityId, classId: cls.id })).data.assignment;
  const lian = cls.pupils.find((p) => p.name === 'ليان');
  const played = await solve(hw.code, 'ليان', lian.pin, ['o1', 'true']);
  assert.ok(!played.error);
  played.socket.close();

  const built = await teacher.request('POST', `/api/classes/${cls.id}/review`, { studentId: lian.id });
  assert.equal(built.status, 201);
  assert.equal(built.data.activity.questionCount, 1);
  assert.match(built.data.activity.title, /ليان/);
  const opened = await teacher.request('GET', '/api/activities/' + built.data.activity.id);
  assert.equal(opened.data.activity.questions[0].text, 'عاصمة الأردن؟');
  // نشاطٌ محفوظ لا جلسة: القرار الأخير للمعلّم
  assert.equal(opened.data.activity.settings.pace, 'self');
});

test('نشاط المراجعة: بلا سجلٍّ للنطاق لا تُبنى، وتقول لماذا', async () => {
  const { teacher, cls } = await teacherWithClass();
  const built = await teacher.request('POST', `/api/classes/${cls.id}/review`, {});
  assert.equal(built.status, 409);
  assert.match(built.data.error, /سجلّ/);
});
