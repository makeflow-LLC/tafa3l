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
const ai = require('./ai');
const premium = require('./premium');

// بصمة النسخة — تُمكّن المدرب من التأكد أن النشر الأخير وصل فعلاً
const BUILD = {
  version: require('../package.json').version,
  features: ['pace:host/auto/self', 'scoring:speed/flat/none', 'streakBonus', 'badges', 'reactions', 'countdown', 'accounts', 'savedActivities', 'autoSaveOnLaunch', 'duplicateActivity', 'sliderScale', 'dashboardResults', 'shareCard', 'googleLogin', 'screenDisplay', 'teamMode', 'questionBank', 'rebrandTapio', 'i18n:full', 'i18n:activityLang', 'screenLiveResults', 'aiDesigner', 'premium', 'adminPanel', 'exportXlsxPdf', 'pdfRichPrint', 'pdfDirectDownload', 'resultsRecordExport', 'manualGrading', 'questionImages:premium', 'fillBlank', 'analytics', 'richReports', 'helpGuide', 'scheduledStart', 'timedQuiz', 'teacherNameInReports', 'siteFooter', 'legalPages', 'pwaInstall', 'assessedOnlyBadges', 'typeOrder', 'typeMatch', 'partialAutoGrading', 'shuffleQuestions', 'shuffleOptions', 'contentSlides', 'sheetImport', 'questionVideo', 'studentReview', 'publicLibrary', 'pollPanel', 'a11yFocus'],
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

/**
 * حدّان للجسم لا واحد. الصور (data URL) تحتاج ١٢ ميغابايت، لكن ثلاثة مسارات
 * فقط تحملها. لو طبّقنا السقف الواسع على الجميع لصار كل مسار — بما فيها
 * تسجيل الخروج — بابَ إغراقٍ بأجسام ضخمة تُحلَّل قبل أن تُرفض.
 */
const jsonLarge = express.json({ limit: '12mb' });
const jsonSmall = express.json({ limit: '256kb' });
const CARRIES_IMAGES = [/^\/api\/sessions(\/[^/]+)?$/, /^\/api\/activities(\/[^/]+)?$/, /^\/api\/bank(\/[^/]+)?$/];
app.use((req, res, next) => {
  const large = (req.method === 'POST' || req.method === 'PUT') && CARRIES_IMAGES.some((re) => re.test(req.path));
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
const CREATE_MAX_GUEST = 60;
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
app.post('/api/sessions', async (req, res) => {
  try {
    const key = req.user ? 'u:' + req.user.id : 'ip:' + (req.ip || req.socket.remoteAddress || 'unknown');
    if (createLimited(key, req.user ? CREATE_MAX_USER : CREATE_MAX_GUEST)) {
      return res.status(429).json({ error: 'أنشأت جلسات كثيرة خلال ساعة — انتظر قليلاً ثم أعد المحاولة' });
    }
    // صور الأسئلة للمشتركين فقط
    premium.assertImagesAllowed(req.user, req.body?.questions);
    const session = store.createSession(req.body || {});
    let activityId = null;
    // المدرب المسجّل: تُحفظ أسئلته تلقائياً في نشاطاته مع كل إطلاق —
    // فلا يضيع نشاط لمجرد أنه نسي زر الحفظ، وإنهاء الجلسة لا يحذفه
    if (req.user) {
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
    participants: session.participants.size,
    questionCount: session.questions.length,
    joinUrl: joinUrl(req, session.code),
  });
});

/** تعديل الأسئلة قبل بدء الجلسة */
app.put('/api/sessions/:code', (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;
  if (session.status !== 'lobby') {
    return res.status(409).json({ error: 'لا يمكن تعديل الأسئلة بعد بدء الجلسة' });
  }
  try {
    // نفس بوابة POST: بلا هذه كان يكفي إنشاء جلسة نظيفة ثم تعديلها بالصور
    premium.assertImagesAllowed(req.user, req.body?.questions);
    const quiz = normalizeQuiz(req.body || {});
    session.title = quiz.title;
    session.questions = quiz.questions;
    session.settings = quiz.settings;
    session.touch();
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

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'غير موجود' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

function fail(res, err) {
  const status = err?.status || 400;
  res.status(status).json({ error: err?.message || 'طلب غير صالح' });
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

  socket.on('close', () => {
    const ctx = socket.ctx;
    if (!ctx) return;
    const { session, role, participant } = ctx;
    if (role === 'host') {
      session.hostSockets.delete(socket);
    } else if (role === 'screen') {
      session.screenSockets.delete(socket);
    } else if (participant) {
      participant.sockets.delete(socket);
      if (participant.sockets.size === 0) {
        participant.connected = false;
        pushHost(session);
      }
    }
  });
});

function sendTo(socket, message) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* تجاهل */
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
    let participant;
    try {
      participant = session.addParticipant({
        name: session.settings.requireName ? msg.name : 'مشارك مجهول',
        avatar: msg.avatar,
      });
    } catch (err) {
      return sendTo(socket, { t: 'error', code: 'full', message: err.message });
    }
    attachParticipant(socket, session, participant);
    sendTo(socket, {
      t: 'joined',
      participantId: participant.id,
      participantToken: participant.token,
      code: session.code,
    });
    sendTo(socket, session.participantState(participant));
    pushHost(session);
    return;
  }

  if (type === 'rejoin') {
    const session = store.getSession(msg.code);
    if (!session) return sendTo(socket, { t: 'error', code: 'no_session', message: 'الجلسة غير موجودة أو انتهت' });
    const participant = session.participants.get(msg.participantId);
    if (!participant || participant.token !== msg.participantToken) {
      return sendTo(socket, { t: 'error', code: 'no_participant', message: 'انتهت جلستك، أعد الدخول' });
    }
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
      sendTo(socket, { t: 'answer:accepted', correct: result.correct, points: result.points, multiplier: result.multiplier, pending: !!result.pending });
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
    case 'host:dashboard':
      return sendTo(socket, { t: 'dashboard', data: session.dashboard() });
    case 'host:grade': {
      // تصحيح إجابة نصّية: علامة كاملة أو جزئية أو صفر
      const result = session.grade(String(msg.participantId), String(msg.questionId), msg.points);
      if (!result.ok) return sendTo(socket, { t: 'error', code: 'grade', message: result.error });
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
const pendingPush = new Map(); // session -> timer

function pushHostNow(session) {
  if (!session.hostSockets.size && !session.screenSockets.size) return;
  const state = session.hostState();
  const dashboard = { t: 'dashboard', data: session.dashboard() };
  const forScreen = session.screenSockets.size ? { t: 'dashboard', data: withoutVoters(dashboard.data) } : null;
  for (const socket of session.hostSockets) {
    sendTo(socket, state);
    sendTo(socket, dashboard);
  }
  for (const socket of session.screenSockets) {
    sendTo(socket, state);
    sendTo(socket, forScreen);
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
