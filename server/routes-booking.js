'use strict';

/**
 * مسارات المواعيد: ما يفتحه المعلّم، وما يطلبه الطالب، وما يقرّره بعدها.
 *
 * وبابان لا واحد:
 *  - **عامّ بلا حساب**: جدولُ معلّمٍ وطلبُ موعدٍ عليه. صفحةُ المعلّم تُنشر على
 *    فيسبوك، ومن يفتحها زائرٌ لا حساب له — واشتراطُ حسابٍ قبل أن يطلب موعداً
 *    يقتل الغرض كلّه.
 *  - **خاصّ بالمعلّم**: فتحُ المواعيد وحذفُها، وقبولُ الطلبات ورفضُها.
 *
 * وحدُّ الإساءة في الباب العامّ ليس حساباً بل **طلبٌ معلّقٌ واحد لكل رقم مع
 * كل معلّم**: يكفي لمنع إغراق جدولٍ بعشرين طلباً، ولا يمنع طالباً حقيقياً
 * من أن يطلب موعداً ثانياً بعد أن يُبتّ في الأول.
 */

const express = require('express');
const storage = require('./storage');
const auth = require('./auth');
const premium = require('./premium');
const booking = require('./booking');

/** كم يبقى الموعد الماضي قبل أن يُنظَّف: يومان يكفيان لقراءة ما جرى أمس */
const KEEP_MS = 2 * 86400000;

