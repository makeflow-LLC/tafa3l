'use strict';

/**
 * بقاء الجلسات بعد إعادة تشغيل الخادم.
 *
 * الحالة التي يحميها هذا الملف واقعية ومؤلمة: معلّم يجدول اختباراً للغد
 * ويوزّع رمزه على صفّه، ثم يُعاد نشر الخادم ليلاً — فيجد ثلاثون طالباً
 * صباحاً «الجلسة غير موجودة» بلا سببٍ يفهمونه ولا وسيلة استرداد.
 *
 * والحدّ الفاصل الذي نختبره هنا مرّتين: ما يعود هو **الهيكل** وحده. لا اسم
 * مشارك ولا إجابة ولا درجة تلمس القرص، وهذا ليس نقصاً بل هو وعد المنصة.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-persist-'));
// سائق الملف لا postgres: الاختبار يقيس منطق الحفظ لا قاعدة بيانات بعينها
delete process.env.DATABASE_URL;

const storage = require('../server/storage');
const store = require('../server/store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUIZ = {
  title: 'اختبار الفصل',
  questions: [
    { type: 'mc', text: 'عاصمة الأردن؟', options: ['عمّان', 'إربد'], correct: ['o0'] },
    { type: 'truefalse', text: 'الشمس نجم', correct: ['true'] },
  ],
};

/**
 * «إعادة تشغيل»: نكتب على القرص فعلاً، ثم نُهيّئ سائقاً جديداً يقرأ الملف
 * من الصفر، ثم نُفرغ الذاكرة. لو كان الحفظ وهماً في الذاكرة وحدها لسقط هنا.
 */
async function restart() {
  await store.flush();
  await sleep(400); // سائق الملف يؤجّل الكتابة ١٥٠ms
  await storage.init();
  store.sessions.clear();
}

test.before(async () => {
  await storage.init();
});

/**
 * كل اختبار يبدأ من قرصٍ نظيف — وإلا أحصى أحدهم جلسة جاره.
 *
 * والنومتان ليستا زينة: هذا الملف يُنشئ سائق ملفٍ جديداً في كل «إعادة تشغيل»
 * بينما يبقى للسائق السابق كتابةٌ مؤجَّلة في الطريق إلى الملف نفسه — فتهبط
 * بعد كتابة خَلَفِه فتمحوها. عمليةُ الإنتاج فيها سائق واحد فلا يقع هذا فيها.
 */
test.beforeEach(async () => {
  await sleep(300);
  await storage.init();
  const db = storage.get();
  for (const row of await db.listLiveSessions()) await db.deleteLiveSession(row.code);
  await sleep(300);
  store.sessions.clear();
});

