'use strict';

/**
 * المواعيد: ما يفتحه المعلّم، وما يطلبه الطالب، وما يقرّره بعدها.
 *
 * وما تحرسه هذه الاختبارات: أن **الباب العامّ لا يصير باباً مفتوحاً** — موعدٌ
 * محجوز لا يُحجز مرّتين، ورقمٌ واحد لا يُغرق جدولاً بعشرين طلباً، وجدولُ
 * معلّمٍ لا يكشف من حجزه. وأن الحجز حكرٌ على الباقة التي بيع فيها.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-booking-'));
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.DATABASE_URL;

const { server, ready } = require('../server/index');
const storage = require('../server/storage');
const booking = require('../server/booking');

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

// ------------------------------------------------------------------ أدوات

function client() {
  let cookie = '';
  return {
    async request(method, p, body) {
      const res = await fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const raw of res.headers.getSetCookie?.() || []) {
        const pair = raw.split(';')[0];
        cookie = pair.endsWith('=') ? '' : pair;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* بلا جسم */
      }
      return { status: res.status, data };
    },
    async login(name) {
      const mail = `bk.${Math.random().toString(36).slice(2)}@example.com`;
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

/** زائرٌ بلا حساب — كما يفتح الصفحة من فيسبوك */
const guest = () => ({
  async request(method, p, body) {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json' },
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
});

async function setTier(email, tier) {
  const user = await storage.get().findUserByEmail(email);
  await storage.get().setPremiumUntil(user.id, Date.now() + 30 * 86400000, tier);
  return user;
}

const day = 86400000;
const soon = (hours) => Math.floor((Date.now() + hours * 3600000) / 60000) * 60000;

// ------------------------------------------------------------------ الوحدة

test('تشذيبُ الأوقات: الماضي يسقط، والمكرّر يُوحَّد، وما بعد الأفق لا يُفتح', () => {
  const now = Date.UTC(2026, 0, 1, 10, 0, 0);
  const at = (h) => now + h * 3600000;
  const out = booking.cleanSlots(
    [
      { at: at(-2), minutes: 30 },
      { at: at(2), minutes: 30 },
      { at: at(2) + 30_000, minutes: 30 },
      { at: at(3), minutes: 45 },
      { at: now + 200 * day, minutes: 30 },
      { at: 'سلام', minutes: 30 },
    ],
    { now }
  );
  assert.deepEqual(out.map((s) => s.at), [at(2), at(3)], 'الماضي والمكرّر والبعيد تسقط');
  assert.equal(out[1].minutes, 45);
  // ومدّةٌ غير مسموحة تعود إلى الافتراضي بدل أن تُرفض الدفعة كلّها
  assert.equal(booking.cleanSlots([{ at: at(4), minutes: 7 }], { now })[0].minutes, 30);
  // وما هو مفتوحٌ سلفاً لا يُفتح مرّتين
  assert.equal(booking.cleanSlots([{ at: at(5) }], { now, existing: [{ at: at(5) }] }).length, 0);
});

test('التقاطع: موعدٌ داخل موعدٍ يُكشف', () => {
  const at = Date.UTC(2026, 0, 1, 10, 0, 0);
  assert.equal(booking.overlaps({ at, minutes: 60 }, { at: at + 30 * 60000, minutes: 30 }), true);
  assert.equal(booking.overlaps({ at, minutes: 30 }, { at: at + 30 * 60000, minutes: 30 }), false);
});

test('الجدولُ العامّ: المحجوز يختفي، والمرفوض يعود', () => {
  const now = Date.UTC(2026, 0, 1, 10, 0, 0);
  const slots = [
    { id: 'sl_1', at: now + 3600000, minutes: 30 },
    { id: 'sl_2', at: now + 7200000, minutes: 30 },
    { id: 'sl_3', at: now + 10800000, minutes: 30 },
  ];
  const bookings = [
    { slotId: 'sl_1', status: 'pending' },
    { slotId: 'sl_2', status: 'declined' },
  ];
  const open = booking.openSlots(slots, bookings, { now });
  assert.deepEqual(open.map((s) => s.id), ['sl_2', 'sl_3'], 'المعلّق يحجز، والمرفوض يعود متاحاً');
  // ولا يُرسل عن المحجوز شيء: لا اسمَ ولا أنّه محجوز أصلاً
  assert.equal(JSON.stringify(open).includes('sl_1'), false);
  // ولا تجميعَ بالأيام على الخادم: لحظاتٌ مطلقة يجمعها المتصفّح بتقويم قارئه
  assert.ok(open.every((s) => typeof s.at === 'number'));
});

test('طلبُ الموعد: الاسم والرقم والمادة شرطٌ، والموضوع اختياري', () => {
  assert.equal(booking.cleanRequest({ name: 'ن', phone: '0599123456', subject: 'رياضيات' }).ok, false);
  assert.equal(booking.cleanRequest({ name: 'نور', phone: '12', subject: 'رياضيات' }).ok, false);
  assert.equal(booking.cleanRequest({ name: 'نور', phone: '0599123456', subject: '' }).ok, false);
  const good = booking.cleanRequest({ name: ' نور  حسن ', phone: '+970 599 123456', subject: 'رياضيات', topic: 'الكسور' });
  assert.equal(good.ok, true);
  assert.equal(good.request.name, 'نور حسن');
  assert.equal(good.request.topic, 'الكسور');
});

test('ما يراه الطالب عن طلبه: رابط اللقاء بعد القبول وحده', () => {
  const b = { id: 'bk_1', at: 1, minutes: 30, subject: 'عربي', topic: '', link: 'https://meet.example/x' };
  assert.equal(booking.publicBooking({ ...b, status: 'pending' }).link, '');
  assert.equal(booking.publicBooking({ ...b, status: 'confirmed' }).link, 'https://meet.example/x');
  // ولا رقمَ ولا اسمَ صاحب الطلب في ما يُرسل
  assert.equal(JSON.stringify(booking.publicBooking({ ...b, status: 'confirmed', phone: '0599', name: 'نور' })).includes('0599'), false);
});

// ---------------------------------------------------------------- المسارات

test('الحجز في الباقة الاحترافية وحدها — وصفحة المعلّم تعمل للجميع', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. رامي');
  await setTier(mail, 'basic');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;

  const page = await guest().request('GET', '/api/teachers/' + me.id);
  assert.equal(page.status, 200, 'صفحته العامّة تعمل في الباقة الأساسية');
  assert.equal(page.data.teacher.booking, false);
  assert.equal((await guest().request('GET', `/api/teachers/${me.id}/slots`)).data.booking, false);
  // وفتحُ موعدٍ يُردّ بـ٤٠٢ ومعه الباقة التي تفتحه
  const denied = await teacher.request('POST', '/api/slots', { slots: [{ at: soon(24), minutes: 30 }] });
  assert.equal(denied.status, 402);
  assert.equal(denied.data.upgrade.id, 'pro');

  await setTier(mail, 'pro');
  assert.equal((await teacher.request('POST', '/api/slots', { slots: [{ at: soon(24), minutes: 30 }] })).status, 201);
});

test('المسار كاملاً: يفتح موعداً، يحجزه زائر، فيصل المعلّم بكلّ ما يحتاجه', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. ليلى');
  await setTier(mail, 'pro');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;

  const at = soon(48);
  const made = await teacher.request('POST', '/api/slots', { slots: [{ at, minutes: 45 }, { at: at + 3600000, minutes: 45 }] });
  assert.equal(made.status, 201);
  assert.equal(made.data.added, 2);

  const open = await guest().request('GET', `/api/teachers/${me.id}/slots`);
  assert.equal(open.data.booking, true);
  const slot = open.data.slots[0];
  assert.ok(slot, 'الجدول العام يعرض الموعد');

  const asked = await guest().request('POST', `/api/teachers/${me.id}/bookings`, {
    slotId: slot.id,
    name: 'نور حسن',
    phone: '0599123456',
    subject: 'رياضيات',
    topic: 'الكسور العشرية',
  });
  assert.equal(asked.status, 201);
  assert.equal(asked.data.booking.status, 'pending');

  // الموعد اختفى من الجدول العام فوراً
  const after = await guest().request('GET', `/api/teachers/${me.id}/slots`);
  assert.equal(after.data.slots.some((s) => s.id === slot.id), false);

  // وعند المعلّم: كل ما يحتاجه للقرار
  const inbox = await teacher.request('GET', '/api/bookings');
  assert.equal(inbox.data.pending, 1);
  const row = inbox.data.bookings[0];
  assert.equal(row.name, 'نور حسن');
  assert.equal(row.phone, '0599123456');
  assert.equal(row.subject, 'رياضيات');
  assert.equal(row.topic, 'الكسور العشرية');
  assert.equal(row.at, slot.at);

  // القبول مع رابط اللقاء — والطالب يراه في صفحة حالته
  const decided = await teacher.request('POST', `/api/bookings/${row.id}/decide`, { status: 'confirmed', link: 'https://meet.google.com/abc-defg-hij' });
  assert.equal(decided.status, 200);
  const status = await guest().request('GET', `/api/bookings/${row.id}/status`);
  assert.equal(status.data.booking.status, 'confirmed');
  assert.equal(status.data.booking.link, 'https://meet.google.com/abc-defg-hij');
  assert.equal((await teacher.request('GET', '/api/bookings')).data.pending, 0);
});

