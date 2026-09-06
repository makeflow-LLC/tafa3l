'use strict';

/**
 * الباقات الثلاث: المستوى، وسقفُ الطلاب، وحصّةُ الألعاب، ووسمُ الدفع.
 *
 * وما تحرسه هذه الاختبارات قبل كل شيء **ألّا يُسحب من أحدٍ ما بناه**: من كان
 * له حسابٌ قبل السقف مُعفًى منه، ومن تجاوزه بعد انتهاء اشتراكه يبقى كشفُه
 * كما هو ويُمنع من الزيادة وحدها.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-plans-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const storage = require('../server/storage');
const premium = require('../server/premium');
const quota = require('../server/game-quota');
const billing = require('../server/routes-billing');

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
      const mail = `plan.${Math.random().toString(36).slice(2)}@example.com`;
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
      this.email = mail;
      return mail;
    },
  };
}

/** يُنزل حساباً إلى المجّاني (منحة التسجيل تجعله مشتركاً عند إنشائه) */
async function makeFree(email) {
  const user = await storage.get().findUserByEmail(email);
  await storage.get().setPremiumUntil(user.id, null, null);
  return user;
}

async function setTier(email, tier, days = 30) {
  const user = await storage.get().findUserByEmail(email);
  await storage.get().setPremiumUntil(user.id, Date.now() + days * 86400000, tier);
  return user;
}

/** كشفٌ بأسماء مولّدة — أسرعُ من كتابتها واحداً واحداً */
const roster = (n, prefix = 'طالب') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');

// ------------------------------------------------------------------ الوحدة

test('المستوى: مشروطٌ بسريان التاريخ، والقديم يُقرأ أساسياً، والمالك احترافيّ', () => {
  const soon = Date.now() + 86400000;
  assert.equal(premium.tierOf(null), 'free');
  assert.equal(premium.tierOf({ premiumUntil: null }), 'free');
  // انتهى اشتراكه: يعود مجّانياً ولو بقي مستواه مكتوباً في حسابه
  assert.equal(premium.tierOf({ premiumUntil: Date.now() - 1000, tier: 'pro' }), 'free');
  // دفع قبل وجود المستويات: أساسيّ — هو ما كانت المنصّة تبيعه
  assert.equal(premium.tierOf({ premiumUntil: soon }), 'basic');
  assert.equal(premium.tierOf({ premiumUntil: soon, tier: 'pro' }), 'pro');
  // «free» مخزَّنةً مع تاريخٍ ساري ليست باقةً تُشترى — تُقرأ أساسية
  assert.equal(premium.tierOf({ premiumUntil: soon, tier: 'free' }), 'basic');
  assert.equal(premium.isPremium({ premiumUntil: soon, tier: 'pro' }), true);
  assert.equal(premium.atLeast({ premiumUntil: soon }, 'pro'), false);
  assert.equal(premium.atLeast({ premiumUntil: soon, tier: 'pro' }, 'basic'), true);
});

test('الحدود: عشرون ثم خمسون ثم مئتان، والمعفى بلا سقف', () => {
  const soon = Date.now() + 86400000;
  assert.equal(premium.studentLimit(null), 20);
  assert.equal(premium.studentLimit({ premiumUntil: soon }), 50);
  assert.equal(premium.studentLimit({ premiumUntil: soon, tier: 'pro' }), 200);
  assert.equal(premium.studentLimit({ grandfatheredAt: 1 }), Infinity);
  // والإعفاء يعلو على المستوى: حسابٌ قديم مجّانيّ لا يُحاسَب بسقف المجّانية
  assert.equal(premium.studentLimit({ grandfatheredAt: 1, premiumUntil: null }), Infinity);
});

test('المنع على الزيادة وحدها: من تجاوز سقفه يستطيع أن يُنقص لا أن يزيد', () => {
  const free = { premiumUntil: null };
  assert.doesNotThrow(() => premium.assertStudentsAllowed(free, 20, 0));
  assert.throws(() => premium.assertStudentsAllowed(free, 21, 0), /حدّ باقتك/);
  // مشتركٌ انتهى اشتراكه وعنده ستّون: تقليلُهم إلى خمسين يمرّ رغم تجاوز السقف
  assert.doesNotThrow(() => premium.assertStudentsAllowed(free, 50, 60));
  assert.throws(() => premium.assertStudentsAllowed(free, 61, 60));
  // والاحترافيّ عند سقفه يُقال له «احذف» لا «اشترك» — لا باقةَ فوقه
  const pro = { premiumUntil: Date.now() + 86400000, tier: 'pro' };
  assert.throws(() => premium.assertStudentsAllowed(pro, 201, 200), /احذف/);
});

