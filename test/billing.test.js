'use strict';

/**
 * الدفع بالبطاقة: بوّابةُ البلد، وتوقيعُ الخطّاف، وقاعدةُ المنح.
 *
 * وأدقّ ما هنا **التكرار**: Stripe يرسل حدثين لدفعةٍ واحدة، ويعيد الإرسال عند
 * انقطاع. فمنحٌ يجمع الأيام يعني شهراً مجانياً مع كل تكرار — والاختبار يبعث
 * الحدث نفسه مرّتين ويتأكّد أن التاريخ لم يتحرّك.
 *
 * ونداءُ Stripe الحقيقي مُستبدَل بردٍّ مزيّف: لا مفتاح حقيقيّ في اختبار.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-bill-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_do_not_use';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.PREMIUM_SIGNUP_TRIAL_DAYS = '0';

const { server, ready } = require('../server/index');
const storage = require('../server/storage');
const premium = require('../server/premium');
const billing = require('../server/routes-billing');

const DAY = 86400000;
let base;

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    async request(method, urlPath, body) {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* بلا جسم */
      }
      return { status: res.status, data };
    },
  };
}

/** جوجل مزيّفة للدخول، وStripe مزيّفة للجلسة */
function mockUpstream({ email, sub = 'g_bill_' + Math.random().toString(36).slice(2), stripe }) {
  const original = global.fetch;
  const seen = { stripe: [] };
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) };
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return { ok: true, json: async () => ({ sub, email, email_verified: true, name: 'مدرب' }) };
    }
    if (u.startsWith('https://api.stripe.com/')) {
      seen.stripe.push({ url: u, body: String(opts.body), auth: opts.headers.Authorization });
      return stripe ? stripe(u) : { ok: true, status: 200, text: async () => JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) };
    }
    return original(url, opts);
  };
  return { seen, restore: () => (global.fetch = original) };
}

async function login(c) {
  const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await fetch(`${base}/api/auth/google/callback?code=fake&state=${state}`, {
    redirect: 'manual',
    headers: { Cookie: stateCookie.split(';')[0] },
  });
  c.cookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
}

/** يبعث حدثاً موقّعاً كما يبعثه Stripe تماماً */
async function sendEvent(event, { secret = process.env.STRIPE_WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const payload = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(`${at}.${payload}`).digest('hex');
  const res = await fetch(base + '/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${at},v1=${sig}` },
    body: payload,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const userOf = async (email) => storage.get().findUserByEmail(email);

// ------------------------------------------------------------- بوّابة البلد

test('حالة الدفع تقول طريقاً واحداً بحسب البلد — لا قائمة طرق', async () => {
  const email = 'card-status@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);

    await storage.get().updateProfile(user.id, { country: 'MA' });
    const abroad = await c.request('GET', '/api/billing/status');
    assert.equal(abroad.data.card, true, 'خارج فلسطين: البطاقة');
    assert.equal(abroad.data.localPay, null, 'ولا محفظة محلّية');

    await storage.get().updateProfile(user.id, { country: 'PS' });
    const home = await c.request('GET', '/api/billing/status');
    assert.equal(home.data.localPay.wallet, '0597750343', 'في فلسطين: المحفظة');
    assert.equal(premium.payMethodFor(await userOf(email)), 'local');
    // والمفتاح السرّي لا يظهر في أي ردّ مهما كان
    assert.equal(JSON.stringify(home.data).includes('sk_test'), false);
  } finally {
    mock.restore();
  }
});

test('الفلسطينيّ لا تُفتح له جلسة بطاقة أصلاً — طريقُه المحفظة', async () => {
  const email = 'ps-card@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    await storage.get().updateProfile((await userOf(email)).id, { country: 'PS' });
    const res = await c.request('POST', '/api/billing/checkout', {});
    assert.equal(res.status, 400);
    assert.equal(mock.seen.stripe.length, 0, 'ولا نداءَ إلى Stripe أصلاً');
  } finally {
    mock.restore();
  }
});

test('بلا حساب لا جلسة دفع', async () => {
  const res = await client().request('POST', '/api/billing/checkout', {});
  assert.equal(res.status, 401);
});

test('جلسة الدفع تحمل هوية المعلّم في ثلاثة مواضع — وإلا ضاعت دفعته', async () => {
  const email = 'checkout@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);
    await storage.get().updateProfile(user.id, { country: 'JO' });

    const res = await c.request('POST', '/api/billing/checkout', { lang: 'ar' });
    assert.equal(res.status, 200);
    assert.match(res.data.url, /^https:\/\/checkout\.stripe\.com\//);

    const call = mock.seen.stripe[0];
    assert.match(call.url, /\/v1\/checkout\/sessions$/);
    assert.equal(call.auth, 'Bearer sk_test_do_not_use');
    const sent = new URLSearchParams(call.body);
    assert.equal(sent.get('mode'), 'subscription');
    assert.equal(sent.get('client_reference_id'), user.id);
    assert.equal(sent.get('metadata[userId]'), user.id);
    assert.equal(sent.get('subscription_data[metadata][userId]'), user.id);
    assert.equal(sent.get('customer_email'), email);
    // بلا `STRIPE_PRICE_ID` يُرسل السعر صراحةً: ٥ دولارات شهرياً
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '500');
    assert.equal(sent.get('line_items[0][price_data][recurring][interval]'), 'month');
  } finally {
    mock.restore();
  }
});

// ------------------------------------------------------------------ الخطّاف

