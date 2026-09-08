'use strict';

/**
 * دليل المعلّمين: من يظهر فيه، وبِمَ يُرشَّح، وما الذي لا يخرج منه.
 *
 * وما تحرسه هذه الاختبارات: أن الدليل **لا يكشف** ما لا تكشفه صفحة المعلّم —
 * لا بريد ولا هاتف ولا اسم كامل — وأن حساباً فارغاً لا يملأ الدليل بأسماءٍ
 * لا تقود إلى شيء، وأن البحث بالاسم يجد «أحمد» لمن كتب «احمد».
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-directory-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const storage = require('../server/storage');
const directory = require('../server/directory');

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

function client() {
  let cookie = '';
  return {
    async request(method, p, body) {
      const res = await fetch(base + p, {
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
    async login(name) {
      const mail = `td.${Math.random().toString(36).slice(2)}@example.com`;
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

const guest = (p) => fetch(base + p).then((r) => r.json());

async function setTier(email, tier) {
  const user = await storage.get().findUserByEmail(email);
  await storage.get().setPremiumUntil(user.id, Date.now() + 30 * 86400000, tier);
  return user;
}

const QUIZ = (title) => ({
  title,
  questions: [
    { type: 'truefalse', text: 'س١', correct: ['true'] },
    { type: 'truefalse', text: 'س٢', correct: ['true'] },
    { type: 'truefalse', text: 'س٣', correct: ['true'] },
  ],
});

// ------------------------------------------------------------------ الوحدة

test('مفتاح البحث يوحّد الهمزة والتاء المربوطة والياء', () => {
  assert.equal(directory.searchKey('أحمد'), directory.searchKey('احمد'));
  assert.equal(directory.searchKey('فاطمة'), directory.searchKey('فاطمه'));
  assert.equal(directory.searchKey('مصطفى'), directory.searchKey('مصطفي'));
  assert.equal(directory.searchKey('  أ.  سامي '), 'ا. سامي');
});

test('الترشيح: بلدٌ ومادّةٌ وصفٌّ واسمٌ — والاسم الكامل يُطابَق ولا يُعرض', () => {
  const items = [
    { id: 'a', name: 'أ. سامي', fullName: 'أ. سامي حجازي', country: 'JO', subjects: ['math'], grades: ['g7'], booking: true, published: 2, games: 0, plays: 0 },
    { id: 'b', name: 'هدى', fullName: 'هدى سليم', country: 'PS', subjects: ['science'], grades: ['g7', 'g8'], booking: false, published: 0, games: 3, plays: 40 },
    { id: 'c', name: 'كريم', fullName: 'كريم خالد', country: 'PS', subjects: ['math'], grades: ['g9'], booking: false, published: 1, games: 0, plays: 0 },
  ];
  assert.deepEqual(directory.filter(items, { country: 'ps' }).map((i) => i.id), ['b', 'c']);
  assert.deepEqual(directory.filter(items, { subject: 'math' }).map((i) => i.id), ['a', 'c']);
  assert.deepEqual(directory.filter(items, { grade: 'g7' }).map((i) => i.id), ['b', 'a'], 'الأكثر نشراً أوّلاً');
  assert.deepEqual(directory.filter(items, { booking: true }).map((i) => i.id), ['a']);
  assert.deepEqual(directory.filter(items, { q: 'حجازي' }).map((i) => i.id), ['a'], 'اللقب الكامل يجد صاحبه');
  assert.deepEqual(directory.filter(items, { q: 'هدي' }).map((i) => i.id), ['b']);
  assert.deepEqual(directory.filter(items, { subject: 'math', country: 'PS' }).map((i) => i.id), ['c']);
});

test('يُدرج من له وجهٌ عامّ: بروفايلٌ مملوء أو محتوًى منشور', () => {
  assert.equal(directory.isListed({ name: 'أحمد' }, undefined), false, 'حسابٌ فارغ لا يُدرج');
  assert.equal(directory.isListed({ name: 'أحمد', subjects: ['math'] }, undefined), true);
  assert.equal(directory.isListed({ name: 'أحمد', hasPhoto: true }, undefined), true);
  assert.equal(directory.isListed({ name: 'أحمد' }, { published: 1 }), true);
  assert.equal(directory.isListed({ name: 'أحمد' }, { games: 1 }), true);
});

// ------------------------------------------------------------------ المسار

test('الدليل عامٌّ: يُرشَّح ويكتم البريد والهاتف والاسم الكامل', async () => {
  const sami = client();
  const samiMail = await sami.login('أ. سامي حجازي');
  await sami.request('PUT', '/api/profile', { subjects: ['math'], grades: ['g7', 'g8'], country: 'JO', years: 9, phone: '0599000000', phonePublic: false });
  const made = await sami.request('POST', '/api/activities', QUIZ('الكسور'));
  await sami.request('POST', `/api/activities/${made.data.activity.id}/publish`, { subject: 'math', grade: 'g7' });

  const huda = client();
  const hudaMail = await huda.login('هدى سليم');
  await huda.request('PUT', '/api/profile', { subjects: ['science'], grades: ['g7'], country: 'PS', bio: 'معلّمة علوم' });
  await setTier(hudaMail, 'pro');

  // حسابٌ سجّل ولم يفعل شيئاً — لا يظهر
  const blank = client();
  await blank.login('زائر عابر');

  const all = await guest('/api/teachers');
  const ids = all.items.map((i) => i.name);
  assert.ok(ids.includes('أ. سامي'), 'الاسم العامّ لا الكامل');
  assert.ok(ids.includes('هدى'));
  assert.equal(ids.includes('زائر'), false, 'الفارغ لا يُدرج');
  assert.deepEqual(all.countries, ['JO', 'PS']);
  const body = JSON.stringify(all);
  assert.equal(body.includes(samiMail), false, 'لا بريد');
  assert.equal(body.includes(hudaMail), false);
  assert.equal(body.includes('0599000000'), false, 'لا هاتف');
  assert.equal(body.includes('حجازي'), false, 'الاسم الكامل لا يخرج');
  assert.equal(body.includes('fullName'), false);

  const samiRow = all.items.find((i) => i.name === 'أ. سامي');
  assert.equal(samiRow.published, 1);
  assert.deepEqual(samiRow.grades, ['g7', 'g8']);
  assert.equal(samiRow.years, 9);
  assert.equal(samiRow.booking, false);
  const hudaRow = all.items.find((i) => i.name === 'هدى');
  assert.equal(hudaRow.booking, true, 'الاحترافية تستقبل حجوزات');
  assert.equal(hudaRow.bio, 'معلّمة علوم');

  // المرشّحات
  assert.deepEqual((await guest('/api/teachers?country=PS')).items.map((i) => i.name), ['هدى']);
  assert.deepEqual((await guest('/api/teachers?subject=math')).items.map((i) => i.name), ['أ. سامي']);
  assert.equal((await guest('/api/teachers?grade=g7')).total, 2);
  assert.deepEqual((await guest('/api/teachers?grade=g8')).items.map((i) => i.name), ['أ. سامي']);
  assert.deepEqual((await guest('/api/teachers?booking=1')).items.map((i) => i.name), ['هدى']);
  assert.deepEqual((await guest('/api/teachers?q=' + encodeURIComponent('حجازي'))).items.map((i) => i.name), ['أ. سامي'], 'اللقب الكامل يجد صاحبه');
  assert.deepEqual((await guest('/api/teachers?q=' + encodeURIComponent('هدي'))).items.map((i) => i.name), ['هدى']);
  assert.equal((await guest('/api/teachers?q=' + encodeURIComponent('لا أحد'))).total, 0);

  // والصفوف تصل صفحة المعلّم وبروفايله
  const page = await guest('/api/teachers/' + samiRow.id);
  assert.deepEqual(page.teacher.grades, ['g7', 'g8']);
  const me = await sami.request('GET', '/api/profile');
  assert.deepEqual(me.data.profile.grades, ['g7', 'g8']);

  // صفحةُ الدليل نفسها تُقدَّم من عنوانٍ قصير
  const html = await fetch(base + '/teachers');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /teachers\.js/);
});
