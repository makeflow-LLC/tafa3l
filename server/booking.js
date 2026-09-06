'use strict';

/**
 * المواعيد — أوقاتٌ يفتحها المعلّم، وطلباتٌ يرسلها الطلاب.
 *
 * والفكرة كلّها في كلمتين: **المعلّم يعرض، والطالب يضغط**. لا مراسلةَ ذهابٍ
 * وإياب على واتساب («متى تفضي؟» … «الثلاثاء؟» … «لا، الأربعاء») — بل أزرارٌ
 * لأوقاتٍ فارغةٍ فعلاً، من ضغط واحداً منها حجزه فاختفى عن غيره.
 *
 * والوقت **مطلق** (مللي ثانية) لا «الثلاثاء ٤ عصراً»: يُخزَّن كما هو ويُعرض
 * بتوقيت جهاز القارئ، فلا حقلَ منطقةٍ زمنية ولا لبسَ بين معلّمٍ وطالبٍ في
 * بلدين. والتكرار الأسبوعيّ يحسبه المتصفّح بتقويمه المحلّي ثم يرسل المواعيد
 * مواعيدَ — فلا يزيح التوقيت الصيفيّ ساعةَ الدرس عند من يعمل به.
 *
 * وهذه الوحدة **منطقٌ خالص**: لا تعرف تخزيناً ولا مسارات، فتُختبر وحدها.
 */

/** مدد اللقاء المسموحة بالدقائق */
const DURATIONS = [15, 30, 45, 60, 90];
/** أقصى ما يفتحه معلّمٌ من مواعيد قائمة */
const MAX_SLOTS = 300;
/** أقصى ما يُنشأ في نداءٍ واحد (يومٌ كامل مكرّرٌ أسابيع) */
const MAX_BATCH = 80;
/** إلى أي مدًى يُعرض الجدول للطالب */
const HORIZON_DAYS = 60;
/** الحالات التي تحجز الموعد فعلاً — المرفوض والملغى يُعيدانه إلى المتاح */
const HOLDING = new Set(['pending', 'confirmed']);

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** دقيقةٌ صحيحة: الثواني تُسقَط كي تتطابق المواعيد المتكرّرة بالضبط */
function minuteOf(at) {
  const ms = Number(at);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 60000) * 60000;
}

function duration(value) {
  const n = Number(value);
  return DURATIONS.includes(n) ? n : 30;
}

/**
 * يشذّب مواعيدَ قادمةً من المتصفّح: يُسقط الماضي وما بعد الأفق، ويوحّد
 * المكرّر، ويرتّب — فالمعلّم قد يضغط الزرّ مرّتين ولا يصحّ أن يظهر الموعد
 * مرّتين للطالب.
 */
function cleanSlots(list, { now = Date.now(), existing = [] } = {}) {
  const taken = new Set((existing || []).map((s) => minuteOf(s.at)));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const at = minuteOf(raw?.at);
    if (!at || at <= now) continue;
    if (at > now + HORIZON_DAYS * 86400000) continue;
    if (seen.has(at) || taken.has(at)) continue;
    seen.add(at);
    out.push({ at, minutes: duration(raw?.minutes) });
    if (out.length >= MAX_BATCH) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** هل يتقاطع موعدان؟ — يمنع فتح موعدٍ داخل موعدٍ مفتوح */
function overlaps(a, b) {
  const endA = a.at + (a.minutes || 30) * 60000;
  const endB = b.at + (b.minutes || 30) * 60000;
  return a.at < endB && b.at < endA;
}

/** الموعد محجوزٌ إن كان له طلبٌ معلّقٌ أو مقبول */
function isTaken(slotId, bookings) {
  return (bookings || []).some((b) => b.slotId === slotId && HOLDING.has(b.status));
}

/**
 * ما يراه الطالب: المواعيد الفارغة القادمة، **قائمةً مرتّبة**.
 *
 * والتجميع باليوم يقع في المتصفّح لا هنا: «الثلاثاء» يومٌ يختلف أوّله وآخره
 * باختلاف منطقة القارئ الزمنية، فتجميعُه على الخادم بتوقيت UTC يضع موعد
 * الحادية عشرة ليلاً في يوم الغد عند من هو شرقيّ غرينتش. والخادم يرسل لحظاتٍ
 * مطلقة، والمتصفّح يعرف تقويم صاحبه.
 */
function openSlots(slots, bookings, { now = Date.now(), days = HORIZON_DAYS } = {}) {
  const limit = now + days * 86400000;
  return (slots || [])
    .filter((s) => s.at > now && s.at <= limit && !isTaken(s.id, bookings))
    .sort((a, b) => a.at - b.at)
    .map((s) => ({ id: s.id, at: s.at, minutes: s.minutes }));
}

/**
 * طلبُ موعدٍ من طالب — والتحقّق هنا لا في الواجهة.
 *
 * @returns {{ok:true, request}|{ok:false, error:string}}
 */
function cleanRequest(raw) {
  const name = clean(raw?.name, 40);
  if (name.length < 2) return { ok: false, error: 'اكتب اسمك' };
  /*
   * الرقم هو طريقُ الردّ كلّه: المعلّم يردّ على واتساب، فرقمٌ خاطئ يعني
   * موعداً لن يُبلَّغ صاحبه. فيُتحقَّق من شكله هنا لا في المتصفّح وحده.
   */
  const phone = clean(raw?.phone, 24);
  if (!/^\+?[\d\s()-]{7,24}$/.test(phone)) return { ok: false, error: 'اكتب رقم واتساب صحيحاً' };
  const subject = clean(raw?.subject, 60);
  if (!subject) return { ok: false, error: 'اكتب المادة' };
  return {
    ok: true,
    request: { name, phone, subject, topic: clean(raw?.topic, 200) },
  };
}

/** ما يُرسل للطالب عن طلبه — بلا شيءٍ عن غيره */
function publicBooking(b) {
  return {
    id: b.id,
    at: b.at,
    minutes: b.minutes,
    status: b.status,
    subject: b.subject,
    topic: b.topic,
    // رابط اللقاء لا يُعطى إلا بعد القبول — لا معنى له قبله
    link: b.status === 'confirmed' ? b.link || '' : '',
  };
}

module.exports = {
  DURATIONS,
  MAX_SLOTS,
  MAX_BATCH,
  HORIZON_DAYS,
  HOLDING,
  minuteOf,
  duration,
  cleanSlots,
  overlaps,
  isTaken,
  openSlots,
  cleanRequest,
  publicBooking,
};