test('موعدٌ واحد لا يُحجز مرّتين، ورقمٌ واحد لا يُغرق الجدول', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. حسن');
  await setTier(mail, 'pro');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;
  await teacher.request('POST', '/api/slots', { slots: [{ at: soon(72), minutes: 30 }, { at: soon(73), minutes: 30 }] });
  const slots = (await guest().request('GET', `/api/teachers/${me.id}/slots`)).data.slots;

  const ask = (slotId, phone) =>
    guest().request('POST', `/api/teachers/${me.id}/bookings`, { slotId, name: 'طالب', phone, subject: 'علوم' });

  assert.equal((await ask(slots[0].id, '0599000001')).status, 201);
  // طالبٌ آخر على الموعد نفسه
  assert.equal((await ask(slots[0].id, '0599000002')).status, 409);
  // والرقمُ الأول على موعدٍ ثانٍ: له طلبٌ معلّق فينتظر الردّ
  const flood = await ask(slots[1].id, '0599000001');
  assert.equal(flood.status, 429);
  assert.match(flood.data.error, /معلّق/);
});

test('الرفضُ يعيد الموعد إلى الجدول، والمحجوز لا يُحذف قبل الردّ', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. سناء');
  await setTier(mail, 'pro');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;
  await teacher.request('POST', '/api/slots', { slots: [{ at: soon(96), minutes: 30 }] });
  const slot = (await guest().request('GET', `/api/teachers/${me.id}/slots`)).data.slots[0];
  await guest().request('POST', `/api/teachers/${me.id}/bookings`, { slotId: slot.id, name: 'طالب', phone: '0599111222', subject: 'عربي' });

  // محجوز: لا يُحذف قبل الردّ
  const blocked = await teacher.request('DELETE', '/api/slots/' + slot.id);
  assert.equal(blocked.status, 409);

  const row = (await teacher.request('GET', '/api/bookings')).data.bookings[0];
  await teacher.request('POST', `/api/bookings/${row.id}/decide`, { status: 'declined' });
  const back = await guest().request('GET', `/api/teachers/${me.id}/slots`);
  assert.equal(back.data.slots.some((s) => s.id === slot.id), true, 'المرفوض يعود متاحاً');
  assert.equal((await teacher.request('DELETE', '/api/slots/' + slot.id)).status, 200);
});

