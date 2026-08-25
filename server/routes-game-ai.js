'use strict';

/**
 * مسار «منشئ الألعاب التفاعلية».
 *
 * ثلاثة قراراتٍ تفرقه عن `routes-ai.js`، وكلُّها من طبيعة المهمّة:
 *
 *  ١) **المحادثة تعيش هنا لا في المتصفّح.** دورُ النموذج الواحد قد يكون ملفَّ
 *     لعبةٍ من مئتَي كيلوبايت؛ لو أعاده المتصفّح مع كل رسالة لدفع المعلّم
 *     ثمنه رفعاً وتحميلاً في كل مرّة. فالمتصفّح يرسل رسالته ومعرّف المحادثة
 *     لا غير، والنصّ الكامل محفوظٌ عندنا.
 *
 *  ٢) **الطلب مهمّةٌ تُستطلَع لا نداءٌ يُنتظر.** بناء اللعبة دقيقةٌ أو
 *     دقيقتان، وطلبُ HTTP معلّقٌ تلك المدّة يقطعه أيُّ وسيطٍ في الطريق. فـ
 *     POST يُرجع معرّف مهمّة فوراً، وGET يستطلعها — وهو النمط نفسه الذي
 *     تتبعه خدمة الرسم في `game-cover.js`.
 *
 *  ٣) **ملفّ اللعبة لا يُعرض للمعلّم شيفرةً.** الخادم يُرجعه ليُشغَّل في
 *     إطارٍ معزول ويُنشر في قسم الألعاب، والواجهة لا تطبعه نصّاً.
 *
 * والمفتاح من البيئة وحدها (EVOLINK_API_KEY) — لا يصل المتصفّح.
 */

const express = require('express');
const auth = require('./auth');
const premium = require('./premium');
const builder = require('./game-builder');
const { sendGameFrame } = require('./game-frame');

const MAX_MESSAGE_CHARS = 6000;
const MAX_TURNS_KEPT = 24;
/** أقصى ما نحمله من نصٍّ في محادثةٍ واحدة قبل أن نُسقط أقدمها */
const MAX_CHAT_CHARS = 260000;

const CHAT_TTL_MS = 6 * 60 * 60 * 1000; // محادثة مهجورة تُنسى بعد ست ساعات
/*
 * المهمّة تُنسى بعد ساعتين لا بعد دقائق: منها تُقدَّم معاينةُ اللعبة، والمعلّم
 * يترك تبويبه مفتوحاً وهو يجرّبها ويكتب حقول النشر.
 *
 * والسقفان صلبان لأن ما يُحفظ ملفّاتُ ألعاب لا أسطرُ نصّ: مئةُ محادثةٍ بحدّها
 * الأعلى تبلغ عشرات الميغابايتات، وهذا أقصى ما نقبله من ذاكرة الخادم لميزةٍ
 * كلُّ ما فيها مؤقّت.
 */
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CHATS = 100;
const MAX_JOBS = 100;

// حدّ استعمالٍ لكل معلّم: بناء اللعبة نداءٌ غالٍ، وزرٌّ يُضغط مراراً يستنزفه
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = Number(process.env.GAME_AI_HOURLY_LIMIT) || 20;

/**
 * ما يُحفظ من دورٍ سابق حمل ملفَّ لعبة.
 *
 * الملفّ الأخير وحده يبقى كاملاً — عليه يبني النموذج تعديلاته. وما قبله
 * يُختصر إلى سطر: النموذج يحتاج أن يعرف أنه بنى، لا أن يقرأ ما بنى مرّتين.
 */
const OLD_BUILD_NOTE = '[ملفّ اللعبة السابق — حُذف من السياق اختصاراً. الملفّ المعتمد هو الأخير أدناه.]';

