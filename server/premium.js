'use strict';

/**
 * الاشتراك: ثلاث باقات، ومحورٌ واحد اسمه **المستوى**.
 *
 * كانت المنصّة ثنائية — مشتركٌ أو لا — فكفاها تاريخُ انتهاءٍ واحد. ثم صار
 * للاشتراك درجتان مدفوعتان تختلفان في الحدود لا في وجودها، فاحتجنا محوراً:
 *
 *   free  — بلا اشتراك: عشرون طالباً، ولعبتان في عمر الحساب، وبلا مساعدٍ ذكيّ.
 *   basic — خمسون طالباً، وخمس عشرة لعبة شهرياً، والمساعد والتصدير والصور.
 *   pro   — مئتا طالب، وخمسٌ وثلاثون لعبة شهرياً، ومعها حجز المواعيد.
 *
 * والمستوى المخزَّن في الحساب لا يعمل إلا ما دام `premiumUntil` سارياً —
 * فانتهاءُ الاشتراك يُعيد صاحبه إلى `free` بلا خطوةٍ ثانية، تماماً كما كان.
 *
 * ومن كان له حسابٌ قبل أن توضع حدود الطلاب **معفًى منها** (`grandfatheredAt`):
 * معلّمٌ بنى فصوله على وعدٍ سابق لا يُسحب منه ما بناه.
 */

const gameQuota = require('./game-quota');
const stripe = require('./stripe');

// بريد المالك — يُضبط من متغيّر البيئة، ويبقى بريد صاحب المنصة افتراضاً
// حتى تعمل اللوحة فور النشر بلا إعداد إضافي.
const DEFAULT_ADMIN = 'jihad@makeflow.tech';

/**
 * تجربة التسجيل: كل حسابٍ جديد يُفتح له بريميوم عشرة أيام تلقائياً لحظة
 * إنشائه — بلا طلبٍ ولا رسالة واتساب ولا موافقةٍ يدوية. المعلّم الذي يجرّب
 * المساعد الذكي في دقيقته الأولى هو الذي يعرف لماذا يشترك بعد عشرة أيام.
 * اضبطها صفراً لإيقاف المنحة.
 */
const SIGNUP_TRIAL_DAYS = process.env.PREMIUM_SIGNUP_TRIAL_DAYS === undefined ? 10 : Number(process.env.PREMIUM_SIGNUP_TRIAL_DAYS) || 0;

/**
 * الدفع المحلّي: طريقة دفعٍ لبلدٍ بعينه، مفتاحها رمز البلد.
 *
 * الحوالة الدولية بالدولار ليست خياراً لمعلّمٍ في فلسطين: لا بطاقة ولا حساب
 * بنكيّ يقبلها غالباً، وما بيده محفظةٌ على هاتفه. فمن بلده فلسطين يُساق إلى
 * «جوال باي» بمبلغٍ بالشيكل، ثم يرسل الإيصال على واتساب فيُفعَّل حسابه —
 * وغيره يبقى على الطريق الأصلي بلا تغيير.
 *
 * والأرقام كلها متغيّرات بيئة: رقم محفظةٍ يتغيّر ولا ننشر نسخةً جديدة لأجله.
 */
const BASIC_ILS = Number(process.env.PS_PAY_AMOUNT_ILS) || 15;
const PRO_ILS = Number(process.env.PS_PAY_AMOUNT_ILS_PRO) || 36;

const LOCAL_PAY = {
  PS: {
    country: 'PS',
    method: 'jawwal-pay',
    wallet: process.env.PS_PAY_WALLET || '0597750343',
    amount: BASIC_ILS,
    // مبلغُ كل مستوى بعملة البلد — والقديم `amount` يبقى للأساسية كما كان
    amounts: { basic: BASIC_ILS, pro: PRO_ILS },
    currency: 'ILS',
    // الإيصال يذهب إلى رقمٍ قد يختلف عن رقم صاحب المحفظة، فحقلٌ مستقلّ
    whatsapp: process.env.PS_PAY_WHATSAPP || '970597750343',
  },
};

