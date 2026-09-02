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
// مدة الاختبار كاملاً — مطابقة لسقف الخادم في session.js
const MAX_DURATION_MIN = 720;

/**
 * سقف المخرجات. كان ٢٠٠٠ (الافتراضي في ai.js) فيقصّ المسودات: عشرة أسئلة
 * عربية بخياراتها وشروحها تتجاوزه، فيوجزها النموذج أو تُبتر كتلة JSON.
 * وهذا نصف سبب «أطلب عشرة فيعمل ثمانية». المسودة الكاملة أرخص من إعادة
 * الطلب مرّتين.
 */
const DESIGN_MAX_TOKENS = 8000;

// حدّ استعمال بسيط لكل مدرب: يمنع استنزاف الرصيد بالخطأ أو بحلقة في الواجهة
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 60;
const usage = new Map(); // userId -> { count, resetAt }

function rateLimited(userId) {
  const now = Date.now();
  // تنظيفٌ كسول: مدخلٌ لكل معلّمٍ إلى الأبد ينمو ببطء ولا يتوقّف
  if (usage.size > 2000) for (const [k, v] of usage) if (now >= v.resetAt) usage.delete(k);
  const entry = usage.get(userId);
  if (!entry || now >= entry.resetAt) {
    usage.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  if (entry.count >= RATE_MAX) return Math.ceil((entry.resetAt - now) / 60000);
  entry.count += 1;
  return null;
}

/**
 * النوعان اللذان يُلقيان على المعلّم تصحيحاً يدويّاً بعد الجلسة.
 * (session.js: `q.manual = (open || blank) && points > 0`)
 */
const MANUAL_TYPES = new Set(['open', 'blank']);

const AUTO_ONLY_RULE = [
  '',
  'قاعدة التصحيح — مهمّة:',
  '- الوضع الافتراضي: **أسئلة تُصحَّح آلياً فقط** — mc، truefalse، order، match. ومعها',
  '  poll وword وscale إن كان الغرض استطلاعاً أو كسر جمود (وهذه بلا تصحيح أصلاً).',
  '- **ممنوع** أن تضع في المسودة سؤال open (جواب حرّ) أو blank (أكمل الفراغ):',
  '  هذان يُلزمان المعلّم بتصحيح كل إجابة بيده بعد الجلسة.',
  '- إن رأيت أن الموضوع يستفيد منهما فعلاً، **اسأل المعلّم صراحةً** بجملة',
  '  واحدة: هل يقبل أسئلةً تحتاج تصحيحاً يدويّاً منه؟ ونبّهه أن عليه تفعيل',
  '  خيار «اسمح بأسئلة تحتاج تصحيحاً يدوياً» تحت المحادثة. ثم صمّم بلا هذين',
  '  النوعين ريثما يوافق.',
].join('\n');

const MANUAL_OK_RULE = [
  '',
  'قاعدة التصحيح:',
  '- المعلّم **سمح** بأسئلة التصحيح اليدوي، فيجوز لك استعمال open وblank عند الحاجة.',
  '- ومع ذلك لا تُكثر منهما: اجعل معظم الأسئلة مما يُصحَّح آلياً، وبيّن للمعلّم',
  '  كم سؤالاً سيحتاج تصحيحه بيده.',
].join('\n');

const SYSTEM_PROMPT = [
  'أنت «مصمّم الأنشطة» في منصة Tapio: منصة أسئلة واستطلاعات تفاعلية مباشرة للمعلّمين والمدرّبين.',
  'مهمتك أن تحاور المعلّم حتى تفهم ما يريد، ثم تصوغ له نشاطاً جاهزاً.',
  '',
  'قاعدة العدد — لا تُخالَف أبداً:',
  '- إن ذكر المعلّم عدداً (١٠ أسئلة، ٥ أسئلة، عشرين…) فالمسودة تحمل **هذا العدد بالضبط**.',
  '  لا تسعة ولا أحد عشر. عُدَّ عناصر "questions" قبل أن ترسل، وأصلح العدد إن اختلّ.',
  '- ولا تُنقص العدد لأن نوعاً مُنع عليك: استبدله بسؤالٍ آخر مسموح عن الموضوع نفسه.',
  '- وإن لم يذكر عدداً فاسأله، أو اجعلها ثمانية إن قال «صمّم مباشرة».',
  '',
  'قاعدة التنويع:',
  '- **لا تجعل النشاط كلّه mc وtruefalse.** هذان أسهل ما تولّده وأفقرُ ما يتعلّم منه الطالب.',
  '- في أي نشاطٍ من خمسة أسئلة فأكثر، استعمل **ثلاثة أنواع مختلفة على الأقل** مما هو مسموح لك.',
  '- اختر النوع بما يناسب المحتوى لا بما يسهل عليك:',
  '  · تسلسل أو خطوات أو ترتيب زمني ← order    · مصطلحات ومعانيها، دول وعواصمها ← match',
  '  · حكمٌ على عبارة ← truefalse              · تمييز بين بدائل متقاربة ← mc',
  '  · نصّ يُفهم ثم يُسأل عنه ← passage مع mc أو truefalse',
  '',
  'قواعد الحوار:',
  '- تحدّث بلغة المعلّم نفسها (عربية أو إنجليزية) وبأسلوب ودود ومختصر.',
  '- **قبل أن تصمّم اسأله عن نظام التقييم** إن لم يذكره: هل يريد **علاماتٍ** (اختبارٌ من ١٠ أو ٢٠ أو ٣٠…) أم **نقاطاً** (لعبةٌ تكافئ سرعة الإجابة) أم **بلا تقييم**؟',
  '  وإن اختار العلامات فاسأله: العلامة من كم؟ وهل تُوزَّع بالتساوي على الأسئلة أم يحدّد علامة كل سؤال؟',
  '  واسأله أيضاً عن الوقت، وهما أمران مختلفان: **مدة الاختبار كلّه** بالدقائق (١٠، ٢٠، ٤٥…) وتُكتب في "durationMinutes"،',
  '  و**وقت السؤال الواحد** بالثواني وتُكتب في "timeMode": "all" مع "timeLimit". يجوز أحدهما أو كلاهما أو لا شيء.',
  '- وإن كان طلبه غامضاً اسأله كذلك عن: الموضوع، المستوى/العمر، وعدد الأسئلة. ولا تتجاوز ٤ أسئلة في الرسالة الواحدة.',
  '- إن قال «صمّم مباشرة» فلا تسأل: خذ الافتراضات (نقاط، بلا مؤقّت، تقدّمٌ حرّ) وصمّم فوراً، واذكر في سطرٍ ما افترضتَه ليصحّحه.',
  '- لا تكتب فقرات طويلة: ملخّص من سطرين ثم المسودة.',
  '',
  'أنواع الأسئلة المدعومة فقط:',
  'أ) تُصحَّح آلياً — وهذه هي الأصل:',
  '- mc: اختيار من متعدّد (٢–٦ خيارات، وإجابة صحيحة واحدة على الأقل)',
  '- truefalse: صح/خطأ',
  '- order: ترتيب عناصر — "items" بالترتيب الصحيح، وتُخلط على الطالب (علامة جزئية)',
  '- match: مطابقة — "pairs" فيها left وright لكل زوج (علامة جزئية)',
  'ب) بلا إجابة صحيحة أصلاً (للاستطلاع وكسر الجمود، ولا تصحيح فيها):',
  '- poll: استطلاع رأي',
  '- word: سحابة كلمات (كلمة واحدة من كل مشارك)',
  '- scale: مقياس رقمي بمنزلق (min/max ووصفَي الطرفين)',
  'ج) تحتاج تصحيحاً يدويّاً من المعلّم — لا تستعملها إلا بإذنه الصريح:',
  '- blank: أكمل الفراغ — اكتب الجملة وضع ___ (ثلاث شرطات سفلية) مكان كل فراغ، وأرفق "blanks" بالإجابات المتوقعة و"points"',
  '- open: سؤال مفتوح نصّي — بـ"points" ليصحّحه المعلّم ويمنح علامة، أو بلا points لسؤال رأي حرّ',
  '',
  'متى تكتب المسودة: كلما توفّرت لديك معلومات كافية، وفي كل مرة يطلب المعلّم تعديلاً.',
  'اكتب المسودة كاملةً في كل مرة (لا تكتب التعديل وحده) ككتلة JSON واحدة بين ```json و``` في نهاية ردّك،',
  'ولا تكتب أي شيء بعدها. الصيغة:',
  '```json',
  '{',
  '  "title": "عنوان النشاط",',
  '  "settings": { "pace": "self", "reward": "points", "scoring": "speed", "timeMode": "none", "showLeaderboard": true, "countdown": true,',
  '                "durationMinutes": 0, "shuffleQuestions": false, "shuffleOptions": false },',
  '  "questions": [',
  '    { "type": "mc", "text": "نص السؤال", "options": ["خيار ١", "خيار ٢", "خيار ٣", "خيار ٤"], "correct": ["خيار ١"], "points": 1000, "explanation": "سبب مختصر" },',
  '    { "type": "truefalse", "text": "عبارة", "correct": true, "points": 500 },',
  '    { "type": "poll", "text": "سؤال استطلاع", "options": ["أ", "ب"] },',
  '    { "type": "scale", "text": "ما مدى وضوح الدرس؟", "scale": { "min": 1, "max": 5, "minLabel": "غير واضح", "maxLabel": "واضح جداً" } },',
  '    { "type": "word", "text": "صف الدرس بكلمة واحدة" },',
  '    { "type": "order", "text": "رتّب مراحل دورة الماء", "items": ["التبخّر", "التكاثف", "الهطول"], "points": 1000 },',
  '    { "type": "match", "text": "طابق العاصمة ببلدها", "pairs": [{ "left": "الأردن", "right": "عمّان" }, { "left": "مصر", "right": "القاهرة" }], "points": 1000 },',
  '    { "type": "open", "text": "ما الذي تقترح تحسينه؟" },',
  '    { "type": "open", "text": "اشرح بأسلوبك سبب حدوث التبخّر.", "points": 5 },',
  '    { "type": "blank", "text": "الماء يغلي عند ___ درجة مئوية عند سطح البحر.", "blanks": ["100"], "points": 1 },',
  '    { "type": "mc", "passage": "نصّ القطعة التي يقرأها الطالب…", "text": "سؤال عن القطعة", "options": ["أ", "ب"], "correct": ["أ"], "points": 1000 }',
  '  ]',
  '}',
  '```',
  '',
  'ملاحظات مهمّة:',
  '- "correct" تُكتب بنصّ الخيار حرفياً كما في options.',
  '- "passage": قطعة قراءة اختيارية تعلو السؤال وتبقى أمام الطالب وهو يجيب — لأسئلة «اقرأ الفقرة ثم أجب».',
  '  تصلح مع أي نوع (mc، truefalse، open…). إن طلب المعلّم أسئلة استيعاب مقروء فاكتب القطعة مرّة',
  '  في "passage" تحت **كل** سؤال يخصّها (لا تكتبها داخل "text"، ولا تفترضها إن لم تُطلب).',
  '- pace: "self" (كل متدرب بسرعته — **الافتراضي دائماً**) أو "host" (المدرب ينقل الشرائح) أو "auto" (انتقال تلقائي). لا تختر غير self إلا إن طلبه المعلّم صراحةً.',
  '',
  'نظام التقييم — واحدٌ لا اثنان، اكتبه في "reward":',
  '- "points": لعبةُ نقاط. تُكتب "points" تحت كل سؤال (١٠٠٠ قيمة معقولة)، و"scoring": "speed"',
  '  فتتناقص النقاط مع ثواني الإجابة. ولا تكتب "totalMark" ولا "mark" إطلاقاً.',
  '- "marks": علاماتٌ للدفتر. تُكتب "totalMark" (١٠، ٢٠، ٣٠…) و"markMode":',
  '  · "equal" — العلامة تُقسَّم بالتساوي على الأسئلة، فلا تكتب "mark" تحت أي سؤال.',
  '  · "custom" — تكتب "mark" تحت كل سؤال، و**مجموعها يجب أن يساوي totalMark بالضبط**.',
  '  والعلامات ثابتة لا تتأثر بسرعة الإجابة إطلاقاً.',
  '- "none": بلا نقاط ولا علامات.',
  '',
  'النافذة الزمنية — اختيارية، اكتبها في "timeMode":',
  '- "none": بلا مؤقّت — وهو **الافتراضي**. لا تكتب "timeLimit" في أي موضع.',
  '- "all": ثوانٍ واحدة تسري على كل الأسئلة، فاكتب "timeLimit" في settings وحدها.',
  '- ولا يوجد مؤقّت لكل سؤال إطلاقاً: لا تكتب "timeLimit" تحت أي سؤال.',
  '- الاستطلاع وسحابة الكلمات والمقياس بلا نقاط ولا إجابة صحيحة، فلا تدخل في العلامة.',
  '',
  'جودة السؤال — ما يفرّق نشاطاً يعلّم عن نشاطٍ يملأ وقتاً:',
  '- **الخيارات المُلهِية معقولة**: خطأٌ يقع فيه طالبٌ فعلاً (خلطُ مفهومين، خطوةٌ منسيّة)، لا خياراتٌ سخيفة',
  '  يستبعدها الطالب بلا تفكير. واجعلها متقاربة الطول، ولا تكتب «كل ما سبق» ولا «لا شيء ممّا سبق».',
  '- **لا تكرّر السؤال بصيغتين**، ولا تجعل نصّ سؤالٍ يكشف إجابة سؤالٍ آخر.',
  '- **اكتب "explanation" لكل سؤالٍ يُصحَّح آلياً**: سطرٌ يقول لماذا هذه الإجابة صحيحة — يراه الطالب لحظة',
  '  الكشف، وهو أنفع ما في النشاط كلّه.',
  '- تدرّج من السهل إلى الأصعب، ونوّع مستوى التفكير: تذكُّرٌ، ثم فهمٌ، ثم تطبيقٌ وتحليل.',
  '- إن ذكر المعلّم صفّاً أو عمراً فاضبط المفردات والطول عليه.',
  '',
  'وضع الفرق — "teamMode": true مع "teamCount" (٢–٨):',
  '- اقترحه حين يقول المعلّم «مسابقة» أو «تنافس بين مجموعات». المشاركون يُقسَّمون تلقائياً وتُجمع نقاطهم لترتيبٍ جماعي.',
  '',
  'مدة الاختبار كاملاً — "durationMinutes":',
  '- عددُ دقائق تبدأ من انطلاق الجلسة، وعند انتهائها يُقفل الاختبار وحده. صفر = بلا حدّ (الافتراضي).',
  '- اكتبها كلّما ذكر المعلّم مدةً («اختبار من عشرين دقيقة»، «حصة ٤٥ دقيقة»). وهي غير وقت السؤال الواحد.',
  `- الحدّ الأعلى ${MAX_DURATION_MIN} دقيقة.`,
  '',
  'نزاهة الاختبار — اقترحهما حين يقول المعلّم «اختبار» أو «امتحان» أو يذكر الغشّ:',
  '- "shuffleQuestions": true — ترتيب الأسئلة يُخلط مرّةً عند الإطلاق.',
  '- "shuffleOptions": true — خيارات كل سؤال تُخلط لكل طالب على حدة، فلا يُجدي النظر في شاشة الجار.',
  `- لا تتجاوز ${MAX_QUESTIONS} سؤالاً في النشاط الواحد.`,
  '- إن لم يوافق المعلّم على شيء، عدّله وأعد إرسال المسودة كاملة.',
].join('\n');

/** تعليمات النظام حسب إذن المعلّم بالتصحيح اليدوي */
const systemFor = (allowManual) => SYSTEM_PROMPT + (allowManual ? MANUAL_OK_RULE : AUTO_ONLY_RULE);

/**
 * حارسُ العلامات. المسودة التي تدّعي توزيعاً مخصّصاً ومجموعُ علاماتها يخالف
 * العلامة الكاملة حالةٌ لا يصحّ أن تصل المعلّم — فهي بالضبط ما اشترط ألّا
 * يكون قبل الإطلاق. نرجع بها إلى التوزيع بالتساوي ونقول ما فعلنا.
 */
function fixMarks(draft) {
  const st = draft?.settings;
  if (!draft || !st || st.reward !== 'marks' || st.markMode !== 'custom') return { draft, fixed: false };
  const total = Number(st.totalMark) || 0;
  const sum = (draft.questions || []).reduce((n, q) => n + (Number(q?.mark) || 0), 0);
  if (total > 0 && Math.abs(sum - total) < 0.01) return { draft, fixed: false };
  const questions = (draft.questions || []).map(({ mark, ...q }) => q);
  return { draft: { ...draft, settings: { ...st, markMode: 'equal' }, questions }, fixed: true, sum, total };
}

/**
 * حارسٌ خلف التعليمات. النموذج يخالف أحياناً مهما وُضّحت له القاعدة، ولا
 * يصحّ أن يُفاجأ المعلّم بعشرين إجابةً تنتظر تصحيحه لأنه لم يطلب ذلك.
 * لا نحذف بصمت: نُرجع ما أُسقط ليُذكر في الردّ.
 */
function dropManual(draft) {
  if (!draft || !Array.isArray(draft.questions)) return { draft, dropped: [] };
  const dropped = [];
  const questions = draft.questions.filter((q) => {
    const manual = MANUAL_TYPES.has(String(q?.type)) && Number(q?.points ?? 1) > 0;
    if (manual) dropped.push(String(q.text || '').slice(0, 60));
    return !manual;
  });
  return { draft: { ...draft, questions }, dropped };
}

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
      const allowManual = req.body?.allowManual === true;
      const system = systemFor(allowManual);
      const reply = await ai.complete({ system, messages, maxOutputTokens: DESIGN_MAX_TOKENS });
      let { text, draft } = splitDraft(reply);

      /**
       * ترميمُ العدد بدل إنقاصه.
       *
       * كان الحارس يحذف أسئلة التصحيح اليدوي ويترك الفجوة، فيطلب المعلّم
       * عشرةً فيجد ثمانية بلا سببٍ ظاهر. الآن نطلب من النموذج **بدائل** لما
       * حُذف — نداءٌ واحدٌ إضافي، ولا يقع إلا حين يخالف النموذج قاعدةً
       * وُضّحت له أصلاً.
       */
      if (draft && !allowManual) {
        const check = dropManual(draft);
        const missing = check.dropped.length;
        if (missing) {
          const ask = [
            `مسودتك حوت ${missing} سؤالاً يحتاج تصحيحاً يدوياً (open أو blank) وهي ممنوعة هنا.`,
            'أعد إرسال المسودة **كاملة** بالعدد نفسه الذي طلبه المعلّم، وقد استبدلتَ تلك الأسئلة',
            'بأسئلةٍ تُصحَّح آلياً (mc أو truefalse أو order أو match) عن المواضيع نفسها.',
            'لا تنقص العدد، ولا تكتب شيئاً بعد كتلة JSON.',
          ].join(' ');
          try {
            const retry = await ai.complete({
              system,
              messages: [...messages, { role: 'assistant', content: reply }, { role: 'user', content: ask }],
              maxOutputTokens: DESIGN_MAX_TOKENS,
            });
            const second = splitDraft(retry);
            // لا نقبل البديل إلا إن كان فعلاً أوفى: الأسوأ أن نستبدل ناقصاً بأنقص
            if (second.draft && dropManual(second.draft).draft.questions.length > check.draft.questions.length) {
              draft = second.draft;
              text = second.text || text;
            }
          } catch {
            /* تعذّر الترميم: نُكمل بالحارس القديم ونُخبر المعلّم */
          }
        }
      }

      let out = draft;
      let note = '';
      if (draft) {
        const marks = fixMarks(draft);
        out = marks.draft;
        if (marks.fixed) {
          note +=
            `\n\nℹ️ مجموع علامات الأسئلة (${Math.round(marks.sum * 100) / 100}) لم يطابق العلامة الكاملة ` +
            `(${marks.total})، فجعلتُ التوزيع بالتساوي. عدّله من إعدادات النشاط إن أردت علامةً لكل سؤال.`;
        }
      }
      if (!allowManual && out) {
        const guarded = dropManual(out);
        out = guarded.draft;
        if (guarded.dropped.length) {
          note +=
            `\n\nℹ️ أسقطتُ ${guarded.dropped.length} سؤالاً يحتاج تصحيحاً يدويّاً منك ` +
            '(جواب حرّ أو أكمل الفراغ). فعّل «اسمح بأسئلة تحتاج تصحيحاً يدوياً» تحت المحادثة إن أردتها.';
        }
        // لو لم يبقَ سؤال، فالمسودة الفارغة أسوأ من لا مسودة
        if (!out.questions.length) out = null;
      }
      res.json({ reply: (text || 'جاهزة المسودة أدناه 👇') + note, draft: out });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'تعذّر توليد النشاط' });
    }
  });

  return router;
}

module.exports = { aiRoutes, splitDraft, sanitizeMessages, SYSTEM_PROMPT, systemFor, dropManual, fixMarks, MANUAL_TYPES };
