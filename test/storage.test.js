'use strict';

/**
 * طبقة التخزين: البقاء بعد إعادة التشغيل، وعزل الملكية، وسلامة الأنواع.
 * تعمل على السائقين معاً — شغّلها مع DATABASE_URL لاختبار Postgres/Supabase:
 *   DATABASE_URL=postgres://... node test/storage.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-store-'));
}

const storage = require('../server/storage');

const suffix = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const mail = (n) => `store${n}.${suffix}@example.com`;

test.before(async () => {
  await storage.init();
});

test('يبلّغ عن نوع التخزين وديمومته', () => {
  const s = storage.status();
  assert.ok(['file', 'postgres'].includes(s.kind));
  assert.equal(s.durable, s.kind === 'postgres');
  assert.equal(s.error, null, 'لا يوجد خطأ اتصال');
});

test('البيانات تبقى بعد إعادة تشغيل الخادم', async () => {
  const email = mail('restart');
  const user = await storage.get().upsertUser({ email, name: 'باقٍ بعد التشغيل', googleId: 'g-restart' });

  const now = Date.now();
  await storage.get().saveActivity({
    id: storage.newId('a_'),
    ownerId: user.id,
    title: 'نشاط باقٍ',
    settings: { pace: 'self', scoring: 'flat' },
    questions: [{ id: 'q1', type: 'mc', text: 'س', options: [{ id: 'o0', text: 'أ' }], correct: ['o0'] }],
    createdAt: now,
    updatedAt: now,
  });

  // مهلة قصيرة لتفريغ كتابة الملف المؤجّلة، ثم «إعادة تشغيل» بتهيئة جديدة
  await new Promise((r) => setTimeout(r, 300));
  await storage.init();

  const again = await storage.get().findUserByEmail(email);
  assert.ok(again, 'المستخدم موجود بعد إعادة التشغيل');
  assert.equal(again.name, 'باقٍ بعد التشغيل');

  const activities = await storage.get().listActivities(again.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, 'نشاط باقٍ');
  assert.equal(activities[0].settings.pace, 'self', 'الإعدادات تعود ككائن لا كنص');
  assert.equal(activities[0].questions[0].options[0].text, 'أ', 'الأسئلة تعود ككائنات كاملة');
  assert.equal(typeof activities[0].updatedAt, 'number', 'الطوابع الزمنية أرقام لا نصوص');
});

test('قائمة كل مدرب تخصّه وحده', async () => {
  const now = Date.now();
  const a = await storage.get().upsertUser({ email: mail('a'), name: 'أ', googleId: 'g-a' });
  const b = await storage.get().upsertUser({ email: mail('b'), name: 'ب', googleId: 'g-b' });

  await storage.get().saveActivity({ id: storage.newId('a_'), ownerId: a.id, title: 'لأحمد', settings: {}, questions: [], createdAt: now, updatedAt: now });

  assert.equal((await storage.get().listActivities(a.id)).length, 1);
  assert.equal((await storage.get().listActivities(b.id)).length, 0);
});

test('تحديث النشاط لا يُنشئ نسخة ثانية', async () => {
  const now = Date.now();
  const user = await storage.get().upsertUser({ email: mail('upd'), name: 'م', googleId: 'g-upd' });
  const id = storage.newId('a_');
  const base = { id, ownerId: user.id, title: 'قبل', settings: {}, questions: [], createdAt: now, updatedAt: now };

  await storage.get().saveActivity(base);
  await storage.get().saveActivity({ ...base, title: 'بعد', updatedAt: now + 1000 });

  const list = await storage.get().listActivities(user.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'بعد');

  await storage.get().deleteActivity(id);
  assert.equal((await storage.get().listActivities(user.id)).length, 0);
});

test('upsertUser بنفس البريد يحدّث الحساب لا يكرّره', async () => {
  const email = mail('upsert');
  const first = await storage.get().upsertUser({ email, name: 'الاسم الأول', googleId: 'g-1' });
  const second = await storage.get().upsertUser({ email, name: 'الاسم بعد التحديث', googleId: 'g-1' });

  assert.equal(second.id, first.id, 'نفس الحساب — لا حساب ثانٍ لنفس بريد جوجل');
  const found = await storage.get().findUserByEmail(email);
  assert.equal(found.name, 'الاسم بعد التحديث');
});

test('جلسات الدخول: تُقرأ، وتنتهي بالمدة، وتُحذف', async () => {
  const now = Date.now();
  const user = await storage.get().upsertUser({ email: mail('sess'), name: 'ج', googleId: 'g-sess' });

  await storage.get().createAuthSession({ token: 'tok-live-' + suffix, userId: user.id, expiresAt: now + 60000 });
  const live = await storage.get().getAuthSession('tok-live-' + suffix);
  assert.equal(live.userId, user.id);

  // منتهية الصلاحية لا تُقبل
  await storage.get().createAuthSession({ token: 'tok-old-' + suffix, userId: user.id, expiresAt: now - 1000 });
  assert.equal(await storage.get().getAuthSession('tok-old-' + suffix), null);

  await storage.get().deleteAuthSession('tok-live-' + suffix);
  assert.equal(await storage.get().getAuthSession('tok-live-' + suffix), null);
});