/** المستويات مرتّبةً من الأدنى إلى الأعلى — الترتيب معنويّ لا شكليّ */
const TIERS = ['free', 'basic', 'pro'];

/**
 * ترقيةٌ تجري **مرّةً واحدة** يوم إطلاق الباقات: من بقي في اشتراكه أكثر من
 * أحد عشر يوماً يصير في الباقة الأعلى بلا زيادةِ ثمن.
 *
 * وهؤلاء هم من اشتروا حين كانت الباقة واحدة، فلا يصحّ أن يجدوا أنفسهم فجأة
 * في «الأدنى» من اثنتين. والحدُّ أحد عشر يوماً لا أقلّ لأن منحة التسجيل عشرة
 * أيام: بها تُميَّز الاشتراكاتُ المدفوعة من التجارب التي لم تُشترَ بعد.
 */
const PRO_UPGRADE_DAYS = 11;

function deservesProUpgrade(user, at = Date.now()) {
  return Boolean(user?.premiumUntil && user.premiumUntil > at + PRO_UPGRADE_DAYS * 86400000);
}

/**
 * حدود كل مستوى.
 *
 * `students` مجموعُ الطلاب في **كل** فصول المعلّم لا في الفصل الواحد: الحدّ
 * على الفصل يُلتفّ عليه بفصلٍ ثانٍ، وهذا هو ما يقيس حجم الاستعمال فعلاً.
 * وفصلُ العرض التجريبي خارج العدّ (انظر routes-account) — أرقامه ليست طلابه.
 */
const LIMITS = {
  free: {
    students: Number(process.env.TIER_FREE_STUDENTS) || 20,
    gamesMonthly: 0,
    ai: false,
    booking: false,
  },
  basic: {
    students: Number(process.env.TIER_BASIC_STUDENTS) || 50,
    gamesMonthly: gameQuota.PREMIUM_MONTHLY,
    ai: true,
    booking: false,
  },
  pro: {
    students: Number(process.env.TIER_PRO_STUDENTS) || 200,
    gamesMonthly: gameQuota.PRO_MONTHLY,
    ai: true,
    booking: true,
  },
};

const PLAN = {
  whatsapp: process.env.PREMIUM_WHATSAPP || '970597034066',
  priceUsd: Number(process.env.PREMIUM_PRICE_USD) || 5,
  perks: ['تصميم النشاط بالذكاء الاصطناعي', 'تصدير النتائج PDF و Excel'],
  signupTrialDays: SIGNUP_TRIAL_DAYS,
  // حصّة بناء الألعاب معروضةً في صفحة الباقات — رقمٌ واحد في الخادم لا رقمان
  // في نصّي ترجمة يفترقان يوم يتغيّر الإعداد
  games: { free: gameQuota.FREE_TOTAL, premiumMonthly: gameQuota.PREMIUM_MONTHLY },
  localPay: LOCAL_PAY,
};

const PRO_PRICE_USD = Number(process.env.PRO_PRICE_USD) || 12;

/**
 * الباقات كما تُعرض في صفحة الاشتراك — مصدرها الخادم لا نصوصُ الواجهة.
 *
 * ولا يُكتب رقمٌ منها في ترجمةٍ أبداً: «٥٠ طالباً» في نصٍّ عربيّ و«٥٠» في
 * إعدادٍ يفترقان يوم يتغيّر الإعداد، فيقرأ المعلّم وعداً غير الذي يُنفَّذ.
 */
