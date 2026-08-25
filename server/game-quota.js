'use strict';

/**
 * حصّة بناء الألعاب.
 *
 * بناء اللعبة أغلى نداءٍ في المنصّة — ملفٌّ كامل من عشرات آلاف الرموز يكتبه
 * النموذج في دقيقة أو دقيقتين. فالميزة للمشتركين، وللحساب المجاني منها
 * **ذوقٌ لا خدمة**:
 *
 *  - المجاني: لعبتان **مرّةً واحدة في عمر الحساب**، لا تتجدّدان. من أراد
 *    الثالثة اشترك.
 *  - المشترك: عشرون لعبة **كل شهر**، تتجدّد مع الشهر الميلادي.
 *  - المالك: بلا حدّ — يجرّب الميزة ولا يمنح نفسه حصّة.
 *
 * والمحسوب **كل ملفّ لعبةٍ يُنتجه النموذج**، بما فيه التعديلات: هي النداء
 * نفسه وتكلفتها هي التكلفة نفسها. أمّا أدوار الحوار التي لا تنتهي بملفّ
 * (سؤال العمر، اقتراح الأفكار) فلا تُحسب — لم يُبنَ فيها شيء.
 *
 * ولا يُخصم إلا بعد أن يُسلَّم الملفّ فعلاً: من فشل نداؤه لا يدفع ثمنه.
 */

const FREE_TOTAL = Number(process.env.GAME_FREE_TOTAL ?? 2);
const PREMIUM_MONTHLY = Number(process.env.GAME_PREMIUM_MONTHLY ?? 20);

/** مفتاح الشهر الميلادي بتوقيت UTC — YYYY-MM */
function monthKey(at = Date.now()) {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * حال حصّة معلّمٍ الآن.
 *
 * @param {object|null} user حساب المعلّم كما تعيده storage
 * @param {{isPremium:boolean, isAdmin:boolean}} status ملخّص الاشتراك
 * @returns {{plan:string, limit:number|null, used:number, remaining:number, unlimited:boolean, period:string}}
 */
function quotaOf(user, status) {
  if (status?.isAdmin) {
    return { plan: 'admin', limit: null, used: 0, remaining: Infinity, unlimited: true, period: 'none' };
  }
  const builtTotal = Number(user?.gamesBuilt) || 0;

  if (status?.isPremium) {
    // عدّاد شهرٍ مضى ليس عدّاد هذا الشهر: مفتاحٌ قديم يعني أن الحصّة كاملة
    const used = user?.gamesMonthKey === monthKey() ? Number(user?.gamesMonth) || 0 : 0;
    return {
      plan: 'premium',
      limit: PREMIUM_MONTHLY,
      used,
      remaining: Math.max(0, PREMIUM_MONTHLY - used),
      unlimited: false,
      period: 'month',
    };
  }

  return {
    plan: 'free',
    limit: FREE_TOTAL,
    used: builtTotal,
    remaining: Math.max(0, FREE_TOTAL - builtTotal),
    unlimited: false,
    period: 'lifetime',
  };
}

/**
 * الحصّة كما تُرسل إلى المتصفّح.
 *
 * بلا `Infinity` — فهي لا تمرّ من JSON فتصير `null`. ومعها سقفُ المشترك
 * دائماً: الواجهة تقول للمجاني «والاشتراك يفتح كذا كل شهر»، ولو كُتب الرقم
 * في نصّ الترجمة لكذب على المعلّم يوم يتغيّر الإعداد.
 */
function summary(user, status) {
  const q = quotaOf(user, status);
  return { ...q, remaining: q.unlimited ? null : q.remaining, premiumMonthly: PREMIUM_MONTHLY };
}

/**
 * رسالةُ من نفدت حصّته — تقول كم كانت، ومتى تعود، وماذا يفعل.
 * @param {object} q ناتج `quotaOf`
 * @param {object} plan باقة الاشتراك (رقم واتساب وسعرها)
 */
function exhaustedMessage(q, plan) {
  if (q.plan === 'premium') {
    return `بلغت حصّتك الشهرية من بناء الألعاب (${q.limit} لعبة). تتجدّد مع بداية الشهر القادم.`;
  }
  return (
    `الحساب المجاني يبني ${q.limit} لعبة فقط، وقد استعملتهما. ` +
    `اشترك في بريميوم لتبني ${PREMIUM_MONTHLY} لعبة كل شهر — واتساب ${plan?.whatsapp} (${plan?.priceUsd}$ شهرياً).`
  );
}

module.exports = { quotaOf, summary, exhaustedMessage, monthKey, FREE_TOTAL, PREMIUM_MONTHLY };
