'use strict';

/**
 * المسابقات المفتوحة: تُلعب على مدى أيام بلا حساب، فحارسان يهمّان قبل كل
 * شيء — أن الإجابات الصحيحة لا تغادر الخادم قبل التسليم، وأن ما لا
 * يُصحَّح آلياً لا يدخلها أصلاً فتنتظر لوحةُ الصدارة معلّماً إلى الأبد.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-contest-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
const { server, ready } = require('../server/index');
const contest = require('../server/contest');

let base;

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

// «correct» معرّفاتُ الخيارات لا نصوصُها — كما تُرسلها الواجهة وكما تقرأها
// الجلسة الحيّة. والمحرّر يحوّل النصّ إلى معرّفٍ قبل الإرسال.
const QUESTIONS = [
  { type: 'mc', text: 'عاصمة الأردن؟', options: ['عمّان', 'إربد', 'العقبة'], correct: ['o0'], points: 1000, explanation: 'عمّان منذ 1921.' },
  { type: 'truefalse', text: 'الماء يغلي عند 100°', correct: true, points: 500 },
  { type: 'order', text: 'رتّب دورة الماء', items: ['التبخّر', 'التكاثف', 'الهطول'], points: 900 },
];

function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    async request(method, urlPath, body) {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* بلا جسم */
      }
      return { status: res.status, data };
    },
  };
}

function mockGoogle({ email, sub = 'g_ct_' + Math.random().toString(36).slice(2) }) {
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub, email, email_verified: true, name: 'مدرب' }) };
    }
    return original(url, opts);
  };
  return () => (global.fetch = original);
}