function bookingRoutes() {
  const router = express.Router();

  /** معلّمٌ يقبل الحجز: الميزة في الباقة الاحترافية وحدها */
  const booksAllowed = (user) => premium.limitsFor(user).booking === true;

  // ------------------------------------------------------------ الباب العام

  /**
   * جدولُ معلّمٍ كما يراه الزائر: الأيام الفارغة وأوقاتها.
   *
   * ولا يُرسل منه شيءٌ عن المحجوز: من حجز، ولا حتى أنّه محجوز — الموعد
   * المحجوز يختفي وكفى. جدولُ المعلّم ليس معلومةً عامّة.
   */
  router.get('/teachers/:id/slots', async (req, res) => {
    try {
      const db = storage.get();
      const teacher = await db.findUserById(req.params.id);
      if (!teacher) return res.status(404).json({ error: 'المعلّم غير موجود' });
      if (!booksAllowed(teacher)) return res.json({ booking: false, days: [] });
      const [slots, bookings] = await Promise.all([db.listSlots(teacher.id), db.listBookings(teacher.id)]);
      res.json({ booking: true, days: booking.openDays(slots, bookings) });
    } catch (err) {
      console.error('teacher slots:', err);
      res.status(500).json({ error: 'تعذّر جلب المواعيد' });
    }
  });

  /** طلبُ موعد — من زائرٍ أو طالبٍ أو من كان: الاسم والرقم والمادة تكفي */
  router.post('/teachers/:id/bookings', async (req, res) => {
    try {
      const db = storage.get();
      const teacher = await db.findUserById(req.params.id);
      if (!teacher) return res.status(404).json({ error: 'المعلّم غير موجود' });
      if (!booksAllowed(teacher)) return res.status(404).json({ error: 'هذا المعلّم لا يستقبل حجوزات' });

      const checked = booking.cleanRequest(req.body);
      if (!checked.ok) return res.status(400).json({ error: checked.error });

      const slot = await db.getSlot(String(req.body?.slotId || ''));
      if (!slot || slot.ownerId !== teacher.id) return res.status(404).json({ error: 'الموعد لم يعد متاحاً' });
      if (slot.at <= Date.now()) return res.status(409).json({ error: 'هذا الموعد مضى — اختر موعداً قادماً' });

      const bookings = await db.listBookings(teacher.id);
      // سباقُ طالبين على موعدٍ واحد: الأوّل يأخذه، والثاني يُقال له صراحةً
      if (booking.isTaken(slot.id, bookings)) return res.status(409).json({ error: 'حُجز هذا الموعد للتوّ — اختر غيره' });
      /*
       * طلبٌ معلّقٌ واحد لكل رقم: حدُّ الإساءة في بابٍ بلا حساب. ومن بُتّ في
       * طلبه — قُبل أو رُفض — يطلب من جديد بلا انتظار.
       */
      const digits = (v) => String(v || '').replace(/\D/g, '');
      const pending = bookings.find((b) => b.status === 'pending' && digits(b.phone) === digits(checked.request.phone));
      if (pending) return res.status(429).json({ error: 'لك طلبٌ معلّق عند هذا المعلّم — انتظر ردّه قبل طلبٍ جديد' });

      const now = Date.now();
      const item = {
        id: storage.newId('bk_'),
        ownerId: teacher.id,
        slotId: slot.id,
        at: slot.at,
        minutes: slot.minutes,
        status: 'pending',
        ...checked.request,
        link: '',
        createdAt: now,
        decidedAt: null,
      };
      await db.saveBooking(item);
      res.status(201).json({ booking: booking.publicBooking(item) });
    } catch (err) {
      console.error('booking request:', err);
      res.status(err.status || 400).json({ error: err.message || 'تعذّر إرسال الطلب' });
    }
  });

  /** حالةُ طلبٍ بمعرّفه — يعود إليها الطالب ليرى إن قُبل ورابط اللقاء */
  router.get('/bookings/:id/status', async (req, res) => {
    try {
      const item = await storage.get().getBooking(req.params.id);
      if (!item) return res.status(404).json({ error: 'الطلب غير موجود' });
      res.json({ booking: booking.publicBooking(item) });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب حالة الطلب' });
    }
  });

  // --------------------------------------------------------- بابُ المعلّم

  /** جدولي: مواعيدي القادمة، وأيّها محجوز */
  router.get('/slots', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const [slots, bookings] = await Promise.all([db.listSlots(req.user.id), db.listBookings(req.user.id)]);
      const now = Date.now();
      res.json({
        booking: booksAllowed(req.user),
        slots: slots
          .filter((s) => s.at > now)
          .map((s) => ({ id: s.id, at: s.at, minutes: s.minutes, taken: booking.isTaken(s.id, bookings) })),
      });
    } catch (err) {
      console.error('my slots:', err);
      res.status(500).json({ error: 'تعذّر جلب مواعيدك' });
    }
  });

  /**
   * فتحُ مواعيد — دفعةً واحدة.
   *
   * والمتصفّح هو الذي يحسب التكرار الأسبوعي بتقويمه المحلّي ثم يرسل المواعيد
   * مواعيدَ: التوقيت الصيفيّ يزيح «الرابعة عصراً» ساعةً لو جمعناها هنا بسبعة
   * أيام حسابياً، فيجد الطالب درسه في الثالثة.
   */
  router.post('/slots', auth.requireUser, premium.requireTier('pro'), async (req, res) => {
    try {
      const db = storage.get();
      const existing = await db.listSlots(req.user.id);
      const now = Date.now();
      const alive = existing.filter((s) => s.at > now);
      const wanted = booking.cleanSlots(req.body?.slots, { now, existing: alive });
      if (!wanted.length) return res.status(400).json({ error: 'اختر وقتاً واحداً على الأقل في المستقبل' });
      if (alive.length + wanted.length > booking.MAX_SLOTS) {
        return res.status(409).json({ error: `بلغت الحدّ الأقصى (${booking.MAX_SLOTS} موعداً مفتوحاً) — احذف مواعيد قديمة` });
      }
      // موعدٌ داخل موعدٍ مفتوح يعني لقاءين في وقتٍ واحد
      const clash = wanted.find((w) => alive.some((s) => booking.overlaps(w, s)));
      if (clash) return res.status(409).json({ error: 'أحد الأوقات يتقاطع مع موعدٍ مفتوحٍ عندك' });

      const rows = wanted.map((w) => ({ id: storage.newId('sl_'), ownerId: req.user.id, at: w.at, minutes: w.minutes, createdAt: now }));
      await db.saveSlots(rows);
      res.status(201).json({ added: rows.length, slots: rows.map((s) => ({ id: s.id, at: s.at, minutes: s.minutes, taken: false })) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر فتح المواعيد' });
    }
  });

  /** حذفُ موعدٍ مفتوح — والمحجوزُ لا يُحذف إلا برفض طلبه أوّلاً */
  router.delete('/slots/:id', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const slot = await db.getSlot(req.params.id);
      if (!slot || slot.ownerId !== req.user.id) return res.status(404).json({ error: 'الموعد غير موجود' });
      const bookings = await db.listBookings(req.user.id);
      if (booking.isTaken(slot.id, bookings)) {
        return res.status(409).json({ error: 'هذا الموعد محجوز — ردَّ على الطلب أوّلاً' });
      }
      await db.deleteSlot(slot.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف الموعد' });
    }
  });

  /**
   * طلباتُ المواعيد عندي — وهي مصدرُ جرس الإشعارات.
   *
   * والمعلّم يرى فيها ما يحتاجه للقرار كاملاً: اسم الطالب ورقمه والمادة
   * والموضوع والوقت. ورقمُ الطالب يُعطى لصاحب الطلب وحده — هو طريق الردّ.
   */
  router.get('/bookings', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const rows = await db.listBookings(req.user.id);
      const now = Date.now() - KEEP_MS;
      const mine = rows.filter((b) => b.at > now).sort((a, b) => a.at - b.at);
      res.json({
        booking: booksAllowed(req.user),
        pending: mine.filter((b) => b.status === 'pending').length,
        bookings: mine,
      });
    } catch (err) {
      console.error('my bookings:', err);
      res.status(500).json({ error: 'تعذّر جلب الطلبات' });
    }
  });

  /** قبولُ طلبٍ أو رفضه — والقبول يحمل رابط اللقاء إن كتبه المعلّم */
  router.post('/bookings/:id/decide', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const item = await db.getBooking(req.params.id);
      if (!item || item.ownerId !== req.user.id) return res.status(404).json({ error: 'الطلب غير موجود' });
      const wanted = String(req.body?.status || '');
      if (!['confirmed', 'declined'].includes(wanted)) return res.status(400).json({ error: 'قرارٌ غير معروف' });
      /*
       * رابط اللقاء يُنشر على صفحةٍ يفتحها طالب: `http(s)` وحدهما يمرّان.
       * ورابطٌ بمخطّطٍ آخر (`javascript:`) على صفحةٍ عامّة بابُ أذى لا ميزة.
       */
      const link = String(req.body?.link || '').trim().slice(0, 300);
      if (link && !/^https?:\/\//i.test(link)) return res.status(400).json({ error: 'رابط اللقاء يجب أن يبدأ بـ https' });
      const updated = { ...item, status: wanted, link: wanted === 'confirmed' ? link : '', decidedAt: Date.now() };
      await db.saveBooking(updated);
      res.json({ booking: updated });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر حفظ القرار' });
    }
  });

  return router;
}

/** تنظيفٌ دوريّ لما مضى — يُنادى عند الإقلاع وكل ساعة */
function sweep() {
  const db = storage.get();
  if (!db || typeof db.sweepBookings !== 'function') return Promise.resolve();
  return db.sweepBookings(Date.now() - KEEP_MS).catch(() => {});
}

module.exports = { bookingRoutes, sweep, KEEP_MS };
