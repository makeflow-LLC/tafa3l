'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const store = require('./store');
const { normalizeQuiz, withoutVoters } = require('./session');
const templates = require('./templates');
const { startKeepAlive, keepAliveUrl } = require('./keepalive');
const storage = require('./storage');
const auth = require('./auth');
const googleAuth = require('./google-auth');
const { accountRoutes, syncLaunchedActivity } = require('./routes-account');
const { aiRoutes } = require('./routes-ai');
const { gameAiRoutes } = require('./routes-game-ai');
const billing = require('./routes-billing');
const stripeApi = require('./stripe');
const sharePage = require('./share-page');
const ai = require('./ai');
const premium = require('./premium');
const records = require('./records');

// بصمة النسخة — تُمكّن المدرب من التأكد أن النشر الأخير وصل فعلاً
const BUILD = {
  version: require('../package.json').version,
  features: ['pace:host/self', 'scoring:speed/flat/none', 'badges', 'reactions', 'countdown', 'accounts', 'savedActivities', 'autoSaveOnLaunch', 'duplicateActivity', 'sliderScale', 'dashboardResults', 'shareCard', 'googleLogin', 'screenDisplay', 'teamMode', 'rebrandTapio', 'i18n:full', 'i18n:activityLang', 'screenLiveResults', 'aiDesigner', 'premium', 'adminPanel', 'exportXlsxPdf', 'pdfRichPrint', 'pdfDirectDownload', 'resultsRecordExport', 'manualGrading', 'questionImages:premium', 'fillBlank', 'analytics', 'richReports', 'helpGuide', 'scheduledStart', 'timedQuiz', 'teacherNameInReports', 'siteFooter', 'legalPages', 'pwaInstall', 'assessedOnlyBadges', 'typeOrder', 'typeMatch', 'partialAutoGrading', 'shuffleQuestions', 'shuffleOptions', 'contentSlides', 'sheetImport', 'questionVideo', 'studentReview', 'publicLibrary', 'pollPanel', 'a11yFocus', 'marks', 'gradeBands', 'selfPacedDefault', 'autoNext', 'gamesHub', 'gameCovers', 'gameFullscreen', 'gameShareLinks', 'subjectGradeCatalog', 'gameTeacherDirectory', 'gamesDarkMode', 'gamesOfflinePlay', 'teacherProfile', 'aiFreshChat', 'aiAutoGradedDefault', 'markSplitEqualCustom', 'timeWindowModes', 'questionWizard', 'threeStageBuilder', 'joinPageAtSlashC', 'launchRequiresAccount', 'aiDraftOpensAtReview', 'finishForEveryone', 'sessionStructurePersistence', 'finishBarForStudents', 'demoWithoutAccount', 'reuseMyQuestions', 'autoAdvanceAsToggle', 'noStreakMultiplier', 'paperPrintout', 'guidedFirstRun', 'homeworkDueDate', 'classRosters', 'darkModeEverywhere', 'cardPayments', 'gameSocialShare', 'studentRecords', 'homeworkAssignments', 'assignmentTracking', 'reviewActivities'],
};

// PORT=0 صالح (منفذ عشوائي) لذا لا نستخدم `||`
const PORT = Number.isFinite(Number(process.env.PORT)) && process.env.PORT !== '' ? Number(process.env.PORT) : 3000;

/** سجلّ صامت أثناء الاختبارات (PORT=0) حتى لا يتداخل مع مشغّل الاختبارات */
const quiet = process.env.PORT === '0' || process.env.NODE_ENV === 'test';
const log = (...args) => !quiet && console.log(...args);
const warn = (...args) => !quiet && console.warn(...args);

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
// خلف وسيط المنصة (Render): يجعل req.ip عنوان الزائر الحقيقي لا عنوان الوسيط —
// وهذا شرط لصحّة حدّ الإنشاء أدناه — ويجعل req.secure يعكس HTTPS الفعلي.
app.set('trust proxy', 1);

// ترويسات أمان أساسية على كل ردّ
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // لوحة المدرب فيها أزرار مصيرية (إنهاء الجلسة) فلا يجوز تأطيرها
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/*
 * خطّاف Stripe **قبل** محلّل JSON — وهو الترتيب الوحيد الذي يعمل.
 *
 * توقيع Stripe محسوبٌ على بايتات الجسم كما أُرسلت. فلو حلّله `express.json`
 * أولاً لما بقي بين أيدينا إلا كائن، وإعادةُ تسلسله نصّاً تعطي بايتاتٍ أخرى
 * (ترتيب مفاتيح، مسافات، هروب أحرف) فيفشل كلُّ تحقّقٍ من التوقيع.
 */