function nowId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function gameAiRoutes() {
  const router = express.Router();

  const chats = new Map(); // chatId -> { userId, turns:[{role,text,built}], at }
  const jobs = new Map(); // jobId  -> { userId, chatId, status, stage, startedAt, ... }
  const usage = new Map(); // userId -> { count, resetAt }

  /** ينظّف ما انتهى عمره — نداءٌ رخيص عند كل طلب بدل مؤقّتٍ دائم */
  function sweep() {
    const now = Date.now();
    for (const [id, chat] of chats) if (now - chat.at > CHAT_TTL_MS) chats.delete(id);
    for (const [id, job] of jobs) if (now - job.startedAt > JOB_TTL_MS && job.status !== 'working') jobs.delete(id);
    // سقفٌ صلب خلف المهلة: أقدمها يخرج أولاً
    while (chats.size > MAX_CHATS) chats.delete(chats.keys().next().value);
    while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  }

  function rateLimited(userId) {
    const now = Date.now();
    const entry = usage.get(userId);
    if (!entry || now >= entry.resetAt) {
      usage.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return 0;
    }
    if (entry.count >= RATE_MAX) return Math.ceil((entry.resetAt - now) / 60000);
    entry.count += 1;
    return 0;
  }

  /**
   * السياق الذي يُرسل إلى النموذج: أدوارُ المحادثة وقد اختُصر منها كلُّ ملفٍّ
   * إلا الأخير، ثم قُصّت من أوّلها إن تجاوزت السقف.
   */
  function contextOf(chat) {
    const turns = chat.turns.slice(-MAX_TURNS_KEPT);
    const lastBuilt = turns.map((t) => t.built).lastIndexOf(true);
    const shaped = turns.map((turn, i) => ({
      role: turn.role,
      text: turn.built && i !== lastBuilt ? OLD_BUILD_NOTE : turn.text,
    }));
    let total = shaped.reduce((n, t) => n + t.text.length, 0);
    while (total > MAX_CHAT_CHARS && shaped.length > 1) {
      total -= shaped[0].text.length;
      shaped.shift();
    }
    return shaped;
  }

  router.get('/game-ai/status', (req, res) => {
    res.json({
      configured: builder.isConfigured(),
      model: builder.config().model,
      signedIn: Boolean(req.user),
      knobs: builder.KNOBS,
      defaults: builder.readConfig({}),
      ...premium.summary(req.user),
    });
  });

  /**
   * يبدأ دوراً جديداً. يعيد `chatId` و`jobId` فوراً — والبناء يجري خلفه.
   */
  router.post('/game-ai/chat', auth.requireUser, premium.requirePremium, (req, res) => {
    sweep();
    if (!builder.isConfigured()) {
      return res.status(503).json({ error: 'منشئ الألعاب غير مُفعّل — أضف المتغيّر EVOLINK_API_KEY في إعدادات الخادم' });
    }

    const message = String(req.body?.message ?? '').slice(0, MAX_MESSAGE_CHARS).trim();
    if (!message) return res.status(400).json({ error: 'اكتب رسالتك أولاً' });

    const minutes = rateLimited(req.user.id);
    if (minutes) {
      return res.status(429).json({ error: `بلغت حدّ بناء الألعاب مؤقتاً — أعد المحاولة بعد ${minutes} دقيقة` });
    }

    let chatId = String(req.body?.chatId || '').trim();
    let chat = chatId ? chats.get(chatId) : null;
    // محادثةٌ لا تخصّه — أو انتهى عمرها — تبدأ من جديد بلا رسالة خطأ
    if (!chat || chat.userId !== req.user.id) {
      chatId = nowId('gc_');
      chat = { userId: req.user.id, turns: [], at: Date.now() };
      chats.set(chatId, chat);
    }
    chat.at = Date.now();
    const asked = { role: 'user', text: message, built: false };
    chat.turns.push(asked);

    const jobId = nowId('gj_');
    const job = { userId: req.user.id, chatId, status: 'working', stage: 'thinking', startedAt: Date.now() };
    jobs.set(jobId, job);

    const cfg = req.body?.config;
    builder
      .chat({ turns: contextOf(chat), config: cfg, onProgress: (stage) => (job.stage = stage) })
      .then((out) => {
        chat.turns.push({ role: 'model', text: out.text + (out.html ? '\n\n```html\n' + out.html + '\n```' : ''), built: Boolean(out.html) });
        chat.at = Date.now();
        Object.assign(job, {
          status: 'done',
          stage: 'done',
          reply: out.text,
          html: out.html,
          truncated: out.truncated,
          config: out.config,
          finishedAt: Date.now(),
        });
      })
      .catch((err) => {
        // الدور فشل: نسحب رسالة المعلّم من السياق كي لا يبقى سؤالٌ بلا جواب
        // فيه، فيُعيد المعلّم إرسالها فتُحسب مرّتين
        chat.turns = chat.turns.filter((turn) => turn !== asked);
        Object.assign(job, { status: 'error', stage: 'error', error: err.message || 'تعذّر بناء اللعبة', finishedAt: Date.now() });
      });

    res.status(202).json({ jobId, chatId });
  });

  /** استطلاع المهمّة. النتيجة تُسلَّم مرّةً ثم تبقى قابلةً للقراءة حتى تُنسى */
  router.get('/game-ai/chat/:jobId', auth.requireUser, (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'انتهت مهلة هذه المهمّة — أعد الطلب' });
    const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
    if (job.status === 'working') return res.json({ status: 'working', stage: job.stage, elapsed });
    if (job.status === 'error') return res.status(200).json({ status: 'error', error: job.error, elapsed });
    res.json({
      status: 'done',
      reply: job.reply,
      html: job.html || '',
      truncated: Boolean(job.truncated),
      config: job.config,
      elapsed,
    });
  });

  /**
   * معاينة اللعبة قبل نشرها — **بترويسات العزل نفسها** التي ستُقدَّم بها بعد
   * النشر (`game-frame.js`).
   *
   * ولم نكتف بـ`srcdoc` وسمةِ `sandbox` في الوسم: تلك تُبهم الأصل ولا تفرض
   * سياسة المحتوى، فتُجيز للمعاينة ما لا تُجيزه اللعبة المنشورة — فيلعبها
   * المعلّم فتعمل، ثم تنكسر عند طالبه. المعاينة ما سيُنشر بالضبط.
   *
   * وهي خاصّة ببانيها: لا يقرأها إلا صاحب المهمّة، ولا تُخزَّن في متصفّح.
   */
  router.get('/game-ai/chat/:jobId/frame', auth.requireUser, (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.userId !== req.user.id || !job.html) {
      return res.status(404).type('text/plain; charset=utf-8').send('انتهت مهلة هذه المعاينة — أعد الطلب');
    }
    sendGameFrame(res, job.html, 'no-store');
  });

  /** يبدأ المعلّم من الصفر: المحادثة تُنسى فوراً لا بعد ست ساعات */
  router.delete('/game-ai/chat/:chatId', auth.requireUser, (req, res) => {
    const chat = chats.get(req.params.chatId);
    if (chat && chat.userId === req.user.id) chats.delete(req.params.chatId);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { gameAiRoutes, OLD_BUILD_NOTE, MAX_TURNS_KEPT, MAX_CHAT_CHARS };
