'use strict';

/**
 * جسر Stripe — بلا مكتبة.
 *
 * واجهة Stripe نداءُ HTTPS بجسمٍ من نوع `x-www-form-urlencoded` ومفتاحٍ في
 * ترويسة `Authorization`، وهذا كل ما نحتاجه: جلسةُ دفعٍ تُنشأ، وبوّابةُ
 * اشتراكٍ تُفتح، وتوقيعُ خطّافٍ يُتحقّق منه. فإضافةُ حزمةٍ كاملة إلى مشروعٍ
 * دفعاتُه ثلاثة نداءات زيادةُ سطح لا زيادةُ قدرة — والمشروع يفعل الشيء نفسه
 * مع Evolink وجوجل.
 *
 * والمفتاح السرّي **لا يغادر الخادم أبداً**: المتصفّح يطلب جلسةً فيأخذ
 * عنوانها عند Stripe، ولا يرى مفتاحاً ولا يلمس واجهة Stripe بنفسه.
 */

const crypto = require('node:crypto');

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 20000;

/** فرقٌ مسموح بين ختم التوقيع والآن — يمنع إعادة بثّ نداءٍ قديم */
const TOLERANCE_SEC = 300;

const secretKey = () => String(process.env.STRIPE_SECRET_KEY || '').trim();
const webhookSecret = () => String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const priceId = () => String(process.env.STRIPE_PRICE_ID || '').trim();

/** هل الدفع بالبطاقة مُفعَّل على هذا الخادم؟ */
function configured() {
  return Boolean(secretKey());
}

/**
 * ترميز شجرةٍ من القيم إلى صيغة Stripe: `a[b][0][c]=v`.
 * الأصفار والفراغات تُحذف كي لا نُرسل حقولاً فارغة تُفسَّر قيماً.
 */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') form(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function call(pathname, body, opts = {}) {
  const key = secretKey();
  if (!key) {
    const err = new Error('الدفع بالبطاقة غير مُفعّل على الخادم');
    err.status = 503;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + pathname, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/x-www-form-urlencoded',
        // مفتاح عدم التكرار: نداءٌ يُعاد بعد انقطاع شبكةٍ لا يُنشئ جلستين
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: form(body).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* ردٌّ ليس JSON — يُعالَج أدناه */
    }
    if (!res.ok) {
      // رسالة Stripe أدقّ من أي رسالةٍ نخترعها، لكنها إنجليزية وموجّهة للمطوّر:
      // تُسجَّل ولا تُعرض للمعلّم كما هي
      const detail = data?.error?.message || text.slice(0, 300);
      const err = new Error('تعذّر بدء الدفع');
      err.status = res.status >= 500 ? 502 : 400;
      err.detail = detail;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * جلسةُ دفعٍ لاشتراكٍ شهري — ويعيد عنوانها عند Stripe.
 *
 * هويّةُ المعلّم تُربط بالدفعة في ثلاثة مواضع عمداً: `client_reference_id`
 * ومعرّفٌ في `metadata` ومثلُه في بيانات الاشتراك. فالخطّاف الذي يصل بعد
 * شهرٍ (فاتورةُ تجديد) لا يحمل الجلسة أصلاً، ووسمُ الاشتراك هو ما يبقى معه.
 *
 * @param {{user:object, origin:string, priceUsd:number, lang?:string}} opts
 */
async function createCheckout({ user, origin, priceUsd, lang }) {
  const price = priceId();
  const item = price
    ? { price, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(Number(priceUsd) * 100),
          recurring: { interval: 'month' },
          product_data: { name: 'Tapio Premium' },
        },
      };

  const session = await call(
    '/checkout/sessions',
    {
      mode: 'subscription',
      'line_items[0]': item,
      // العودة إلى صفحة الدفع نفسها: هي التي تعرف كيف تقول «تمّ» وكيف تنتظر
      success_url: `${origin}/host.html?paid=1#/pay`,
      cancel_url: `${origin}/host.html?paid=0#/pay`,
      client_reference_id: user.id,
      customer_email: user.email,
      locale: lang === 'en' ? 'en' : 'ar',
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
      allow_promotion_codes: 'true',
    },
    { idempotencyKey: `checkout_${user.id}_${Math.floor(Date.now() / 60000)}` }
  );
  return { id: session.id, url: session.url };
}

/**
 * بوّابةُ إدارة الاشتراك: يرى فيها المعلّم فواتيره ويلغي اشتراكه بنفسه.
 *
 * اشتراكٌ شهريّ بلا زرّ إلغاءٍ ظاهر ليس ميزةً بل مصيدة، ولا يصحّ أن يكون
 * طريقُ الإلغاء رسالةَ واتساب ينتظر ردّها.
 */
async function createPortal({ customerId, origin }) {
  const session = await call('/billing_portal/sessions', {
    customer: customerId,
    return_url: `${origin}/host.html#/upgrade`,
  });
  return { url: session.url };
}

/**
 * يتحقّق من توقيع Stripe على جسم الخطّاف الخام.
 *
 * بلا هذا التحقّق يصير المسار باباً مفتوحاً: من عرف عنوانه منح نفسه اشتراكاً
 * برسالةٍ ملفّقة. والمقارنة `timingSafeEqual` لا `===` — فمقارنةُ نصٍّ سرّي
 * حرفاً حرفاً تُسرّب طولَ ما وافق منه.
 *
 * @param {Buffer|string} raw جسم الطلب كما وصل، بلا تحليل
 * @param {string} header قيمة ترويسة `Stripe-Signature`
 * @returns {object|null} الحدث إن صحّ التوقيع، وإلا `null`
 */
function verifyEvent(raw, header) {
  const secret = webhookSecret();
  if (!secret || !raw || !header) return null;

  const parts = String(header)
    .split(',')
    .map((p) => p.split('='));
  const timestamp = parts.find((p) => p[0] === 't')?.[1];
  const signatures = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!timestamp || !signatures.length) return null;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return null;

  const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  const ok = signatures.some((sig) => {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(sig), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

module.exports = { configured, createCheckout, createPortal, verifyEvent, form };