app.post('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), billing.webhook);

/**
 * حدّان للجسم لا واحد. الصور (data URL) تحتاج ١٢ ميغابايت، لكن ثلاثة مسارات
 * فقط تحملها. لو طبّقنا السقف الواسع على الجميع لصار كل مسار — بما فيها
 * تسجيل الخروج — بابَ إغراقٍ بأجسام ضخمة تُحلَّل قبل أن تُرفض.
 */
const jsonLarge = express.json({ limit: '12mb' });
const jsonSmall = express.json({ limit: '256kb' });
const CARRIES_IMAGES = [
  /^\/api\/sessions(\/[^/]+)?$/,
  /^\/api\/activities(\/[^/]+)?$/,
  /^\/api\/bank(\/[^/]+)?$/,
  /^\/api\/games(\/[^/]+)?$/,
  // صورةُ اللعبة وصورةُ البروفايل: كلتاهما أكبر من السقف الصغير حين تُرمَّز
  // base64، فكان تبديلُ صورةٍ بحجمٍ يقبله المتحقّق يُرفض قبل أن يصله بـ413
  /^\/api\/games\/[^/]+\/cover$/,
  /^\/api\/profile$/,
];
app.use((req, res, next) => {
  const large = ['POST', 'PUT', 'PATCH'].includes(req.method) && CARRIES_IMAGES.some((re) => re.test(req.path));
  return (large ? jsonLarge : jsonSmall)(req, res, next);
});

/**
 * مكتبات الطرف الثالث (jsPDF وخط Amiri ‏≈1.5MB) ثابتة لا تتغيّر أبداً تحت
 * مسارها، ولها نسخة .gz مُولَّدة مسبقاً: نقدّمها مضغوطة وبتخزين سنة كاملة،
 * فلا يدفع المعلّم ثمنها إلا مرة واحدة، ولا يدفع الخادم ثمن ضغطها في كل طلب.
 */
const VENDOR_DIR = path.join(__dirname, '..', 'public', 'assets', 'vendor');
const VENDOR_TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
app.get('/assets/vendor/:file', (req, res, next) => {
  const name = path.basename(req.params.file);
  const type = VENDOR_TYPES[path.extname(name)];
  if (!type) return next();
  const plain = path.join(VENDOR_DIR, name);
  if (!plain.startsWith(VENDOR_DIR + path.sep)) return next();
  const gz = plain + '.gz';
  const accepts = String(req.headers['accept-encoding'] || '').includes('gzip');
  const useGz = accepts && fs.existsSync(gz);
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Vary', 'Accept-Encoding');
  if (useGz) res.setHeader('Content-Encoding', 'gzip');
  res.sendFile(useGz ? gz : plain, (err) => {
    if (err) next();
  });
});

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    // لا نخزّن صفحات التطبيق: بعد كل نشر يجب أن يرى المدرب النسخة الجديدة فوراً.
    // الملفات صغيرة، و etag يجعل إعادة التحقق ترد 304 بلا تحميل فعلي.
    maxAge: 0,
    etag: true,
    lastModified: true,
    extensions: ['html'],
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

// كل مسارات API تعرف المستخدم الحالي إن كان مسجّلاً (بلا إجبار)
app.use('/api', auth.attachUser);
app.use('/api', accountRoutes(store));
app.use('/api', aiRoutes());
app.use('/api', gameAiRoutes());
app.use('/api', billing.billingRoutes());

// ------------------------------------------------------------------ واجهة REST

/** فحص الصحة — يكشف أيضاً الإعدادات الفعلية لتشخيص النشر بسرعة */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: BUILD.version,
    features: BUILD.features,
    uptime: Math.round(process.uptime()),
    ...store.stats(),
    config: {
      // مهم للتحقق من أن الخدمة لن تنام أثناء المحاضرة
      keepAlive: keepAliveUrl() || null,
      keepAliveMinutes: Number(process.env.KEEP_ALIVE_MINUTES) || 10,
      sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES) || 180,
      sessionEndedMinutes: Number(process.env.SESSION_ENDED_MINUTES) || 30,
    },
    // حالة تخزين الحسابات — لمعرفة هل ستبقى بعد النشر
    storage: storage.status(),
    // هل رُبطت بيانات اعتماد جوجل؟ بدونها لا يعمل تسجيل الدخول إطلاقاً
    googleLoginConfigured: googleAuth.isConfigured(),
    // هل رُبط مفتاح أزور؟ بدونه لا يعمل «صمّم بالذكاء الاصطناعي»
    aiConfigured: ai.isConfigured(),
    /*
     * حالة الدفع بالبطاقة — ثلاث رايات لا واحدة.
     *
     * الأعطال الثلاثة المحتملة بعد ضبط المفاتيح يستحيل تمييزها من الواجهة:
     * مفتاحٌ لم يصل الخادم (الزرّ يختفي)، وسرُّ توقيعٍ ناقص (الدفع ينجح ولا
     * يُفعَّل شيء أبداً)، ومعرّفُ سعرٍ لم يُضبط (يُرسل السعر مع كل جلسة).
     * فراياتٌ ثلاث تفصلها في نظرة، **بلا كشف قيمةٍ من أي منها**.
     */
    payments: {
      card: stripeApi.configured(),
      mode: stripeApi.mode(),
      webhookReady: Boolean(String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()),
      pricePinned: Boolean(String(process.env.STRIPE_PRICE_ID || '').trim()),
      priceUsd: premium.PLAN.priceUsd,
    },
  });
});

app.get('/api/templates', (_req, res) => {
  res.json({ templates });
});

