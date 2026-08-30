'use strict';

/**
 * الدفع بالبطاقة — مسارات المعلّم وخطّاف Stripe.
 *
 * قاعدةُ المنح واحدة في كل مكانٍ هنا: **التاريخ المطلق لا عدد الأيام**.
 *
 * الخطّافات تصل مكرّرة أحياناً (إعادةُ إرسالٍ بعد انقطاع، أو حدثان لدفعةٍ
 * واحدة: `checkout.session.completed` و`invoice.paid`). فلو كان المنح
 * «أضِف ٣١ يوماً» لصار كلُّ تكرارٍ شهراً مجانياً. أمّا `max(القائم، نهايةُ
 * المدة المدفوعة)` فيعطي القيمة نفسها مهما تكرّر — لا سجلَّ أحداثٍ نصونه،
 * ولا تكرارَ يضرّ.
 */

const express = require('express');
const storage = require('./storage');
const premium = require('./premium');
const auth = require('./auth');
const stripe = require('./stripe');

/** مهلةٌ بعد نهاية المدة المدفوعة قبل أن يُغلق الباب — فرقُ ساعاتٍ في تسوية الدفعة لا يُحرم به مشترك */
const GRACE_MS = 3 * 86400000;

/** شهرٌ تقريبيّ حين لا تُعلن الفاتورة نهاية مدّتها */
const MONTH_MS = 31 * 86400000;

const quiet = process.env.PORT === '0' || process.env.NODE_ENV === 'test';
const log = (...args) => !quiet && console.log(...args);

/**
 * أصل الموقع — إليه يعود المعلّم من صفحة Stripe.
 *
 * عنوانُ المنصّة المُعلن أولاً، وترويسة `Host` بديلاً في التطوير: الترويسة
 * يكتبها العميل، ومن زوّرها وجّه عودةَ الدفع إلى موقعه. والمنحُ لا يتأثّر
 * (الخطّاف هو الذي يمنح، لا العودة) لكن المعلّم يستحقّ أن يعود إلى موقعه.
 */
