'use strict';

/**
 * مسار «صمّم نشاطك بالذكاء الاصطناعي».
 *
 * المتصفّح يرسل المحادثة كاملة، والخادم يضيف تعليمات النظام وينادي أزور
 * (المفتاح على الخادم فقط)، ثم يفصل نصّ الردّ عن مسودة النشاط (JSON).
 */

const express = require('express');
const auth = require('./auth');
const ai = require('./ai');
const premium = require('./premium');

const MAX_MESSAGES = 30;
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_TOTAL_CHARS = 24000;
const MAX_QUESTIONS = 40;

// حدّ استعمال بسيط لكل مدرب: يمنع استنزاف الرصيد بالخطأ أو بحلقة في الواجهة
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 60;
const usage = new Map(); // userId -> { count, resetAt }

function rateLimited(userId) {
  const now = Date.now();
  const entry = usage.get(userId);
  if (!entry || now >= entry.resetAt) {
    usage.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  if (entry.count >= RATE_MAX) return Math.ceil((entry.resetAt - now) / 60000);
  entry.count += 1;
  return null;
}

const SYSTEM_PROMPT = [
  'أنت «مصمّم الأنشطة» في منصة Tapio: منصة أسئلة واستطلاعات تفاعلية مباشرة للمعلّمين والمدرّبين.',
  'مهمتك أن تحاور المعلّم حتى تفهم ما يريد، ثم تصوغ له نشاطاً جاهزاً.',
  '',
  'قواعد الحوار:',
  '- تحدّث بلغة المعلّم نفسها (عربية أو إنجليزية) وبأسلوب ودود ومختصر.',
  '- إن كان طلبه غامضاً اسأله أسئلة قصيرة مرقّمة (٤ كحدّ أقصى) عن: الموضوع، المستوى/العمر، عدد الأسئلة، والهدف (تقييم، مراجعة، كسر جمود، استطلاع رأي).',
  '- إن كان طلبه واضحاً أو قال «صمّم مباشرة» فلا تسأل، صمّم فوراً.',
  '- لا تكتب فقرات طويلة: ملخّص من سطرين ثم المسودة.',
  '',
  'أنواع الأسئلة المدعومة فقط:',
  '- mc: اختيار من متعدّد (٢–٦ خيارات، وإجابة صحيحة واحدة على الأقل)',
  '- truefalse: صح/خطأ',
  '- poll: استطلاع رأي بلا إجابة صحيحة',
  '- word: سحابة كلمات (كلمة واحدة من كل مشارك)',
  '- scale: مقياس رقمي بمنزلق (min/max ووصفَي الطرفين)',
  '- open: سؤال مفتوح نصّي',
  '',
  'متى تكتب المسودة: كلما توفّرت لديك معلومات كافية، وفي كل مرة يطلب المعلّم تعديلاً.',
  'اكتب المسودة كاملةً في كل مرة (لا تكتب التعديل وحده) ككتلة JSON واحدة بين ```json و``` في نهاية ردّك،',
  'ولا تكتب أي شيء بعدها. الصيغة:',
  '```json',
  '{',
  '  "title": "عنوان النشاط",',
  '  "settings": { "pace": "host", "scoring": "speed", "showLeaderboard": true, "countdown": true },',
  '  "questions": [',
  '    { "type": "mc", "text": "نص السؤال", "options": ["خيار ١", "خيار ٢", "خيار ٣", "خيار ٤"], "correct": ["خيار ١"], "points": 1000, "timeLimit": 20, "explanation": "سبب مختصر" },',
  '    { "type": "truefalse", "text": "عبارة", "correct": true, "points": 500, "timeLimit": 15 },',
  '    { "type": "poll", "text": "سؤال استطلاع", "options": ["أ", "ب"] },',
  '    { "type": "scale", "text": "ما مدى وضوح الدرس؟", "scale": { "min": 1, "max": 5, "minLabel": "غير واضح", "maxLabel": "واضح جداً" } },',
  '    { "type": "word", "text": "صف الدرس بكلمة واحدة" },',
  '    { "type": "open", "text": "ما الذي تقترح تحسينه؟" }',
  '  ]',
  '}',
  '```',
  '',
  'ملاحظات مهمّة:',
  '- "correct" تُكتب بنصّ الخيار حرفياً كما في options.',
  '- pace: "host" (المدرب ينقل الشرائح) أو "self" (كل متدرب بسرعته) أو "auto" (انتقال تلقائي).',
  '- scoring: "speed" (النقاط تتناقص مع الوقت) أو "flat" (نقاط ثابتة) أو "none" (بلا نقاط).',
  '- الاستطلاع وسحابة الكلمات والمقياس والمفتوح بلا نقاط ولا إجابة صحيحة.',
  `- لا تتجاوز ${MAX_QUESTIONS} سؤالاً في النشاط الواحد.`,
  '- إن لم يوافق المعلّم على شيء، عدّله وأعد إرسال المسودة كاملة.',
].join('\n');

/** يفصل كتلة JSON عن نصّ الردّ — يعيد { text, draft } */
function splitDraft(reply) {
  const fenced = [...String(reply).matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  const candidates = fenced.map((m) => ({ raw: m[1], full: m[0] }));

  if (!candidates.length) {
    // ربما كتب الكائن بلا أسوار
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start >= 0 && end > start) candidates.push({ raw: reply.slice(start, end + 1), full: reply.slice(start, end + 1) });
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    let data;
    try {
      data = JSON.parse(candidates[i].raw.trim());
    } catch {
      continue;
    }
    const questions = Array.isArray(data) ? data : data?.questions;
    if (!Array.isArray(questions) || !questions.length) continue;
    const draft = Array.isArray(data) ? { questions: data } : data;
    draft.questions = draft.questions.slice(0, MAX_QUESTIONS);
    const text = reply.replace(candidates[i].full, '').trim();
    return { text, draft };
  }
  return { text: String(reply).trim(), draft: null };
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    const err = new Error('لا توجد رسالة');
    err.status = 400;
    throw err;
  }
  const list = raw
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content ?? '').slice(0, MAX_CHARS_PER_MESSAGE).trim(),
    }))
    .filter((m) => m.content);
  if (!list.length) {
    const err = new Error('لا توجد رسالة');
    err.status = 400;
    throw err;
  }
  let total = 0;
  const trimmed = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    total += list[i].content.length;
    if (total > MAX_TOTAL_CHARS && trimmed.length) break;
    trimmed.unshift(list[i]);
  }
  return trimmed;
}

