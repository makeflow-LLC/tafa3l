'use strict';

/**
 * تحليل الفصل: ما يُرسل إلى النموذج، وما يعود منه، ومن يحقّ له.
 *
 * وما تحرسه هذه الاختبارات قبل غيره: أن **أسماء الطلاب لا تغادر الخادم** —
 * الخلاصةُ المرسلة بأسماءٍ مستعارة، والتقريرُ العائد بأسماءٍ حقيقيّة. وأن
 * الميزة حكرٌ على الاحترافية، وأن التقرير يُحفظ فلا يُعاد بناؤه مع كل فتح.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-analysis-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.AZURE_OPENAI_KEY = 'test-azure-key';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const storage = require('../server/storage');
const analysis = require('../server/analysis');

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

// ------------------------------------------------------------------ أدوات

/** جوجل مزيّفة للدخول، وأزور مزيّفة للردّ — ويُحفظ ما أُرسل إليها */
function mockUpstream({ email, azure }) {
  const original = global.fetch;
  const seen = { azure: [] };
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub: 'g_' + email, email, email_verified: true, name: 'مدرب' }) };
    }
    if (u.includes('services.ai.azure.com') || u.includes('openai')) {
      const body = JSON.parse(opts.body);
      seen.azure.push(body);
      return azure(body);
    }
    return original(url, opts);
  };
  return { seen, restore: () => (global.fetch = original) };
}

const azureReply = (text) => () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
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
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* بلا جسم */
      }
      return { status: res.status, data };
    },
    async login() {
      const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
      const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
      const state = new URL(start.headers.get('location')).searchParams.get('state');
      const cb = await fetch(`${base}/api/auth/google/callback?code=fake&state=${state}`, {
        redirect: 'manual',
        headers: { Cookie: stateCookie.split(';')[0] },
      });
      cookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
    },
  };
}

async function setTier(email, tier) {
  const user = await storage.get().findUserByEmail(email);
  await storage.get().setPremiumUntil(user.id, Date.now() + 30 * 86400000, tier);
  return user;
}

/** سطرُ سجلٍّ كما يكتبه records.js — ما يهمّ التحليل منه فقط */
function row(classId, studentId, code, percent, items = [], at = Date.now()) {
  return {
    id: `${classId}:${studentId}:${code}`,
    classId,
    studentId,
    code,
    title: 'اختبار ' + code,
    at,
    total: 4,
    answered: 4,
    correct: Math.round((percent / 100) * 4),
    partial: 0,
    wrong: 4 - Math.round((percent / 100) * 4),
    pending: 0,
    percent,
    items,
  };
}

const wrong = (text, skill) => ({ text, type: 'mc', skill, ok: false, mine: 'خطأ', right: 'صواب' });

const REPORT = JSON.stringify({
  headline: 'مجموعةٌ متفاوتة: قمّةٌ واضحة وقاعدةٌ تحتاج دعماً',
  summary: 'ثلاثة طلاب، واحدٌ يتقدّم واثنان يتعثّران في الكسور. s2 خصوصاً يحتاج تدخّلاً.',
  strengths: ['الحضور والمشاركة كاملان'],
  gaps: ['جمع الكسور — تكرّر الخطأ عند s2 و s3'],
  patterns: ['الأخطاء تتركّز في سؤالٍ واحد'],
  students: [
    { id: 's1', level: 'strong', note: 'ثابتٌ في القمّة', next: 'إثراء' },
    { id: 's2', level: 'support', note: 'يكرّر الخطأ في الكسور', next: 'جلسة علاجية' },
    { id: 'S3', level: 'bogus', note: 'مستقرّ', next: 'تثبيت' },
    { id: 's9', level: 'strong', note: 'ليس في النطاق', next: '' },
  ],
  plan: ['ابدأ بجمع الكسور', 'اختبار قصير بعد أسبوع'],
  homework: '',
});

// ------------------------------------------------------------------ الوحدة