/**
 * حدّ إنشاء الجلسات. الإنشاء متاح بلا حساب عمداً (تجربة المنصة بلا تسجيل)،
 * لكن ذلك يعني أن أي أحد يستطيع ملء ذاكرة الخادم بجلسات ضخمة. فنحدّ الضيوف
 * بحسب عنوانهم، والمسجّلين بحسب حسابهم وبسقف أعلى.
 */
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_MAX_USER = 300;
const createUsage = new Map(); // key -> { count, resetAt }

function createLimited(key, max) {
  const now = Date.now();
  // تنظيف كسول: المفاتيح المنتهية لا تتراكم مع الوقت
  if (createUsage.size > 5000) {
    for (const [k, v] of createUsage) if (now >= v.resetAt) createUsage.delete(k);
  }
  const entry = createUsage.get(key);
  if (!entry || now >= entry.resetAt) {
    createUsage.set(key, { count: 1, resetAt: now + CREATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= max) return true;
  entry.count += 1;
  return false;
}

/** إنشاء جلسة جديدة — يعيد رمز الدخول ومفتاح المضيف */
/**
 * إنشاء جلسة يتطلّب حساباً.
 *
 * كان مفتوحاً لأي زائر، فيستطيع أي أحد أن يطلق نشاطاً باسم المنصة بلا أثرٍ
 * يُنسب إليه — ولا إشراف على ما يُعرض على الطلاب، ولا نشاطٌ يُحفظ لصاحبه.
 * والدخول بجوجل بضغطة، فالكلفة على المعلّم لا تُذكر أمام ما تشتريه.
 */
app.post('/api/sessions', auth.requireUser, async (req, res) => {
  try {
    const key = 'u:' + req.user.id;
    if (createLimited(key, CREATE_MAX_USER)) {
      return res.status(429).json({ error: 'أنشأت جلسات كثيرة خلال ساعة — انتظر قليلاً ثم أعد المحاولة' });
    }
    // صور الأسئلة للمشتركين فقط
    premium.assertImagesAllowed(req.user, req.body?.questions);
    const session = store.createSession(req.body || {});
    await vetRecordClass(session, req.user);
    let activityId = null;
    // المدرب المسجّل: تُحفظ أسئلته تلقائياً في نشاطاته مع كل إطلاق —
    // فلا يضيع نشاط لمجرد أنه نسي زر الحفظ، وإنهاء الجلسة لا يحذفه
    {
      session.ownerId = req.user.id;
      // اسم المعلّم يُطبع على التقرير — يُحفظ مع الجلسة لا يُقرأ من القاعدة وقت التصدير
      session.ownerName = req.user.name;
      activityId = await syncLaunchedActivity(req.user, session, req.body?.activityId);
      if (activityId) session.activityId = activityId;
    }
    res.status(201).json({
      code: session.code,
      hostToken: session.hostToken,
      title: session.title,
      questionCount: session.questions.length,
      joinUrl: joinUrl(req, session.code),
      activityId,
    });
  } catch (err) {
    fail(res, err);
  }
});

/** معلومات عامة مختصرة للتحقق من الرمز قبل الدخول */
/**
 * صورة سؤال داخل جلسة حية — تُقدَّم كملف لا كـ data URL كي تصل مرة واحدة
 * ويخزّنها متصفح كل مشارك. لا تحتاج مصادقة: من يملك رمز الجلسة يرى السؤال أصلاً.
 */
app.get('/api/sessions/:code/questions/:qid/image', (req, res) => {
  const session = store.getSession(req.params.code);
  if (!session) return res.status(404).json({ error: 'لا توجد جلسة بهذا الرمز' });
  const question = session.questions.find((q) => q.id === req.params.qid);
  if (!question || !question.image) return res.status(404).json({ error: 'لا توجد صورة لهذا السؤال' });

  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(question.image);
  if (!match) return res.status(404).json({ error: 'صورة غير صالحة' });
  const body = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', match[1]);
  // الصورة جزء من السؤال ولا تتغيّر داخل الجلسة، فالتخزين المؤقت آمن
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.end(body);
});

app.get('/api/sessions/:code', (req, res) => {
  const session = store.getSession(req.params.code);
  if (!session) return res.status(404).json({ error: 'لا توجد جلسة بهذا الرمز' });
  res.json({
    code: session.code,
    title: session.title,
    status: session.status,
    requireName: session.settings.requireName,
    allowLateJoin: session.settings.allowLateJoin,
    // مكشوفان للتشخيص السريع: هل طُبّق وضع التقدّم الذي اختاره المدرب؟
    pace: session.settings.pace,
    autoStart: session.settings.autoStart,
    // الجدولة: صفحة الدخول تعرض العدّ التنازلي قبل الموعد
    scheduledAt: session.settings.opensAt,
    // شاشة الطالب تضبط لغتها على لغة النشاط قبل أن ترسم
    lang: session.settings.lang,
    durationMinutes: session.settings.durationMinutes,
    // موعد التسليم: الطالب يفتح رابط واجبٍ ليلاً ويريد أن يعرف كم بقي له
    dueAt: session.settings.dueAt,
    /**
     * كشف الأسماء إن أرفقه المعلّم — يختار الطالب اسمه بدل كتابته.
     *
     * وكشفُه هنا مقصود: من معه رمز الجلسة هو من في الصفّ، وقائمةُ الأسماء
     * الأولى هي ما يُنادى به في الحصة أصلاً. ولا يُرسَل شيءٌ آخر — لا بريد
     * ولا رقم ولا درجة — لأن الكشف أسماءٌ فقط لا سجلّ طلاب.
     */
    roster: session.settings.roster || [],
    // مجموعة كل اسم في الكشف — الطالب يجد اسمه تحت عنوان مجموعته لا في قائمةٍ طويلة
    rosterGroups: session.settings.rosterGroups || [],
    // سجلّ الطلاب مفعّل: من يختار اسمه من الكشف يُدخل رمزه الشخصي معه
    record: Boolean(session.settings.recordClassId),
    participants: session.participants.size,
    questionCount: session.questions.length,
    joinUrl: joinUrl(req, session.code),
  });
});

/** تعديل الأسئلة قبل بدء الجلسة */
app.put('/api/sessions/:code', async (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;
  if (session.status !== 'lobby') {
    return res.status(409).json({ error: 'لا يمكن تعديل الأسئلة بعد بدء الجلسة' });
  }
  try {
    // نفس بوابة POST: بلا هذه كان يكفي إنشاء جلسة نظيفة ثم تعديلها بالصور
    premium.assertImagesAllowed(req.user, req.body?.questions);
    const quiz = normalizeQuiz(req.body || {});
    session.applyEdit(quiz);
    await vetRecordClass(session, req.user);
    // كتابةٌ كاملة لا خفيفة: الأسئلة والعنوان لا تكتبهما التحديثات الخفيفة،
    // فكانت إعادةُ النشر تُعيد الجلسة بأسئلتها القديمة
    store.rewrite(session);
    session.broadcastState();
    res.json({ ok: true, questionCount: session.questions.length });
  } catch (err) {
    fail(res, err);
  }
});

/** لوحة الإحصاءات (نفس بيانات الويب سوكت، متاحة أيضاً عبر HTTP) */
app.get('/api/sessions/:code/dashboard', (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;
  res.json(session.dashboard());
});

/** تنزيل النتائج قبل انتهاء الجلسة (التخزين مؤقت — لا شيء يُحفظ على الخادم) */
app.get('/api/sessions/:code/export', (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tapio-${session.code}.json"`);
  res.end(JSON.stringify(session.export(), null, 2));
});

app.delete('/api/sessions/:code', (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;
  session.broadcast({ t: 'session:closed', reason: 'host' });
  store.deleteSession(session.code);
  res.json({ ok: true });
});

/** رمز QR بصيغة SVG (يُولَّد على الخادم — لا حاجة لمكتبة في المتصفح) */
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 512);
  if (!text) return res.status(400).json({ error: 'نص مفقود' });
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: String(req.query.dark || '#0f172a'), light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.end(svg);
  } catch {
    res.status(500).json({ error: 'تعذّر توليد رمز QR' });
  }
});

