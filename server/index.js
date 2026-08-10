'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const store = require('./store');
const { normalizeQuiz } = require('./session');
const templates = require('./templates');
const { startKeepAlive, keepAliveUrl } = require('./keepalive');
const storage = require('./storage');
const auth = require('./auth');
const { accountRoutes } = require('./routes-account');

// بصمة النسخة — تُمكّن المدرب من التأكد أن النشر الأخير وصل فعلاً
const BUILD = {
  version: require('../package.json').version,
  features: ['pace:host/auto/self', 'scoring:speed/flat/none', 'streakBonus', 'badges', 'reactions', 'countdown', 'accounts', 'savedActivities'],
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
app.use(express.json({ limit: '256kb' }));
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    // لا نخزّن الملفات في المتصفح: بعد كل نشر يجب أن يرى المدرب النسخة الجديدة فوراً.
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
  });
});

app.get('/api/templates', (_req, res) => {
  res.json({ templates });
});

/** إنشاء جلسة جديدة — يعيد رمز الدخول ومفتاح المضيف */
app.post('/api/sessions', (req, res) => {
  try {
    const session = store.createSession(req.body || {});
    // ننسب الجلسة لصاحبها إن كان مسجّل الدخول، لتظهر «مباشر الآن» في لوحته
    if (req.user) {
      session.ownerId = req.user.id;
      if (req.body?.activityId) session.activityId = String(req.body.activityId);
    }
    res.status(201).json({
      code: session.code,
      hostToken: session.hostToken,
      title: session.title,
      questionCount: session.questions.length,
      joinUrl: joinUrl(req, session.code),
    });
  } catch (err) {
    fail(res, err);
  }
});

/** معلومات عامة مختصرة للتحقق من الرمز قبل الدخول */
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
  res.setHeader('Content-Disposition', `attachment; filename="tafa3l-${session.code}.json"`);
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

  if (type === 'join') {
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
      sendTo(socket, { t: 'answer:accepted', correct: result.correct, points: result.points, multiplier: result.multiplier });
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
    if (type === 'reaction') {
      // تفاعل سريع يظهر على شاشة المدرب — لا يُخزَّن ولا يُنسب لأحد
      if (session.react(participant, msg.emoji)) {
        for (const s of session.hostSockets) sendTo(s, { t: 'reaction', emoji: msg.emoji });
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
    default:
      return;
  }

  // broadcastState يرسل الحالة ولوحة الإحصاءات للمضيف معاً
  session.broadcastState();
}

/** تحديث المضيف بالحالة والإحصاءات معاً (لتبقى لوحة التحكم حيّة) */
function pushHost(session) {
  if (session.hostSockets.size === 0) return;
  const state = session.hostState();
  const dashboard = { t: 'dashboard', data: session.dashboard() };
  for (const socket of session.hostSockets) {
    sendTo(socket, state);
    sendTo(socket, dashboard);
  }
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
          log(`تفاعل — يعمل على http://localhost:${server.address().port}`);
          startKeepAlive(store);
          resolve();
        });
      })
  );

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

module.exports = { app, server, ready };