const PLANS = [
  {
    id: 'free',
    priceUsd: 0,
    students: LIMITS.free.students,
    gamesLifetime: gameQuota.FREE_TOTAL,
    gamesMonthly: 0,
    perks: ['أنشطة وألعاب بلا حدّ', 'سجلّ الطلاب والواجبات', 'تقارير ونتائج'],
  },
  {
    id: 'basic',
    priceUsd: PLAN.priceUsd,
    students: LIMITS.basic.students,
    gamesMonthly: LIMITS.basic.gamesMonthly,
    perks: ['المساعد الذكيّ لتصميم الأنشطة', 'تصدير النتائج PDF و Excel', 'صور داخل الأسئلة'],
  },
  {
    id: 'pro',
    priceUsd: PRO_PRICE_USD,
    students: LIMITS.pro.students,
    gamesMonthly: LIMITS.pro.gamesMonthly,
    perks: ['كل ما في الأساسية', 'حجز مواعيد مع طلابك من صفحتك العامّة'],
  },
];

/**
 * الدفع بالبطاقة كما تراه الواجهة. خاصيّةٌ محسوبة لا ثابتة: مفتاح Stripe
 * متغيّر بيئة قد يُضبط بعد إقلاع الوحدة (في الاختبارات، وفي أول ضبطٍ على
 * المنصّة)، وقيمةٌ تُجمَّد لحظة `require` تكذب بعده.
 */
Object.defineProperty(PLAN, 'card', {
  enumerable: true,
  get: () => ({ enabled: stripe.configured(), priceUsd: PLAN.priceUsd, currency: 'usd' }),
});

/** طريقة الدفع المحلّية لهذا الحساب — أو `null` فيبقى الدفع الدوليّ */
function localPayFor(user) {
  const code = String(user?.country || '').toUpperCase();
  return LOCAL_PAY[code] || null;
}

/**
 * طريقُ الاشتراك لهذا الحساب — واحدٌ لا خيارات.
 *
 *  - `local`: بلدٌ له محفظةٌ محلّية (فلسطين) — المحفظة ثم إيصالٌ على واتساب.
 *  - `card`: بقيةُ العالم حين يكون Stripe مُفعّلاً — بطاقةٌ وانتهى.
 *  - `contact`: لا هذا ولا ذاك (Stripe غير مُفعّل بعد) — واتساب كما كان.
 *
 * وعرضُ الطريقين معاً كان سيبدو خياراً وهو ليس خياراً: من في فلسطين لا
 * تعمل بطاقته غالباً، ومن خارجها لا محفظة له.
 */
function payMethodFor(user) {
  if (localPayFor(user)) return 'local';
  return stripe.configured() ? 'card' : 'contact';
}

/**
 * جملةٌ تقول للمعلّم كيف يشترك بطريق بلده — تُذيَّل بها رسائل المنع.
 * ومستوى المقصود يغيّر المبلغ لا الطريق: المحفظة نفسها والواتساب نفسه.
 */
function upgradeHint(user, tier = 'basic') {
  const plan = planFor(tier);
  const pay = localPayFor(user);
  if (pay) {
    const amount = pay.amounts?.[tier] || pay.amount;
    return `الدفع ${amount} شيكل شهرياً عبر جوال باي على المحفظة ${pay.wallet}، ثم أرسل الإيصال على واتساب ${pay.whatsapp}`;
  }
  if (stripe.configured()) return `اشترك بالبطاقة (${plan.priceUsd}$ شهرياً) من صفحة الباقات`;
  return `تواصل عبر واتساب ${PLAN.whatsapp} (${plan.priceUsd}$ شهرياً)`;
}

/** مدّة منحة التسجيل بالمللي ثانية — صفرٌ يعني: لا منحة */
function signupTrialMs() {
  return Math.max(0, SIGNUP_TRIAL_DAYS) * 86400000;
}

