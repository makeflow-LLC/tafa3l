'use strict';

/**
 * مسارات الحساب والأنشطة المحفوظة.
 * المحفوظ هنا أسئلة المدرب وإعداداته فقط — لا نتائج مشاركين ولا إجاباتهم.
 */

const express = require('express');
const storage = require('./storage');
const auth = require('./auth');
const google = require('./google-auth');
const premium = require('./premium');
const { normalizeQuiz, normalizeQuestion } = require('./session');

const MAX_ACTIVITIES = 200;
const MAX_BANK_QUESTIONS = 500;

/** يقبل فقط مساراً داخلياً نسبياً — يمنع التحويل إلى موقع خارجي عبر next= */
function safeNext(value) {
  const requested = String(value || '/host.html#/mine');
  return /^\/[^/]/.test(requested) ? requested : '/host.html#/mine';
}

function accountRoutes(store) {
  const router = express.Router();

  // ----------------------------------------------------------- المصادقة عبر جوجل فقط

  /** يبدأ تسجيل الدخول: يحوّل المتصفح إلى صفحة اختيار حساب جوجل */
  router.get('/auth/google', (req, res) => {
    if (!google.isConfigured()) {
      return res.status(503).json({ error: 'تسجيل الدخول عبر جوجل غير مُفعّل على هذا الخادم' });
    }
    const next = safeNext(req.query.next);
    const { authUrl, cookiePayload } = google.buildAuthUrl(req, next);
    google.setStateCookie(req, res, cookiePayload);
    res.redirect(authUrl);
  });

  /** عودة جوجل بعد موافقة المستخدم — يُنشئ الجلسة ويعيده إلى وجهته */
  router.get('/auth/google/callback', async (req, res) => {
    const bounce = (reason) => {
      google.clearStateCookie(req, res);
      res.redirect('/login.html?error=' + encodeURIComponent(reason));
    };
    try {
      if (!google.isConfigured()) return bounce('تسجيل الدخول عبر جوجل غير مُفعّل على هذا الخادم');

      const saved = google.readStateCookie(req);
      if (!saved || !req.query.state || saved.state !== req.query.state) {
        return bounce('انتهت صلاحية محاولة الدخول — أعد المحاولة');
      }
      if (req.query.error) return bounce('أُلغي تسجيل الدخول عبر جوجل');
      if (!req.query.code) return bounce('لم يصل رمز من جوجل');

      const profile = await google.resolveUser(req, String(req.query.code));
      const email = auth.validateEmail(profile.email);
      if (!email) return bounce('بريد حساب جوجل غير صالح');

      const user = await storage.get().upsertUser({ email, name: profile.name, googleId: profile.googleId });
      google.clearStateCookie(req, res);
      await auth.startSession(req, res, user.id);
      res.redirect(safeNext(saved.next));
    } catch (err) {
      console.error('دخول جوجل:', err.message);
      bounce('تعذّر تسجيل الدخول عبر جوجل — حاول مجدداً');
    }
  });

  router.post('/auth/logout', async (req, res) => {
    await auth.endSession(req, res);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req, res) => {
    res.json({
      user: req.user || null,
      durable: storage.isDurable(),
      googleConfigured: google.isConfigured(),
      // حالة الاشتراك تصل مع المستخدم كي تعرف الواجهة ماذا تعرض فوراً
      premium: premium.summary(req.user),
    });
  });

  // ------------------------------------------------------ لوحة المالك

  /** كل المدربين المسجّلين مع حالة اشتراكهم — للمالك وحده */
  router.get('/admin/users', premium.requireAdmin, async (_req, res) => {
    try {
      const users = await storage.get().listUsers();
      res.json({
        now: Date.now(),
        users: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          createdAt: u.createdAt,
          premiumUntil: u.premiumUntil ?? null,
          isPremium: premium.isPremium(u),
          isAdmin: premium.isAdmin(u),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'تعذّر جلب قائمة المدربين' });
    }
  });

  /**
   * ضبط اشتراك مدرب: إما بإضافة أيام (addDays موجب أو سالب) أو بتاريخ صريح
   * (until بالمللي ثانية، أو null لإلغاء الاشتراك فوراً).
   */
  router.post('/admin/users/:id/premium', premium.requireAdmin, async (req, res) => {
    try {
      const target = await storage.get().findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'المدرب غير موجود' });

      const now = Date.now();
      let until;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'addDays')) {
        const days = Number(req.body.addDays);
        if (!Number.isFinite(days) || Math.abs(days) > 3650) {
          return res.status(400).json({ error: 'عدد أيام غير صالح' });
        }
        // الإضافة تبدأ من تاريخ الانتهاء الحالي إن كان ساري المفعول، وإلا من اليوم
        const base = target.premiumUntil && target.premiumUntil > now ? target.premiumUntil : now;
        until = Math.round(base + days * 86400000);
        if (until <= now) until = null; // الخصم إلى ما قبل اليوم = إلغاء
      } else if (Object.prototype.hasOwnProperty.call(req.body || {}, 'until')) {
        if (req.body.until === null) until = null;
        else {
          const value = Number(req.body.until);
          if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'تاريخ غير صالح' });
          until = value <= now ? null : Math.round(value);
        }
      } else {
        return res.status(400).json({ error: 'حدّد addDays أو until' });
      }

      const updated = await storage.get().setPremiumUntil(target.id, until);
      res.json({
        user: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          createdAt: updated.createdAt,
          premiumUntil: updated.premiumUntil ?? null,
          isPremium: premium.isPremium(updated),
          isAdmin: premium.isAdmin(updated),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'تعذّر تحديث الاشتراك' });
    }
  });

  // ------------------------------------------------------ الأنشطة المحفوظة

  /** نضيف حالة «مباشر الآن» من مخزن الجلسات المؤقت */
  function withLiveState(activity) {
    let live = null;
    for (const session of store.sessions.values()) {
      if (session.activityId === activity.id && session.status !== 'ended') {
        live = { code: session.code, status: session.status, participants: session.participants.size };
        break;
      }
    }
    return { ...activity, live };
  }

  router.get('/activities', auth.requireUser, async (req, res) => {
    try {
      const list = await storage.get().listActivities(req.user.id);
      res.json({
        activities: list.map((a) => ({
          id: a.id,
          title: a.title,
          questionCount: Array.isArray(a.questions) ? a.questions.length : 0,
          settings: a.settings,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          live: withLiveState(a).live,
        })),
      });
    } catch (err) {
      console.error('list activities:', err);
      res.status(500).json({ error: 'تعذّر جلب أنشطتك' });
    }
  });

  router.post('/activities', auth.requireUser, async (req, res) => {
    try {
      const list = await storage.get().listActivities(req.user.id);
      if (list.length >= MAX_ACTIVITIES) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_ACTIVITIES} نشاطاً) — احذف نشاطاً قديماً` });
      }
      premium.assertImagesAllowed(req.user, req.body?.questions);
      // نستخدم نفس تحقق الجلسات حتى لا يُحفظ نشاط لا يمكن إطلاقه
      const quiz = normalizeQuiz(req.body || {});
      const now = Date.now();
      const activity = {
        id: storage.newId('a_'),
        ownerId: req.user.id,
        title: quiz.title,
        settings: quiz.settings,
        questions: quiz.questions,
        createdAt: now,
        updatedAt: now,
      };
      await storage.get().saveActivity(activity);
      res.status(201).json({ activity: { id: activity.id, title: activity.title, updatedAt: activity.updatedAt } });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر حفظ النشاط' });
    }
  });

  /** جلب نشاط كاملاً لإعادة فتحه في المحرّر */
  router.get('/activities/:id', auth.requireUser, async (req, res) => {
    const activity = await storage.get().getActivity(req.params.id);
    if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
    res.json({ activity });
  });

  router.put('/activities/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().getActivity(req.params.id);
      if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
      premium.assertImagesAllowed(req.user, req.body?.questions);
      const quiz = normalizeQuiz(req.body || {});
      const updated = {
        ...existing,
        title: quiz.title,
        settings: quiz.settings,
        questions: quiz.questions,
        updatedAt: Date.now(),
      };
      await storage.get().saveActivity(updated);
      res.json({ activity: { id: updated.id, title: updated.title, updatedAt: updated.updatedAt } });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تحديث النشاط' });
    }
  });

  router.delete('/activities/:id', auth.requireUser, async (req, res) => {
    const activity = await storage.get().getActivity(req.params.id);
    if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
    await storage.get().deleteActivity(activity.id);
    res.json({ ok: true });
  });

  /** استنساخ نشاط — نسخة مستقلة يمكن تعديلها دون المساس بالأصل */
  router.post('/activities/:id/duplicate', auth.requireUser, async (req, res) => {
    try {
      const activity = await storage.get().getActivity(req.params.id);
      if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
      const list = await storage.get().listActivities(req.user.id);
      if (list.length >= MAX_ACTIVITIES) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_ACTIVITIES} نشاطاً) — احذف نشاطاً قديماً` });
      }
      const now = Date.now();
      const copy = {
        ...activity,
        id: storage.newId('a_'),
        title: (activity.title + ' — نسخة').slice(0, 120),
        createdAt: now,
        updatedAt: now,
      };
      await storage.get().saveActivity(copy);
      res.status(201).json({ activity: { id: copy.id, title: copy.title, updatedAt: copy.updatedAt } });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر استنساخ النشاط' });
    }
  });

  /** إطلاق جلسة مباشرة من نشاط محفوظ */
  router.post('/activities/:id/launch', auth.requireUser, async (req, res) => {
    try {
      const activity = await storage.get().getActivity(req.params.id);
      if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });

      const session = store.createSession({
        title: activity.title,
        settings: activity.settings,
        questions: activity.questions,
      });
      session.ownerId = req.user.id;
      session.activityId = activity.id;

      res.status(201).json({ code: session.code, hostToken: session.hostToken, title: session.title });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر إطلاق الجلسة' });
    }
  });

  // ------------------------------------------------------------ بنك الأسئلة

  /**
   * أسئلة مستقلة عن أي نشاط — يجمعها المدرب مع الوقت ويعيد استخدامها
   * في أي نشاط جديد بدل إعادة كتابتها. لا صلة لها بنتائج المشاركين.
   */

  router.get('/bank', auth.requireUser, async (req, res) => {
    try {
      const list = await storage.get().listBankQuestions(req.user.id);
      res.json({ questions: list.map((item) => ({ id: item.id, question: item.question, createdAt: item.createdAt, updatedAt: item.updatedAt })) });
    } catch (err) {
      console.error('list bank:', err);
      res.status(500).json({ error: 'تعذّر جلب بنك الأسئلة' });
    }
  });

  router.post('/bank', auth.requireUser, async (req, res) => {
    try {
      const list = await storage.get().listBankQuestions(req.user.id);
      if (list.length >= MAX_BANK_QUESTIONS) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_BANK_QUESTIONS} سؤالاً) — احذف أسئلة قديمة` });
      }
      const question = normalizeQuestion(req.body?.question || req.body, 0);
      const now = Date.now();
      const item = { id: storage.newId('bq_'), ownerId: req.user.id, question, createdAt: now, updatedAt: now };
      await storage.get().saveBankQuestion(item);
      res.status(201).json({ item: { id: item.id, question: item.question, createdAt: item.createdAt, updatedAt: item.updatedAt } });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر حفظ السؤال في البنك' });
    }
  });

  router.put('/bank/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().getBankQuestion(req.params.id);
      if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'السؤال غير موجود' });
      const question = normalizeQuestion(req.body?.question || req.body, 0);
      const updated = { ...existing, question, updatedAt: Date.now() };
      await storage.get().saveBankQuestion(updated);
      res.json({ item: { id: updated.id, question: updated.question, updatedAt: updated.updatedAt } });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تحديث السؤال' });
    }
  });

  router.delete('/bank/:id', auth.requireUser, async (req, res) => {
    const existing = await storage.get().getBankQuestion(req.params.id);
    if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'السؤال غير موجود' });
    await storage.get().deleteBankQuestion(existing.id);
    res.json({ ok: true });
  });

  return router;
}

/**
 * حفظ تلقائي عند الإطلاق: المدرب المسجّل لا يحتاج زر «حفظ» —
 * كل جلسة يطلقها تُحفظ في نشاطاته (أو تُحدَّث إن كانت نسخة من نشاط موجود).
 * إنهاء الجلسة أو إيقافها لا يمس النشاط المحفوظ أبداً.
 * يعيد معرّف النشاط أو null، ولا يرمي خطأ حتى لا يعطل إنشاء الجلسة.
 */
async function syncLaunchedActivity(user, session, activityId) {
  try {
    const db = storage.get();
    const now = Date.now();
    const content = { title: session.title, settings: session.settings, questions: session.questions };

    if (activityId) {
      const existing = await db.getActivity(String(activityId));
      if (existing && existing.ownerId === user.id) {
        await db.saveActivity({ ...existing, ...content, updatedAt: now });
        return existing.id;
      }
    }

    const list = await db.listActivities(user.id);
    // إطلاق متكرر لنفس النشاط بلا معرّف: نطابق بالعنوان وعدد الأسئلة بدل تكديس نسخ
    const twin = list.find(
      (a) => a.title === session.title && Array.isArray(a.questions) && a.questions.length === session.questions.length
    );
    if (twin) {
      await db.saveActivity({ ...twin, ...content, updatedAt: now });
      return twin.id;
    }

    if (list.length >= MAX_ACTIVITIES) return null;
    const activity = {
      id: storage.newId('a_'),
      ownerId: user.id,
      ...content,
      createdAt: now,
      updatedAt: now,
    };
    await db.saveActivity(activity);
    return activity.id;
  } catch (err) {
    console.error('الحفظ التلقائي للنشاط:', err.message);
    return null;
  }
}

module.exports = { accountRoutes, syncLaunchedActivity };
