'use strict';

/**
 * حصّة بناء الألعاب — الحساب وحده، بلا خادم ولا قاعدة.
 *
 * المجاني لعبتان في العمر، والمشترك خمس عشرة في الشهر، والمالك بلا حدّ.
 * وأدقّ ما فيها انقلابُ الشهر: عدّادٌ لا يُصفَّر يمنع المشترك من حقّه، وعدّادٌ
 * يُصفَّر في غير موضعه يمنح المجاني ما ليس له.
 */

const test = require('node:test');
const assert = require('node:assert');
const quota = require('../server/game-quota');

const FREE = { isPremium: false, isAdmin: false };
const PREMIUM = { isPremium: true, isAdmin: false };
const ADMIN = { isPremium: true, isAdmin: true };

const now = quota.monthKey();
const past = '2000-01';

test('المجاني: لعبتان في العمر، ثم لا شيء', () => {
  assert.deepEqual(pick(quota.quotaOf({ gamesBuilt: 0 }, FREE)), { plan: 'free', limit: 2, used: 0, remaining: 2, period: 'lifetime' });
  assert.equal(quota.quotaOf({ gamesBuilt: 1 }, FREE).remaining, 1);
  assert.equal(quota.quotaOf({ gamesBuilt: 2 }, FREE).remaining, 0);
});

test('المجاني: انقلاب الشهر لا يعيد له شيئاً — حصّته في العمر', () => {
  const user = { gamesBuilt: 2, gamesMonth: 2, gamesMonthKey: past };
  assert.equal(quota.quotaOf(user, FREE).remaining, 0);
});

test('المجاني: من بنى وهو مشترك ثم انتهى اشتراكه لا يستأنف بلعبتين', () => {
  // مجموع العمر هو المرجع، فمن استهلك خمساً وهو مشترك ليس له «لعبتان جديدتان»
  assert.equal(quota.quotaOf({ gamesBuilt: 5, gamesMonth: 5, gamesMonthKey: now }, FREE).remaining, 0);
});

test('المشترك: خمس عشرة في الشهر، والعدّاد يُقرأ من مفتاح هذا الشهر وحده', () => {
  assert.deepEqual(pick(quota.quotaOf({ gamesBuilt: 40, gamesMonth: 3, gamesMonthKey: now }, PREMIUM)), {
    plan: 'premium',
    limit: 15,
    used: 3,
    remaining: 12,
    period: 'month',
  });
  // مفتاحٌ من شهرٍ ماضٍ = الحصّة كاملة، بلا مهمّةٍ دوريّة تصفّر العدّادات
  assert.equal(quota.quotaOf({ gamesBuilt: 40, gamesMonth: 15, gamesMonthKey: past }, PREMIUM).remaining, 15);
  // ولا حسابَ لمجموع العمر عليه: مئةُ لعبةٍ سابقة لا تنقص شهره
  assert.equal(quota.quotaOf({ gamesBuilt: 100, gamesMonth: 0, gamesMonthKey: now }, PREMIUM).remaining, 15);
});

test('المشترك: الحصّة لا تصير سالبة مهما تجاوز العدّاد', () => {
  assert.equal(quota.quotaOf({ gamesMonth: 40, gamesMonthKey: now }, PREMIUM).remaining, 0);
});

test('المالك بلا حدّ — يجرّب الميزة ولا يمنح نفسه حصّة', () => {
  const q = quota.quotaOf({ gamesBuilt: 999 }, ADMIN);
  assert.equal(q.unlimited, true);
  assert.equal(q.remaining, Infinity);
  // وInfinity لا تمرّ من JSON، فما يصل المتصفّح null لا صفر
  assert.equal(quota.summary({ gamesBuilt: 999 }, ADMIN).remaining, null);
});

test('حسابٌ جديد بلا عدّادات يُقرأ صفراً لا NaN', () => {
  assert.equal(quota.quotaOf({}, FREE).remaining, 2);
  assert.equal(quota.quotaOf(null, FREE).remaining, 2);
  assert.equal(quota.quotaOf({ gamesMonth: undefined, gamesMonthKey: undefined }, PREMIUM).remaining, 15);
});

test('رسالةُ النفاد تقول ماذا يفعل لا «ممنوع» وحدها', () => {
  const plan = { whatsapp: '970000000', priceUsd: 5 };
  const free = quota.exhaustedMessage(quota.quotaOf({ gamesBuilt: 2 }, FREE), plan);
  assert.match(free, /اشترك/);
  assert.match(free, /970000000/);
  const paid = quota.exhaustedMessage(quota.quotaOf({ gamesMonth: 15, gamesMonthKey: now }, PREMIUM), plan);
  assert.match(paid, /الشهر القادم/);
  // المشترك لا يُساق إلى اشتراكٍ هو فيه: حصّته تعود مع الشهر
  assert.equal(/واتساب/.test(paid), false);
});

test('من تعمل بطاقته يُقال له «ادفع» لا «راسلنا»', () => {
  const q = quota.quotaOf({ gamesBuilt: 2 }, FREE);
  const withCard = quota.exhaustedMessage(q, { whatsapp: '970000000', priceUsd: 5, card: { enabled: true, priceUsd: 5 } });
  assert.match(withCard, /بالبطاقة/);
  // ورقمُ واتساب لا يُعرض لمن يستطيع الاشتراك في نصف دقيقة
  assert.equal(/970000000/.test(withCard), false);
});

test('مفتاح الشهر YYYY-MM بتوقيت UTC — فلا يختلف باختلاف خادم', () => {
  assert.equal(quota.monthKey(Date.UTC(2026, 0, 1, 0, 0, 0)), '2026-01');
  assert.equal(quota.monthKey(Date.UTC(2026, 11, 31, 23, 59, 59)), '2026-12');
});

function pick(q) {
  return { plan: q.plan, limit: q.limit, used: q.used, remaining: q.remaining, period: q.period };
}

test('سقف المشترك يُرسل مع كل حصّة — فلا يُكتب رقمٌ في نصٍّ يكذب يوم يتغيّر', () => {
  assert.equal(quota.summary({ gamesBuilt: 0 }, FREE).premiumMonthly, quota.PREMIUM_MONTHLY);
  assert.equal(quota.summary({}, ADMIN).premiumMonthly, quota.PREMIUM_MONTHLY);
});