function adminEmails() {
  const raw = String(process.env.ADMIN_EMAILS || DEFAULT_ADMIN);
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isAdmin(user) {
  return Boolean(user && adminEmails().includes(String(user.email).toLowerCase()));
}

/**
 * مستوى هذا الحساب الآن.
 *
 * والمستوى المخزَّن **مشروطٌ بسريان التاريخ**: من انتهى اشتراكه يعود `free`
 * ولو بقي في حسابه أنه كان `pro` — فلا خطوةَ ثانية تُنسى، ولا مهمّةَ دوريّة
 * تمرّ على الحسابات لتُنزّلها. ومن دفع قبل وجود المستويات لا مستوى مخزَّناً
 * له، فيُقرأ `basic`: هو ما اشتراه وما كانت المنصّة تبيعه يومها.
 */
function tierOf(user) {
  if (!user) return 'free';
  if (isAdmin(user)) return 'pro';
  if (!user.premiumUntil || user.premiumUntil <= Date.now()) return 'free';
  return TIERS.includes(user.tier) && user.tier !== 'free' ? user.tier : 'basic';
}

/** حدود هذا الحساب — مستواه، وإعفاؤه إن كان من الحسابات القديمة */
function limitsFor(user) {
  return LIMITS[tierOf(user)] || LIMITS.free;
}

/**
 * سقفُ الطلاب لهذا المعلّم — أو `Infinity` لمن سبق الحدود.
 *
 * الإعفاء ليس تساهلاً: هؤلاء بنوا فصولهم حين لم يكن للطلاب سقفٌ أصلاً، وسحبُ
 * ما بُني على وعدٍ سابق أسوأ من ألّا نضع سقفاً. والحساب الجديد لا يُختم بهذا
 * الختم أبداً — الترحيل يمرّ مرّةً واحدة على من كان موجوداً يومها.
 */
function studentLimit(user) {
  if (user?.grandfatheredAt) return Infinity;
  return limitsFor(user).students;
}

/** المالك مشترك دائماً — كي يجرّب الميزات دون أن يمنح نفسه اشتراكاً */
function isPremium(user) {
  return tierOf(user) !== 'free';
}

/** هل يملك هذا الحساب مستوى كذا فما فوق؟ */
function atLeast(user, tier) {
  return TIERS.indexOf(tierOf(user)) >= TIERS.indexOf(tier);
}

/** الباقة التي تُقترح على من بلغ سقفه — أوّلُ باقةٍ تتّسع لما يريد */
function planFor(tier) {
  return PLANS.find((p) => p.id === tier) || PLANS[0];
}

/** كم يوماً بقي من الاشتراك الحالي (صفرٌ إن لا اشتراك) — للعدّاد في الواجهة */
function daysLeft(user) {
  if (!user?.premiumUntil || user.premiumUntil <= Date.now()) return 0;
  return Math.ceil((user.premiumUntil - Date.now()) / 86400000);
}

/**
 * هل هذا الحساب يعيش منحة تسجيله الآن؟
 *
 * وجود `trialGrantedAt` وحده لا يكفي: المعلّم الذي اشترك بعد تجربته يبقى
 * أثر منحته في حسابه إلى الأبد، فكان سيُقال له «لديك أيام مجانية» وهو دافع.
 * لذا نشترط أن يكون تاريخ الانتهاء هو تاريخ المنحة كما مُنحت تماماً — أيّ
 * تمديدٍ من المالك يجعلها اشتراكاً لا تجربة. والمالك مستثنى: هو مشتركٌ دائماً.
 */
function onSignupTrial(user) {
  if (!user || isAdmin(user)) return false;
  if (!user.trialGrantedAt || !user.premiumUntil) return false;
  if (user.premiumUntil <= Date.now()) return false;
  return user.premiumUntil === user.trialGrantedAt + signupTrialMs();
}

/** ملخّص يُرسل للمتصفح — بلا أي بيانات حساسة */
function summary(user) {
  const tier = tierOf(user);
  return {
    isPremium: isPremium(user),
    isAdmin: isAdmin(user),
    premiumUntil: user?.premiumUntil ?? null,
    daysLeft: daysLeft(user),
    // منحة التسجيل: نميّزها عن الاشتراك المدفوع كي تعرف الواجهة ماذا تقول
    onSignupTrial: onSignupTrial(user),
    plan: PLAN,
    // المستوى وحدوده والباقات كلّها: الواجهة ترسم عليها ولا تحفظ رقماً عندها
    tier,
    limits: { ...LIMITS[tier], students: studentLimit(user) === Infinity ? null : LIMITS[tier].students },
    grandfathered: Boolean(user?.grandfatheredAt),
    plans: PLANS,
  };
}

function requirePremium(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  if (!isPremium(req.user)) {
    return res.status(402).json({
      error: `هذه ميزة بريميوم — للاشتراك ${upgradeHint(req.user)}`,
      upgrade: PLAN,
    });
  }
  next();
}

/**
 * صور الأسئلة ميزة بريميوم: نرفض الإنشاء بدل حذف الصورة صامتاً كي يعرف
 * المدرب سبب اختفائها. تُستدعى قبل إنشاء الجلسة أو حفظ النشاط.
 */
function assertImagesAllowed(user, questions) {
  const hasImage = (Array.isArray(questions) ? questions : []).some((q) => typeof q?.image === 'string' && q.image.trim());
  if (!hasImage || isPremium(user)) return;
  const err = new Error(`إضافة صورة إلى السؤال ميزة بريميوم — للاشتراك ${upgradeHint(user)}`);
  err.status = 402;
  throw err;
}

/**
 * بوّابةُ مستوى: ميزةٌ لا تُفتح إلا لمن بلغ مستواها فما فوق.
 * تُستعمل لما هو حكرٌ على الاحترافية (الحجز)، بخلاف `requirePremium` التي
 * تكفيها أي باقةٍ مدفوعة.
 */
function requireTier(tier) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
    if (!atLeast(req.user, tier)) {
      const plan = planFor(tier);
      return res.status(402).json({
        error: `هذه الميزة في الباقة الاحترافية (${plan.priceUsd}$ شهرياً) — ${upgradeHint(req.user, tier)}`,
        upgrade: plan,
      });
    }
    next();
  };
}