test('الخلاصة: أسماءٌ مستعارة في ما يُرسل، وأرقامٌ محسوبة من السجل', () => {
  const cls = {
    id: 'cl_a',
    name: 'السابع أ',
    record: true,
    pupils: [
      { id: 'st_1', name: 'سارة قاسم', group: 'الدعم' },
      { id: 'st_2', name: 'ليان محمود', group: 'الدعم' },
      { id: 'st_3', name: 'هدى سليم', group: 'الإثراء' },
    ],
  };
  const records = [
    row('cl_a', 'st_1', '111111', 100, []),
    row('cl_a', 'st_2', '111111', 25, [wrong('١/٢ + ١/٤ = ؟', 'جمع الكسور')]),
    row('cl_a', 'st_3', '111111', 75, [wrong('١/٢ + ١/٤ = ؟', 'جمع الكسور')]),
    row('cl_a', 'st_2', '222222', 50, [wrong('٢/٣ + ١/٣ = ؟', 'جمع الكسور')]),
  ];
  const d = analysis.digest({ cls, records, assignments: [], group: '' });
  assert.equal(d.students.length, 3);
  assert.deepEqual(d.students.map((s) => s.label), ['s1', 's2', 's3']);
  assert.equal(d.stats.avg, Math.round((100 + 25 + 75 + 50) / 4));
  assert.deepEqual(d.stats.distribution, { strong: 1, steady: 1, support: 1, silent: 0 });
  assert.equal(d.stats.skills[0].skill, 'جمع الكسور');
  assert.equal(d.stats.skills[0].misses, 3);
  // نسبة الخطأ من عدد من شارك في الجلسة نفسها: اثنان من ثلاثة أخطأوا في الأولى
  assert.equal(d.stats.missed[0].rate, Math.round((2 / 3) * 100));

  const prompt = analysis.promptFor(d);
  assert.equal(prompt.includes('سارة'), false, 'لا اسمَ في ما يُرسل');
  assert.equal(prompt.includes('ليان'), false);
  assert.equal(prompt.includes('هدى'), false);
  assert.match(prompt, /s2: محاولات 2/);
  assert.match(prompt, /جمع الكسور/);

  // مجموعةٌ وحدها
  const g = analysis.digest({ cls, records, assignments: [], group: 'الدعم' });
  assert.equal(g.students.length, 2);
  assert.equal(g.stats.group, 'الدعم');
});

test('التقرير العائد: الأسماء تعود، والدخلاء يسقطون، والمنسيّ يُدرج بأرقامه', () => {
  const cls = {
    id: 'cl_b',
    name: 'الثامن',
    record: true,
    pupils: [
      { id: 'st_1', name: 'سارة', group: '' },
      { id: 'st_2', name: 'ليان', group: '' },
      { id: 'st_3', name: 'هدى', group: '' },
    ],
  };
  const d = analysis.digest({ cls, records: [row('cl_b', 'st_1', '1', 90), row('cl_b', 'st_2', '1', 30)], assignments: [] });
  const report = analysis.parseReport('```json\n' + REPORT + '\n```', d);
  assert.equal(report.students.length, 3, 'ثلاثةٌ لا أربعة: s9 ليس في النطاق');
  assert.deepEqual(report.students.map((s) => s.name), ['ليان', 'هدى', 'سارة'], 'من يحتاج دعماً أوّلاً');
  const layan = report.students.find((s) => s.name === 'ليان');
  assert.equal(layan.level, 'support');
  assert.equal(layan.avg, 30);
  const huda = report.students.find((s) => s.name === 'هدى');
  assert.equal(huda.level, 'support', 'مستوى غير معروف يُستبدل بالمحسوب — وبلا محاولات هو دعم');
  assert.equal(huda.attempts, 0);
  // وفي النصّ الحرّ أيضاً: من زلّ النموذج وذكره بالمستعار يُعاد اسمه
  assert.match(report.summary, /ليان خصوصاً/);
  assert.match(report.gaps[0], /عند ليان و هدى/);
  assert.equal(report.plan.length, 2);

  assert.throws(() => analysis.parseReport('عذراً، لا أستطيع', d), /ليس تقريراً/);
});

// ------------------------------------------------------------------ المسار