test('ترقيةُ القدامى: من بقي له أكثر من أحد عشر يوماً يصير في الأعلى، والتجربةُ لا تُرقّى', () => {
  const now = Date.UTC(2026, 0, 1);
  const days = (n) => now + n * 86400000;
  assert.equal(premium.PRO_UPGRADE_DAYS, 11);
  assert.equal(premium.deservesProUpgrade({ premiumUntil: days(30) }, now), true);
  assert.equal(premium.deservesProUpgrade({ premiumUntil: days(12) }, now), true);
  // الحدُّ نفسه ليس «أكثر من»
  assert.equal(premium.deservesProUpgrade({ premiumUntil: days(11) }, now), false);
  // منحة التسجيل عشرة أيام: لم تُشترَ بعد فلا تُرقّى
  assert.equal(premium.deservesProUpgrade({ premiumUntil: days(10) }, now), false);
  assert.equal(premium.deservesProUpgrade({ premiumUntil: days(-5) }, now), false);
  assert.equal(premium.deservesProUpgrade({ premiumUntil: null }, now), false);
  assert.equal(premium.deservesProUpgrade(null, now), false);
});

test('حصّة الألعاب: خمس عشرة للأساسية، وخمسٌ وثلاثون للاحترافية', () => {
  assert.equal(quota.monthlyFor('basic'), 15);
  assert.equal(quota.monthlyFor('pro'), 35);
  const basic = quota.quotaOf({ gamesMonth: 3, gamesMonthKey: quota.monthKey() }, { isPremium: true, tier: 'basic' });
  assert.equal(basic.limit, 15);
  assert.equal(basic.remaining, 12);
  const pro = quota.quotaOf({ gamesMonth: 3, gamesMonthKey: quota.monthKey() }, { isPremium: true, tier: 'pro' });
  assert.equal(pro.limit, 35);
  assert.equal(pro.plan, 'pro');
});

test('وسمُ الباقة في دفعة Stripe يُقرأ من مواضعه كلّها', () => {
  assert.equal(billing.tierIn({ metadata: { tier: 'pro' } }), 'pro');
  assert.equal(billing.tierIn({ lines: { data: [{ metadata: { tier: 'basic' } }] } }), 'basic');
  assert.equal(billing.tierIn({ parent: { subscription_details: { metadata: { tier: 'pro' } } } }), 'pro');
  // وسمٌ مجهول لا يُمرَّر كما جاء
  assert.equal(billing.tierIn({ metadata: { tier: 'gold' } }), '');
  assert.equal(billing.tierIn({}), '');
});

test('الباقات المعروضة: ثلاثٌ بأرقامها، والحجز ميزةٌ في الاحترافية لا وعداً', () => {
  const ids = premium.PLANS.map((p) => p.id);
  assert.deepEqual(ids, ['free', 'basic', 'pro']);
  assert.equal(premium.planFor('free').students, 20);
  assert.equal(premium.planFor('basic').students, 50);
  assert.equal(premium.planFor('basic').priceUsd, 5);
  assert.equal(premium.planFor('pro').students, 200);
  assert.equal(premium.planFor('pro').priceUsd, 12);
  assert.equal(premium.planFor('pro').gamesMonthly, 35);
  assert.ok(
    premium.planFor('pro').perks.some((line) => line.includes('حجز مواعيد')),
    'الحجز صار ميزةً منجزة تُعدّ في الباقة'
  );
  assert.ok(!premium.planFor('pro').soon?.length, 'ولم يبقَ فيها ما يُوعد به «قريباً»');
  // المحفظة المحلّية: مبلغٌ لكل مستوى
  assert.equal(premium.LOCAL_PAY.PS.amounts.basic, 15);
  assert.equal(premium.LOCAL_PAY.PS.amounts.pro, 40);
  assert.match(premium.upgradeHint({ country: 'PS' }, 'pro'), /40 شيكل/);
  assert.match(premium.upgradeHint({ country: 'PS' }, 'basic'), /15 شيكل/);
});

// ---------------------------------------------------------------- المسارات