/**
 * يمنع تجاوز سقف الطلاب — ويقول الحدّ والباقة التي ترفعه.
 *
 * @param {object} user المعلّم
 * @param {number} next عدد الطلاب بعد هذه الإضافة
 * @param {number} [current] عددهم قبلها — من كان فوق سقفه (بعد انتهاء
 *   اشتراكه) لا يُمنع من **تقليلهم**: المنع على الإضافة وحدها، فلا يُحبس
 *   معلّمٌ في قائمةٍ لا يستطيع تحريرها.
 */
function assertStudentsAllowed(user, next, current = 0) {
  const limit = studentLimit(user);
  if (next <= limit || next <= current) return;
  const tier = tierOf(user);
  const upgrade = tier === 'free' ? 'basic' : 'pro';
  const bigger = planFor(upgrade);
  const err = new Error(
    tier === 'pro'
      ? `بلغت الحدّ الأقصى (${limit} طالباً) — احذف طلاباً لم يعودوا في فصولك`
      : `بلغت حدّ باقتك (${limit} طالباً). باقة ${bigger.priceUsd}$ ترفعه إلى ${bigger.students} طالباً — ${upgradeHint(user, upgrade)}`
  );
  err.status = tier === 'pro' ? 409 : 402;
  err.upgrade = bigger;
  throw err;
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  // 404 لا 403: لا نكشف وجود لوحة مالك أصلاً لغير المالك
  if (!isAdmin(req.user)) return res.status(404).json({ error: 'الصفحة غير موجودة' });
  next();
}

module.exports = {
  PLAN,
  PLANS,
  TIERS,
  LIMITS,
  PRO_UPGRADE_DAYS,
  deservesProUpgrade,
  LOCAL_PAY,
  localPayFor,
  payMethodFor,
  upgradeHint,
  isAdmin,
  isPremium,
  tierOf,
  atLeast,
  limitsFor,
  studentLimit,
  planFor,
  requireTier,
  assertStudentsAllowed,
  summary,
  daysLeft,
  onSignupTrial,
  signupTrialMs,
  requirePremium,
  requireAdmin,
  adminEmails,
  assertImagesAllowed,
};