app.get('/j/:code', (req, res) => {
  res.redirect(`/play.html?code=${encodeURIComponent(req.params.code)}`);
});

/**
 * الدخول بالرمز صار صفحةً مستقلّة لا حقلاً في الواجهة: زائرٌ لا رمز معه كان
 * يظنّ أن عليه إدخال شيء ليتصفّح. و«‎/c‎» عنوانٌ قصير يُملى على الطلاب شفهياً.
 */
app.get('/c', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'join.html'));
});

/**
 * رابطُ مشاركة اللعبة — قصيرٌ يُلصق في واتساب فتظهر معه صورةُ اللعبة واسمها.
 * التفصيل في `server/share-page.js`، وخلاصته أن ما بعد `#` لا يصل الخادم
 * فلا يستطيع زاحفُ التواصل أن يعرف أي لعبةٍ يصف.
 */
app.get('/g/:id', async (req, res) => {
  try {
    const game = await storage.get().getGame(String(req.params.id));
    if (!game) return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    const host = String(req.get('host') || '');
    const origin = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${req.secure ? 'https' : req.protocol || 'http'}://${host}` : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // خمسُ دقائق: الزواحف تعيد الطلب كثيراً، وعنوانُ اللعبة قد يُعدَّل
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(sharePage.gameSharePage(game, origin, BUILD.version));
  } catch (err) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

app.get('/c/:code', (req, res) => {
  const code = String(req.params.code || '').replace(/\D/g, '');
  // رمزٌ كامل يمضي مباشرةً إلى النشاط، والناقص يفتح الصفحة ليكمله
  if (code.length === 6) return res.redirect(`/play.html?code=${code}`);
  res.sendFile(path.join(__dirname, '..', 'public', 'join.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'غير موجود' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/**
 * أخطاء ما قبل المسار — JSON دائماً على `/api`.
 *
 * بلا هذا المعالج كان جسمٌ مكسور أو أكبر من الحدّ يصل إلى معالج إكسبريس
 * الافتراضي: صفحةُ HTML فيها تتبّعُ المكدّس بمسارات الخادم، والواجهة تقرؤها
 * فتعرض «تعذّر الوصول إلى الخادم» لأنها ليست JSON. فالمعلّم الذي رفع صورةً
 * كبيرةً قليلاً كان يُقال له إن الخادم متوقّف.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.status(err.status || err.statusCode || 500).type('text/plain; charset=utf-8').send('حدث خطأ');
    return;
  }
  const status = err.status || err.statusCode || 500;
  const tooLarge = err.type === 'entity.too.large' || status === 413;
  if (status >= 500) console.error('خطأ غير متوقّع في', req.method, req.path, '—', err.message);
  res.status(status).json({
    error: tooLarge ? 'الملفّ أكبر من الحدّ المسموح — صغّر الصورة ثم أعد المحاولة' : status >= 500 ? 'حدث خطأ في الخادم' : 'طلب غير صالح',
  });
});

function fail(res, err) {
  const status = err?.status || 400;
  res.status(status).json({ error: err?.message || 'طلب غير صالح' });
}

/**
 * سجلّ الطلاب لا يُكتب إلا في فصلٍ **يملكه المُطلِق وشغّل عليه السجل**.
 * الواجهة لا ترسل المعرّف إلا حينها، لكن الخادم لا يثق بالواجهة: معرّفُ
 * فصلٍ لغير صاحبه، أو فصلٍ أُطفئ سجلّه بعد حفظ المسودة، يُسقَط بصمت.
 */
async function vetRecordClass(session, user) {
  const id = session.settings.recordClassId;
  if (!id) return;
  let cls = null;
  try {
    cls = await storage.get().getClass(id);
  } catch {
    cls = null;
  }
  if (!cls || !cls.record || !user || cls.ownerId !== user.id) session.settings.recordClassId = null;
}

function requireHost(req, res) {
  const session = store.getSession(req.params.code);
  if (!session) {
    res.status(404).json({ error: 'لا توجد جلسة بهذا الرمز' });
    return null;
  }
  const provided = req.get('x-host-token') || req.query.hostToken || req.body?.hostToken;
  if (!provided || provided !== session.hostToken) {
    res.status(403).json({ error: 'مفتاح المضيف غير صالح' });
    return null;
  }
  return session;
}

function joinUrl(req, code) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/j/${code}`;
}

// ------------------------------------------------------------- الويب سوكت

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.ctx = null; // { session, role, participant }

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      handleMessage(socket, msg);
    } catch (err) {
      sendTo(socket, { t: 'error', message: err?.message || 'خطأ غير متوقع' });
    }
  });

  socket.on('close', () => detachSocket(socket));
});

function sendTo(socket, message) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* تجاهل */
  }
}

/**
 * يفصل المقبس عمّا كان مربوطاً به قبل ربطه بشيءٍ آخر.
 *
 * `join` وحدها كانت ترفض مقبساً مربوطاً، أمّا `rejoin` و`host:hello` فكانت
 * تكتب `ctx` جديداً فوق القديم وتترك المقبس في مجموعة المشارك السابق: يبقى
 * «متصلاً» في لوحة المعلّم إلى انتهاء الجلسة، وتصله حالاتُ غيره. وهو ما يعمله
 * معالجُ الإغلاق نفسه — فلا يُكتب مرّتين.
 */
function detachSocket(socket) {
  const ctx = socket.ctx;
  if (!ctx) return;
  const { session, role, participant } = ctx;
  socket.ctx = null;
  if (role === 'host') session.hostSockets.delete(socket);
  else if (role === 'screen') session.screenSockets.delete(socket);
  else if (participant) {
    participant.sockets.delete(socket);
    if (participant.sockets.size === 0) {
      participant.connected = false;
      pushHost(session);
    }
  }
}

function handleMessage(socket, msg) {
  const type = msg?.t;
  if (type === 'ping') return sendTo(socket, { t: 'pong', serverNow: Date.now() });

  // --- الاتصال الأولي -------------------------------------------------
  if (type === 'host:hello') {
    const session = store.getSession(msg.code);
    if (!session) return sendTo(socket, { t: 'error', code: 'no_session', message: 'الجلسة غير موجودة أو انتهت' });
    if (msg.hostToken !== session.hostToken) {
      return sendTo(socket, { t: 'error', code: 'forbidden', message: 'مفتاح المضيف غير صالح' });
    }
    detachSocket(socket);
    socket.ctx = { session, role: 'host', participant: null };
    session.hostSockets.add(socket);
    session.touch();
    sendTo(socket, session.hostState());
    sendTo(socket, { t: 'dashboard', data: session.dashboard() });
    return;
  }

  // شاشة عرض للبروجكتر: نفس مفتاح المضيف، لكن بلا صلاحية إرسال أوامر تحكم
  if (type === 'screen:hello') {
    const session = store.getSession(msg.code);
    if (!session) return sendTo(socket, { t: 'error', code: 'no_session', message: 'الجلسة غير موجودة أو انتهت' });
    if (msg.hostToken !== session.hostToken) {
      return sendTo(socket, { t: 'error', code: 'forbidden', message: 'مفتاح المضيف غير صالح' });
    }
    detachSocket(socket);
    socket.ctx = { session, role: 'screen', participant: null };
    session.screenSockets.add(socket);
    session.touch();
    sendTo(socket, session.hostState());
    // بلا أسماء المصوّتين: البروجكتر أمام الصف كله
    sendTo(socket, { t: 'dashboard', data: withoutVoters(session.dashboard()) });
    return;
  }

  if (type === 'join') {
    // مقبس واحد = مشارك واحد. بدون هذا كان يكفي مقبسٌ واحد يرسل «join» ٣٠٠ مرة
    // ليملأ سقف المشاركين بأشباح ويمنع الصف الحقيقي من الدخول.
    if (socket.ctx) {
      return sendTo(socket, { t: 'error', code: 'already_joined', message: 'هذا الاتصال منضمّ بالفعل' });
    }
    const session = store.getSession(msg.code);
    if (!session) return sendTo(socket, { t: 'error', code: 'no_session', message: 'الجلسة غير موجودة أو انتهت' });
    if (session.status === 'ended') {
      return sendTo(socket, { t: 'error', code: 'ended', message: 'انتهت هذه الجلسة' });
    }
    if (session.status === 'live' && !session.settings.allowLateJoin) {
      return sendTo(socket, { t: 'error', code: 'closed', message: 'بدأت الجلسة ولا يُسمح بالدخول المتأخر' });
    }
    const name = session.settings.requireName ? msg.name : 'مشارك مجهول';
    /**
     * سجلّ الطلاب: إن كان للجلسة فصلٌ مُسجَّل والاسمُ من كشفه، فالرمز الشخصي
     * شرطٌ — وإلا كتب أحدُهم في ملفّ زميله. والاسم الذي ليس في الكشف يدخل
     * ضيفاً كما كان دائماً: الكشف دليلٌ لا بوّابة، والسجل لا يغيّر ذلك.
     * (القراءة من التخزين غير متزامنة، فيُعاد التحقّق من المقبس بعدها.)
     */
    const finishJoin = (studentId, cls, pupil) => {
      if (socket.ctx || socket.readyState !== 1) return;
      let participant;
      try {
        participant = session.addParticipant({ name, avatar: msg.avatar });
      } catch (err) {
        // الاسم المكرّر ليس امتلاءً: رمزُه يخصّه كي تعرف الواجهة أن تُعيد السؤال
        return sendTo(socket, { t: 'error', code: err.code || 'full', message: err.message });
      }
      participant.studentId = studentId || null;
      attachParticipant(socket, session, participant);
      const joined = {
        t: 'joined',
        participantId: participant.id,
        participantToken: participant.token,
        code: session.code,
      };
      // رمزُ صفحته «سجلّي»: يعيش على جهازه، ولا يُرسل إلا لمن دخل بملفّه
      if (studentId) joined.recordToken = records.tokenFor(cls.id, pupil);
      sendTo(socket, joined);
      sendTo(socket, session.participantState(participant));
      pushHost(session);
    };
    if (!session.settings.recordClassId || !session.settings.requireName) return finishJoin(null);
    records
      .identify(session.settings.recordClassId, name, msg.pin)
      .then((found) => {
        if (found.ok) return finishJoin(found.pupil.id, found.cls, found.pupil);
        if (found.reason === 'pin') {
          return sendTo(socket, { t: 'error', code: 'pin', message: 'الرمز الشخصي غير صحيح — اسأل معلّمك عن رمزك' });
        }
        return finishJoin(null);
      })
      .catch(() => finishJoin(null));
    return;
  }

  if (type === 'rejoin') {
    const session = store.getSession(msg.code);
    if (!session) return sendTo(socket, { t: 'error', code: 'no_session', message: 'الجلسة غير موجودة أو انتهت' });
    const participant = session.participants.get(msg.participantId);
    if (!participant || participant.token !== msg.participantToken) {
      return sendTo(socket, { t: 'error', code: 'no_participant', message: 'انتهت جلستك، أعد الدخول' });
    }
    detachSocket(socket);
    attachParticipant(socket, session, participant);
    sendTo(socket, { t: 'joined', participantId: participant.id, participantToken: participant.token, code: session.code });
    sendTo(socket, session.participantState(participant));
    pushHost(session);
    return;
  }

  // --- ما بعد الاتصال ---------------------------------------------------
  const ctx = socket.ctx;
  if (!ctx) return sendTo(socket, { t: 'error', code: 'no_ctx', message: 'لم يتم الاتصال بالجلسة' });
  const { session, role, participant } = ctx;
  session.touch();

  if (role === 'player') {
    if (type === 'answer') {
      const result = session.submitAnswer(participant, msg.questionId, msg.value);
      if (!result.ok) return sendTo(socket, { t: 'answer:rejected', message: result.error });
      // الإقرار يحمل ما يسمح به المعلّم فقط: الصحّة مع الكشف، والنقاط مع إظهار النتيجة
      const ack = { t: 'answer:accepted', pending: !!result.pending };
      if (session.settings.revealAnswer) ack.correct = result.correct;
      if (session.settings.showScore) {
        ack.points = result.points;
        ack.multiplier = result.multiplier;
      }
      sendTo(socket, ack);
      for (const s of participant.sockets) sendTo(s, session.participantState(participant));
      pushHost(session);

      // إذا أجاب الجميع نُغلق السؤال تلقائياً ونعرض النتائج (عدا الوضع الحر)
      if (session.settings.pace !== 'self') {
        const q = session.currentQuestion;
        if (q && session.participants.size > 0) {
          const all = [...session.participants.values()].every((p) => p.answers.has(q.id));
          if (all && session.phase === 'question') {
            session.showResults();
            session.broadcastState();
          }
        }
      }
      return;
    }

    if (type === 'next') {
      // الوضع الحر: المتدرب ينتقل بنفسه بعد الإجابة أو انتهاء وقته
      if (!session.advance(participant)) {
        return sendTo(socket, { t: 'answer:rejected', message: 'لا يمكن الانتقال الآن' });
      }
      for (const s of participant.sockets) sendTo(s, session.participantState(participant));
      pushHost(session);
      // في الوضع الحرّ يُنهي كلٌّ بنفسه — فتُكتب نتيجته في سجلّه حينها لا عند إغلاق المعلّم الجلسة
      if (participant.phase === 'done' && participant.studentId) records.capture(session, participant).catch(() => {});
      return;
    }
    if (type === 'review') {
      // مراجعة الطالب لأدائه — بياناته هو، ولا تُرسل إلا بعد أن ينتهي
      const done = session.status === 'ended' || participant.phase === 'done';
      if (!done) return sendTo(socket, { t: 'error', code: 'not_done', message: 'المراجعة تفتح بعد انتهاء النشاط' });
      return sendTo(socket, { t: 'review', items: session.reviewFor(participant) });
    }

    if (type === 'reaction') {
      // تفاعل سريع يظهر على شاشة المدرب وشاشة العرض — لا يُخزَّن ولا يُنسب لأحد
      if (session.react(participant, msg.emoji)) {
        for (const s of session.hostSockets) sendTo(s, { t: 'reaction', emoji: msg.emoji });
        for (const s of session.screenSockets) sendTo(s, { t: 'reaction', emoji: msg.emoji });
      }
      return;
    }
    if (type === 'leave') {
      session.removeParticipant(participant.id);
      pushHost(session);
      socket.ctx = null;
      return;
    }
    return;
  }

  if (role !== 'host') return;

  switch (type) {
    case 'host:start':
      session.start();
      break;
    case 'host:next':
      if (session.phase === 'question') session.showResults();
      else if (session.phase === 'results' && session.settings.showLeaderboard && session.hasScoredQuestions())
        session.showLeaderboard();
      else session.next();
      break;
    case 'host:skip':
      session.next();
      break;
    case 'host:prev':
      session.prev();
      break;
    case 'host:goto':
      session.goTo(Number(msg.index));
      break;
    case 'host:lock':
      session.lock();
      break;
    case 'host:results':
      session.showResults();
      break;
    case 'host:leaderboard':
      session.showLeaderboard();
      break;
    case 'host:end':
      session.finish();
      break;
    case 'host:kick': {
      const target = session.participants.get(String(msg.participantId));
      if (target) {
        for (const s of target.sockets) sendTo(s, { t: 'kicked' });
        session.removeParticipant(target.id);
      }
      break;
    }
    // فتحُ تبويب اللوحة اشتراكٌ فيها، وإغلاقه انصرافٌ عنها
    case 'host:dashboard':
      socket.wantsDash = true;
      return sendTo(socket, { t: 'dashboard', data: session.dashboard() });
    case 'host:dashboard:off':
      socket.wantsDash = false;
      return;
    case 'host:grade': {
      // تصحيح إجابة نصّية: علامة كاملة أو جزئية أو صفر
      const result = session.grade(String(msg.participantId), String(msg.questionId), msg.points);
      if (!result.ok) return sendTo(socket, { t: 'error', code: 'grade', message: result.error });
      // تصحيحٌ بعد أن كُتب السطر في السجل (طالبٌ أنهى، أو جلسةٌ انتهت) يُحدّثه
      {
        const graded = session.participants.get(String(msg.participantId));
        if (graded?.studentId && (session.status === 'ended' || graded.phase === 'done')) records.capture(session, graded).catch(() => {});
      }
      break;
    }
    default:
      return;
  }

  // broadcastState يرسل الحالة ولوحة الإحصاءات للمضيف معاً
  session.broadcastState();
}

/** تحديث المضيف وشاشة العرض بالحالة والإحصاءات معاً (كلاهما يرسم منهما) */
/**
 * بناء لوحة المدرب مكلف: يعيد حساب نتائج كل سؤال وطابور التصحيح، ويبلغ
 * عشرات الميغابايتات من JSON في صفّ كبير. وأحداثه تأتي دفعات — ثلاثون طالباً
 * يضغطون الإجابة في ثانية واحدة — فنجمع الدفعة في إرسالة واحدة بدل ثلاثين.
 * التأخير غير محسوس للمدرب، ويحمي حلقة الأحداث من التوقف.
 */
const HOST_PUSH_MS = 120;
/**
 * واللوحة أبطأ من ذلك عمداً. حالةُ المضيف صغيرة (من أجاب، وكم) فتستحقّ
 * ١٢٠ms، أما اللوحة فأربعون كيلوبايت لصفٍّ من ستين — وثمانُ نسخٍ منها في
 * الثانية تعني ثلث ميغابايت في الثانية إلى جوّال المعلّم، وثمانَ عمليات
 * تحليلٍ ورسمٍ كاملة عليه. والأرقام لا تحتاج ثمانيَ تحديثاتٍ في الثانية.
 */
const DASH_PUSH_MS = 900;
const pendingPush = new Map(); // session -> timer
const lastDash = new WeakMap(); // session -> آخر لحظة أُرسلت فيها اللوحة

function pushHostNow(session, { withDashboard = true } = {}) {
  if (!session.hostSockets.size && !session.screenSockets.size) return;
  const state = session.hostState();
  const wanted = [...session.hostSockets, ...session.screenSockets].filter((s) => session.wantsDashboard(s));
  const due = withDashboard && wanted.length && Date.now() - (lastDash.get(session) || 0) >= DASH_PUSH_MS;
  const data = due ? session.dashboard() : null;
  if (data) lastDash.set(session, Date.now());
  const dashboard = data ? { t: 'dashboard', data } : null;
  const forScreen = data && session.screenSockets.size ? { t: 'dashboard', data: withoutVoters(data) } : null;
  for (const socket of session.hostSockets) {
    sendTo(socket, state);
    if (dashboard && session.wantsDashboard(socket)) sendTo(socket, dashboard);
  }
  for (const socket of session.screenSockets) {
    sendTo(socket, state);
    if (forScreen && session.wantsDashboard(socket)) sendTo(socket, forScreen);
  }
}

function pushHost(session) {
  if (!session.hostSockets.size && !session.screenSockets.size) return;
  if (pendingPush.has(session)) return;
  const timer = setTimeout(() => {
    pendingPush.delete(session);
    pushHostNow(session);
  }, HOST_PUSH_MS);
  timer.unref?.();
  pendingPush.set(session, timer);
}

function attachParticipant(socket, session, participant) {
  socket.ctx = { session, role: 'player', participant };
  participant.sockets.add(socket);
  participant.connected = true;
}

// نبض للحفاظ على الاتصالات وتنظيف الميتة (مهم على شبكات الجوال)
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch {
      /* تجاهل */
    }
  }
}, 30000);
heartbeat.unref?.();

// نهيّئ التخزين قبل الاستماع حتى لا يصل طلب قبل جهوزية الحسابات
const ready = storage
  .init()
  .then(() => {
    if (!storage.isDurable()) {
      warn(
        'تنبيه: تخزين الحسابات على ملف محلي. على استضافة بقرص مؤقت (مثل خطة Render المجانية) ' +
          'تضيع الحسابات مع كل نشر — اضبط DATABASE_URL لقاعدة Postgres.'
      );
    }
  })
  .catch((err) => {
    console.error('فشل تهيئة التخزين:', err.message);
    throw err;
  })
  // إحياء الجلسات المحفوظة قبل الاستماع: طالبٌ يطرق رمزاً بعد إعادة النشر
  // مباشرةً يجب أن يجده حيّاً، لا أن يُقابَل بـ«الجلسة غير موجودة» ثم تعود
  .then(() =>
    store
      .restore()
      .then((n) => {
        if (n) log(`أُعيدت ${n} جلسة محفوظة بعد إعادة التشغيل`);
      })
      .catch((err) => console.error('تعذّر إحياء الجلسات:', err.message))
  )
  .then(
    () =>
      new Promise((resolve) => {
        server.listen(PORT, () => {
          log(`Tapio — يعمل على http://localhost:${server.address().port}`);
          startKeepAlive(store);
          resolve();
        });
      })
  );