function aiRoutes() {
  const router = express.Router();

  router.get('/ai/status', (req, res) => {
    res.json({
      configured: ai.isConfigured(),
      model: ai.config().model,
      signedIn: Boolean(req.user),
      ...premium.summary(req.user),
    });
  });

  router.post('/ai/design', auth.requireUser, premium.requirePremium, async (req, res) => {
    try {
      if (!ai.isConfigured()) {
        return res.status(503).json({
          error: 'خدمة الذكاء الاصطناعي غير مُفعّلة — أضف المتغيّر AZURE_OPENAI_KEY في إعدادات الخادم',
        });
      }
      const minutes = rateLimited(req.user.id);
      if (minutes) {
        return res.status(429).json({ error: `بلغت حدّ الاستخدام مؤقتاً — أعد المحاولة بعد ${minutes} دقيقة` });
      }

      const messages = sanitizeMessages(req.body?.messages);
      const reply = await ai.complete({ system: SYSTEM_PROMPT, messages });
      const { text, draft } = splitDraft(reply);
      res.json({ reply: text || 'جاهزة المسودة أدناه 👇', draft });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر توليد النشاط' });
    }
  });

  return router;
}

module.exports = { aiRoutes, splitDraft, sanitizeMessages, SYSTEM_PROMPT };