test('المسار: للاحترافية وحدها، يُبنى مرّةً ويُحفظ، والمجموعة نطاقٌ مستقلّ', async () => {
  const email = 'analysis.teacher@example.com';
  const mock = mockUpstream({ email, azure: azureReply(REPORT) });
  try {
    const teacher = client();
    await teacher.login();
    await setTier(email, 'basic');

    const cls = (await teacher.request('POST', '/api/classes', {
      name: 'السابع أ',
      students: '# الدعم\nسارة قاسم\nليان محمود\n# الإثراء\nهدى سليم',
      record: true,
    })).data.class;

    // الأساسية لا تراه — ٤٠٢ لا ٤٠٤: الميزة موجودة وثمنُها مكتوب
    const denied = await teacher.request('GET', `/api/classes/${cls.id}/analysis`);
    assert.equal(denied.status, 402);
    assert.match(denied.data.error, /الاحترافية/);

    await setTier(email, 'pro');
    const empty = await teacher.request('GET', `/api/classes/${cls.id}/analysis`);
    assert.equal(empty.status, 200);
    assert.equal(empty.data.report, null);
    assert.equal(empty.data.results, 0);
    const noRows = await teacher.request('POST', `/api/classes/${cls.id}/analysis`, {});
    assert.equal(noRows.status, 409, 'لا تقرير بلا نتائج');

    // نتائجُ في السجل مباشرةً — كما تكتبها جلسةٌ انتهت
    const full = await storage.get().getClass(cls.id);
    const [p1, p2, p3] = full.pupils;
    await storage.get().saveRecords([
      row(cls.id, p1.id, '111111', 100, []),
      row(cls.id, p2.id, '111111', 25, [wrong('١/٢ + ١/٤ = ؟', 'جمع الكسور')]),
      row(cls.id, p3.id, '111111', 75, [wrong('١/٢ + ١/٤ = ؟', 'جمع الكسور')]),
    ]);

    const made = await teacher.request('POST', `/api/classes/${cls.id}/analysis`, {});
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(mock.seen.azure.length, 1);
    const sent = JSON.stringify(mock.seen.azure[0]);
    assert.equal(sent.includes('سارة'), false, 'اسمُ الطالب لا يُرسل إلى النموذج');
    assert.equal(sent.includes('ليان'), false);
    assert.ok(sent.includes('s2'), 'المستعار وحده');
    assert.equal(made.data.report.report.students.find((s) => s.name === 'ليان محمود').level, 'support');
    assert.equal(made.data.report.stats.students, 3);

    // الفتح الثاني يعرض المحفوظ ولا ينادي النموذج
    const again = await teacher.request('GET', `/api/classes/${cls.id}/analysis`);
    assert.equal(again.data.report.at, made.data.report.at);
    assert.equal(again.data.stale, false);
    assert.equal(mock.seen.azure.length, 1, 'لا نداءَ ثانياً لفتحٍ ثانٍ');

    // نتيجةٌ جديدة تجعل المحفوظ قديماً — ويُقال ذلك لا يُخفى
    await storage.get().saveRecords([row(cls.id, p2.id, '222222', 60, [], Date.now() + 1000)]);
    const later = await teacher.request('GET', `/api/classes/${cls.id}/analysis`);
    assert.equal(later.data.stale, true);
    assert.equal(later.data.report.at, made.data.report.at, 'المحفوظ يبقى حتى يُطلب التجديد');

    // مجموعةٌ نطاقٌ آخر بتقريرٍ آخر
    const grp = await teacher.request('POST', `/api/classes/${cls.id}/analysis`, { group: 'الدعم' });
    assert.equal(grp.status, 200);
    assert.equal(grp.data.report.stats.students, 2);
    assert.equal(grp.data.report.stats.group, 'الدعم');
    assert.equal(mock.seen.azure.length, 2);
    const ghost = await teacher.request('POST', `/api/classes/${cls.id}/analysis`, { group: 'لا أحد' });
    assert.equal(ghost.status, 404);

    // ولا يُسرَّب التقرير في قائمة الفصول
    const list = await teacher.request('GET', '/api/classes');
    assert.equal(JSON.stringify(list.data).includes('headline'), false);

    // فصلُ غيره لا يُرى
    const other = client();
    mock.restore();
    const mock2 = mockUpstream({ email: 'other.analysis@example.com', azure: azureReply(REPORT) });
    try {
      await other.login();
      await setTier('other.analysis@example.com', 'pro');
      assert.equal((await other.request('GET', `/api/classes/${cls.id}/analysis`)).status, 404);
    } finally {
      mock2.restore();
    }
  } finally {
    mock.restore();
  }
});