function originOf(req) {
  const declared = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (declared) return declared.replace(/\/+$/, '');
  const proto = req.secure ? 'https' : req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function billingRoutes() {
  const router = express.Router();

  /** ما هي طريقة الدفع المتاحة لهذا المعلّم؟ الواجهة تسأل مرّةً وترسم عليها */
  router.get('/billing/status', (req, res) => {
    res.json({
      card: stripe.configured(),
      priceUsd: premium.PLAN.priceUsd,
      localPay: premium.localPayFor(req.user),
      // بوّابة الإدارة تُفتح لمن دفع بالبطاقة فعلاً — ومنها يلغي اشتراكه بنفسه
      canManage: Boolean(stripe.configured() && req.user?.stripeCustomerId),
    });
  });

  /**
   * بدءُ الدفع: نُنشئ جلسةً عند Stripe ونعيد عنوانها، والمتصفّح ينتقل إليه.
   *
   * ولا نُنشئ جلسةً لمن بلده فلسطين: طريقُه المحفظة المحلّية، وجلسةٌ بالدولار
   * تُفتح له خطأٌ في العرض لا خيارٌ إضافي.
   */
  router.post('/billing/checkout', auth.requireUser, async (req, res) => {
    try {
      if (!stripe.configured()) return res.status(503).json({ error: 'الدفع بالبطاقة غير مُفعّل بعد' });
      if (premium.localPayFor(req.user)) {
        return res.status(400).json({ error: 'الدفع في بلدك يتمّ عبر المحفظة المحلّية' });
      }
      const session = await stripe.createCheckout({
        user: req.user,
        origin: originOf(req),
        priceUsd: premium.PLAN.priceUsd,
        lang: req.body?.lang === 'en' ? 'en' : 'ar',
      });
      res.json({ url: session.url });
    } catch (err) {
      if (err.detail) console.error('Stripe:', err.detail);
      res.status(err.status || 500).json({ error: err.message || 'تعذّر بدء الدفع' });
    }
  });

  /** بوّابةُ Stripe: الفواتير والبطاقة والإلغاء — كلُّها بيد المعلّم لا برسالةٍ إلينا */
  router.post('/billing/portal', auth.requireUser, async (req, res) => {
    try {
      const customer = req.user.stripeCustomerId;
      if (!customer) return res.status(404).json({ error: 'لا يوجد اشتراك بالبطاقة على هذا الحساب' });
      const session = await stripe.createPortal({ customerId: customer, origin: originOf(req) });
      res.json({ url: session.url });
    } catch (err) {
      if (err.detail) console.error('Stripe:', err.detail);
      res.status(err.status || 500).json({ error: err.message || 'تعذّر فتح بوّابة الاشتراك' });
    }
  });

  return router;
}

// ------------------------------------------------------------------ الخطّاف

/** يقرأ معرّف المعلّم من وسوم الحدث — Stripe غيّر مواضعها بين إصداراته، فنقرأ كلّها */
function userIdIn(object) {
  return (
    object?.metadata?.userId ||
    object?.client_reference_id ||
    object?.subscription_details?.metadata?.userId ||
    object?.parent?.subscription_details?.metadata?.userId ||
    object?.lines?.data?.[0]?.metadata?.userId ||
    ''
  );
}

/** نهايةُ المدة المدفوعة بالمللي ثانية — أو صفر إن لم تُعلنها الفاتورة */
function paidUntil(object) {
  const end = Number(object?.lines?.data?.[0]?.period?.end || object?.period_end || 0);
  return Number.isFinite(end) && end > 0 ? end * 1000 : 0;
}

/**
 * يجد صاحب الدفعة: بالوسم أولاً، ثم بمعرّف الزبون، ثم بالبريد.
 * ثلاثة طرقٍ لا واحد — دفعةٌ لا نعرف صاحبها اشتراكٌ دُفع ثمنُه ولم يُفتح.
 */
async function ownerOf(object) {
  const store = storage.get();
  const id = userIdIn(object);
  if (id) {
    const byId = await store.findUserById(id);
    if (byId) return byId;
  }
  const customer = typeof object?.customer === 'string' ? object.customer : object?.customer?.id;
  if (customer) {
    const byCustomer = await store.findUserByStripeCustomer(customer);
    if (byCustomer) return byCustomer;
  }
  const email = object?.customer_email || object?.customer_details?.email;
  if (email) return store.findUserByEmail(String(email).toLowerCase());
  return null;
}

/** يمدّد الاشتراك إلى تاريخٍ مطلق — ولا ينقصه أبداً */
async function grantUntil(user, until) {
  const target = Math.max(Number(user.premiumUntil) || 0, until);
  if (target <= Date.now()) return null;
  return storage.get().setPremiumUntil(user.id, Math.round(target));
}

/**
 * معالجُ الحدث — مفصولٌ عن المسار كي يُختبر بلا خادمٍ ولا توقيع.
 * @returns {Promise<{handled:boolean, reason?:string, until?:number}>}
 */
async function applyEvent(event) {
  const object = event?.data?.object || {};

  if (event?.type === 'checkout.session.completed') {
    if (object.payment_status && object.payment_status !== 'paid' && object.payment_status !== 'no_payment_required') {
      return { handled: false, reason: 'unpaid' };
    }
    const user = await ownerOf(object);
    if (!user) return { handled: false, reason: 'no-user' };
    const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    // ربطُ الزبون بالحساب هنا وحده: فواتير الشهور القادمة لا تحمل غيره
    if (customer && user.stripeCustomerId !== customer) await storage.get().setStripeCustomer(user.id, customer);
    const updated = await grantUntil(user, Date.now() + MONTH_MS);
    return { handled: true, until: updated?.premiumUntil ?? user.premiumUntil };
  }

  // الفاتورة هي الحدث الذي يتكرّر كل شهر: التجديد يمرّ من هنا لا من الجلسة
  if (event?.type === 'invoice.paid' || event?.type === 'invoice.payment_succeeded') {
    const user = await ownerOf(object);
    if (!user) return { handled: false, reason: 'no-user' };
    const end = paidUntil(object);
    const updated = await grantUntil(user, (end || Date.now() + MONTH_MS) + (end ? GRACE_MS : 0));
    return { handled: true, until: updated?.premiumUntil ?? user.premiumUntil };
  }

  /*
   * الإلغاء لا يقطع شيئاً في حينه: من دفع شهره يُكمله. ولذلك لا حدث هنا
   * لـ`customer.subscription.deleted` — الاشتراك ينتهي وحده بانقضاء تاريخه.
   */
  return { handled: false, reason: 'ignored' };
}

/**
 * مسار الخطّاف — يُركَّب في `index.js` **قبل** محلّل JSON لأنه يحتاج الجسم
 * الخام: التوقيع محسوبٌ على البايتات كما أُرسلت، وأي إعادة تركيبٍ للنصّ من
 * كائنٍ محلَّل تكسره.
 */
async function webhook(req, res) {
  const event = stripe.verifyEvent(req.body, req.get('stripe-signature'));
  if (!event) return res.status(400).json({ error: 'توقيع غير صالح' });
  try {
    const out = await applyEvent(event);
    if (out.handled) log('Stripe:', event.type, '→ اشتراك حتى', new Date(out.until || 0).toISOString());
    else if (out.reason === 'no-user') console.error('Stripe: دفعةٌ بلا حسابٍ معروف —', event.id);
    // ٢٠٠ دائماً بعد التوقيع الصحيح: خطأٌ عندنا لا يصحّ أن يجعل Stripe يعيد
    // الإرسال إلى الأبد، والسجلّ هو مكان التشخيص
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook:', err.message);
    res.json({ received: true });
  }
}

module.exports = { billingRoutes, webhook, applyEvent, GRACE_MS, MONTH_MS };