test('خطّافٌ بلا توقيعٍ صحيح يُرفض — وإلا منح كلُّ من عرف العنوان نفسه اشتراكاً', async () => {
  const email = 'forged@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);

    const event = { id: 'evt_forged', type: 'checkout.session.completed', data: { object: { client_reference_id: user.id, payment_status: 'paid' } } };

    const noSig = await fetch(base + '/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    assert.equal(noSig.status, 400, 'بلا ترويسة توقيع');

    const wrongKey = await sendEvent(event, { secret: 'whsec_attacker' });
    assert.equal(wrongKey.status, 400, 'بمفتاحٍ غير مفتاحنا');

    const old = await sendEvent(event, { at: Math.floor(Date.now() / 1000) - 3600 });
    assert.equal(old.status, 400, 'وبتوقيعٍ صحيحٍ لكنه قديم — إعادةُ بثٍّ لا تمرّ');

    assert.equal((await storage.get().findUserById(user.id)).premiumUntil ?? null, null, 'ولم يُمنح شيء');
  } finally {
    mock.restore();
  }
});

test('دفعةٌ ناجحة تفتح الاشتراك وتربط الزبون بالحساب', async () => {
  const email = 'paid@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);

    const res = await sendEvent({
      id: 'evt_ok',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: user.id, customer: 'cus_123', payment_status: 'paid', mode: 'subscription' } },
    });
    assert.equal(res.status, 200);

    const after = await storage.get().findUserById(user.id);
    assert.ok(after.premiumUntil > Date.now() + 25 * DAY, 'شهرٌ كامل على الأقل');
    assert.equal(premium.isPremium(after), true);
    // معرّف الزبون هو الرابط الوحيد الباقي لفواتير الشهور القادمة
    assert.equal((await storage.get().findUserByStripeCustomer('cus_123')).id, user.id);
  } finally {
    mock.restore();
  }
});

test('التجديد يمدّد إلى نهاية المدة المدفوعة، وتكرارُ الحدث لا يمدّد يوماً واحداً', async () => {
  const email = 'renew@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);
    await storage.get().setStripeCustomer(user.id, 'cus_renew');

    const periodEnd = Math.floor((Date.now() + 30 * DAY) / 1000);
    const invoice = {
      id: 'evt_inv',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_renew', lines: { data: [{ period: { end: periodEnd } }] } } },
    };

    await sendEvent(invoice);
    const once = (await storage.get().findUserById(user.id)).premiumUntil;
    assert.equal(once, periodEnd * 1000 + billing.GRACE_MS, 'التاريخ من الفاتورة لا من عدّادٍ عندنا');

    // Stripe يعيد الإرسال عند أي انقطاع، والحدثان (الجلسة والفاتورة) لدفعةٍ واحدة
    await sendEvent(invoice);
    await sendEvent(invoice);
    assert.equal((await storage.get().findUserById(user.id)).premiumUntil, once, 'التكرار لا يمنح شهراً إضافياً');
  } finally {
    mock.restore();
  }
});

test('الفاتورة تجد صاحبها بالبريد وإن سبقت ربطَ الزبون بالحساب', async () => {
  const email = 'by-mail@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);

    const out = await billing.applyEvent({
      type: 'invoice.paid',
      data: { object: { customer: 'cus_unknown', customer_email: email, lines: { data: [{ period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] } } },
    });
    assert.equal(out.handled, true);
    assert.equal(premium.isPremium(await storage.get().findUserById(user.id)), true);
  } finally {
    mock.restore();
  }
});

test('جلسةٌ لم تُدفع لا تفتح شيئاً، وحدثٌ لا يعنينا يُهمَل بهدوء', async () => {
  const email = 'unpaid@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);

    const unpaid = await billing.applyEvent({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: user.id, payment_status: 'unpaid' } },
    });
    assert.equal(unpaid.handled, false);
    assert.equal((await storage.get().findUserById(user.id)).premiumUntil ?? null, null);

    const other = await billing.applyEvent({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_x' } } });
    assert.equal(other.handled, false);
    // الإلغاء لا يقطع المدة المدفوعة: من دفع شهره يُكمله
    assert.equal((await storage.get().findUserById(user.id)).premiumUntil ?? null, null);
  } finally {
    mock.restore();
  }
});

test('المنح لا ينقص اشتراكاً قائماً مهما تأخّرت فاتورة', async () => {
  const email = 'long@example.com';
  const mock = mockUpstream({ email });
  try {
    const c = client();
    await login(c);
    const user = await userOf(email);
    const far = Date.now() + 300 * DAY;
    await storage.get().setPremiumUntil(user.id, far);

    await billing.applyEvent({
      type: 'invoice.paid',
      data: { object: { customer: 'cus_none', customer_email: email, lines: { data: [{ period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] } } },
    });
    assert.equal((await storage.get().findUserById(user.id)).premiumUntil, far, 'الأبعد يبقى');
  } finally {
    mock.restore();
  }
});

test('فحصُ الصحة يفصل أعطال الدفع الثلاثة — بلا كشف قيمةٍ من أي مفتاح', async () => {
  const res = await client().request('GET', '/api/health');
  assert.deepEqual(res.data.payments, { card: true, mode: 'test', webhookReady: true, pricePinned: false, priceUsd: 5 });
  // المفاتيح نفسها لا تظهر في الردّ مهما كانت الراية
  const body = JSON.stringify(res.data);
  assert.equal(body.includes('sk_test_do_not_use'), false);
  assert.equal(body.includes('whsec_test_secret'), false);
});