/**
 * إغلاق مرتّب. المهم هنا إغلاق مقابس الويب أولاً: فهي طويلة العمر عمداً،
 * و server.close() وحده ينتظرها إلى الأبد فتقتل المنصةُ العمليةَ قسراً
 * ويرى الطلاب انقطاعاً غامضاً. نرسل لهم 1001 (الخادم يُغلق) كي يعيد
 * عميلهم الاتصال بعد النشر، ثم نُخرج بعد مهلة قصيرة مهما حدث.
 */
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // آخر كتابة قبل الوداع: الحفظ مؤجَّل ثانيةً ونصفاً، ولولا هذه لضاع آخر
  // انتقالِ سؤالٍ حدث قُبيل النشر. لا ننتظرها — شبكةُ الأمان بعد ٥ ثوانٍ تكفي.
  store.flush().catch(() => {});
  for (const socket of wss.clients) {
    try {
      socket.close(1001, 'server restarting');
    } catch {
      /* المقبس ميت أصلاً */
    }
  }
  server.close(() => process.exit(0));
  // شبكة أمان: لو تعثّر إغلاق اتصال ما، لا نترك المنصة تقتلنا بـ SIGKILL
  setTimeout(() => process.exit(0), 5000).unref();
}

/**
 * شبكة أمان أخيرة. كل جلسات المنصة في ذاكرة هذه العملية، فموتها يمحو
 * محاضرات جارية عند معلّمين لا علاقة لهم بالخطأ. أي رفض وعد غير ملتقَط
 * (خطأ قاعدة بيانات عابر مثلاً) كان كافياً لإسقاطها — نسجّله ونكمل.
 */
process.on('unhandledRejection', (reason) => {
  console.error('رفض وعد غير ملتقَط:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('استثناء غير ملتقَط:', err && err.stack ? err.stack : err);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { app, server, ready };
