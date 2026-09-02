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
const countries = require('./countries');
const social = require('./social-links');
const { normalizeQuiz } = require('./session');
const gameCover = require('./game-cover');
const { sendGameFrame } = require('./game-frame');

const MAX_ACTIVITIES = 200;
// سقف ما تعرضه «أسئلتي السابقة» في نداء واحد — القائمة للتصفّح لا للجرد
const MAX_MY_QUESTIONS = 500;

const DEFAULT_NEXT = '/host.html#/mine';

/**
 * يقبل فقط مساراً داخلياً — يمنع التحويل إلى موقع خارجي عبر next=.
 * لا يكفي رفض «//evil.com»: المتصفحات تعامل الشرطة العكسية معاملة المائلة
 * في موضع المضيف، و«/\evil.com» يمرّ من فحص نصّي ساذج ثم يخرج بلا ترميز.
 * فنحلّل العنوان ونحتفظ بمساره فقط، وهذا يسقط المضيف مهما كانت صياغته.
 */
function safeNext(value) {
  const requested = String(value || DEFAULT_NEXT);
  if (!requested.startsWith('/')) return DEFAULT_NEXT;
  try {
    const url = new URL(requested, 'http://tapio.invalid');
    // عنوان يحمل مضيفاً غير الوهمي يعني أنه هرب من كوننا نسبيّين
    if (url.host !== 'tapio.invalid') return DEFAULT_NEXT;
    const path = url.pathname + url.search + url.hash;
    return path.startsWith('//') ? DEFAULT_NEXT : path;
  } catch {
    return DEFAULT_NEXT;
  }
}

/**
 * يضيف `welcome=1` إلى وجهةٍ نسبية سبق أن مرّت على safeNext.
 * البناء يدويّ لأن الوجهة قد تحمل مرساة (`/host.html#/ai`)، ولصق المعامل في
 * آخر النصّ كان سيضعه داخل المرساة فلا تقرؤه الصفحة.
 */
function withWelcome(target) {
  const [beforeHash, ...rest] = String(target).split('#');
  const hash = rest.length ? '#' + rest.join('#') : '';
  const [pathPart, query] = beforeHash.split('?');
  const search = query ? `?${query}&welcome=1` : '?welcome=1';
  return pathPart + search + hash;
}

/**
 * تسجيلات كل يوم في آخر `days` يوماً — سلسلةٌ متّصلة بلا فجوات.
 *
 * الأيام الصفرية تُذكر صراحةً: رسمٌ يقفز من يومٍ إلى يومٍ بعده بثلاثة أيام
 * يبدو نموّاً مطّرداً وهو انقطاع. والحدّ الأدنى يوم واحد كي لا يُقسم على صفر.
 */
function signupsByDay(users, days) {
  const span = Math.max(1, Math.min(365, Number(days) || 30));
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const tally = new Map();
  for (const u of users) {
    if (!u.createdAt) continue;
    const key = dayKey(u.createdAt);
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const out = [];
  const today = Date.now();
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = dayKey(today - i * 86400000);
    out.push({ day: key, count: tally.get(key) || 0 });
  }
  return out;
}

/** نصّ قصير مُشذَّب — لحقول المكتبة القادمة من المدرب أو من شريط العنوان */
function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * الاسم الأول وحده يُنسب إليه النشاط في المكتبة. المعلّم نشر درساً لا سيرةً
 * ذاتية، والاسم الكامل مع المادة والصف يكفي للتعرّف عليه شخصياً.
 */
function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/**
 * ما يراه الطلاب. الأصل الاسم الأول وحده — المعلّم نشر درساً لا سيرةً — لكنّ
 * من ملأ بروفايله اختار بنفسه ما يُعرض، فاختياره يعلو على القاعدة.
 */
function publicNameOf(user) {
  return clean(user?.displayName, 60) || firstNameOf(user?.name);
}

/** رقم تواصل: أرقامٌ وعلامةُ زائد وفواصل شكلية فقط */
function cleanPhone(value) {
  const raw = clean(value, 24);
  if (!raw) return '';
  if (!/^\+?[\d\s()-]{6,24}$/.test(raw)) {
    throw Object.assign(new Error('رقم التواصل غير صالح — أرقامٌ فقط مع + إن أردت'), { status: 400 });
  }
  return raw;
}

