'use strict';

/**
 * مسارات الحساب والأنشطة المحفوظة.
 * المحفوظ هنا أسئلة المدرب وإعداداته فقط — لا نتائج مشاركين ولا إجاباتهم.
 */

const express = require('express');
const storage = require('./storage');
const auth = require('./auth');
const { normalizeQuiz } = require('./session');

const MAX_ACTIVITIES = 200;

function accountRoutes(store) {
  const router = express.Router();

  const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name });

  // ----------------------------------------------------------- المصادقة

  router.post('/auth/signup', async (req, res) => {
    try {
      const email = auth.validateEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });

      const name = String(req.body?.name || '').trim().slice(0, 60);
      if (name.length < 2) return res.status(400).json({ error: 'اكتب اسمك (حرفان على الأقل)' });

      const check = auth.validatePassword(req.body?.password);
      if (check.error) return res.status(400).json({ error: check.error });

      if (await storage.get().findUserByEmail(email)) {
        return res.status(409).json({ error: 'هذا البريد مسجّل مسبقاً — سجّل الدخول بدلاً من ذلك' });
      }

      const { hash, salt } = await auth.hashPassword(check.password);
      const user = await storage.get().createUser({
        id: storage.newId('u_'),
        email,
        name,
        passwordHash: hash,
        salt,
        createdAt: Date.now(),
      });

      await auth.startSession(req, res, user.id);
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      console.error('signup:', err);
      res.status(500).json({ error: 'تعذّر إنشاء الحساب' });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const email = auth.validateEmail(req.body?.email);
      const password = String(req.body?.password || '');
      if (!email || !password) return res.status(400).json({ error: 'أدخل البريد وكلمة المرور' });

      const key = auth.throttleKey(req, email);
      if (auth.tooManyAttempts(key)) {
        return res.status(429).json({ error: 'محاولات كثيرة فاشلة — انتظر عشر دقائق ثم أعد المحاولة' });
      }

      const user = await storage.get().findUserByEmail(email);
      // رسالة واحدة للحالتين حتى لا نكشف البريد المسجّل من غيره
      const ok = user && (await auth.verifyPassword(password, user.passwordHash, user.salt));
      if (!ok) {
        auth.recordFailure(key);
        return res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحة' });
      }

      auth.clearFailures(key);
      await auth.startSession(req, res, user.id);
      res.json({ user: publicUser(user) });
    } catch (err) {
      console.error('login:', err);
      res.status(500).json({ error: 'تعذّر تسجيل الدخول' });
    }
  });

  router.post('/auth/logout', async (req, res) => {
    await auth.endSession(req, res);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req, res) => {
    res.json({ user: req.user || null, durable: storage.isDurable() });
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

  return router;
}

module.exports = { accountRoutes };
