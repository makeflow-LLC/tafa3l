'use strict';

/**
 * وسم المهارة أو الهدف — **اختياريّ بالكامل**، وأثرُه في ثلاثة أماكن:
 * تقريرِ الجلسة (الأداء حسب المهارة)، وسجلِّ الطالب (مهارات تحتاج دعماً)،
 * وقائمةِ اقتراحٍ في المحرّر من وسوم المعلّم السابقة.
 *
 * وما تحرسه هذه الاختبارات أولاً: أن السؤال بلا وسمٍ يمرّ كما كان.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-skills-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const { normalizeQuiz, Session, publicQuestion } = require('../server/session');
const records = require('../server/records');

let base;

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

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
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    async login(name) {
      const mail = `sk.${Math.random().toString(36).slice(2)}@example.com`;
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

const QUESTIONS = [
  { type: 'mc', text: '١/٢ + ١/٤؟', skill: 'جمع الكسور', options: [{ id: 'o0', text: '٣/٤' }, { id: 'o1', text: '٢/٦' }], correct: ['o0'], points: 100 },
  { type: 'mc', text: '١/٣ + ١/٦؟', skill: 'جمع الكسور', options: [{ id: 'o0', text: '١/٢' }, { id: 'o1', text: '٢/٩' }], correct: ['o0'], points: 100 },
  { type: 'mc', text: 'أكبر قاسم لـ ١٨ و٢٤؟', skill: 'القواسم', options: [{ id: 'o0', text: '٦' }, { id: 'o1', text: '٣' }], correct: ['o0'], points: 100 },
  { type: 'mc', text: 'سؤال بلا وسم', options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'], points: 100 },
];

// ------------------------------------------------------------------ النموذج

test('الوسم اختياري: يُقبل ويُقصّ عند الحدّ، وغيابه لا يغيّر شيئاً', () => {
  const quiz = normalizeQuiz({
    questions: [
      { type: 'mc', text: 'س', skill: '  جمع الكسور  ', options: ['أ', 'ب'], correct: ['أ'] },
      { type: 'mc', text: 'س٢', options: ['أ', 'ب'], correct: ['أ'] },
      { type: 'mc', text: 'س٣', skill: 'م'.repeat(120), options: ['أ', 'ب'], correct: ['أ'] },
    ],
  });
  assert.equal(quiz.questions[0].skill, 'جمع الكسور');
  assert.equal(quiz.questions[1].skill, '', 'بلا وسم = نصٌّ فارغ لا undefined');
  assert.equal(quiz.questions[2].skill.length, 60, 'يُقصّ عند ٦٠ حرفاً');
});

test('الوسم يصل الطالب مع السؤال ومع المراجعة — وهو ليس مفتاح إجابة', () => {
  const quiz = normalizeQuiz({ questions: QUESTIONS, settings: { pace: 'host' } });
  const pub = publicQuestion(quiz.questions[0], false, '123456', null, 0);
  assert.equal(pub.skill, 'جمع الكسور');
  assert.equal(pub.explanation, '', 'ولا يكشف الشرح معه');

  const session = new Session('654321', { questions: QUESTIONS });
  const p = session.addParticipant({ name: 'سارة' });
  const review = session.reviewFor(p);
  assert.equal(review[0].skill, 'جمع الكسور');
  assert.equal(review[3].skill, '');
});

test('تقرير الجلسة يحمل وسم كل سؤال، ولوحة المتابعة كذلك', () => {
  const session = new Session('111111', { questions: QUESTIONS });
  const report = session.export();
  assert.deepEqual(report.questions.map((q) => q.skill), ['جمع الكسور', 'جمع الكسور', 'القواسم', '']);
  assert.equal(session.dashboard().perQuestion[0].skill, 'جمع الكسور');
});

// ------------------------------------------------------------ سجلّ الطالب

test('سجلّ الطالب: الخطأ يحمل مهارته، والمهارات المتعثّرة تُجمع وتُرتَّب', () => {
  const rows = [
    {
      items: [
        { text: 'س١', skill: 'جمع الكسور', ok: false },
        { text: 'س٢', skill: 'القواسم', ok: false },
        { text: 'س٣', skill: '', ok: false },
      ],
    },
    {
      items: [
        { text: 'س٤', skill: 'جمع الكسور', ok: false },
        { text: 'س٥', skill: 'جمع الكسور', ok: 'partial' },
        { text: 'س٦', skill: 'القواسم', ok: null },
      ],
    },
  ];
  const weak = records.weakSkills(rows);
  assert.deepEqual(weak, [
    { skill: 'جمع الكسور', misses: 3 },
    { skill: 'القواسم', misses: 1 },
  ]);
  assert.ok(!weak.some((w) => w.skill === ''), 'السؤال بلا وسم لا يُخترَع له وسم');
});

test('سجلّ الفصل يعيد المهارات المتعثّرة مع ملفّ الطالب', async () => {
  const teacher = client();
  await teacher.login('أ. نور');
  const demo = (await teacher.request('POST', '/api/classes/demo', {})).data.class;
  const summary = await teacher.request('GET', '/api/classes/' + demo.id + '/record');
  const weakest = summary.data.students.find((s) => s.name === 'زيد حاتم');
  const file = await teacher.request('GET', `/api/classes/${demo.id}/record/${weakest.id}`);
  assert.ok(Array.isArray(file.data.weakSkills));
  assert.ok(file.data.weakSkills.length, 'النموذج نفسه موسومٌ بالمهارات');
  assert.ok(file.data.weakSkills[0].misses >= 2);
  assert.ok(file.data.records.every((r) => r.items.every((it) => typeof it.skill === 'string')));
});

// ------------------------------------------------------------- الاقتراحات

test('«مهاراتي»: وسوم المعلّم السابقة مرتّبةً بالأكثر استعمالاً، ومعزولةً عن غيره', async () => {
  const a = client();
  await a.login('أ. ليث');
  assert.deepEqual((await a.request('GET', '/api/my-skills')).data.skills, []);

  await a.request('POST', '/api/activities', { title: 'حصة', questions: QUESTIONS });
  const skills = (await a.request('GET', '/api/my-skills')).data.skills;
  assert.deepEqual(skills, [
    { skill: 'جمع الكسور', times: 2 },
    { skill: 'القواسم', times: 1 },
  ]);

  const b = client();
  await b.login('أ. هدى');
  assert.deepEqual((await b.request('GET', '/api/my-skills')).data.skills, [], 'وسوم غيره لا تصله');
  assert.equal((await client().request('GET', '/api/my-skills')).status, 401);
});