test('رابطُ اللقاء يُنشر على صفحةٍ عامّة: http(s) وحدهما يمرّان', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. عمر');
  await setTier(mail, 'pro');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;
  await teacher.request('POST', '/api/slots', { slots: [{ at: soon(120), minutes: 30 }] });
  const slot = (await guest().request('GET', `/api/teachers/${me.id}/slots`)).data.slots[0];
  await guest().request('POST', `/api/teachers/${me.id}/bookings`, { slotId: slot.id, name: 'طالب', phone: '0599333444', subject: 'فيزياء' });
  const row = (await teacher.request('GET', '/api/bookings')).data.bookings[0];

  const bad = await teacher.request('POST', `/api/bookings/${row.id}/decide`, { status: 'confirmed', link: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  // وجدولُ معلّمٍ آخر لا يُقرّر فيه أحد
  const other = client();
  await other.login('أ. غريب');
  assert.equal((await other.request('POST', `/api/bookings/${row.id}/decide`, { status: 'confirmed' })).status, 404);
});

test('صفحة المعلّم: موادّه وخبرته وعيّنته — والعيّنة من المنشور وحده', async () => {
  const teacher = client();
  const mail = await teacher.login('أ. هدى');
  await setTier(mail, 'pro');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;
  const activity = (await teacher.request('POST', '/api/activities', {
    title: 'درس الكسور',
    // ثلاثةُ أسئلة: النشر في المكتبة يشترطها
    questions: [
      { type: 'truefalse', text: 'النصف أكبر من الربع', correct: ['true'] },
      { type: 'truefalse', text: 'الثلث أصغر من النصف', correct: ['true'] },
      { type: 'truefalse', text: 'الربع يساوي ٠٫٢٥', correct: ['true'] },
    ],
  })).data.activity;

  const saved = await teacher.request('PUT', '/api/profile', {
    displayName: 'أ. هدى سليم',
    subjects: ['math', 'science'],
    years: 12,
    schools: 'مدرسة الأمل\nمركز الإبداع',
    bookingTerms: 'الدرس ساعة\nاللقاء عبر Meet',
    samples: [
      { title: 'شرح الكسور', url: 'https://youtube.com/watch?v=abc' },
      { title: 'بلا رابط', url: '' },
      { title: '', url: 'https://drive.example/lesson' },
      { title: 'مخطّطٌ خبيث', url: 'javascript:alert(1)' },
    ],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.profile.subjects, ['math', 'science']);
  assert.equal(saved.data.profile.years, 12);
  // العيّنات روابطُ خارجية: ما لا رابط له يسقط، وما ليس http(s) يسقط
  assert.equal(saved.data.profile.samples.length, 2);
  assert.equal(saved.data.profile.samples[0].title, 'شرح الكسور');
  // وبلا عنوانٍ يُشتقّ من نطاق الرابط فلا يظهر رابطٌ عارٍ بلا اسم
  assert.ok(saved.data.profile.samples[1].title.includes('drive.example'));
  // والأسطر تبقى أسطراً
  assert.ok(saved.data.profile.schools.includes('\n'));

  const page = await guest().request('GET', '/api/teachers/' + me.id);
  assert.equal(page.data.teacher.years, 12, 'سنوات الخبرة تصل الصفحة العامّة');
  assert.equal(page.data.teacher.samples.length, 2);
  assert.equal(page.data.teacher.credentials, undefined, 'الشهادات أُزيلت من الصفحة');
  // وشروطُ الحجز تصل مع الجدول لتُقرأ قبل الطلب
  const schedule = await guest().request('GET', `/api/teachers/${me.id}/slots`);
  assert.match(schedule.data.terms, /الدرس ساعة/);

  await teacher.request('POST', `/api/activities/${activity.id}/publish`, { subject: 'math', grade: 'g7' });
  // ونشاطاته المنشورة تُصفّى باسمه
  const mine = await guest().request('GET', '/api/library?teacher=' + me.id);
  assert.equal(mine.data.items.length, 1);
  assert.equal(mine.data.items[0].title, 'درس الكسور');
});

test('اسمُ المعلّم العامّ: اللقب وحده لا يدلّ على أحد', async () => {
  const teacher = client();
  await teacher.login('أ. سامي درويش');
  const me = (await teacher.request('GET', '/api/auth/me')).data.user;
  const page = await guest().request('GET', '/api/teachers/' + me.id);
  assert.equal(page.data.teacher.name, 'أ. سامي', 'اللقب يجرّ الاسم بعده');

  const plain = client();
  await plain.login('سلمى درويش');
  const her = (await plain.request('GET', '/api/auth/me')).data.user;
  const hers = await guest().request('GET', '/api/teachers/' + her.id);
  assert.equal(hers.data.teacher.name, 'سلمى', 'وبلا لقبٍ يبقى الاسم الأول وحده');
});