function accountRoutes(store) {
  const router = express.Router();

  // ----------------------------------------------------------- المصادقة عبر جوجل فقط

  /** يبدأ تسجيل الدخول: يحوّل المتصفح إلى صفحة اختيار حساب جوجل */
  router.get('/auth/google', (req, res) => {
    if (!google.isConfigured()) {
      // هذا المسار صار مقصداً مباشراً لأزرار الدخول في كل الصفحات، فخطؤه
      // يجب أن يهبط بالزائر على صفحةٍ تشرح لا على JSON خام في نافذته
      return res.redirect('/login.html?error=' + encodeURIComponent('تسجيل الدخول عبر جوجل غير مُفعّل على هذا الخادم'));
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
      // الحساب الجديد يُمنح بريميوم تلقائياً — نُعلمه بذلك في وجهته لا في رسالة
      // منفصلة: `welcome=1` تجعل أول شاشة يراها هي شاشة «ما الذي فُتح لك».
      res.redirect(user.isNew && premium.signupTrialMs() ? withWelcome(safeNext(saved.next)) : safeNext(saved.next));
    } catch (err) {
      console.error('دخول جوجل:', err.message);
      bounce('تعذّر تسجيل الدخول عبر جوجل — حاول مجدداً');
    }
  });

  router.post('/auth/logout', async (req, res) => {
    try {
      await auth.endSession(req, res);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'تعذّر تسجيل الخروج' });
    }
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
      const counts = (await storage.get().ownerCounts?.()) || new Map();
      res.json({
        now: Date.now(),
        signups: signupsByDay(users, 30),
        users: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          createdAt: u.createdAt,
          premiumUntil: u.premiumUntil ?? null,
          isPremium: premium.isPremium(u),
          isAdmin: premium.isAdmin(u),
          onSignupTrial: premium.onSignupTrial(u),
          activities: counts.get(u.id)?.activities || 0,
          games: counts.get(u.id)?.games || 0,
          country: u.country || '',
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
          published: Boolean(a.published),
          subject: a.subject || '',
          grade: a.grade || '',
          copies: a.copies || 0,
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
    try {
      const activity = await storage.get().getActivity(req.params.id);
      if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
      res.json({ activity });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر جلب النشاط' });
    }
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
    try {
      const activity = await storage.get().getActivity(req.params.id);
      if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
      await storage.get().deleteActivity(activity.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف النشاط' });
    }
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
        // النسخة لا ترث النشر ولا عدّاد النسخ — وإلا ظهر النشاط مرّتين في المكتبة
        published: false,
        publishedAt: null,
        copies: 0,
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
      // الاشتراك يُفحص عند كل إطلاق: نشاط حُفظ أيام البريميوم لا يبقى مفتوحاً بعد انتهائه
      premium.assertImagesAllowed(req.user, activity.questions);

      const session = store.createSession({
        title: activity.title,
        settings: activity.settings,
        questions: activity.questions,
      });
      session.ownerId = req.user.id;
      session.ownerName = req.user.name;
      session.activityId = activity.id;

      res.status(201).json({ code: session.code, hostToken: session.hostToken, title: session.title });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر إطلاق الجلسة' });
    }
  });

  // ------------------------------------------------------------ بنك الأسئلة

  /**
   * «أسئلتي السابقة» — بديل بنك الأسئلة.
   *
   * كان البنك مكاناً ثانياً تعيش فيه الأسئلة، وله زرُّ حفظٍ منفصل على كل
   * سؤال يجب أن يتذكّره المعلّم **قبل** أن يعرف أنه سيحتاج السؤال ثانيةً.
   * وأكثر من ملأه لم يستعمله، وأكثر من احتاج سؤالاً قديماً كان قد كتبه في
   * نشاطٍ سابق لا في البنك. فحُذف المفهوم وبقي الغرض: بحثٌ واحد يمرّ على
   * **كل أسئلة المعلّم** — في أنشطته المحفوظة وفي بنكه القديم معاً — فلا
   * يضيع ما جمعه أحدٌ من قبل، ولا يُطلب منه حفظٌ مسبق بعد اليوم.
   */
  router.get('/my-questions', auth.requireUser, async (req, res) => {
    try {
      const needle = String(req.query.q || '').trim().toLowerCase();
      const db = storage.get();
      const [activities, bank] = await Promise.all([db.listActivities(req.user.id), db.listBankQuestions(req.user.id)]);
      const out = [];
      const seen = new Set();
      const add = (question, from) => {
        const text = String(question?.text || '').trim();
        if (!text) return;
        // سؤالٌ واحد كُرّر في ثلاثة أنشطة يظهر مرة واحدة — القائمة للاختيار لا للجرد
        const key = question.type + '|' + text.toLowerCase();
        if (seen.has(key)) return;
        if (needle && !text.toLowerCase().includes(needle)) return;
        seen.add(key);
        // بلا الصور: القائمة قد تحمل مئات الأسئلة وصورةٌ واحدة تثقلها كلها
        const { image, ...light } = question;
        out.push({ question: { ...light, hasImage: Boolean(image) }, from });
      };
      for (const item of bank) add(item.question, '');
      for (const activity of activities) for (const question of activity.questions || []) add(question, activity.title);
      res.json({ questions: out.slice(0, MAX_MY_QUESTIONS), total: out.length });
    } catch (err) {
      console.error('my-questions:', err);
      res.status(500).json({ error: 'تعذّر جلب أسئلتك السابقة' });
    }
  });

  // ---------------------------------------------------------------- الفصول
  //
  // أسماءُ طلاب المعلّم كما يكتبها هو، **اختيارية بالكامل**، وغرضها واحد:
  // أن يعرف من لم يدخل بعد، وأن تتّحد كتابة الاسم بين الحصص فلا يظهر
  // «احمد» و«أحمد» صفَّين في التقرير.
  //
  // والوعد الأصلي لم يُمسّ: هذه قائمةٌ كتبها المعلّم في حسابه، لا بياناتٌ
  // جمعتها المنصة من الطلاب، ولا تُربط بإجابة أحد. الإجابات تبقى في الذاكرة
  // وتختفي بانتهاء الجلسة كما كانت.

  const MAX_CLASSES = 60;
  const MAX_STUDENTS = 300;

  /** أسماءٌ نظيفة بلا فراغات ولا تكرار — تُقبل ملصوقةً بأسطر أو فواصل */
  function cleanNames(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\n,،;]+/);
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const name = String(item || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= MAX_STUDENTS) break;
    }
    return out;
  }

  router.get('/classes', auth.requireUser, async (req, res) => {
    try {
      res.json({ classes: await storage.get().listClasses(req.user.id) });
    } catch (err) {
      console.error('list classes:', err);
      res.status(500).json({ error: 'تعذّر جلب فصولك' });
    }
  });

  router.post('/classes', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().listClasses(req.user.id);
      if (existing.length >= MAX_CLASSES) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_CLASSES} فصلاً) — احذف فصلاً قديماً` });
      }
      const name = String(req.body?.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'اكتب اسم الفصل' });
      const now = Date.now();
      const item = {
        id: storage.newId('cl_'),
        ownerId: req.user.id,
        name,
        students: cleanNames(req.body?.students),
        createdAt: now,
        updatedAt: now,
      };
      await storage.get().saveClass(item);
      res.status(201).json({ class: item });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر حفظ الفصل' });
    }
  });

  router.put('/classes/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().getClass(req.params.id);
      if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'الفصل غير موجود' });
      const name = String(req.body?.name ?? existing.name).trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'اكتب اسم الفصل' });
      const updated = {
        ...existing,
        name,
        students: req.body?.students === undefined ? existing.students : cleanNames(req.body.students),
        updatedAt: Date.now(),
      };
      await storage.get().saveClass(updated);
      res.json({ class: updated });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تحديث الفصل' });
    }
  });

  router.delete('/classes/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().getClass(req.params.id);
      if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'الفصل غير موجود' });
      await storage.get().deleteClass(existing.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف الفصل' });
    }
  });

  // ------------------------------------------------------- المكتبة العامة

  /**
   * نشر نشاط في المكتبة. النشر قرار صريح لصاحبه، وما يُنشر يصير مرئياً
   * بأسئلته وإجاباته الصحيحة — لذا يحذّره العميل قبل الضغط، ويستطيع سحبه
   * في أي لحظة. النسخ لا تتأثر بالسحب: كل ناسخ أخذ نسخته المستقلة.
   */
  router.post('/activities/:id/publish', auth.requireUser, async (req, res) => {
    try {
      const activity = await storage.get().getActivity(req.params.id);
      if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
      if (!Array.isArray(activity.questions) || activity.questions.length < 3) {
        return res.status(400).json({ error: 'انشر نشاطاً فيه ٣ أسئلة على الأقل — المكتبة للمحتوى المفيد لا للتجارب' });
      }
      const updated = {
        ...activity,
        published: true,
        publishedAt: activity.publishedAt || Date.now(),
        subject: clean(req.body?.subject, 40),
        grade: clean(req.body?.grade, 40),
        copies: activity.copies || 0,
      };
      await storage.get().saveActivity(updated);
      res.json({ published: true, subject: updated.subject, grade: updated.grade });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر نشر النشاط' });
    }
  });

  router.post('/activities/:id/unpublish', auth.requireUser, async (req, res) => {
    try {
      const activity = await storage.get().getActivity(req.params.id);
      const owner = activity && (activity.ownerId === req.user.id || premium.isAdmin(req.user));
      if (!owner) return res.status(404).json({ error: 'النشاط غير موجود' });
      await storage.get().saveActivity({ ...activity, published: false });
      res.json({ published: false });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر سحب النشاط' });
    }
  });

  /** تصفّح المكتبة — متاح بلا حساب: هذه أوسع بوابة يدخل منها معلّم جديد */
  router.get('/library', async (req, res) => {
    try {
      const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
      const page = Math.max(0, Number(req.query.page) || 0);
      const { items, total } = await storage.get().listPublished({
        q: clean(req.query.q, 80),
        subject: clean(req.query.subject, 40),
        grade: clean(req.query.grade, 40),
        lang: req.query.lang === 'en' ? 'en' : req.query.lang === 'ar' ? 'ar' : '',
        limit,
        offset: page * limit,
      });
      res.json({
        total,
        page,
        limit,
        // العناوين والوصف فقط — الأسئلة تحتاج حساباً (انظر المسار التالي)
        items: items.map((a) => ({
          id: a.id,
          title: a.title,
          subject: a.subject || '',
          grade: a.grade || '',
          lang: a.settings?.lang || 'ar',
          questionCount: Array.isArray(a.questions) ? a.questions.length : 0,
          types: [...new Set((a.questions || []).map((q) => q.type))],
          copies: a.copies || 0,
          publishedAt: a.publishedAt,
          author: firstNameOf(a.authorName),
        })),
      });
    } catch (err) {
      console.error('library:', err);
      res.status(500).json({ error: 'تعذّر جلب المكتبة' });
    }
  });

  /**
   * معاينة نشاط منشور بأسئلته. تتطلّب حساباً عمداً: المكتبة تحوي إجابات
   * صحيحة، وفتحها للزائر المجهول يجعلها ورقة غشّ لطالب يبحث عن اختبار غده.
   */
  router.get('/library/:id', auth.requireUser, async (req, res) => {
    try {
      const activity = await storage.get().getActivity(req.params.id);
      if (!activity || !activity.published) return res.status(404).json({ error: 'النشاط غير موجود في المكتبة' });
      const author = await storage.get().findUserById(activity.ownerId);
      res.json({
        activity: {
          id: activity.id,
          title: activity.title,
          subject: activity.subject || '',
          grade: activity.grade || '',
          settings: activity.settings,
          questions: activity.questions,
          copies: activity.copies || 0,
          author: firstNameOf(author?.name),
        },
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر جلب النشاط' });
    }
  });

  /** نسخ نشاط من المكتبة إلى أنشطتي — نسخة مستقلة تماماً عن الأصل */
  router.post('/library/:id/copy', auth.requireUser, async (req, res) => {
    try {
      const source = await storage.get().getActivity(req.params.id);
      if (!source || !source.published) return res.status(404).json({ error: 'النشاط غير موجود في المكتبة' });
      const list = await storage.get().listActivities(req.user.id);
      if (list.length >= MAX_ACTIVITIES) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_ACTIVITIES} نشاطاً) — احذف نشاطاً قديماً` });
      }
      // صور الأسئلة ميزة بريميوم: نُسقطها للناسخ المجاني بدل رفض النسخة كلها،
      // ونخبره — فالمنع هنا يحرمه محتوى مجّانياً بسبب صورةٍ ليست له.
      const paid = premium.isPremium(req.user);
      const questions = (source.questions || []).map((q) => (paid || !q.image ? q : { ...q, image: null }));
      const dropped = paid ? 0 : (source.questions || []).filter((q) => q.image).length;
      const now = Date.now();
      const copy = {
        id: storage.newId('a_'),
        ownerId: req.user.id,
        title: source.title.slice(0, 120),
        settings: source.settings,
        questions,
        createdAt: now,
        updatedAt: now,
        published: false, // النسخة لا تُنشر تلقائياً — النشر قرار ناسخها وحده
        publishedAt: null,
        subject: source.subject || '',
        grade: source.grade || '',
        copies: 0,
      };
      await storage.get().saveActivity(copy);
      await storage.get().bumpCopies(source.id);
      res.status(201).json({ activity: { id: copy.id, title: copy.title }, droppedImages: dropped });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر نسخ النشاط' });
    }
  });

  // ---------------------------------------------------- الألعاب التفاعلية

  /**
   * قسم الألعاب: المعلّم يرفع ملف HTML يعمل بذاته، والطلاب يلعبونه.
   *
   * **نموذج الأمان.** هذا الملف شفرةٌ كتبها شخصٌ آخر، وتشغيلها على نطاقنا
   * يعني — لو تُركت — أن تقرأ كوكي جلسة كل من يفتحها وتنتحل شخصيته على
   * المنصة. لذلك:
   *
   *  ١) لا تُقدَّم داخل صفحة، بل في **إطار معزول بلا `allow-same-origin`**،
   *     فأصلها «مبهم»: لا كوكي، ولا `localStorage`، ولا وصول إلى صفحة الأب،
   *     ولا طلبات مُعتمَدة إلى `/api`.
   *  ٢) وسياسة محتوى على المستند نفسه تمنع `connect-src` و`form-action`،
   *     فلا تستطيع اللعبة إرسال ما يكتبه الطالب فيها إلى أي جهة.
   *  ٣) ولا نُنقّي الشفرة إطلاقاً — تنقيةُ HTML عامٍّ وهمُ أمانٍ يكسر الألعاب
   *     ولا يمنع محترفاً. العزل هو الضمانة، لا التنقية.
   *  ٤) والمالك يستطيع حذف أي لعبة، وفي كل صفحة رابط إبلاغ.
   */
  const MAX_GAME_BYTES = 2 * 1024 * 1024; // ٢ ميغابايت: تكفي لعبةً مكتفيةً بذاتها
  const MAX_GAMES_PER_USER = 60;
  // نبذةٌ لا سيرة: فقرةٌ تُقرأ في بطاقةٍ لا صفحةٌ تُطوى
  const MAX_BIO_CHARS = 300;

  /**
   * عدّادات الزيارة والتقييم بلا حساب: نمنع التكرار بالعنوان في الذاكرة.
   * هذا يضبط النقر العابر لا المتلاعب المصرّ — وهو ما تحتمله عدّادات شعبية،
   * ولا نبني عليها علامةً ولا قراراً.
   */
  const gameSeen = new Map(); // "ip|id|kind" -> وقت الانتهاء
  const GAME_SEEN_MS = 60 * 60 * 1000;

  function seenRecently(req, id, kind) {
    const key = `${req.ip || 'x'}|${id}|${kind}`;
    const now = Date.now();
    if (gameSeen.size > 20000) for (const [k, at] of gameSeen) if (at < now) gameSeen.delete(k);
    if ((gameSeen.get(key) || 0) > now) return true;
    gameSeen.set(key, now + GAME_SEEN_MS);
    return false;
  }

  /**
   * الصورة المصغّرة: data URI فقط، وبأنواعٍ نقدر على تقديمها بأمان.
   * نستبعد SVG عمداً — ملفُّ SVG مستندٌ كامل يحمل نصوصاً، ولا داعي
   * لفتح ذلك الباب من أجل صورةِ بطاقة.
   */
  const COVER_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/gif'];
  const MAX_COVER_BYTES = 400 * 1024;

  function readCover(raw, max = MAX_COVER_BYTES) {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match || !COVER_TYPES.includes(match[1])) {
      throw Object.assign(new Error('الصورة المصغّرة يجب أن تكون PNG أو JPG أو WebP'), { status: 400 });
    }
    if (Buffer.byteLength(match[2], 'base64') > max) {
      throw Object.assign(new Error(`الصورة أكبر من ${Math.round(max / 1024)} كيلوبايت`), { status: 413 });
    }
    return value;
  }

  /**
   * يقرأ حقول اللعبة من الطلب ويتحقّق منها.
   * `coverRequired` تُطفأ عند التحديث: من يعدّل عنوان لعبته لا يُطالَب بإعادة
   * رفع صورتها، والحقل الغائب يعني «أبقِ الصورة الحالية».
   */
  function readGame(body, { coverRequired = true } = {}) {
    const title = clean(body?.title, 120);
    if (!title) throw Object.assign(new Error('اكتب اسم اللعبة'), { status: 400 });
    const html = String(body?.html ?? '');
    const bytes = Buffer.byteLength(html, 'utf8');
    if (!html.trim()) throw Object.assign(new Error('ارفع ملف اللعبة أو الصق شفرتها'), { status: 400 });
    if (bytes > MAX_GAME_BYTES) {
      throw Object.assign(new Error('حجم اللعبة أكبر من ٢ ميغابايت — اجعلها ملفاً واحداً أخفّ'), { status: 413 });
    }
    if (!/<[a-z!]/i.test(html)) {
      throw Object.assign(new Error('هذا لا يبدو ملف HTML — ارفع ملفاً يبدأ بوسوم صفحة'), { status: 400 });
    }
    // مصفوفة فارغة = «كل المراحل»
    const grades = Array.isArray(body?.grades) ? [...new Set(body.grades.map((g) => clean(g, 40)).filter(Boolean))].slice(0, 12) : [];
    const cover = readCover(body?.cover);
    if (!cover && coverRequired) throw Object.assign(new Error('أرفق صورةً مصغّرة تدلّ على اللعبة'), { status: 400 });
    return {
      title,
      html,
      bytes,
      grades,
      // بلا صورةٍ جديدة لا نكتب الحقل أصلاً، فلا يُمحى ما هو محفوظ
      ...(cover ? { cover } : {}),
      // الحفظ للعمل بلا إنترنت مسموحٌ ما لم يمنعه صاحب اللعبة صراحةً
      offlineOk: body?.offlineOk !== false,
      subject: clean(body?.subject, 40),
      description: clean(body?.description, 300),
    };
  }

  /** بطاقة اللعبة للمتصفّح — بلا الشفرة، فالقائمة لا تحتاجها ولا تُحمَّل بها */
  const gameCard = (g) => ({
    id: g.id,
    title: g.title,
    subject: g.subject || '',
    grades: g.grades || [],
    description: g.description || '',
    plays: g.plays || 0,
    rating: g.ratingCount ? Math.round((g.ratingSum / g.ratingCount) * 10) / 10 : null,
    ratingCount: g.ratingCount || 0,
    bytes: g.bytes || 0,
    // وجودُ الصورة فقط؛ بايتاتها تأتي من مسارها الخاص القابل للتخزين
    cover: Boolean(g.hasCover),
    // بصمةٌ تُلحَق بعنوان الصورة: مسارها مخزَّنٌ يوماً كاملاً، فبدون تغيّر
    // العنوان يبقى المعلّم يرى صورته القديمة بعد أن بدّلها
    coverAt: g.updatedAt || 0,
    offlineOk: g.offlineOk !== false,
    createdAt: g.createdAt,
    author: publicNameOf({ displayName: g.authorDisplayName, name: g.authorName }),
    authorId: g.ownerId,
  });

  // ------------------------------------------------------ بروفايل المعلّم

  const MAX_PHOTO_BYTES = 200 * 1024;

  /** ما يراه صاحب الحساب عن نفسه */
  /**
   * إظهار الرقم اختيارٌ لا نتيجةَ ملئه.
   *
   * وغيابُ الراية يعني «أظهره»: حساباتٌ كتبت رقمها قبل وجودها كان رقمها
   * ظاهراً، فلا يختفي بنشرةٍ لم يطلبوها.
   */
  const phoneIsPublic = (u) => u?.phonePublic !== false;

  const myProfile = (u) => ({
    id: u.id,
    name: u.name,
    displayName: u.displayName || '',
    phone: u.phone || '',
    phonePublic: phoneIsPublic(u),
    bio: u.bio || '',
    photo: Boolean(u.hasPhoto),
    country: u.country || '',
    links: Array.isArray(u.links) ? u.links : [],
    publicName: publicNameOf(u),
    // ما ينقص البروفايل — تسألُه الواجهة لتدعو المعلّم إلى إكماله بلا إلزام
    missing: ['displayName', 'photo', 'bio', 'country'].filter((key) =>
      key === 'photo' ? !u.hasPhoto : !String(u[key] || '').trim()
    ),
  });

  /**
   * قائمة البلدان المسموح بها — رموز ISO فقط بلا أسماء.
   *
   * الأسماء يولّدها المتصفّح بـ`Intl.DisplayNames` بلغة قارئه، فلا نرسل
   * قاموساً بلغتين ولا نصون أسماء مئتَي بلد. عامّةٌ بلا جلسة: من يفتح صفحة
   * البروفايل يحتاجها قبل أن نعرف شيئاً عنه.
   */
  router.get('/countries', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json({ arab: countries.ARAB, rest: countries.REST, overrides: countries.NAME_OVERRIDES });
  });

  router.get('/profile', auth.requireUser, async (req, res) => {
    try {
      const me = await storage.get().findUserById(req.user.id);
      if (!me) return res.status(404).json({ error: 'الحساب غير موجود' });
      res.json({ profile: myProfile(me) });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب البروفايل' });
    }
  });

  /**
   * تحديث البروفايل. الحقول الثلاثة اختيارية: ما لم يُرسَل يبقى كما هو،
   * وما أُرسل فارغاً يُمسح — فيستطيع المعلّم التراجع عن أيٍّ منها.
   */
  router.put('/profile', auth.requireUser, async (req, res) => {
    try {
      const patch = {};
      const body = req.body || {};
      if (body.displayName !== undefined) patch.displayName = clean(body.displayName, 60);
      if (body.phone !== undefined) patch.phone = cleanPhone(body.phone);
      if (body.phonePublic !== undefined) patch.phonePublic = body.phonePublic !== false;
      if (body.bio !== undefined) patch.bio = clean(body.bio, MAX_BIO_CHARS);
      if (body.photo !== undefined) patch.photo = body.photo ? readCover(body.photo, MAX_PHOTO_BYTES) : '';
      // البلد يُقارَن بقائمة الخادم لا يُصدَّق كما وصل: رمزٌ خارجها يُرفض بلا
      // مساومة — الواجهة تقترح، والخادم يقرّر
      if (body.country !== undefined) {
        const code = countries.clean(body.country);
        if (body.country && !code) return res.status(400).json({ error: 'اختر بلداً من القائمة' });
        patch.country = code;
      }
      // الروابط تُنشر على صفحةٍ يفتحها طلاب: `http(s)` وحدهما يمرّان (social-links.js)
      if (body.links !== undefined) patch.links = social.cleanList(body.links);
      const updated = await storage.get().updateProfile(req.user.id, patch);
      if (!updated) return res.status(404).json({ error: 'الحساب غير موجود' });
      res.json({ profile: myProfile(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر حفظ البروفايل' });
    }
  });

  /**
   * البروفايل العلني. لا بريد ولا معرّف جوجل ولا شيء لم يكتبه المعلّم بنفسه:
   * الاسم الظاهر دائماً، والصورة والرقم إن ملأهما — والفارغ لا يُذكر أصلاً.
   */
  router.get('/teachers/:id', async (req, res) => {
    try {
      const u = await storage.get().findUserById(req.params.id);
      if (!u) return res.status(404).json({ error: 'المعلّم غير موجود' });
      res.json({
        teacher: {
          id: u.id,
          name: publicNameOf(u),
          photo: Boolean(u.hasPhoto),
          bio: u.bio || '',
          // ومعها منصّةُ كل رابط مستنتجةً من نطاقه — الواجهة تعرض ولا تخمّن
          links: social.publicList(u.links),
          // الرقم يُحجب على الخادم لا في الواجهة: ما لا يُرسل لا يُكشف بفتح الأدوات
          phone: phoneIsPublic(u) ? u.phone || '' : '',
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب البروفايل' });
    }
  });

  router.get('/teachers/:id/photo', async (req, res) => {
    try {
      const photo = await storage.get().getUserPhoto(req.params.id);
      const match = photo && /^data:([a-z/+-]+);base64,(.+)$/.exec(photo);
      if (!match) return res.status(404).end();
      res.setHeader('Content-Type', match[1]);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(match[2], 'base64'));
    } catch (err) {
      res.status(404).end();
    }
  });

  /** دليل المعلّمين — كي يتصفّح الطالب حسب معلّمه لا حسب المادة فقط */
  router.get('/game-teachers', async (req, res) => {
    try {
      const rows = await storage.get().listGameTeachers();
      res.json({
        items: rows
          .filter((r) => r.name || r.displayName)
          .map((r) => ({ id: r.id, name: publicNameOf(r), photo: Boolean(r.hasPhoto), games: r.games, plays: r.plays })),
      });
    } catch (err) {
      console.error('game teachers:', err);
      res.status(500).json({ error: 'تعذّر جلب المعلّمين' });
    }
  });

  router.get('/games', async (req, res) => {
    try {
      const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
      const page = Math.max(0, Number(req.query.page) || 0);
      const sort = ['popular', 'rated', 'new'].includes(req.query.sort) ? req.query.sort : 'popular';
      const { items, total } = await storage.get().listGames({
        q: clean(req.query.q, 80),
        subject: clean(req.query.subject, 40),
        grade: clean(req.query.grade, 40),
        ownerId: clean(req.query.teacher, 60),
        sort,
        limit,
        offset: page * limit,
      });
      res.json({ total, page, limit, sort, items: items.map(gameCard) });
    } catch (err) {
      console.error('games list:', err);
      res.status(500).json({ error: 'تعذّر جلب الألعاب' });
    }
  });

  router.get('/games/:id', async (req, res) => {
    try {
      const game = await storage.get().getGame(req.params.id);
      if (!game) return res.status(404).json({ error: 'اللعبة غير موجودة' });
      res.json({ game: gameCard(game) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر جلب اللعبة' });
    }
  });

  /**
   * الصورة المصغّرة بمسارٍ مستقلّ: تُخزَّن في المتصفّح والوسائط، ولا تثقل
   * JSON القائمة. لا تحتاج جلسةً — البطاقة نفسها عامّة.
   */
  router.get('/games/:id/cover', async (req, res) => {
    try {
      const cover = await storage.get().getGameCover(req.params.id);
      const match = cover && /^data:([a-z/+-]+);base64,(.+)$/.exec(cover);
      if (!match) return res.status(404).end();
      res.setHeader('Content-Type', match[1]);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(match[2], 'base64'));
    } catch (err) {
      res.status(404).end();
    }
  });

  /**
   * مستند اللعبة نفسه — يُقدَّم داخل الإطار المعزول، ويصحّ فتحه في تبويبٍ
   * مستقلّ أيضاً: ترويسة CSP فيها `sandbox` فيبقى الأصل مبهماً في الحالتين.
   */
  router.get('/games/:id/frame', async (req, res) => {
    try {
      const game = await storage.get().getGame(req.params.id);
      if (!game) return res.status(404).type('text/plain; charset=utf-8').send('اللعبة غير موجودة');
      if (!seenRecently(req, game.id, 'play')) storage.get().bumpGamePlays(game.id).catch(() => {});

      sendGameFrame(res, game.html);
    } catch (err) {
      res.status(500).type('text/plain; charset=utf-8').send('تعذّر تشغيل اللعبة');
    }
  });

  router.post('/games/:id/rate', async (req, res) => {
    try {
      const stars = Math.round(Number(req.body?.stars));
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'التقييم من ١ إلى ٥' });
      const game = await storage.get().getGame(req.params.id);
      if (!game) return res.status(404).json({ error: 'اللعبة غير موجودة' });
      if (seenRecently(req, game.id, 'rate')) return res.status(429).json({ error: 'قيّمت هذه اللعبة قبل قليل' });
      await storage.get().rateGame(game.id, stars);
      const fresh = await storage.get().getGame(game.id);
      res.json({ rating: gameCard(fresh).rating, ratingCount: fresh.ratingCount });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر التقييم' });
    }
  });

  /**
   * توليد صورةٍ مصغّرة من شيفرة اللعبة — بديل رفعِ لقطة شاشة.
   *
   * الشيفرة لا تُحفظ هنا: تُقرأ، ويُرسم منها، ويعود الرسم إلى المتصفّح الذي
   * يكتب عليه اسم اللعبة ثم يرسله مع بقية الحقول عند الرفع.
   *
   * وحدُّ استعمالٍ لكل معلّم: التوليد نداءان لخدمةٍ مدفوعة، وزرٌّ يُضغط
   * مراراً بحثاً عن رسمةٍ أجمل يستنزفها بلا قصد.
   */
  const coverUsage = new Map(); // userId -> { count, resetAt }
  const COVER_WINDOW_MS = 60 * 60 * 1000;
  const COVER_MAX = 30;

  router.post('/games/cover', auth.requireUser, async (req, res) => {
    try {
      const now = Date.now();
      if (coverUsage.size > 2000) for (const [k, v] of coverUsage) if (now >= v.resetAt) coverUsage.delete(k);
      const entry = coverUsage.get(req.user.id);
      if (!entry || now >= entry.resetAt) {
        coverUsage.set(req.user.id, { count: 1, resetAt: now + COVER_WINDOW_MS });
      } else if (entry.count >= COVER_MAX) {
        const minutes = Math.ceil((entry.resetAt - now) / 60000);
        return res.status(429).json({ error: `بلغت حدّ توليد الصور مؤقتاً — أعد المحاولة بعد ${minutes} دقيقة` });
      } else {
        entry.count += 1;
      }

      const out = await gameCover.generate({
        html: req.body?.html,
        title: req.body?.title,
        subject: req.body?.subject,
        grades: Array.isArray(req.body?.grades) ? req.body.grades.slice(0, 20) : [],
      });
      res.json({ name: out.name, image: out.image });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر توليد الصورة' });
    }
  });

  router.post('/games', auth.requireUser, async (req, res) => {
    try {
      const mine = await storage.get().listGames({ ownerId: req.user.id, limit: 1 });
      if (mine.total >= MAX_GAMES_PER_USER) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_GAMES_PER_USER} لعبة) — احذف لعبة قديمة` });
      }
      const fields = readGame(req.body);
      const now = Date.now();
      const game = {
        id: storage.newId('g_'),
        ownerId: req.user.id,
        ...fields,
        plays: 0,
        ratingSum: 0,
        ratingCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await storage.get().saveGame(game);
      res.status(201).json({ game: gameCard({ ...game, authorName: req.user.name }) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر رفع اللعبة' });
    }
  });

  router.put('/games/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().getGame(req.params.id);
      if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'اللعبة غير موجودة' });
      const fields = readGame(req.body, { coverRequired: false });
      const updated = { ...existing, ...fields, updatedAt: Date.now() };
      delete updated.authorName;
      await storage.get().saveGame(updated);
      res.json({ game: gameCard({ ...updated, authorName: req.user.name }) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تحديث اللعبة' });
    }
  });

  /**
   * تغيير صورة لعبةٍ مرفوعة — مسارٌ مستقلّ لا تعديلٌ كامل.
   *
   * لعبةٌ بحجمها الأقصى ملفان ميغابايت من HTML؛ إرسالها كلها لتبديل صورةٍ
   * بحجم عشرات الكيلوبايت هدرٌ ومخاطرة: أي عطبٍ في الرفع يستبدل اللعبة نفسها
   * لا صورتها. هذا المسار لا يلمس شفرة اللعبة إطلاقاً.
   */
  router.patch('/games/:id/cover', auth.requireUser, async (req, res) => {
    try {
      const game = await storage.get().getGame(req.params.id);
      // 404 لا 403: لا نكشف وجود لعبةٍ لغير صاحبها
      if (!game || game.ownerId !== req.user.id) return res.status(404).json({ error: 'اللعبة غير موجودة' });
      const cover = readCover(req.body?.cover);
      if (!cover) return res.status(400).json({ error: 'أرفق صورةً مصغّرة تدلّ على اللعبة' });

      const updated = { ...game, cover, updatedAt: Date.now() };
      delete updated.authorName;
      delete updated.authorDisplayName;
      await storage.get().saveGame(updated);
      // `updatedAt` الجديد هو بصمة الصورة في عنوانها: بدونه يبقى المتصفّح
      // يعرض الصورة القديمة يوماً كاملاً (Cache-Control على مسار الصورة)
      res.json({ game: gameCard({ ...updated, hasCover: true, authorName: req.user.name }) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تغيير الصورة' });
    }
  });

  router.delete('/games/:id', auth.requireUser, async (req, res) => {
    try {
      const game = await storage.get().getGame(req.params.id);
      // المالك يحذف أي لعبة — الإشراف شرطُ فتح البابِ للرفع أصلاً
      const allowed = game && (game.ownerId === req.user.id || premium.isAdmin(req.user));
      if (!allowed) return res.status(404).json({ error: 'اللعبة غير موجودة' });
      await storage.get().deleteGame(game.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف اللعبة' });
    }
  });

  router.delete('/bank/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().getBankQuestion(req.params.id);
      if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: 'السؤال غير موجود' });
      await storage.get().deleteBankQuestion(existing.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف السؤال' });
    }
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