test.after(() => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('الجلسة المجدولة تعود بعد إعادة التشغيل برمزها ورمز مضيفها وموعدها', async () => {
  const opensAt = Date.now() + 6 * 60 * 60 * 1000;
  const session = store.createSession({ ...QUIZ, settings: { opensAt } });
  session.ownerId = 'u_test';
  session.ownerName = 'أستاذة ريم';
  const { code, hostToken } = session;

  await restart();
  assert.equal(store.getSession(code), null, 'الذاكرة أُفرغت فعلاً قبل الإحياء');

  assert.equal(await store.restore(), 1);
  const back = store.getSession(code);
  assert.ok(back, 'الجلسة عادت');
  assert.equal(back.hostToken, hostToken, 'رمز المضيف نفسه — وإلا فقد المعلّم لوحته');
  assert.equal(back.ownerId, 'u_test');
  assert.equal(back.ownerName, 'أستاذة ريم');
  assert.equal(back.title, 'اختبار الفصل');
  assert.equal(back.questions.length, 2);
  assert.equal(back.settings.opensAt, opensAt, 'الموعد المجدول نجا');
  assert.equal(back.status, 'lobby');
  assert.equal(back.restored, true);

  store.deleteSession(code);
});

test('موعدٌ حلّ أثناء توقّف الخادم يفتح الاختبار فور الإحياء لا يعلّقه', async () => {
  const session = store.createSession({ ...QUIZ, settings: { opensAt: Date.now() + 1200 } });
  const { code } = session;
  assert.equal(session.status, 'lobby');

  await restart();
  // «مرّ الوقت»: نُزحزح الموعد إلى الماضي في اللقطة المحفوظة كما لو أن
  // الخادم كان نائماً حين حان
  const db = storage.get();
  const rows = await db.listLiveSessions();
  const snap = rows.find((r) => r.code === code);
  snap.settings.opensAt = Date.now() - 60000;
  await db.saveLiveSession(snap);

  await store.restore();
  const back = store.getSession(code);
  assert.ok(back);
  await sleep(60); // مؤقّت الفتح مهلته صفر لكنه غير متزامن
  assert.equal(back.status, 'live', 'الاختبار انطلق بدل أن ينتظر موعداً مضى');

  store.deleteSession(code);
});

test('الجلسة الحيّة تعود حيّة، وإجابات ما قبل إعادة التشغيل لا تعود', async () => {
  const session = store.createSession({ ...QUIZ, settings: { pace: 'host' } });
  const { code } = session;
  const participant = session.addParticipant({ name: 'سارة' });
  session.start();
  session.submitAnswer(participant, session.questions[0].id, [session.questions[0].options[0].id]);
  assert.ok(participant.score > 0, 'أُحرزت نقاط قبل «الانقطاع»');

  await restart();
  await store.restore();
  const back = store.getSession(code);
  assert.ok(back);
  assert.equal(back.status, 'live', 'النشاط ما زال يعمل');
  assert.equal(back.currentIndex, 0, 'عاد إلى السؤال الذي كان معروضاً');
  assert.equal(back.participants.size, 0, 'لا مشارك واحد على القرص — هذا هو الوعد');

  // ولا يكفي أن تكون فارغة: يجب ألّا يكون الاسم قد لمس القرص أصلاً
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'tafa3l.json'), 'utf8');
  assert.ok(!raw.includes('سارة'), 'اسم الطالبة ليس في ملف البيانات');

  store.deleteSession(code);
});

test('الجلسة المنتهية لا تُبعث — نتائجها ذهبت مع الذاكرة فهيكلها الفارغ يوهم بعطل', async () => {
  const session = store.createSession(QUIZ);
  const { code } = session;
  session.start();
  session.finish();

  await restart();
  assert.equal(await store.restore(), 0);
  assert.equal(store.getSession(code), null);

  const rows = await storage.get().listLiveSessions();
  assert.equal(rows.find((r) => r.code === code), undefined, 'وصفّها مُسح من القرص أيضاً');
});

test('حذف الجلسة يمحو هيكلها من القرص فلا تعود بعد إعادة التشغيل', async () => {
  const session = store.createSession(QUIZ);
  const { code } = session;
  await store.flush();
  await sleep(300);
  store.deleteSession(code);
  await sleep(300);

  await storage.init();
  store.sessions.clear();
  assert.equal(await store.restore(), 0);
  assert.equal(store.getSession(code), null);
});

test('جلسة نامت أطول من عمرها الطبيعي لا تُبعث ورمزها يعود متاحاً', async () => {
  const session = store.createSession(QUIZ);
  const { code } = session;
  await restart();

  const db = storage.get();
  const rows = await db.listLiveSessions();
  const snap = rows.find((r) => r.code === code);
  snap.lastActivity = Date.now() - 400 * 60 * 1000; // أقدم من مهلة الخمول (١٨٠ دقيقة)
  await db.saveLiveSession(snap);

  assert.equal(await store.restore(), 0);
  assert.equal(store.getSession(code), null);
  const after = await db.listLiveSessions();
  assert.equal(after.find((r) => r.code === code), undefined);
});

