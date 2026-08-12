'use strict';

/**
 * اختبار الاشتراك ولوحة المالك: من يملك الميزة، ومن يستطيع تمديدها،
 * وأن التمديد والخصم والإلغاء تعمل كما يتوقّع المالك.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-prem-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.ADMIN_EMAILS = 'owner@tapio.fun';
const { server, ready } = require('../server/index');
const premium = require('../server/premium');

let base;
const DAY = 86400000;

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
    async login(email, name) {
      const original = global.fetch;
      global.fetch = async (url, opts) => {
        const u = String(url);
        if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
        if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
          return { ok: true, json: async () => ({ sub: 'g_' + email, email, email_verified: true, name }) };
        }
        return original(url, opts);
      };
      try {
        const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
        const stateCookie = (start.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_oauth='));
        const state = new URL(start.headers.get('location')).searchParams.get('state');
        const cb = await fetch(`${base}/api/auth/google/callback?code=fake&state=${state}`, {
          redirect: 'manual',
          headers: { Cookie: stateCookie.split(';')[0] },
        });
        cookie = (cb.headers.getSetCookie?.() || []).find((h) => h.startsWith('tafa3l_sid=')).split(';')[0];
      } finally {
        global.fetch = original;
      }
    },
  };
}

// ------------------------------------------------------------------ وحدات

test('حساب بلا اشتراك ليس بريميوم، والمنتهي كذلك، والساري نعم', () => {
  assert.equal(premium.isPremium({ email: 'a@b.com', premiumUntil: null }), false);
  assert.equal(premium.isPremium({ email: 'a@b.com', premiumUntil: Date.now() - DAY }), false);
  assert.equal(premium.isPremium({ email: 'a@b.com', premiumUntil: Date.now() + DAY }), true);
});

test('المالك بريميوم دائماً بلا أن يمنح نفسه اشتراكاً', () => {
  assert.equal(premium.isAdmin({ email: 'owner@tapio.fun' }), true);
  assert.equal(premium.isPremium({ email: 'owner@tapio.fun', premiumUntil: null }), true);
  assert.equal(premium.isAdmin({ email: 'OWNER@TAPIO.FUN' }), true, 'حالة الأحرف لا تهم');
});

// ------------------------------------------------------------------ المسار

test('لوحة المالك محجوبة عن المدربين العاديين (بلا كشف وجودها)', async () => {
  const teacher = client();
  await teacher.login('teacher1@example.com', 'مدرب');
  const list = await teacher.request('GET', '/api/admin/users');
  assert.equal(list.status, 404);
});

test('المالك يرى المدربين ويمدّد ويخصم ويلغي', async () => {
  const teacher = client();
  await teacher.login('teacher2@example.com', 'سارة');
  const before = await teacher.request('GET', '/api/auth/me');
  assert.equal(before.data.premium.isPremium, false, 'يبدأ حساباً مجانياً');
  assert.equal(before.data.premium.plan.whatsapp, '970597034066');
  assert.equal(before.data.premium.plan.priceUsd, 3);

  const owner = client();
  await owner.login('owner@tapio.fun', 'المالك');
  const list = await owner.request('GET', '/api/admin/users');
  assert.equal(list.status, 200);
  const target = list.data.users.find((u) => u.email === 'teacher2@example.com');
  assert.ok(target, 'المدرب يظهر في القائمة');
  assert.ok(target.createdAt > 0, 'تاريخ التسجيل ظاهر');
  assert.equal(target.premiumUntil, null);

  // +30 يوماً
  const added = await owner.request('POST', `/api/admin/users/${target.id}/premium`, { addDays: 30 });
  assert.equal(added.status, 200);
  assert.equal(added.data.user.isPremium, true);
  const until = added.data.user.premiumUntil;
  assert.ok(Math.abs(until - (Date.now() + 30 * DAY)) < 60000, 'شهر من اليوم');

  // +30 أخرى تُضاف فوق المتبقّي لا من اليوم
  const extended = await owner.request('POST', `/api/admin/users/${target.id}/premium`, { addDays: 30 });
  assert.ok(Math.abs(extended.data.user.premiumUntil - (until + 30 * DAY)) < 60000, 'تراكمية');

  // المدرب نفسه يرى اشتراكه الآن
  const after = await teacher.request('GET', '/api/auth/me');
  assert.equal(after.data.premium.isPremium, true);

  // خصم أكبر من المتبقّي = إلغاء
  const cut = await owner.request('POST', `/api/admin/users/${target.id}/premium`, { addDays: -365 });
  assert.equal(cut.data.user.premiumUntil, null);
  assert.equal(cut.data.user.isPremium, false);

  // تاريخ صريح
  const stamp = Date.now() + 100 * DAY;
  const dated = await owner.request('POST', `/api/admin/users/${target.id}/premium`, { until: stamp });
  assert.equal(dated.data.user.premiumUntil, stamp);

  // تاريخ في الماضي يعني إلغاء لا اشتراكاً منتهياً وهمياً
  const past = await owner.request('POST', `/api/admin/users/${target.id}/premium`, { until: Date.now() - DAY });
  assert.equal(past.data.user.premiumUntil, null);

  // مدخلات غير صالحة تُرفض
  const bad = await owner.request('POST', `/api/admin/users/${target.id}/premium`, { addDays: 99999 });
  assert.equal(bad.status, 400);
  const missing = await owner.request('POST', `/api/admin/users/${target.id}/premium`, {});
  assert.equal(missing.status, 400);
  const ghost = await owner.request('POST', '/api/admin/users/u_ghost/premium', { addDays: 30 });
  assert.equal(ghost.status, 404);
});

test('مدرب لا يستطيع تمديد اشتراك نفسه', async () => {
  const teacher = client();
  await teacher.login('teacher3@example.com', 'سامي');
  const me = await teacher.request('GET', '/api/auth/me');
  const res = await teacher.request('POST', `/api/admin/users/${me.data.user.id}/premium`, { addDays: 3650 });
  assert.equal(res.status, 404);
  const still = await teacher.request('GET', '/api/auth/me');
  assert.equal(still.data.premium.isPremium, false);
});
