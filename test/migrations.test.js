'use strict';

/**
 * الترحيلات التي تمرّ على الحسابات القائمة مرّةً واحدة.
 *
 * وهي أخطرُ ما يُكتب في المنصّة: تمرّ على بيانات معلّمين حقيقيين، ولا تُراجَع
 * قبل أن تقع. فتُختبر هنا على ملفٍّ حقيقيّ لا على دالّةٍ مجرّدة — نكتب حسابات
 * كما هي على القرص، ثم نُقلع التخزين، ثم نقرأ ماذا صار بها.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-migrate-'));
const now = Date.now();
const day = 86400000;
/** لحظةُ الترحيل القديم الذي ختم كل حسابٍ قائم بفلسطين */
const backfilledAt = now - 60 * day;

/** حساباتٌ كما كانت قبل الباقات: بلا مستوى وبلا ختم إعفاء */
const before = {
  users: {
    u_paid: { id: 'u_paid', email: 'paid@example.com', country: 'PS', name: 'مشترك سنة', premiumUntil: now + 300 * day, createdAt: now - 200 * day },
    u_month: { id: 'u_month', email: 'month@example.com', country: 'PS', name: 'مشترك شهر', premiumUntil: now + 25 * day, createdAt: now - 40 * day },
    u_edge: { id: 'u_edge', email: 'edge@example.com', country: 'PS', name: 'أحد عشر يوماً', premiumUntil: now + 11 * day, createdAt: now - 20 * day },
    u_trial: { id: 'u_trial', email: 'trial@example.com', country: 'PS', name: 'تجربة', premiumUntil: now + 9 * day, trialGrantedAt: now - day, createdAt: now - day },
    u_free: { id: 'u_free', email: 'free@example.com', country: 'PS', name: 'مجّاني', premiumUntil: null, createdAt: now - 100 * day },
    u_gone: { id: 'u_gone', email: 'gone@example.com', country: 'PS', name: 'منتهٍ', premiumUntil: now - 5 * day, createdAt: now - 300 * day },
    // أُنشئ بعد الترحيل القديم: مرّ ببوّابة السؤال فاختار بلده بنفسه
    u_after: { id: 'u_after', email: 'after@example.com', name: 'اختار بلده', country: 'MA', premiumUntil: null, createdAt: now - 10 * day },
  },
  activities: {},
  games: {},
  authSessions: {},
  bankQuestions: {},
  liveSessions: {},
  classes: {},
  records: {},
  assignments: {},
  // الترحيل القديم جرى قبل شهرين: من أُنشئ قبله خُتم بفلسطين بلا أن يُسأل
  meta: { countryBackfillAt: backfilledAt },
};

process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
fs.writeFileSync(path.join(dir, 'tafa3l.json'), JSON.stringify(before), 'utf8');

const storage = require('../server/storage');

test.before(async () => {
  await storage.init();
});

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ترقيةُ القدامى: من بقي له أكثر من أحد عشر يوماً يصير في الباقة الأعلى', async () => {
  const db = storage.get();
  const tier = async (email) => (await db.findUserByEmail(email)).tier || '';

  assert.equal(await tier('paid@example.com'), 'pro', 'مشتركُ السنة يُرقّى');
  assert.equal(await tier('month@example.com'), 'pro', 'مشتركُ الشهر يُرقّى');
  // الحدُّ نفسه ليس «أكثر من»
  assert.equal(await tier('edge@example.com'), '', 'أحد عشر يوماً بالضبط لا تُرقّى');
  assert.equal(await tier('trial@example.com'), '', 'منحةُ التسجيل ليست شراءً');
  assert.equal(await tier('free@example.com'), '', 'المجّانيّ كما هو');
  assert.equal(await tier('gone@example.com'), '', 'المنتهي اشتراكه كما هو');
});

test('إعفاءُ القدامى من سقف الطلاب يشمل الجميع — ولا يتكرّر مع كل إقلاع', async () => {
  const db = storage.get();
  for (const email of ['paid@example.com', 'free@example.com', 'gone@example.com']) {
    const user = await db.findUserByEmail(email);
    assert.ok(user.grandfatheredAt, `${email} معفًى من السقف`);
  }
  // حسابٌ يُنشأ **بعد** الترحيل لا يُعفى، وإلا لم يبقَ للسقف معنى
  const fresh = await db.upsertUser({ email: 'new@example.com', name: 'جديد', googleId: 'g_new' });
  assert.ok(!fresh.grandfatheredAt, 'الحساب الجديد يخضع للسقف');
  assert.ok(!fresh.tier, 'ولا يُرقّى بمنحة تسجيله');
});

test('البلد: من أُنشئ بعد الترحيل القديم اختاره بنفسه، ومن قبله يُسأل مرّةً', async () => {
  const db = storage.get();
  // خُتم بفلسطين في ترحيلٍ قديم بلا أن يُسأل: لا يُعدّ اختياراً، فيُسأل مرّة
  const old = await db.findUserByEmail('paid@example.com');
  assert.equal(old.country, 'PS', 'الترحيل القديم ختمه');
  assert.ok(!old.countryChosenAt, 'وليس اختياراً منه');

  // أُنشئ بعد الترحيل: مرّ ببوّابة السؤال فلا يُسأل ثانيةً
  const after = await db.findUserByEmail('after@example.com');
  assert.equal(after.country, 'MA');
  assert.ok(after.countryChosenAt, 'اختياره مختوم');

  // وحين يجيب، يُختم — فلا يُسأل بعدها
  const saved = await db.updateProfile(old.id, { country: 'JO' });
  assert.equal(saved.country, 'JO');
  assert.ok(saved.countryChosenAt, 'الإجابة تُختم اختياراً');
});

test('العلامات تُكتب فتمنع إعادة الترحيل — والقيَم لا تتبدّل بعدها', async () => {
  // الكتابة على القرص مؤجّلةٌ بمهلةٍ قصيرة (تجميعُ التعديلات) فننتظرها
  await new Promise((r) => setTimeout(r, 400));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tafa3l.json'), 'utf8'));
  assert.ok(saved.meta.studentCapAt, 'علامة سقف الطلاب مكتوبة');
  assert.ok(saved.meta.proUpgradeAt, 'علامة الترقية مكتوبة');
  // إقلاعٌ ثانٍ على البيانات نفسها: لا يُرقّى من لم يُرقّ، ولا يُعفى من لم يُعفَ
  await storage.init();
  const db = storage.get();
  assert.equal((await db.findUserByEmail('new@example.com')).tier || '', '');
  assert.ok(!(await db.findUserByEmail('new@example.com')).grandfatheredAt);
});
