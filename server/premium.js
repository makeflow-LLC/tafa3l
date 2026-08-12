'use strict';

/**
 * اشتراك «بريميوم»: يفتح تصميم النشاط بالذكاء الاصطناعي وتصدير النتائج.
 * الاشتراك يدوي حالياً — يتواصل المدرب عبر واتساب، ويمدّد المالك المدة من
 * لوحة المالك. لذا كل ما نحتاجه هنا تاريخ انتهاء واحد لكل حساب.
 */

// بريد المالك — يُضبط من متغيّر البيئة، ويبقى بريد صاحب المنصة افتراضاً
// حتى تعمل اللوحة فور النشر بلا إعداد إضافي.
const DEFAULT_ADMIN = 'jihad@makeflow.tech';

const PLAN = {
  whatsapp: process.env.PREMIUM_WHATSAPP || '970597034066',
  priceUsd: Number(process.env.PREMIUM_PRICE_USD) || 3,
  perks: ['تصميم النشاط بالذكاء الاصطناعي', 'تصدير النتائج PDF و Excel'],
};

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

/** ملخّص يُرسل للمتصفح — بلا أي بيانات حساسة */
function summary(user) {
  return {
    isPremium: isPremium(user),
    isAdmin: isAdmin(user),
    premiumUntil: user?.premiumUntil ?? null,
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

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  // 404 لا 403: لا نكشف وجود لوحة مالك أصلاً لغير المالك
  if (!isAdmin(req.user)) return res.status(404).json({ error: 'الصفحة غير موجودة' });
  next();
}

module.exports = { PLAN, isAdmin, isPremium, summary, requirePremium, requireAdmin, adminEmails };