async function login(c, email) {
  const restore = mockGoogle({ email });
  try {
    const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
    const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const callback = await fetch(`${base}/api/auth/google/callback?code=fake&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie.split(';')[0] },
    });
    c.cookie = (callback.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
  } finally {
    restore();
  }
}

async function makeContest(c, over = {}) {
  const res = await c.request('POST', '/api/contests', { title: 'مسابقة العلوم', questions: QUESTIONS, days: 7, ...over });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.contest;
}

// ------------------------------------------------------------- الوحدة

test('التصحيح: الإتقان يُجمع، و«رتّب» تأخذ علامةً جزئية', () => {
  const built = contest.build({ title: 'ت', questions: QUESTIONS }, 'u1');
  const [mc, tf, order] = built.questions;
  const right = order.items.map((i) => i.id);

  const full = contest.grade(built, { [mc.id]: mc.options.find((o) => o.text === 'عمّان').id, [tf.id]: 'true', [order.id]: right });
  assert.equal(full.score, 2400);
  assert.equal(full.correct, 3);
  assert.equal(full.max, 2400);

  // ثلثا الترتيب: عنصران في موضعهما من ثلاثة
  const partial = contest.grade(built, { [order.id]: [right[0], right[2], right[1]] });
  assert.equal(partial.detail.find((d) => d.id === order.id).merit, 1 / 3);
  assert.equal(partial.score, 300);
  assert.equal(partial.correct, 0, 'الجزئيّ ليس صحيحاً كاملاً');

  // بلا إجابةٍ إطلاقاً: صفرٌ لا انهيار
  assert.equal(contest.grade(built, {}).score, 0);
  assert.equal(contest.grade(built, null).score, 0);
});

test('الترتيب: العلامة أولاً، ثم الأسرع، ثم الأسبق تسليماً', () => {
  const rows = [
    { id: 'a', name: 'أ', score: 100, ms: 9000, at: 1 },
    { id: 'b', name: 'ب', score: 200, ms: 9000, at: 2 },
    { id: 'c', name: 'ج', score: 200, ms: 4000, at: 3 },
    { id: 'd', name: 'د', score: 200, ms: 4000, at: 1 },
  ];
  assert.deepEqual(contest.board(rows).map((r) => r.name), ['د', 'ج', 'ب', 'أ']);
  assert.deepEqual(contest.rankOf(rows, 'a'), { rank: 4, of: 4 });
});

test('الخلط ثابتٌ لبذرةٍ واحدة ومختلفٌ لغيرها — فترتيب المتسابق لا يتبدّل تحته', () => {
  const list = ['1', '2', '3', '4', '5', '6', '7', '8'];
  assert.deepEqual(contest.shuffled(list, 'سلمى'), contest.shuffled(list, 'سلمى'));
  assert.notDeepEqual(contest.shuffled(list, 'سلمى'), contest.shuffled(list, 'أحمد'));
  assert.deepEqual([...contest.shuffled(list, 'س')].sort(), [...list].sort(), 'لا عنصر يُفقد ولا يتكرّر');
});

test('ما لا يُصحَّح آلياً يُسقَط ويُذكر — ولا تُردّ المسابقة كلّها', () => {
  for (const bad of [
    { type: 'open', text: 'اشرح بأسلوبك', points: 5 },
    { type: 'poll', text: 'ما رأيك؟', options: ['أ', 'ب'] },
    { type: 'word', text: 'صف الدرس بكلمة' },
    { type: 'mc', text: 'بلا إجابة صحيحة', options: ['أ', 'ب'] },
  ]) {
    const built = contest.build({ title: 'ت', questions: [...QUESTIONS, bad] }, 'u1');
    assert.equal(built.questions.length, 3, `الثلاثة الصالحة تبقى مع ${bad.type}`);
    assert.equal(built.dropped.length, 1, 'والمُسقَط يُذكر لا يُبتلع');
    assert.match(built.dropped[0], new RegExp(bad.text.slice(0, 8)));
  }
  // وشريحة العرض تُحذف بلا أن تُحسب إسقاطاً: ليست سؤالاً أصلاً
  const withSlide = contest.build({ title: 'ت', questions: [...QUESTIONS, { type: 'slide', text: 'مقدّمة', body: 'أهلاً' }] }, 'u1');
  assert.equal(withSlide.questions.length, 3);
  assert.equal(withSlide.dropped.length, 0);
});

test('ولا تُمنع إلا إن لم يبقَ سؤالٌ واحد يصلح', () => {
  assert.throws(
    () => contest.build({ title: 'ت', questions: [{ type: 'open', text: 'اشرح', points: 5 }, { type: 'word', text: 'كلمة' }] }, 'u1'),
    /سؤالاً واحداً على الأقل/
  );
  // وسؤالٌ واحدٌ صالح يكفي: لا حدَّ أدنى مصطنع
  const one = contest.build({ title: 'ت', questions: [QUESTIONS[1], { type: 'open', text: 'اشرح', points: 5 }] }, 'u1');
  assert.equal(one.questions.length, 1);
});

test('المسار يُعيد ما أُسقط مع البطاقة، فتقوله الواجهة للمعلّم', async () => {
  const c = client();
  await login(c, 'dropped@example.com');
  const res = await c.request('POST', '/api/contests', {
    title: 'مسابقة',
    questions: [...QUESTIONS, { type: 'open', text: 'اشرح بأسلوبك سبب التبخّر', points: 5 }],
    days: 7,
  });
  assert.equal(res.status, 201, 'لا تُردّ لأجل سؤالٍ واحد');
  assert.equal(res.data.contest.questions, 3);
  assert.equal(res.data.dropped.length, 1);
});

test('حالُ المسابقة: مفتوحةٌ ثم منتهية، والإغلاق اليدويّ يعلو على الموعد', () => {
  const now = Date.now();
  const open = { opensAt: now - 1000, closesAt: now + 1000, questions: [] };
  assert.equal(contest.statusOf(open, now), 'open');
  assert.equal(contest.isOpen(open, now), true);
  assert.equal(contest.statusOf({ ...open, closesAt: now - 1 }, now), 'ended');
  assert.equal(contest.statusOf({ ...open, opensAt: now + 5000 }, now), 'soon');
  assert.equal(contest.statusOf({ ...open, closed: true }, now), 'closed');
  assert.equal(contest.isOpen({ ...open, closed: true }, now), false);
});

// ------------------------------------------------------------ المسار

test('الإجابات الصحيحة لا تغادر الخادم قبل التسليم', async () => {
  const c = client();
  await login(c, 'play@example.com');
  const made = await makeContest(c);

  const anon = client();
  const play = await anon.request('GET', `/api/contests/${made.id}/play?seed=سلمى`);
  assert.equal(play.status, 200);
  const raw = JSON.stringify(play.data);
  assert.equal(/"correct"/.test(raw), false, 'لا حقل صواب');
  assert.equal(/"explanation"/.test(raw), false, 'ولا شرحٌ يكشفه');
  assert.equal(/correctOrder|"right"/.test(raw), false, 'ولا ترتيبٌ صحيح ولا طرفٌ مطابق');
  // وأطراف «رتّب» تصل مخلوطةً لا مرتّبة
  assert.equal(play.data.questions.length, 3);
  assert.equal(play.data.max, 2400);
});

test('التسليم يعيد العلامة والرتبة واللوحة والشرح — والشرح هنا لا قبله', async () => {
  const c = client();
  await login(c, 'submit@example.com');
  const made = await makeContest(c, { retries: true });
  const anon = client();
  const play = (await anon.request('GET', `/api/contests/${made.id}/play?seed=x`)).data;
  const mc = play.questions.find((q) => q.type === 'mc');
  const answers = { [mc.id]: mc.options.find((o) => o.text === 'عمّان').id };

  const sent = await anon.request('POST', `/api/contests/${made.id}/entries`, { name: '  سلمى  ', answers, ms: 42000 });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.result.score, 1000);
  assert.equal(sent.data.result.max, 2400);
  assert.equal(sent.data.rank, 1);
  assert.equal(sent.data.board[0].name, 'سلمى', 'والاسم يُنظَّف من الفراغات');
  assert.ok(sent.data.review.some((r) => r.explanation.includes('عمّان منذ')), 'الشرح يصل بعد التسليم');
});

test('محاولةٌ واحدة ما لم يسمح المعلّم بغيرها', async () => {
  const c = client();
  await login(c, 'once@example.com');
  const made = await makeContest(c);
  const anon = client();
  const first = await anon.request('POST', `/api/contests/${made.id}/entries`, { name: 'أحمد', answers: {} });
  assert.equal(first.status, 201);
  const again = await anon.request('POST', `/api/contests/${made.id}/entries`, { name: 'أحمد', answers: {} });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /المحاولة واحدة/);
});

test('المغلقة لا تُلعب ولا تُسلَّم، ولوحتها تبقى مقروءة', async () => {
  const c = client();
  await login(c, 'closed@example.com');
  const made = await makeContest(c);
  const shut = await c.request('PATCH', `/api/contests/${made.id}`, { closed: true });
  assert.equal(shut.data.contest.status, 'closed');

  const anon = client();
  assert.equal((await anon.request('GET', `/api/contests/${made.id}/play`)).status, 409);
  assert.equal((await anon.request('POST', `/api/contests/${made.id}/entries`, { name: 'ب', answers: {} })).status, 409);
  // اللوحة تبقى: المسابقة تنتهي ونتيجتها لا تختفي
  assert.equal((await anon.request('GET', `/api/contests/${made.id}/board`)).status, 200);
});

test('مسابقة معلّمٍ آخر لا تُغلق ولا تُحذف', async () => {
  const owner = client();
  await login(owner, 'owner-ct@example.com');
  const made = await makeContest(owner);

  const other = client();
  await login(other, 'other-ct@example.com');
  assert.equal((await other.request('PATCH', `/api/contests/${made.id}`, { closed: true })).status, 404);
  assert.equal((await other.request('DELETE', `/api/contests/${made.id}`)).status, 404);
  assert.equal((await other.request('GET', '/api/contests')).data.items.length, 0, 'ولا تظهر في قائمته');

  // وبلا حساب: لا إنشاء أصلاً
  assert.equal((await client().request('POST', '/api/contests', { title: 'ت', questions: QUESTIONS })).status, 401);
});

test('البطاقة عامّة وبلا سؤالٍ واحد', async () => {
  const c = client();
  await login(c, 'card@example.com');
  const made = await makeContest(c, { description: 'لصفّي الخامس' });
  const anon = client();
  const card = await anon.request('GET', `/api/contests/${made.id}/card`);
  assert.equal(card.status, 200);
  assert.equal(card.data.contest.questions, 3, 'عددُ الأسئلة لا نصوصُها');
  assert.equal(card.data.contest.description, 'لصفّي الخامس');
  assert.equal(/عاصمة الأردن/.test(JSON.stringify(card.data)), false, 'ولا نصّ سؤالٍ يتسرّب');
});

/**
 * المسار كما تسلكه الواجهة بالضبط: نشاطٌ يُحفظ، ثم يُقرأ من **القائمة**،
 * ثم تُبنى منه مسابقة.
 *
 * وهذا ما كان مكسوراً: `GET /api/activities` تُرجع عدد الأسئلة لا نصوصها،
 * فكانت البطاقة ترسل مسابقةً بلا سؤالٍ واحد ويردّ الخادم «أضف سؤالاً
 * واحداً على الأقل». والاختبار الذي كتبتُه أولاً موّه نداء الإنشاء نفسه،
 * فاختبر محاكاتي لا نظامي.
 */
test('مسابقةٌ من نشاطٍ محفوظ — بالمسارات التي تناديها الواجهة فعلاً', async () => {
  const c = client();
  await login(c, 'from-activity@example.com');

  const saved = await c.request('POST', '/api/activities', { title: 'مراجعة الوحدة', settings: {}, questions: QUESTIONS });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));

  // القائمة: عددٌ لا نصوص — فمن بنى عليها بنى على فراغ
  const list = await c.request('GET', '/api/activities');
  const row = list.data.activities.find((a) => a.id === saved.data.activity.id);
  assert.equal(row.questionCount, 3);
  assert.equal(row.questions, undefined, 'القائمة لا تحمل الأسئلة — وهذا صواب لقائمةٍ طويلة');

  // ولذلك تُجلب الواحدة كاملةً قبل الإنشاء
  const full = await c.request('GET', '/api/activities/' + row.id);
  assert.equal(full.data.activity.questions.length, 3);

  const made = await c.request('POST', '/api/contests', {
    title: full.data.activity.title,
    questions: full.data.activity.questions,
    settings: full.data.activity.settings || {},
    days: 7,
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.contest.questions, 3);
});

test('مسابقةٌ بلا أسئلة تقول ما ينقص بلغة المسابقات لا بلغة الجلسة', async () => {
  const c = client();
  await login(c, 'empty-ct@example.com');
  const res = await c.request('POST', '/api/contests', { title: 'فارغة', questions: [], days: 7 });
  assert.equal(res.status, 400);
  // «أضف سؤالاً واحداً على الأقل» رسالةُ الجلسة الحيّة، وكانت تتسرّب من
  // `normalizeQuiz` فيقرأها المعلّم في شاشةٍ لا سؤال فيها أصلاً
  assert.match(res.data.error, /المسابقة/, JSON.stringify(res.data));
});