test('لكنّ المجدولة لموعد قادم تنجو من انقطاعٍ أطول من مهلة الخمول', async () => {
  // اختبار الأسبوع القادم: أُنشئ اليوم، والخادم نام أربع ساعات. إسقاطه لمجرّد
  // أنه لم يُلمس هو بالضبط الحالة التي جاء هذا كلّه ليمنعها.
  const session = store.createSession({ ...QUIZ, settings: { opensAt: Date.now() + 7 * 24 * 3600 * 1000 } });
  const { code } = session;
  await restart();

  const db = storage.get();
  const rows = await db.listLiveSessions();
  const snap = rows.find((r) => r.code === code);
  snap.lastActivity = Date.now() - 400 * 60 * 1000;
  await db.saveLiveSession(snap);

  assert.equal(await store.restore(), 1, 'الموعد القادم يمنحها حصانة المنظّف نفسها');
  assert.ok(store.getSession(code));

  store.deleteSession(code);
});

test('الإحياء يُجدّد عمر الجلسة على القرص فلا تُسقطها إعادةُ النشر التالية', async () => {
  const session = store.createSession(QUIZ);
  const { code } = session;
  await restart();

  const db = storage.get();
  const rows = await db.listLiveSessions();
  const snap = rows.find((r) => r.code === code);
  // على حافة المهلة: تنجو هذه المرة، فإن لم يُدوَّن إحياؤها سقطت في التالية
  snap.lastActivity = Date.now() - 170 * 60 * 1000;
  await db.saveLiveSession(snap);
  assert.equal(await store.restore(), 1);

  await restart();
  assert.equal(await store.restore(), 1, 'نجت مرة ثانية لأن الإحياء جدّد عمرها');

  store.deleteSession(code);
});

test('التحديث الخفيف يوفّر إعادة كتابة الأسئلة ولا يُفلت خلطها', async () => {
  // ثلاث كتابات متتالية: كاملة عند الإنشاء، ثم كاملة لأن الخلط بدّل الأسئلة،
  // ثم خفيفة لأن ما تغيّر موضعُ العرض وحده. والأخيرة هي موضع الخطر: لو مرّ
  // الخلط عبرها لعاد الترتيب الأصلي بعد الإحياء.
  const many = {
    title: 'خفيف',
    questions: Array.from({ length: 8 }, (_, i) => ({ type: 'truefalse', text: 'س' + i, correct: ['true'] })),
    settings: { shuffleQuestions: true, pace: 'host' },
  };
  const session = store.createSession(many);
  const { code } = session;
  await store.flush();
  await sleep(250);

  session.start();
  const order = session.questions.map((q) => q.text);
  await store.flush();
  await sleep(250);

  session.next();
  assert.equal(session.currentIndex, 1);

  await restart();
  await store.restore();
  const back = store.getSession(code);
  assert.equal(back.questions.length, 8, 'الأسئلة لم تسقط في التحديث الخفيف');
  assert.deepEqual(back.questions.map((q) => q.text), order, 'والترتيب المخلوط نجا');
  assert.equal(back.currentIndex, 1, 'وموضع العرض تحدّث');

  store.deleteSession(code);
});

test('الأسئلة المخلوطة تعود بترتيبها المخلوط ولا تُخلط ثانيةً', async () => {
  const many = {
    title: 'ترتيب',
    questions: Array.from({ length: 8 }, (_, i) => ({ type: 'truefalse', text: 'س' + i, correct: ['true'] })),
    settings: { shuffleQuestions: true, pace: 'host' },
  };
  const session = store.createSession(many);
  session.start();
  const order = session.questions.map((q) => q.text);
  const { code } = session;

  await restart();
  await store.restore();
  const back = store.getSession(code);
  assert.deepEqual(back.questions.map((q) => q.text), order, 'ترتيبٌ ثانٍ يعني طالباً يرى سؤالاً أجابه');

  store.deleteSession(code);
});
