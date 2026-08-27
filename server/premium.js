'use strict';

/**
 * اشتراك «بريميوم»: يفتح تصميم النشاط بالذكاء الاصطناعي وتصدير النتائج.
 * الاشتراك يدوي حالياً — يتواصل المدرب عبر واتساب، ويمدّد المالك المدة من
 * لوحة المالك. لذا كل ما نحتاجه هنا تاريخ انتهاء واحد لكل حساب.
 */

const gameQuota = require('./game-quota');

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
const LOCAL_PAY = {
  PS: {
    country: 'PS',
    method: 'jawwal-pay',
    wallet: process.env.PS_PAY_WALLET || '0597750343',
    amount: Number(process.env.PS_PAY_AMOUNT_ILS) || 15,
    currency: 'ILS',
    // الإيصال يذهب إلى رقمٍ قد يختلف عن رقم صاحب المحفظة، فحقلٌ مستقلّ
    whatsapp: process.env.PS_PAY_WHATSAPP || '970597750343',
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

/** طريقة الدفع المحلّية لهذا الحساب — أو `null` فيبقى الدفع الدوليّ */
function localPayFor(user) {
  const code = String(user?.country || '').toUpperCase();
  return LOCAL_PAY[code] || null;
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

/** المالك مشترك دائماً — كي يجرّب الميزات دون أن يمنح نفسه اشتراكاً */
function isPremium(user) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return Boolean(user.premiumUntil && user.premiumUntil > Date.now());
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
  return {
    isPremium: isPremium(user),
    isAdmin: isAdmin(user),
    premiumUntil: user?.premiumUntil ?? null,
    daysLeft: daysLeft(user),
    // منحة التسجيل: نميّزها عن الاشتراك المدفوع كي تعرف الواجهة ماذا تقول
    onSignupTrial: onSignupTrial(user),
    plan: PLAN,
  };
}

function requirePremium(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  if (!isPremium(req.user)) {
    return res.status(402).json({
      error: `هذه ميزة بريميوم — للاشتراك تواصل عبر واتساب ${PLAN.whatsapp} (${PLAN.priceUsd}$ شهرياً)`,
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
  const err = new Error(
    `إضافة صورة إلى السؤال ميزة بريميوم — للاشتراك تواصل عبر واتساب ${PLAN.whatsapp} (${PLAN.priceUsd}$ شهرياً)`
  );
  err.status = 402;
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
  LOCAL_PAY,
  localPayFor,
  isAdmin,
  isPremium,
  summary,
  daysLeft,
  onSignupTrial,
  signupTrialMs,
  requirePremium,
  requireAdmin,
  adminEmails,
  assertImagesAllowed,
};
