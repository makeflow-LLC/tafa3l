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
const records = require('./records');
const demoRecord = require('./demo-record');
const homework = require('./homework');
const directory = require('./directory');
const review = require('./review');

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
 * نصٌّ **بأسطره** — للشهادات والمدارس في صفحة المعلّم العامّة.
 *
 * `clean` تسحق الأسطر في سطرٍ واحد، فتصير ثلاث شهاداتٍ جملةً واحدة لا تُقرأ.
 * وهنا يُشذَّب كلُّ سطرٍ على حدة، ويُسقط الفارغ، ويُحدّ عددها — فلا يصير
 * الحقل صفحةً كاملة على صفحةٍ عامّة.
 */
function cleanLines(value, max, maxLines = 8) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n')
    .slice(0, max);
}

/**
 * الاسم الأول وحده يُنسب إليه النشاط في المكتبة. المعلّم نشر درساً لا سيرةً
 * ذاتية، والاسم الكامل مع المادة والصف يكفي للتعرّف عليه شخصياً.
 */
const HONORIFICS = /^(أ|د|م|ا|أ\.|د\.|م\.|ا\.|الأستاذ|الاستاذ|الأستاذة|الاستاذة|المعلم|المعلّم|المعلمة|المعلّمة|الدكتور|الدكتورة)$/;
function firstNameOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  // «أ. سامي» لقبٌ واسم لا اسمان: اللقب وحده لا يدلّ على أحد، فيلزمه ما بعده
  if (parts.length > 1 && HONORIFICS.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0];
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
          tier: premium.tierOf(u),
          grandfathered: Boolean(u.grandfatheredAt),
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
   * إحصاءُ معلّمٍ واحد — **أرقامٌ لا محتوى**.
   *
   * اللوحة كانت تقول «سجّل قبل ٤٠ يوماً وله ٣ أنشطة»، وهذا لا يكفي لمعرفة
   * هل المنصّة تُستعمل فعلاً: معلّمٌ بثلاثة أنشطة وثمانين طالباً وعشرين
   * واجباً مستخدمٌ حقيقيّ، وآخرُ بثلاثة أنشطةٍ بلا فصلٍ ولا طالب لم يبدأ بعد.
   *
   * ولا يُرسل من محتواه شيء: لا عناوينُ أنشطة، ولا أسماءُ طلاب، ولا نتائج.
   * المالك يقيس الاستعمال لا يقرأ صفوف الناس — فما يخرج من هنا **عدادات**.
   */
  router.get('/admin/users/:id/stats', premium.requireAdmin, async (req, res) => {
    try {
      const store = storage.get();
      const target = await store.findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'المدرب غير موجود' });

      /*
       * مصدرٌ يسقط لا يُسقط البطاقة كلّها.
       *
       * الأرقام تأتي من سبعة مصادر مستقلّة، وهي **إحصاءٌ لا حساب**: أن يُعرض
       * ستّةٌ منها وسابعُها صفرٌ أهونُ بكثير من صفحةٍ تقول «تعذّر» فلا يعرف
       * المالك عن معلّمه شيئاً. فكلٌّ يُقرأ على حدة، ومن أخفق يُسجَّل في
       * السجلّ ويُعطى قيمةً فارغة.
       */
      const safe = async (what, run, fallback) => {
        try {
          return await run();
        } catch (err) {
          console.error(`admin stats (${what}) for ${target.id}:`, err.message);
          return fallback;
        }
      };

      const [activities, classes, assignments, slots, bookings, games, bank] = await Promise.all([
        safe('activities', () => store.listActivities(target.id), []),
        safe('classes', () => store.listClasses(target.id), []),
        safe('assignments', () => store.listAssignments(target.id), []),
        safe('slots', () => store.listSlots(target.id), []),
        safe('bookings', () => store.listBookings(target.id), []),
        safe('games', () => store.listGames({ ownerId: target.id, limit: 1000 }), { total: 0, items: [] }),
        safe('bank', () => store.listBankQuestions(target.id), []),
      ]);

      // الفصل التجريبي خارج العدّ: طلابه أسماءٌ اخترعناها نحن لا طلابه هو
      const real = classes.filter((c) => !c.demo);
      const recordClasses = real.filter((c) => c.record);
      const records = (
        await Promise.all(recordClasses.map((c) => safe('records', () => store.listRecords(c.id), [])))
      ).flat();

      // الواجب: كم كُلِّف وكم سلّم — من السجل نفسه، فلا رقمان يفترقان
      const byStudent = new Map();
      for (const row of records) {
        if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, new Set());
        byStudent.get(row.studentId).add(row.code);
      }
      let assigned = 0;
      let done = 0;
      for (const item of assignments) {
        const codes = new Set(homework.codesOf(item));
        const ids = Array.isArray(item.studentIds) ? item.studentIds : [];
        assigned += ids.length;
        done += ids.filter((id) => [...(byStudent.get(id) || [])].some((code) => codes.has(code))).length;
      }

      const stamps = [
        target.createdAt,
        ...activities.map((a) => a.updatedAt || a.createdAt),
        ...games.items.map((g) => g.createdAt),
        ...assignments.map((a) => a.createdAt),
        ...real.map((c) => c.updatedAt || c.createdAt),
        ...records.map((r) => r.at),
      ].filter((n) => Number.isFinite(n));

      res.json({
        user: {
          id: target.id,
          name: target.name,
          displayName: target.displayName || '',
          email: target.email,
          createdAt: target.createdAt,
          country: target.country || '',
          tier: premium.tierOf(target),
          premiumUntil: target.premiumUntil ?? null,
          isPremium: premium.isPremium(target),
          isAdmin: premium.isAdmin(target),
          grandfathered: Boolean(target.grandfatheredAt),
        },
        stats: {
          lastActiveAt: stamps.length ? Math.max(...stamps) : target.createdAt,
          activities: {
            total: activities.length,
            published: activities.filter((a) => a.published).length,
            questions: activities.reduce((sum, a) => sum + (a.questions || []).length, 0),
            copies: activities.reduce((sum, a) => sum + (Number(a.copies) || 0), 0),
          },
          bank: bank.length,
          games: {
            total: games.total,
            plays: games.items.reduce((sum, g) => sum + (Number(g.plays) || 0), 0),
            built: Number(target.gamesBuilt) || 0,
          },
          classes: {
            total: real.length,
            students: real.reduce((sum, c) => sum + (c.students || []).length, 0),
            // `groups` كشفٌ موازٍ للأسماء لا قائمةَ مجموعات — فالعدد بالتمييز
            groups: real.reduce((sum, c) => sum + new Set((c.groups || []).filter(Boolean)).size, 0),
            withRecord: recordClasses.length,
          },
          records: {
            rows: records.length,
            sessions: new Set(records.map((r) => r.code)).size,
          },
          homework: { total: assignments.length, assigned, done },
          booking: {
            slots: slots.length,
            requests: bookings.length,
            pending: bookings.filter((b) => b.status === 'pending').length,
          },
          // اكتمالُ البروفايل: ما مُلئ لا ما كُتب فيه
          profile: {
            photo: Boolean(target.hasPhoto),
            bio: Boolean(target.bio),
            subjects: (target.subjects || []).length,
            years: Number(target.years) || 0,
            samples: (target.samples || []).length,
            terms: Boolean(target.bookingTerms),
          },
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'تعذّر جلب إحصاء المدرب' });
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

      /*
       * المستوى مع المدّة: المالك يفعّل يدوياً لمن دفع بالمحفظة المحلّية،
       * فلا بدّ أن يقول **أيّ باقةٍ** دفع ثمنها. وغيابه يُبقي مستوى الحساب
       * كما هو — تمديدُ مشتركٍ في الاحترافية لا يُنزّله إلى الأساسية سهواً.
       */
      let tier;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tier')) {
        const wanted = String(req.body.tier || '');
        if (wanted && !premium.TIERS.includes(wanted)) return res.status(400).json({ error: 'مستوى غير معروف' });
        tier = wanted === 'free' ? null : wanted;
      }
      // إلغاءُ الاشتراك يُسقط مستواه معه: حسابٌ بلا تاريخٍ ساري لا مستوى له
      if (until === null && tier === undefined) tier = null;

      const updated = await storage.get().setPremiumUntil(target.id, until, tier);
      res.json({
        user: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          createdAt: updated.createdAt,
          premiumUntil: updated.premiumUntil ?? null,
          isPremium: premium.isPremium(updated),
          isAdmin: premium.isAdmin(updated),
          tier: premium.tierOf(updated),
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

  /**
   * وسومُ المهارات التي استعملها هذا المعلّم من قبل — لقائمة اقتراحٍ في المحرّر.
   *
   * وسمٌ حرٌّ بلا اقتراحٍ يتشتّت: «جمع الكسور» و«جمع كسور» و«الكسور - جمع»
   * ثلاثةُ وسومٍ لمهارةٍ واحدة، فيصير التحليلُ حسب المهارة بلا معنى. فنعرض
   * عليه ما كتبه سابقاً مرتّباً بالأكثر استعمالاً، ليختار لا ليكتب.
   */
  router.get('/my-skills', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const [activities, bank] = await Promise.all([db.listActivities(req.user.id), db.listBankQuestions(req.user.id)]);
      const counts = new Map();
      const add = (question) => {
        const skill = String(question?.skill || '').replace(/\s+/g, ' ').trim();
        if (!skill) return;
        counts.set(skill, (counts.get(skill) || 0) + 1);
      };
      for (const item of bank) add(item.question);
      for (const activity of activities) for (const question of activity.questions || []) add(question);
      const skills = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
        .slice(0, 200)
        .map(([skill, times]) => ({ skill, times }));
      res.json({ skills });
    } catch (err) {
      console.error('my-skills:', err);
      res.status(500).json({ error: 'تعذّر جلب مهاراتك' });
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

  const MAX_GROUP_NAME = 40;

  /**
   * كشفُ الأسماء، ومجموعاتُه إن كتبها المعلّم.
   *
   * صفٌّ من ستّين طالباً قائمةٌ لا تُقرأ — لا على شاشة المعلّم ولا على جوّال
   * الطالب وهو يبحث عن اسمه. فالمجموعة تُكتب **في الكشف نفسه** كعنوانٍ يسبق
   * أسماءها: سطرٌ يبدأ بـ`#` أو محصورٌ بين قوسين معقوفين. ولا حقلَ جديداً
   * ولا شاشةَ ثانية: من يلصق قائمته كما هي لا يرى شيئاً تغيّر، ومن أراد
   * التقسيم كتب سطراً.
   *
   *     # المجموعة أ
   *     سارة أحمد
   *     ليان محمود
   *     [المجموعة ب]
   *     كريم خالد
   *
   * والمخرجان **متوازيان**: `names[i]` صاحب `groups[i]`. لا خريطةَ بالاسم —
   * الاسم يتغيّر فتضيع مجموعته، والفهرس لا يكذب ما دام المصدر واحداً.
   */
  function parseRoster(raw) {
    const lines = Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/);
    const seen = new Set();
    const names = [];
    const groups = [];
    let current = '';
    for (const line of lines) {
      const text = String(line || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const heading = /^#+\s*(.+)$/.exec(text) || /^\[(.+)\]$/.exec(text);
      if (heading) {
        current = heading[1].trim().slice(0, MAX_GROUP_NAME);
        continue;
      }
      // الفواصل داخل السطر تبقى مقبولة كما كانت — من يلصق «سارة، ليان» يجد اسمين
      for (const piece of text.split(/[,،;]+/)) {
        const name = piece.replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
        groups.push(current);
        if (names.length >= MAX_STUDENTS) return { names, groups };
      }
    }
    return { names, groups };
  }

  /** أسماءٌ نظيفة بلا فراغات ولا تكرار — تُقبل ملصوقةً بأسطر أو فواصل */
  function cleanNames(raw) {
    return parseRoster(raw).names;
  }

  /**
   * سجلّ الطلاب — الاستثناء الذي يقرّره المعلّم لفصلٍ بعينه (انظر records.js).
   *
   * حين يشغّله يصير لكل اسمٍ ملفٌّ برمزٍ شخصي، وتُكتب نتائج من يدخلون بأسمائهم
   * ورموزهم بعد كل نشاط. وحين يطفئه لا يُكتب جديد، وما كُتب يبقى حتى يحذفه هو.
   */
  // التحليل المحفوظ ليس من بيانات الفصل التي تُسرد: صفحته تطلبه وحدها
  const publicClass = ({ analysis, ...item }) => ({
    ...item,
    record: Boolean(item.record),
    demo: Boolean(item.demo),
    groups: item.groups || [],
    pupils: item.record ? (item.pupils || []).map(records.publicPupil) : [],
  });

  /** يعيد الفصل بملفّاته موائمةً لكشفه — إن كان السجل مفعّلاً */
  function withPupils(item) {
    if (!item.record) return { ...item, pupils: item.pupils || [] };
    return { ...item, pupils: records.syncPupils(item.students, item.pupils, item.groups) };
  }

  /**
   * مجموع طلاب هذا المعلّم في فصوله كلّها — عليه يقع سقف الباقة.
   *
   * والسقف على المجموع لا على الفصل الواحد: سقفُ الفصل يُلتفّ عليه بفصلٍ
   * ثانٍ، والمجموع هو ما يقيس حجم الاستعمال فعلاً. وفصلُ العرض التجريبي خارج
   * العدّ — طلابه أسماءٌ اخترعناها نحن، فلا يصحّ أن تأكل من حصّة المعلّم.
   *
   * @param {string} ownerId
   * @param {string} [exceptId] فصلٌ يُستثنى — يُمرَّر حين يُعاد كشفه كاملاً
   */
  async function studentsTotal(ownerId, exceptId) {
    const classes = await storage.get().listClasses(ownerId);
    return classes
      .filter((c) => !c.demo && c.id !== exceptId)
      .reduce((sum, c) => sum + (c.students || []).length, 0);
  }

  /** فصلٌ يملكه هذا المعلّم وإلا 404 — لا فرق بين «غير موجود» و«ليس لك» */
  async function ownClass(req, res) {
    const item = await storage.get().getClass(req.params.id);
    if (!item || item.ownerId !== req.user.id) {
      res.status(404).json({ error: 'الفصل غير موجود' });
      return null;
    }
    return item;
  }

  router.get('/classes', auth.requireUser, async (req, res) => {
    try {
      res.json({ classes: (await storage.get().listClasses(req.user.id)).map(publicClass) });
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
      const roster = parseRoster(req.body?.students);
      const before = await studentsTotal(req.user.id);
      premium.assertStudentsAllowed(req.user, before + roster.names.length, before);
      const item = withPupils({
        id: storage.newId('cl_'),
        ownerId: req.user.id,
        name,
        students: roster.names,
        groups: roster.groups,
        record: req.body?.record === true,
        pupils: [],
        createdAt: now,
        updatedAt: now,
      });
      await storage.get().saveClass(item);
      res.status(201).json({ class: publicClass(item) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر حفظ الفصل' });
    }
  });

  router.put('/classes/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await ownClass(req, res);
      if (!existing) return;
      const name = String(req.body?.name ?? existing.name).trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'اكتب اسم الفصل' });
      const roster = req.body?.students === undefined ? null : parseRoster(req.body.students);
      if (roster) {
        // من كان فوق سقفه (بعد انتهاء اشتراكه) لا يُمنع من **تقليل** كشفه:
        // المنع على الزيادة وحدها، وإلا حُبس في قائمةٍ لا يستطيع تحريرها
        const others = await studentsTotal(req.user.id, existing.id);
        const was = (existing.students || []).length;
        premium.assertStudentsAllowed(req.user, others + roster.names.length, others + was);
      }
      const updated = withPupils({
        ...existing,
        name,
        students: roster ? roster.names : existing.students,
        groups: roster ? roster.groups : existing.groups || [],
        record: typeof req.body?.record === 'boolean' ? req.body.record : Boolean(existing.record),
        updatedAt: Date.now(),
      });
      await storage.get().saveClass(updated);
      res.json({ class: publicClass(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تحديث الفصل' });
    }
  });

  router.delete('/classes/:id', auth.requireUser, async (req, res) => {
    try {
      const existing = await ownClass(req, res);
      if (!existing) return;
      // سجلّ الفصل يذهب معه: لا سطور بلا فصلٍ يقرؤها أحد
      await storage.get().deleteRecords(existing.id);
      await storage.get().deleteClass(existing.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف الفصل' });
    }
  });

  /**
   * سجلٌّ تجريبيّ بضغطة زرّ: فصلٌ نموذجيّ بطلابٍ وهميين ونتائجَ عبر خمسة
   * أنشطة (انظر demo-record.js). ضغطُه مرّةً ثانية يعيد بناءه بتواريخَ
   * جديدة بدل أن يكدّس نسخاً — فهو للعرض لا للتجميع.
   */
  router.post('/classes/demo', auth.requireUser, async (req, res) => {
    try {
      const mine = await storage.get().listClasses(req.user.id);
      const existing = mine.find((c) => c.demo);
      if (!existing && mine.length >= MAX_CLASSES) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_CLASSES} فصلاً) — احذف فصلاً قديماً` });
      }
      const now = Date.now();
      const item = withPupils({
        id: existing?.id || storage.newId('cl_'),
        ownerId: req.user.id,
        name: demoRecord.CLASS_NAME,
        students: demoRecord.STUDENTS.map((s) => s.name),
        groups: demoRecord.STUDENTS.map((s) => s.group),
        record: true,
        demo: true,
        pupils: existing?.pupils || [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      await storage.get().saveClass(item);
      // إعادةُ البناء تمحو سطوره أولاً: تواريخُ اليوم لا تختلط بتواريخ الأمس
      await storage.get().deleteRecords(item.id);
      await storage.get().saveRecords(demoRecord.buildRows({ classId: item.id, ownerId: req.user.id, pupils: item.pupils }));
      res.status(201).json({ class: publicClass(item) });
    } catch (err) {
      console.error('demo record:', err);
      res.status(err.status || 500).json({ error: err.message || 'تعذّر إنشاء السجل التجريبي' });
    }
  });

  // ------------------------------------------------------- إدارة الطلاب
  //
  // الكشف نصٌّ يُلصق دفعةً واحدة، وهذا يكفي أوّل مرّة ولا يكفي بعدها: طالبٌ
  // جديد في منتصف الفصل، واسمٌ فيه خطأٌ مطبعي، وطالبٌ ينتقل من مجموعةٍ إلى
  // أخرى — ثلاثتها كانت تُقضى بإعادة كتابة القائمة كلّها. فهذه أفعالٌ مفردة
  // على الكشف نفسه، لا تخزينٌ ثانٍ له.

  /** يكتب الفصل بعد تعديل كشفه، ويوائم ملفّاته */
  async function saveRoster(item, names, groups) {
    const updated = withPupils({ ...item, students: names, groups, updatedAt: Date.now() });
    await storage.get().saveClass(updated);
    return updated;
  }

  const sameName = (a, b) => records.nameKey(a) === records.nameKey(b);

  /** إضافة طالبٍ واحد — باسمه ومجموعته */
  router.post('/classes/:id/students', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'اكتب اسم الطالب' });
      const names = (item.students || []).slice();
      if (names.length >= MAX_STUDENTS) return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_STUDENTS} طالباً)` });
      if (names.some((n) => sameName(n, name))) return res.status(409).json({ error: 'هذا الاسم موجود في الفصل' });
      const others = await studentsTotal(req.user.id, item.id);
      premium.assertStudentsAllowed(req.user, others + names.length + 1, others + names.length);
      const group = String(req.body?.group || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME);
      const groups = (item.groups || []).slice();
      /*
       * يُدرَج **آخرَ مجموعته** لا آخر القائمة: الكشف مقروءٌ بمجموعاته في
       * شاشة الطالب وفي ورقة الرموز، فطالبٌ يهبط تحت عنوان مجموعةٍ أخرى
       * يفسد الترتيب الذي رتّبه المعلّم بنفسه.
       */
      let at = names.length;
      if (group) {
        const last = groups.lastIndexOf(group);
        if (last >= 0) at = last + 1;
      }
      names.splice(at, 0, name);
      groups.splice(at, 0, group);
      const updated = await saveRoster(item, names, groups);
      res.status(201).json({ class: publicClass(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّرت الإضافة' });
    }
  });

  /**
   * تعديل طالب: اسمُه أو مجموعته.
   *
   * والاسمُ يُعاد تسميته **في ملفّه أيضاً** قبل المواءمة، وإلا عُدَّ اسماً
   * جديداً فأخذ ملفّاً جديداً برمزٍ جديد — فيفقد الطالب سجلّه لأن معلّمه
   * صحّح حرفاً في اسمه.
   */
  router.patch('/classes/:id/students/:name', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const current = String(req.params.name || '');
      const names = (item.students || []).slice();
      const groups = (item.groups || []).slice();
      const at = names.findIndex((n) => sameName(n, current));
      if (at < 0) return res.status(404).json({ error: 'الطالب غير موجود في هذا الفصل' });

      if (req.body?.name !== undefined) {
        const next = String(req.body.name).replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!next) return res.status(400).json({ error: 'اكتب اسم الطالب' });
        if (names.some((n, i) => i !== at && sameName(n, next))) return res.status(409).json({ error: 'هذا الاسم موجود في الفصل' });
        const pupil = (item.pupils || []).find((p) => sameName(p.name, names[at]));
        if (pupil) pupil.name = next;
        names[at] = next;
      }
      if (req.body?.group !== undefined) {
        groups[at] = String(req.body.group).replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME);
        // ينتقل مع مجموعته الجديدة كي يبقى الكشف مقروءاً بعناوينه
        const [movedName] = names.splice(at, 1);
        const [movedGroup] = groups.splice(at, 1);
        const last = movedGroup ? groups.lastIndexOf(movedGroup) : -1;
        const to = last >= 0 ? last + 1 : names.length;
        names.splice(to, 0, movedName);
        groups.splice(to, 0, movedGroup);
      }
      const updated = await saveRoster(item, names, groups);
      res.json({ class: publicClass(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر التعديل' });
    }
  });

  /** حذف طالب من الكشف — وسجلّه يبقى حتى يُحذف صراحةً */
  router.delete('/classes/:id/students/:name', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const names = (item.students || []).slice();
      const groups = (item.groups || []).slice();
      const at = names.findIndex((n) => sameName(n, String(req.params.name || '')));
      if (at < 0) return res.status(404).json({ error: 'الطالب غير موجود في هذا الفصل' });
      names.splice(at, 1);
      groups.splice(at, 1);
      const updated = await saveRoster(item, names, groups);
      res.json({ class: publicClass(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر الحذف' });
    }
  });

  /** مجموعةٌ جديدة بأسمائها دفعةً واحدة — أسرع طريقٍ لتقسيم فصلٍ كبير */
  router.post('/classes/:id/groups', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const group = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME);
      if (!group) return res.status(400).json({ error: 'اكتب اسم المجموعة' });
      const names = (item.students || []).slice();
      const groups = (item.groups || []).slice();
      // أسماءٌ في الفصل بالفعل تُنقل إلى المجموعة الجديدة بدل أن تُرفض أو تتكرّر
      const wanted = parseRoster(req.body?.students).names;
      for (const name of wanted) {
        const at = names.findIndex((n) => sameName(n, name));
        if (at >= 0) {
          names.splice(at, 1);
          groups.splice(at, 1);
        }
      }
      if (names.length + wanted.length > MAX_STUDENTS) return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_STUDENTS} طالباً)` });
      const others = await studentsTotal(req.user.id, item.id);
      premium.assertStudentsAllowed(req.user, others + names.length + wanted.length, others + (item.students || []).length);
      names.push(...wanted);
      groups.push(...wanted.map(() => group));
      const updated = await saveRoster(item, names, groups);
      res.status(201).json({ class: publicClass(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر إنشاء المجموعة' });
    }
  });

  /** إعادة تسمية مجموعة، أو حلّها (اسمٌ فارغ) — الطلاب يبقون في الفصل */
  router.patch('/classes/:id/groups/:name', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const current = String(req.params.name || '').trim();
      const next = String(req.body?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME);
      const groups = (item.groups || []).slice();
      if (!groups.some((g) => (g || '') === current)) return res.status(404).json({ error: 'المجموعة غير موجودة' });
      const updated = await saveRoster(
        item,
        (item.students || []).slice(),
        groups.map((g) => ((g || '') === current ? next : g))
      );
      res.json({ class: publicClass(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تعديل المجموعة' });
    }
  });

  /** ملخّص سجلّ الفصل: كل طالبٍ بمحاولاته ومتوسّطه، والجلسات التي كُتبت */
  router.get('/classes/:id/record', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const rows = await storage.get().listRecords(item.id);
      const summary = records.summarize(item.record ? item.pupils : [], rows);
      res.json({ class: { id: item.id, name: item.name, record: Boolean(item.record), demo: Boolean(item.demo) }, ...summary });
    } catch (err) {
      console.error('class record:', err);
      res.status(500).json({ error: 'تعذّر جلب السجل' });
    }
  });

  /** ملفّ طالبٍ واحد: محاولاته كلها، وما يتكرّر خطؤه */
  router.get('/classes/:id/record/:sid', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const pupil = (item.pupils || []).find((p) => p.id === req.params.sid);
      if (!pupil) return res.status(404).json({ error: 'الطالب غير موجود في هذا الفصل' });
      const rows = await storage.get().listRecords(item.id, pupil.id);
      res.json({
        student: records.publicPupil(pupil),
        demo: Boolean(item.demo),
        records: rows,
        weak: records.weakSpots(rows),
        weakSkills: records.weakSkills(rows),
      });
    } catch (err) {
      console.error('student record:', err);
      res.status(500).json({ error: 'تعذّر جلب ملفّ الطالب' });
    }
  });

  /**
   * معاينة صفحة «سجلّي» كما يراها الطالب — **للفصل التجريبي وحده**.
   *
   * الرمز الذي تعيده يفتح سجلّ الطالب بلا حساب، فلا يجوز أن يُسلَّم لأحد عن
   * طالبٍ حقيقيّ ولو كان معلّمه: صفحةُ الطالب له هو. أمّا فصلُ العرض فطلابه
   * أسماءٌ اخترعناها ونتائجُهم مصنوعة، ولا خصوصيةَ فيها تُنتهك.
   */
  router.get('/classes/:id/record/:sid/preview', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      if (!item.demo) return res.status(403).json({ error: 'المعاينة متاحة في الفصل التجريبي وحده — صفحة الطالب له وحده' });
      const pupil = (item.pupils || []).find((p) => p.id === req.params.sid);
      if (!pupil) return res.status(404).json({ error: 'الطالب غير موجود في هذا الفصل' });
      res.json({ token: records.tokenFor(item.id, pupil) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّرت المعاينة' });
    }
  });

  /** رمزٌ شخصي جديد لطالبٍ نسي رمزه أو أفشاه */
  router.post('/classes/:id/record/:sid/pin', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const pupils = item.pupils || [];
      const pupil = pupils.find((p) => p.id === req.params.sid);
      if (!pupil) return res.status(404).json({ error: 'الطالب غير موجود في هذا الفصل' });
      const taken = new Set(pupils.filter((p) => p !== pupil).map((p) => p.pin));
      let pin = records.newPin();
      while (taken.has(pin)) pin = records.newPin();
      pupil.pin = pin;
      await storage.get().saveClass({ ...item, pupils, updatedAt: Date.now() });
      res.json({ student: records.publicPupil(pupil) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر تجديد الرمز' });
    }
  });

  /** حذف سجلّ طالبٍ واحد، أو سجلّ الفصل كلّه — قرارٌ صريح من المعلّم */
  router.delete('/classes/:id/record/:sid?', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      await storage.get().deleteRecords(item.id, req.params.sid || undefined);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف السجل' });
    }
  });

  /**
   * صفحة الطالب «سجلّي»: برمزٍ يُعطاه جهازُه عند الدخول بملفّه، لا بحساب.
   * يرى محاولاته ونسبه وما أخطأ فيه — بحدود ما سمح به معلّمه في كل نشاط.
   */
  router.get('/record/me', async (req, res) => {
    try {
      const found = await records.resolveToken(req.query.token);
      if (!found) return res.status(404).json({ error: 'لم نجد سجلّاً بهذا الرمز — ادخل نشاطاً باسمك ورمزك أولاً' });
      const rows = await storage.get().listRecords(found.cls.id, found.pupil.id);
      res.json({
        name: found.pupil.name,
        className: found.cls.name,
        records: rows.map((r) => ({
          code: r.code,
          title: r.title,
          at: r.at,
          total: r.total,
          answered: r.answered,
          correct: r.correct,
          wrong: r.wrong,
          partial: r.partial,
          pending: r.pending,
          percent: r.showScore ? r.percent : null,
          mark: r.showScore ? r.mark : null,
          // ما أخطأ فيه يُعرض حين كان المعلّم يكشف الإجابة الصحيحة في ذلك النشاط
          items: r.reveal ? r.items : [],
        })),
      });
    } catch (err) {
      console.error('record/me:', err);
      res.status(500).json({ error: 'تعذّر جلب سجلّك' });
    }
  });

  // --------------------------------------------------------- نشاط المراجعة

  /** كل أسئلة هذا المعلّم — من أنشطته المحفوظة وبنكه القديم معاً */
  async function allMyQuestions(ownerId) {
    const db = storage.get();
    const [activities, bank] = await Promise.all([db.listActivities(ownerId), db.listBankQuestions(ownerId)]);
    const out = [];
    for (const item of bank) if (item.question) out.push(item.question);
    for (const activity of activities) for (const question of activity.questions || []) out.push(question);
    return out;
  }

  /**
   * «نشاط مراجعة» — يُبنى ممّا أخطأ فيه الطلاب لا ممّا نظنّ.
   *
   * نطاقه ثلاثة: الفصل كلّه، أو مجموعةٌ فيه، أو طالبٌ بعينه — وهو الفرق بين
   * مراجعةٍ عامّة ودرسِ علاجٍ لمن يحتاجه. والناتج **نشاطٌ محفوظ** لا جلسة:
   * المعلّم يفتحه فيحذف ويضيف ثم يطلقه أو يكلّف به، فالقرار الأخير له.
   */
  router.post('/classes/:id/review', auth.requireUser, async (req, res) => {
    try {
      const item = await ownClass(req, res);
      if (!item) return;
      const db = storage.get();
      const list = await db.listActivities(req.user.id);
      if (list.length >= MAX_ACTIVITIES) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${MAX_ACTIVITIES} نشاطاً) — احذف نشاطاً قديماً` });
      }

      const pupils = item.pupils || [];
      const studentId = String(req.body?.studentId || '');
      const group = String(req.body?.group || '').trim();
      let scope = item.name;
      let rows = await db.listRecords(item.id, studentId || undefined);
      if (studentId) {
        const pupil = pupils.find((p) => p.id === studentId);
        if (!pupil) return res.status(404).json({ error: 'الطالب غير موجود في هذا الفصل' });
        scope = pupil.name;
      } else if (group) {
        const ids = new Set(pupils.filter((p) => String(p.group || '').trim() === group).map((p) => p.id));
        rows = rows.filter((r) => ids.has(r.studentId));
        scope = group;
      }
      if (!rows.length) return res.status(409).json({ error: 'لا سجلّ بعد لهذا النطاق — المراجعة تُبنى من نتائج سابقة' });

      const picked = review.pickReviewQuestions({ records: rows, questions: await allMyQuestions(req.user.id), limit: req.body?.limit });
      if (!picked.questions.length) {
        /*
         * لم نجد سؤالاً واحداً يقابل ما أخطؤوا فيه. والسبب دائماً أحدهما:
         * أنشطةٌ حُذفت بعد حلّها، أو سجلٌّ تجريبيّ لا أنشطة وراءه. ونقولها
         * صراحةً — «لم يتم» بلا سبب تجعل المعلّم يظنّ الميزة معطوبة.
         */
        return res.status(409).json({
          error: 'لم نجد في أسئلتك ما يقابل أخطاء الطلاب — المراجعة تُبنى من أسئلتك أنت، فأبقِ الأنشطة التي حلّوها محفوظة',
        });
      }

      const now = Date.now();
      const quiz = normalizeQuiz({
        title: `مراجعة — ${scope}`,
        questions: picked.questions,
        // مراجعةٌ يحلّها الطالب بمهله ويرى صواب إجابته فوراً: هذا هو الغرض
        settings: { pace: 'self', revealAnswer: true, showScore: true, timeMode: 'none', reward: 'points' },
      });
      const activity = {
        id: storage.newId('a_'),
        ownerId: req.user.id,
        title: quiz.title,
        settings: quiz.settings,
        questions: quiz.questions,
        createdAt: now,
        updatedAt: now,
      };
      await db.saveActivity(activity);
      res.status(201).json({
        activity: { id: activity.id, title: activity.title, questionCount: activity.questions.length },
        direct: picked.direct,
        bySkill: picked.bySkill,
        skills: picked.skills,
      });
    } catch (err) {
      console.error('review activity:', err);
      res.status(err.status || 400).json({ error: err.message || 'تعذّر بناء نشاط المراجعة' });
    }
  });

  // -------------------------------------------------------------- الواجبات

  /** واجبٌ يملكه هذا المعلّم وإلا 404 */
  async function ownAssignment(req, res) {
    const item = await storage.get().getAssignment(req.params.id);
    if (!item || item.ownerId !== req.user.id) {
      res.status(404).json({ error: 'الواجب غير موجود' });
      return null;
    }
    return item;
  }

  /** من فتح الواجب ولم ينهه بعد — من الجلسة الحيّة وحدها، فهي وحدها تعرف */
  function startedIn(assignment) {
    const open = new Set();
    for (const code of homework.codesOf(assignment)) {
      const session = store.getSession(code);
      if (!session) continue;
      for (const p of session.participants.values()) {
        if (p.studentId && p.phase !== 'done') open.add(p.studentId);
      }
    }
    return open;
  }

  /** حالةُ رابط الواجب الآن: حيٌّ يُحلّ، أو منتهٍ، أو ذهب مع الخادم */
  function linkState(assignment) {
    const session = store.getSession(assignment.code);
    if (!session) return 'gone';
    return session.status === 'ended' ? 'ended' : 'open';
  }

  /** ما يُرسل للمعلّم عن واجب — بلا مفتاح المضيف إلا حين يُطلب صراحةً */
  const publicAssignment = (a) => ({
    id: a.id,
    classId: a.classId,
    className: a.className || '',
    activityId: a.activityId,
    title: a.title,
    code: a.code,
    groups: a.groups || [],
    assigned: (a.studentIds || []).length,
    dueAt: a.dueAt || null,
    createdAt: a.createdAt,
  });

  router.get('/assignments', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const items = await db.listAssignments(req.user.id);
      // سجلّ الفصل يُقرأ مرّةً لكل فصل مهما كثرت واجباته
      const byClass = new Map();
      const out = [];
      for (const item of items) {
        if (!byClass.has(item.classId)) {
          byClass.set(item.classId, {
            cls: await db.getClass(item.classId),
            rows: await db.listRecords(item.classId),
          });
        }
        const { cls, rows } = byClass.get(item.classId);
        const { totals } = homework.progress({
          assignment: item,
          pupils: cls?.pupils || [],
          records: rows,
          started: startedIn(item),
        });
        out.push({ ...publicAssignment(item), className: cls?.name || item.className || '', totals, link: linkState(item) });
      }
      res.json({ assignments: out });
    } catch (err) {
      console.error('list assignments:', err);
      res.status(500).json({ error: 'تعذّر جلب الواجبات' });
    }
  });

  router.post('/assignments', auth.requireUser, async (req, res) => {
    try {
      const db = storage.get();
      const mine = await db.listAssignments(req.user.id);
      if (mine.length >= homework.MAX_ASSIGNMENTS) {
        return res.status(409).json({ error: `بلغت الحد الأقصى (${homework.MAX_ASSIGNMENTS} واجباً) — احذف واجباً قديماً` });
      }
      const cls = await db.getClass(String(req.body?.classId || ''));
      if (!cls || cls.ownerId !== req.user.id) return res.status(404).json({ error: 'الفصل غير موجود' });
      /*
       * السجل شرطُ الواجب لا زينته: نتيجته تُكتب في ملفّ الطالب، وبلا ملفٍّ
       * لا نعرف من سلّم — فيصير الواجب رابطاً كسائر الروابط.
       */
      if (!cls.record) {
        return res.status(409).json({ error: 'شغّل «سجلّ الطلاب» على هذا الفصل أولاً — نتيجة الواجب تُكتب في ملفّ الطالب' });
      }
      const activity = await db.getActivity(String(req.body?.activityId || ''));
      if (!activity || activity.ownerId !== req.user.id) return res.status(404).json({ error: 'النشاط غير موجود' });
      premium.assertImagesAllowed(req.user, activity.questions);

      const pupils = cls.pupils || [];
      const studentIds = homework.pickStudents(pupils, { groups: req.body?.groups, studentIds: req.body?.studentIds });
      if (!studentIds.length) return res.status(400).json({ error: 'اختر طالباً واحداً على الأقل' });
      const chosen = pupils.filter((p) => studentIds.includes(p.id));
      const dueAt = Number(req.body?.dueAt) || 0;

      const session = launchFor({ activity, cls, chosen, dueAt, user: req.user });
      const now = Date.now();
      const item = {
        id: storage.newId('hw_'),
        ownerId: req.user.id,
        classId: cls.id,
        className: cls.name,
        activityId: activity.id,
        title: activity.title,
        code: session.code,
        codes: [session.code],
        // مفتاح المضيف محفوظٌ مع الواجب لا في متصفّحٍ واحد: المعلّم يفتح
        // متابعته الحيّة من أيّ جهازٍ يدخل منه حسابه
        hostToken: session.hostToken,
        groups: (req.body?.groups || []).map((g) => clean(g, 40)).filter(Boolean),
        studentIds,
        dueAt: session.settings.dueAt || 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.saveAssignment(item);
      res.status(201).json({ assignment: { ...publicAssignment(item), hostToken: item.hostToken } });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر إنشاء الواجب' });
    }
  });

  /**
   * جلسةُ الواجب: نسخةٌ من النشاط بإعداداتٍ يفرضها كونه واجباً.
   *
   * الوتيرة حرّة لأن الواجب يُحلّ في البيت لا أمام بروجكتر، والكشف مقصورٌ على
   * المكلَّفين ليجد الطالب اسمه في سطرين، والسجل مربوطٌ بالفصل لتذهب النتيجة
   * إلى ملفّه. وما عدا ذلك يبقى كما ضبطه المعلّم في نشاطه.
   */
  function launchFor({ activity, cls, chosen, dueAt, user }) {
    const session = store.createSession({
      title: activity.title,
      questions: activity.questions,
      settings: {
        ...activity.settings,
        pace: 'self',
        requireName: true,
        allowLateJoin: true,
        roster: chosen.map((p) => p.name),
        rosterGroups: chosen.map((p) => p.group || ''),
        recordClassId: cls.id,
        dueAt: dueAt || 0,
        // موعدُ فتحٍ ورثه النشاط من إطلاقٍ قديم لا معنى له في واجبٍ يُرسل الآن
        opensAt: 0,
      },
    });
    session.ownerId = user.id;
    session.ownerName = user.name;
    session.activityId = activity.id;
    return session;
  }

  /** تفصيل واجب: كلّ مُكلَّفٍ وحالته — سلّم، أو بدأ، أو لم يبدأ */
  router.get('/assignments/:id', auth.requireUser, async (req, res) => {
    try {
      const item = await ownAssignment(req, res);
      if (!item) return;
      const db = storage.get();
      const cls = await db.getClass(item.classId);
      const rows = await db.listRecords(item.classId);
      const { rows: students, totals } = homework.progress({
        assignment: item,
        pupils: cls?.pupils || [],
        records: rows,
        started: startedIn(item),
      });
      res.json({
        assignment: { ...publicAssignment(item), className: cls?.name || item.className || '', hostToken: item.hostToken || '' },
        students,
        totals,
        link: linkState(item),
      });
    } catch (err) {
      console.error('assignment:', err);
      res.status(500).json({ error: 'تعذّر جلب الواجب' });
    }
  });

  /**
   * إعادة الفتح — وهي تمديدُ الموعد نفسه.
   *
   * فالرابط جلسةٌ حيّة: ما دامت قائمة يكفي تحريك موعدها، وإن انتهت أو ذهبت مع
   * إعادة نشرٍ أُنشئت جلسةٌ جديدة ورمزٌ جديد. ورمزُها القديم لا يُنسى — من
   * سلّم قبل الإعادة سلّم، ولو نسيناه لظهر أنه لم يسلّم.
   */
  router.post('/assignments/:id/reopen', auth.requireUser, async (req, res) => {
    try {
      const item = await ownAssignment(req, res);
      if (!item) return;
      const db = storage.get();
      const dueAt = Number(req.body?.dueAt) || 0;
      const live = store.getSession(item.code);
      let code = item.code;
      let hostToken = item.hostToken || '';
      let due = dueAt;

      if (live && live.status !== 'ended') {
        live.settings.dueAt = dueAt || 0;
        live.armDeadline();
        store.rewrite(live);
        live.broadcastState();
        due = live.settings.dueAt || 0;
      } else {
        const cls = await db.getClass(item.classId);
        if (!cls || cls.ownerId !== req.user.id) return res.status(404).json({ error: 'الفصل غير موجود' });
        const activity = await db.getActivity(item.activityId);
        if (!activity || activity.ownerId !== req.user.id) {
          return res.status(404).json({ error: 'النشاط لم يعد محفوظاً — أنشئ واجباً جديداً' });
        }
        premium.assertImagesAllowed(req.user, activity.questions);
        const chosen = (cls.pupils || []).filter((p) => item.studentIds.includes(p.id));
        const session = launchFor({ activity, cls, chosen, dueAt, user: req.user });
        code = session.code;
        hostToken = session.hostToken;
        due = session.settings.dueAt || 0;
      }

      const updated = {
        ...item,
        code,
        hostToken,
        codes: [...new Set([...(item.codes || []), item.code, code])].filter(Boolean),
        dueAt: due,
        updatedAt: Date.now(),
      };
      await db.saveAssignment(updated);
      res.json({ assignment: { ...publicAssignment(updated), hostToken }, link: linkState(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّرت إعادة فتح الواجب' });
    }
  });

  /**
   * حذف الواجب: يُغلق رابطه ويُنسى تكليفه — ونتائجُ من سلّم تبقى في ملفّاتهم.
   * فالسجل ملكُ الطالب لا ملحقُ الواجب، ولا يُمحى إلا من صفحة السجل صراحةً.
   */
  router.delete('/assignments/:id', auth.requireUser, async (req, res) => {
    try {
      const item = await ownAssignment(req, res);
      if (!item) return;
      for (const code of homework.codesOf(item)) {
        const session = store.getSession(code);
        if (!session) continue;
        session.broadcast({ t: 'session:closed', reason: 'host' });
        store.deleteSession(code);
      }
      await storage.get().deleteAssignment(item.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر حذف الواجب' });
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
        // معلّمٌ بعينه — صفحتُه العامّة تعرض ما نشره هو
        owner: clean(req.query.teacher, 40),
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
    // صفحة المعلّم العامّة
    subjects: Array.isArray(u.subjects) ? u.subjects : [],
    grades: Array.isArray(u.grades) ? u.grades : [],
    years: Number(u.years) || 0,
    schools: u.schools || '',
    samples: Array.isArray(u.samples) ? u.samples : [],
    bookingTerms: u.bookingTerms || '',
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
      /*
       * حقول الصفحة العامّة. والمواد **معرّفاتٌ** لا أسماء (`math`, `arabic`…)
       * كما في المكتبة والألعاب: يترجمها المتصفّح لقارئه، ومعرّفٌ خارج القائمة
       * يُعرض كما كُتب بلا كسر — وهذا ما يفعله باقي المنصّة، فلا نخالفه هنا.
       */
      if (body.subjects !== undefined) {
        patch.subjects = (Array.isArray(body.subjects) ? body.subjects : []).map((s) => clean(s, 40)).filter(Boolean).slice(0, 6);
      }
      if (body.grades !== undefined) {
        patch.grades = (Array.isArray(body.grades) ? body.grades : []).map((s) => clean(s, 40)).filter(Boolean).slice(0, 13);
      }
      if (body.years !== undefined) patch.years = Math.max(0, Math.min(60, Math.round(Number(body.years) || 0)));
      if (body.schools !== undefined) patch.schools = cleanLines(body.schools, MAX_BIO_CHARS);
      /*
       * عيّناتُ دروسه **روابطُ خارجية** يضعها بنفسه: فيديو على يوتيوب، ملفٌّ
       * على درايف، منشورٌ فيه شرحُ درس. وهي أصدق ممّا نستطيع نحن انتقاءه من
       * داخل المنصّة — الدرسُ الذي يفخر به قد لا يكون نشاطاً هنا أصلاً.
       * وتُنشر على صفحةٍ يفتحها طلاب، فـ`http(s)` وحدهما يمرّان.
       */
      if (body.samples !== undefined) {
        patch.samples = (Array.isArray(body.samples) ? body.samples : [])
          .map((row) => ({ title: clean(row?.title, 80), url: String(row?.url || '').trim().slice(0, 300) }))
          .filter((row) => /^https?:\/\//i.test(row.url))
          .map((row) => ({ title: row.title || row.url.replace(/^https?:\/\//i, '').slice(0, 60), url: row.url }))
          .slice(0, 6);
      }
      // شروط الحجز: يكتبها المعلّم بنفسه فتُقرأ قبل أن يُرسل الطالب طلبه
      if (body.bookingTerms !== undefined) patch.bookingTerms = cleanLines(body.bookingTerms, MAX_BIO_CHARS, 12);
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
  /**
   * دليلُ المعلّمين — عامٌّ بلا حساب: الطالب يبحث عن معلّمه.
   *
   * ولا يخرج منه إلا ما يظهر في صفحة المعلّم أصلاً: الاسم العامّ والصورة
   * والمواد والصفوف والبلد وما نشره. لا بريد ولا هاتف ولا اسم كامل.
   */
  router.get('/teachers', async (req, res) => {
    try {
      const store = storage.get();
      const [users, counts] = await Promise.all([store.listUsers(), store.directoryCounts()]);
      const all = users
        .filter((u) => directory.isListed(u, counts.get(u.id)))
        .map((u) => {
          const c = counts.get(u.id) || { published: 0, games: 0, plays: 0 };
          return {
            id: u.id,
            name: publicNameOf(u),
            fullName: u.name || '',
            photo: Boolean(u.hasPhoto),
            country: u.country || '',
            subjects: Array.isArray(u.subjects) ? u.subjects : [],
            grades: Array.isArray(u.grades) ? u.grades : [],
            years: Number(u.years) || 0,
            // المدارس كلّها تُطابَق، وأوّلُها وحدها تُعرض: بطاقةٌ لا تتّسع لثلاث
            schools: String(u.schools || '').slice(0, 300),
            school: clean(String(u.schools || '').split('\n')[0], 120),
            bio: clean(u.bio, 140),
            published: c.published,
            games: c.games,
            plays: c.plays,
            booking: premium.limitsFor(u).booking === true,
          };
        });
      const shown = directory.filter(all, {
        q: clean(req.query.q, 60),
        country: clean(req.query.country, 2),
        subject: clean(req.query.subject, 40),
        grade: clean(req.query.grade, 40),
        booking: req.query.booking === '1',
      });
      const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      res.json({
        total: shown.length,
        // الاسم الكامل للمطابقة لا للعرض — يُنزع قبل الإرسال
        items: shown.slice(offset, offset + limit).map(({ fullName, schools, ...it }) => it),
        // البلدان الحاضرة فعلاً في الدليل — فلا يختار الطالب بلداً لا معلّم فيه
        countries: [...new Set(all.map((it) => it.country).filter(Boolean))].sort(),
      });
    } catch (err) {
      console.error('teachers directory:', err);
      res.status(500).json({ error: 'تعذّر جلب دليل المعلّمين' });
    }
  });

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
          // ما يملؤه لصفحته العامّة — وما لم يُملأ لا يُرسل فلا يُعرض
          subjects: Array.isArray(u.subjects) ? u.subjects : [],
          grades: Array.isArray(u.grades) ? u.grades : [],
          years: Number(u.years) || 0,
          schools: u.schools || '',
          // عيّناتُ دروسه: روابطُ خارجية يضعها بنفسه
          samples: Array.isArray(u.samples) ? u.samples : [],
          bookingTerms: u.bookingTerms || '',
          // هل يستقبل حجوزات؟ الميزة في الباقة الاحترافية وحدها
          booking: premium.limitsFor(u).booking === true,
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