test('المجّاني يُمنع عند العشرين، ويُقال له كم يرفعها الاشتراك', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. مها');
  await makeFree(mail);

  const ok = await teacher.request('POST', '/api/classes', { name: 'السابع', students: roster(20) });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.class.students.length, 20);

  const one = await teacher.request('POST', `/api/classes/${ok.data.class.id}/students`, { name: 'طالب زائد' });
  assert.equal(one.status, 402);
  assert.match(one.data.error, /20 طالباً/);
  assert.match(one.data.error, /50/, 'تقول له كم ترفعه الباقة');

  // وفصلٌ ثانٍ لا يلتفّ على السقف: العدّ على المجموع لا على الفصل
  const second = await teacher.request('POST', '/api/classes', { name: 'الثامن', students: 'طالب جديد' });
  assert.equal(second.status, 402);
});

test('الأساسية خمسون والاحترافية مئتان — والترقية تفتح ما مُنع', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. وليد');
  await setTier(mail, 'basic');

  const cls = (await teacher.request('POST', '/api/classes', { name: 'التاسع', students: roster(50) })).data.class;
  assert.equal(cls.students.length, 50);
  assert.equal((await teacher.request('POST', `/api/classes/${cls.id}/students`, { name: 'زائد' })).status, 402);

  await setTier(mail, 'pro');
  const after = await teacher.request('POST', `/api/classes/${cls.id}/students`, { name: 'زائد' });
  assert.equal(after.status, 201);
  assert.equal(after.data.class.students.length, 51);
});

test('السجلّ التجريبي خارج العدّ: تجربتُه لا تأكل من حصّة المعلّم', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. رائد');
  await makeFree(mail);
  const demo = await teacher.request('POST', '/api/classes/demo');
  assert.equal(demo.status, 201);
  assert.ok(demo.data.class.students.length > 5, 'فصل العرض بطلابه');
  // ومع ذلك يبقى للمعلّم عشرون كاملة
  const mine = await teacher.request('POST', '/api/classes', { name: 'صفّي', students: roster(20) });
  assert.equal(mine.status, 201);
});

test('من تجاوز سقفه (بعد انتهاء اشتراكه) لا يُحبس: كشفُه يبقى ويستطيع تقليله', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. سلمى');
  await setTier(mail, 'pro');
  const cls = (await teacher.request('POST', '/api/classes', { name: 'العاشر', students: roster(60) })).data.class;

  await makeFree(mail);
  // ما بُني باقٍ كما هو — لا يُحذف ولا يُخفى
  const still = await teacher.request('GET', '/api/classes');
  assert.equal(still.data.classes[0].students.length, 60);
  // الزيادة ممنوعة
  assert.equal((await teacher.request('POST', `/api/classes/${cls.id}/students`, { name: 'زائد' })).status, 402);
  // والتقليل مسموح ولو بقي فوق السقف
  const trimmed = await teacher.request('PUT', `/api/classes/${cls.id}`, { students: roster(40) });
  assert.equal(trimmed.status, 200);
  assert.equal(trimmed.data.class.students.length, 40);
});

test('الحساب القديم معفًى من السقف — والجديد لا يُعفى', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. قديم');
  // نختم حسابه كما يختم الترحيلُ من كان موجوداً يوم وُضع السقف
  const user = await makeFree(mail);
  user.grandfatheredAt = user.createdAt;

  const big = await teacher.request('POST', '/api/classes', { name: 'صفٌّ كبير', students: roster(45) });
  assert.equal(big.status, 201);
  assert.equal(big.data.class.students.length, 45);
  const me = await teacher.request('GET', '/api/auth/me');
  assert.equal(me.data.premium.grandfathered, true);
  assert.equal(me.data.premium.limits.students, null, 'بلا سقفٍ يُعرض');
});

test('ملخّص الحساب يحمل المستوى وحدوده والباقات', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. نور');
  await setTier(mail, 'pro');
  const me = await teacher.request('GET', '/api/auth/me');
  assert.equal(me.data.premium.tier, 'pro');
  assert.equal(me.data.premium.limits.students, 200);
  assert.equal(me.data.premium.limits.booking, true);
  assert.equal(me.data.premium.plans.length, 3);

  await setTier(mail, 'basic');
  const basic = await teacher.request('GET', '/api/auth/me');
  assert.equal(basic.data.premium.tier, 'basic');
  assert.equal(basic.data.premium.limits.booking, false);
});
