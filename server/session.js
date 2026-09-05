'use strict';

const crypto = require('crypto');

const QUESTION_TYPES = ['mc', 'truefalse', 'poll', 'word', 'scale', 'open', 'blank', 'order', 'match', 'slide'];

/**
 * شريحة محتوى: تُعرض ولا تُجاب. تعيش داخل مصفوفة الأسئلة نفسها كي ترث
 * التنقّل والجدولة والبثّ بلا مسار موازٍ، لكنها تُستثنى من كل ما يخصّ
 * التقييم: لا علامة، ولا نسبة مشاركة، ولا وسام، ولا سطر في التقرير.
 */
const CONTENT_TYPES = new Set(['slide']);

/**
 * أنواع تُصحَّح آلياً بعلامة جزئية: الطالب الذي رتّب ثلاثة من أربعة صحيحاً
 * ليس كمن أخطأ كلها. النسبة تضرب في علامة السؤال.
 */
const PARTIAL_TYPES = new Set(['order', 'match']);
/** علامة الفراغ في نص سؤال «أكمل الفراغ»: ثلاث شرطات سفلية فأكثر */
const BLANK_RE = /_{3,}/g;
const MAX_BLANKS = 8;
/** مهلة «استعد… ٣ ٢ ١» قبل فتح السؤال المؤقّت — تبقي الجميع على نفس الخط */
const READY_MS = 3200;
/** تفاعلات سريعة يرسلها المشاركون أثناء العرض */
const REACTIONS = ['👏', '🔥', '😂', '😮', '❤️', '🤔'];
const REACTION_COOLDOWN_MS = 600;
/** أوضاع التقدّم بين الأسئلة */
const PACES = ['host', 'auto', 'self'];
/** طرق احتساب النقاط */
const SCORING_MODES = ['speed', 'flat', 'none'];

/**
 * نظام التقييم — اختيارٌ واحد لا خليط.
 *
 * points — لعبة: نقاط بالسرعة وسلسلة وترتيب وأوسمة.
 * marks  — تقييم: علامة من مجموع يحدّده المعلّم، وتقدير، ونسبة نجاح.
 * none   — بلا تقييم: استطلاعات وعصف ذهني.
 *
 * جمعُ النظامين معاً يربك الطالب («عندي ٤٦٠٠ نقطة و٢٤ من ٣٠… أيهما نتيجتي؟»)
 * ويربك المعلّم في تقريره. فالمعلّم يختار غرضه، والمنصة تعرض ما يخدمه وحده.
 */
const REWARD_MODES = ['points', 'marks', 'none'];
/**
 * توزيع العلامة على الأسئلة في وضع العلامات:
 * equal  — العلامة الكاملة ÷ عدد الأسئلة المحتسبة (٣٠ على ١٠ أسئلة = ٣ لكل سؤال)
 * custom — المعلّم يحدّد علامة كل سؤال، ومجموعها يجب أن يساوي العلامة الكاملة
 */
const MARK_MODES = ['equal', 'custom'];
/**
 * النافذة الزمنية للإجابة — وضعان لا ثلاثة:
 * none — بلا وقت (الافتراضي)
 * all  — ثوانٍ واحدة تسري على كل الأسئلة
 *
 * ولا مؤقّت لكل سؤال على حدة: كان يُثقل المحرّر برقمٍ تحت كل سؤال مقابل
 * فائدةٍ نادرة، والاختبار الذي يحتاج وقتاً يحتاجه لأسئلته كلها.
 */
const TIME_MODES = ['none', 'all'];
/** مضاعف السلسلة: ١٠٪ لكل إجابة صحيحة متتالية بحد أقصى ٥٠٪ */
/** الأنواع التي تُحتسب لها نقاط (لها إجابة صحيحة) */
const SCORED_TYPES = new Set(['mc', 'truefalse']);
/** فرق افتراضية — نفس الألوان الثمانية المستخدمة أصلاً لخيارات الأسئلة (c0..c7) لتناسق بصري كامل */
const TEAMS = [
  { name: 'الفريق الوردي', emoji: '🩷' },
  { name: 'الفريق الأزرق', emoji: '🔵' },
  { name: 'الفريق الأصفر', emoji: '🟡' },
  { name: 'الفريق الأخضر', emoji: '🟢' },
  { name: 'الفريق البنفسجي', emoji: '🟣' },
  { name: 'الفريق البرتقالي', emoji: '🟠' },
  { name: 'الفريق الفيروزي', emoji: '🩵' },
  { name: 'الفريق الأحمر', emoji: '🔴' },
];
/** الأنواع التي لا تُظهر هوية المشارك في النتائج */
const LIMITS = {
  title: 120,
  // عناصر الترتيب وأزواج المطابقة
  items: 8,
  pairs: 8,
  itemText: 100,
  questionText: 300,
  explanation: 400,
  optionText: 120,
  // نصّ شريحة المحتوى: فقرة شرح لا سؤال، فهي أطول
  slideBody: 1200,
  // قطعة القراءة التي تعلو السؤال — نصٌّ يقرأه الطالب ثم يجيب عمّا تحته
  passage: 2000,
  videoUrl: 300,
  options: 8,
  questions: 60,
  name: 24,
  wordAnswer: 40,
  openAnswer: 300,
  blankAnswer: 60,
  participants: 300,
  // صورة السؤال تُخزَّن كـ data URL داخل السؤال — نحدّها حتى لا تُثقل البث والحفظ
  imageChars: 900000,
};

/** صيغ الصور المقبولة في السؤال */
const IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** يقبل صورة كـ data URL فقط (لا روابط خارجية: نبقي كل شيء داخل الجلسة) */
function cleanImage(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.length > LIMITS.imageChars) {
    const err = new Error('حجم الصورة كبير — اختر صورة أصغر (نضغطها تلقائياً حتى ٦٠٠ كيلوبايت)');
    err.status = 413;
    throw err;
  }
  return IMAGE_RE.test(raw) ? raw : null;
}

function id(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function clean(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/**
 * أقصى مدة اختبار مسموحة (١٢ ساعة) وأبعد موعد جدولة.
 * سقف الجدولة ٢٠ يوماً لا ٩٠: setTimeout يقصّ أي تأخير فوق 2^31-1 ms
 * (≈٢٤.٨ يوماً) إلى ١ms، فكان الاختبار المجدول بعد شهر يفتح فور إنشائه.
 */
const MAX_DURATION_MIN = 720;
// سقف العلامة الكاملة — يتّسع لأي نظام مدرسي (من ١٠ إلى ١٠٠٠) بلا أرقام عبثية
const MAX_TOTAL_MARK = 1000;
const MAX_SCHEDULE_AHEAD_MS = 20 * 86400000;

/** موعد مستقبلي صالح أو null — نتسامح مع النص ISO كما يرسله المتصفح */
function futureStamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const now = Date.now();
  // موعد مضى (أكثر من دقيقة) لا معنى له، والبعيد جداً غالباً خطأ إدخال
  if (ms < now - 60000 || ms > now + MAX_SCHEDULE_AHEAD_MS) return null;
  return Math.round(ms);
}

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * مثل clamp لكن بمنزلتين عشريتين. العلامات تحتاجها: «٣٠ على ٤ أسئلة» = ٧٫٥
 * لكل سؤال، والتقريب إلى صحيحٍ يجعل مجموع الأسئلة يخالف العلامة الكاملة.
 */
function clampDecimal(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v * 100) / 100));
}

/** تحويل سؤال قادم من العميل إلى شكل آمن ومُتحقق منه. */
/**
 * معرّف فيديو يوتيوب من أي صيغة رابط يلصقها المعلّم.
 *
 * نخزّن المعرّف لا الرابط عمداً: الرابط الخام قد يحمل معاملات تتبّع أو يكون
 * لموقع آخر كلياً، وتضمينه كما هو يفتح باب حقن إطار من نطاق مجهول. والمعرّف
 * أحد عشر محرفاً من مجموعة معروفة — لا شيء آخر يمرّ.
 */
function cleanVideo(value) {
  const raw = clean(value, LIMITS.videoUrl);
  if (!raw) return null;
  // معرّف مباشر
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const patterns = [
    /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com|youtube-nocookie\.com)\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = re.exec(raw);
    if (m) return m[1];
  }
  return null;
}

const t2 = (x) => x;

/**
 * التقدير من النسبة. الحدود هي المعتمدة في أغلب المدارس العربية، ويترجمها
 * العميل — الخادم يرسل المفتاح لا النصّ كي يبقى النشاط بلغته أياً كان.
 */
function gradeBand(percent) {
  if (percent >= 90) return 'excellent';
  if (percent >= 80) return 'veryGood';
  if (percent >= 70) return 'good';
  if (percent >= 60) return 'fair';
  return 'weak';
}

/** نسخة من اللوحة بلا أسماء المصوّتين — لكل متلقٍّ غير المدرب نفسه */
function withoutVoters(data) {
  return { ...data, perQuestion: data.perQuestion.map((q) => (q.voters ? { ...q, voters: null } : q)) };
}

function normalizeQuestion(raw, index) {
  const type = QUESTION_TYPES.includes(raw?.type) ? raw.type : 'mc';
  const q = {
    id: clean(raw?.id, 40) || id('q_'),
    type,
    text: clean(raw?.text, LIMITS.questionText) || `سؤال ${index + 1}`,
    // شرح أو سبب يظهر مع الإجابة الصحيحة (اختياري)
    explanation: clean(raw?.explanation, LIMITS.explanation),
    /**
     * مؤقّت السؤال الواحد لم يعد موجوداً: الوقت — إن وُضع — واحدٌ لكل
     * الأسئلة في `settings.timeMode`. يبقى الحقل ليُقرأ من نشاطٍ قديم
     * (يستنتج منه `inferLegacyTime` وضعاً موحّداً) لا ليُولَّد افتراضياً.
     *
     * وكان افتراضه ٣٠ ثانية، فكان كل نشاطٍ يُطلَق بلا `timeMode` صريح —
     * وارداً من المكتبة أو من المساعد — يُستنتج منه مؤقّتٌ لم يطلبه أحد،
     * والافتراضي المُعلَن «بلا وقت».
     */
    timeLimit: clamp(raw?.timeLimit, 0, 600, 0),
    // علامة السؤال — يضعها المدرب بحرية
    points: clamp(raw?.points, 0, 10000, 1000),
    options: [],
    correct: [],
    scale: null,
    // الإجابات المتوقعة لفراغات سؤال «أكمل الفراغ»
    blanks: [],
    // عناصر سؤال «رتّب» بترتيبها الصحيح كما كتبها المدرب
    items: [],
    // أزواج سؤال «طابِق»: كل زوج {id, left, right}
    pairs: [],
    // نصّ شريحة المحتوى تحت العنوان
    body: '',
    /**
     * قطعة قراءة اختيارية تعلو السؤال وتبقى ظاهرةً أثناء الإجابة.
     *
     * حقلٌ لا نوعٌ مستقل: المعلّم يطلب «اقرأ ثم أجب» باختيارٍ من متعدد أو
     * صح/خطأ أو إجابةٍ مفتوحة — فلو جعلناها نوعاً لاحتاج قرارين بدل قرار،
     * ولاحتاج كلُّ منطق التصحيح نسخةً ثانية. وشريحةُ العرض تستثنى: نصّها
     * هو `body` وليس تحته سؤالٌ أصلاً.
     */
    passage: type === 'slide' ? '' : clean(raw?.passage, LIMITS.passage),
    // صورة توضيحية اختيارية تظهر فوق نص السؤال
    image: cleanImage(raw?.image),
    // فيديو يوتيوب اختياري — نخزّن المعرّف لا الرابط، فيُبنى التضمين عندنا
    video: cleanVideo(raw?.video),
  };

  if (type === 'mc' || type === 'poll') {
    const options = Array.isArray(raw?.options) ? raw.options.slice(0, LIMITS.options) : [];
    q.options = options
      .map((o, i) => ({
        id: clean(o?.id, 40) || `o${i}`,
        text: clean(typeof o === 'string' ? o : o?.text, LIMITS.optionText),
      }))
      .filter((o) => o.text.length > 0);
    if (q.options.length < 2) {
      q.options = [
        { id: 'o0', text: 'الخيار الأول' },
        { id: 'o1', text: 'الخيار الثاني' },
      ];
    }
  } else if (type === 'truefalse') {
    q.options = [
      { id: 'true', text: 'صحيح' },
      { id: 'false', text: 'خطأ' },
    ];
  } else if (type === 'slide') {
    q.body = clean(raw?.body, LIMITS.slideBody);
    q.points = 0;
    q.timeLimit = raw?.timeLimit === 0 || raw?.timeLimit == null ? 0 : clamp(raw.timeLimit, 5, 600, 0);
  } else if (type === 'order') {
    // الترتيب الصحيح هو ترتيب الإدخال؛ يُخلط عند العرض على الطالب
    const items = Array.isArray(raw?.items) ? raw.items.slice(0, LIMITS.items) : [];
    q.items = items
      .map((it, i) => ({ id: clean(it?.id, 40) || `i${i}`, text: clean(typeof it === 'string' ? it : it?.text, LIMITS.itemText) }))
      .filter((it) => it.text.length > 0);
    if (q.items.length < 2) {
      q.items = [
        { id: 'i0', text: 'العنصر الأول' },
        { id: 'i1', text: 'العنصر الثاني' },
      ];
    }
  } else if (type === 'match') {
    const pairs = Array.isArray(raw?.pairs) ? raw.pairs.slice(0, LIMITS.pairs) : [];
    q.pairs = pairs
      .map((pr, i) => ({
        id: clean(pr?.id, 40) || `p${i}`,
        left: clean(pr?.left, LIMITS.itemText),
        right: clean(pr?.right, LIMITS.itemText),
      }))
      .filter((pr) => pr.left.length > 0 && pr.right.length > 0);
    if (q.pairs.length < 2) {
      q.pairs = [
        { id: 'p0', left: 'الطرف الأول', right: 'ما يقابله' },
        { id: 'p1', left: 'الطرف الثاني', right: 'ما يقابله' },
      ];
    }
  } else if (type === 'scale') {
    const min = clamp(raw?.scale?.min, 0, 10, 1);
    const max = clamp(raw?.scale?.max, min + 1, 10, Math.max(min + 1, 5));
    q.scale = {
      min,
      max,
      minLabel: clean(raw?.scale?.minLabel, 40) || 'غير موافق',
      maxLabel: clean(raw?.scale?.maxLabel, 40) || 'موافق تماماً',
    };
  }

  if (SCORED_TYPES.has(type)) {
    const ids = new Set(q.options.map((o) => o.id));
    const correct = Array.isArray(raw?.correct) ? raw.correct : raw?.correct != null ? [raw.correct] : [];
    q.correct = [...new Set(correct.map((c) => clean(c, 40)).filter((c) => ids.has(c)))];
    // سؤال بلا إجابة صحيحة يتحول عملياً إلى استطلاع (بلا نقاط)
  } else if (type === 'blank') {
    // عدد الفراغات من النص نفسه، والإجابات المتوقعة تساعد المدرب أثناء التصحيح
    const count = Math.min(MAX_BLANKS, (q.text.match(BLANK_RE) || []).length);
    const expected = Array.isArray(raw?.blanks) ? raw.blanks : [];
    q.blanks = Array.from({ length: count }, (_, i) => clean(expected[i], LIMITS.blankAnswer));
    // العلامة الافتراضية = علامة لكل فراغ، والمدرب يعدّلها كما يشاء
    q.points = raw?.points == null ? Math.max(1, count) : clamp(raw.points, 0, 1000, Math.max(1, count));
  } else if (CONTENT_TYPES.has(type)) {
    q.points = 0;
  } else if (PARTIAL_TYPES.has(type)) {
    // مصحَّحان آلياً بعلامة جزئية — الافتراضي كعلامة الاختيار من متعدد
    q.points = clamp(raw?.points, 0, 10000, 1000);
  } else if (type === 'open') {
    // السؤال المفتوح: علامة صفر = رأي حرّ، وعلامة أكبر من صفر = يصحّحه المدرب يدوياً
    q.points = raw?.points == null ? 0 : clamp(raw.points, 0, 1000, 0);
  } else {
    q.points = 0;
  }

  /**
   * علامة السؤال بوحدات العلامة (لا النقاط). تُستعمل في وضع العلامات حين
   * يختار المعلّم توزيعاً مخصّصاً؛ وفي التوزيع بالتساوي تُشتقّ ولا تُقرأ.
   */
  q.mark = clampDecimal(raw?.mark, 0, MAX_TOTAL_MARK, 0);

  // تصحيح يدوي: المدرب يمنح علامة كاملة أو جزئية بعد قراءة النص
  q.manual = (type === 'open' || type === 'blank') && q.points > 0;

  return q;
}

function normalizeQuiz(payload) {
  const rawQuestions = Array.isArray(payload?.questions) ? payload.questions.slice(0, LIMITS.questions) : [];
  const questions = rawQuestions.map(normalizeQuestion);
  if (questions.length === 0) {
    throw Object.assign(new Error('أضف سؤالاً واحداً على الأقل'), { status: 400 });
  }
  // ضمان تفرّد المعرفات
  const seen = new Set();
  for (const q of questions) {
    while (seen.has(q.id)) q.id = id('q_');
    seen.add(q.id);
  }
  const settings = normalizeSettings(payload?.settings, questions);
  return {
    title: clean(payload?.title, LIMITS.title) || 'نشاط تفاعلي',
    questions,
    settings,
  };
}

/**
 * الإعدادات، ومحورها اختيار واحد: نقاط أم علامات أم لا شيء.
 *
 * والحقول التابعة تُشتقّ منه لا تُترك للمستخدم: نشاطُ علاماتٍ فيه مضاعف
 * سلسلة يُنتج علامةً تتجاوز سقفها، ونشاطُ نقاطٍ فيه علامة كاملة يُظهر
 * رقمين متنافسين على معنى «نتيجتي». فنحسم التبعية هنا مرة واحدة.
 */
/**
 * نشاطٌ أُنشئ قبل وجود `timeMode` يحمل مؤقّتاً تحت كل سؤال. إسقاطه صامتاً
 * يعني اختباراً مؤقّتاً صار بلا وقت بلا أن يدري صاحبه، فنستنتج منه وضعاً
 * موحّداً — وبأطول مهلةٍ كانت فيه، كي لا يُقصَّر على طالبٍ وقتُه.
 */
function inferLegacyTime(questions) {
  const times = (questions || []).map((q) => Number(q?.timeLimit) || 0).filter((n) => n > 0);
  if (!times.length) return { mode: 'none', seconds: 30 };
  return { mode: 'all', seconds: Math.max(...times) };
}

function normalizeSettings(raw, questions) {
    const legacyTime = inferLegacyTime(questions);
    const scoring = SCORING_MODES.includes(raw?.scoring) ? raw.scoring : 'speed';
    const totalMarkRaw = clamp(raw?.totalMark, 0, MAX_TOTAL_MARK, 0);
    // توافق مع نشاط قديم لا يعرف «reward»: نستنتجه من إعداداته كما كانت
    const reward = REWARD_MODES.includes(raw?.reward)
      ? raw.reward
      : totalMarkRaw > 0
        ? 'marks'
        : scoring === 'none'
          ? 'none'
          : 'points';
    const marks = reward === 'marks';
    return {
      // عندما يكون false يدخل المشاركون دون اسم (وضع الاستطلاع المجهول)
      requireName: raw?.requireName !== false,
      allowLateJoin: raw?.allowLateJoin !== false,
      /**
       * ما يراه الطالب على جهازه — ثلاثة مفاتيح مستقلّة:
       * revealAnswer  — الإجابة الصحيحة وشرحها وصحّة إجابته (أدناه)
       * showScore     — نتيجته هو: نقاطه أو علامته، ترتيبه، أوسمته
       * showOthers    — الآخرون: عددهم، لوحة الترتيب، نتائج الصف على سؤال
       * واللوحة تابعةٌ للآخرين: من أخفى الآخرين أخفى لوحتهم.
       */
      showScore: raw?.showScore !== false,
      showOthers: raw?.showOthers !== false,
      showLeaderboard: raw?.showLeaderboard !== false && raw?.showOthers !== false,
      // عدّاد «استعد» قبل الأسئلة المؤقتة
      countdown: raw?.countdown !== false,

      /**
       * وضع التقدّم بين الأسئلة:
       * host — المدرب ينقل الشرائح بنفسه (الافتراضي)
       * auto — الجميع معاً، والانتقال تلقائي بعد عرض النتائج
       * self — كل متدرب يتقدّم بسرعته الخاصة
       */
      /**
       * الافتراضي «حرّ»: الطالب يدخل فيبدأ فوراً ويتقدّم بنفسه. أكثر
       * استعمالات المنصة واجبٌ يُرسَل برابط، لا صفٌّ أمام بروجكتر — ومن
       * أراد أن يقود الشرائح بنفسه يختار «المدرب ينقل الأسئلة».
       */
      pace: PACES.includes(raw?.pace) ? raw.pace : 'self',
      autoAdvanceSec: clamp(raw?.autoAdvanceSec, 2, 60, 6),
      // الوضع الحر: يبدأ المتدرب فور دخوله بلا انتظار المدرب
      autoStart: raw?.autoStart !== false,
      /**
       * الوضع الحرّ: بمجرّد أن يجيب ينتقل إلى السؤال التالي بلا ضغطة زرّ.
       * تُعرض له نتيجته لحظةً أولاً إن كان كشف الإجابة مفعّلاً — لحظةٌ
       * تكفي لقراءة «صحيحة» ولا تكفي لكسر التدفّق — ويستطيع تعجيلها بالزرّ.
       */
      autoNext: raw?.autoNext !== false,

      /**
       * احتساب النقاط:
       * speed — كاملة للأسرع وتتناقص حتى النصف (الافتراضي)
       * flat  — نقاط ثابتة لكل إجابة صحيحة
       * none  — بلا نقاط ولا ترتيب
       */
      reward,
      // في وضع العلامات: نقاط ثابتة داخلياً كي يوافق الترتيبُ العلامةَ،
      // وفي «بلا تقييم» لا نقاط أصلاً
      scoring: marks ? 'flat' : reward === 'none' ? 'none' : scoring,
      // إظهار الإجابة الصحيحة وشرحها للمتدرب فور إجابته
      revealAnswer: raw?.revealAnswer !== false,
      // نزاهة الاختبار: خلط ترتيب الأسئلة مرة عند الإطلاق،
      // وخلط الخيارات لكل طالب على حدة فلا يُجدي النظر في شاشة الجار
      shuffleQuestions: raw?.shuffleQuestions === true,
      shuffleOptions: raw?.shuffleOptions === true,

      // وضع الفرق: يُقسَّم المشاركون تلقائياً إلى فرق ملوّنة، ونقاطهم تُجمع لترتيب جماعي
      teamMode: raw?.teamMode === true,
      teamCount: clamp(raw?.teamCount, 2, TEAMS.length, 4),

      /**
       * الجدولة: موعد فتح الاختبار (بالمللي ثانية) — الجلسة تبقى في القاعة
       * حتى يحين، ثم تبدأ وحدها. ماضٍ أو غير صالح = بدء يدوي كالمعتاد.
       */
      /**
       * لغة النشاط: يضبطها منشئه، وتفرضها شاشات الطالب والبروجكتر على نفسها
       * كي يرى الطالب النشاط بلغة معلّمه لا بلغة متصفحه.
       * null = غير محدّدة (جلسة أُنشئت عبر API قديم) فتبقى لغة المتصفح.
       */
      lang: raw?.lang === 'en' || raw?.lang === 'ar' ? raw.lang : null,

      /**
       * النافذة الزمنية. الافتراضي «بلا وقت»: أكثر استعمالات المنصة واجبٌ
       * يُحلّ على مهل، والمؤقّت قرارٌ يتّخذه المعلّم لا شيء يقع عليه.
       * والاستنتاج أدناه يحفظ أنشطةً قديمة كانت مؤقّتة قبل هذا الوضع.
       */
      timeMode: TIME_MODES.includes(raw?.timeMode) ? raw.timeMode : legacyTime.mode,
      // ثوانٍ واحدة لكل الأسئلة حين يكون timeMode = all
      timeLimit: clamp(raw?.timeLimit, 5, 600, legacyTime.seconds),
      opensAt: futureStamp(raw?.opensAt),
      // مدة الاختبار كاملاً بالدقائق — عند انتهائها يُقفل تلقائياً (صفر = بلا حدّ)
      durationMinutes: clamp(raw?.durationMinutes, 0, MAX_DURATION_MIN, 0),

      /**
       * آخر موعد للتسليم — وهو ما يجعل الرابط **واجباً** لا جلسةً حيّة.
       *
       * المنصة تصف نفسها بأن أكثر استعمالاتها «واجبٌ يُرسَل برابط»، ثم
       * تُسقط الجلسة بعد ثلاث ساعات خمول. فمعلّمٌ يرسل واجب نهاية الأسبوع
       * ليل الخميس يجد رابطه ميتاً صباح السبت، وطلابُه يظنون أنهم أخطؤوا.
       *
       * والفرق عن `durationMinutes` جوهري لا تجميلي: تلك مهلةٌ تبدأ من لحظة
       * انطلاق الجلسة — تصلح لحصةٍ في قاعة — وهذا **موعدٌ مطلق** لا علاقة
       * له بمتى فتح أولُ طالبٍ الرابط، وهو ما يعنيه «سلّموا قبل الأحد».
       */
      dueAt: futureStamp(raw?.dueAt),

      /**
       * كشفُ الأسماء المرفق بالنشاط — **نسخةٌ** من فصل المعلّم لا إشارةٌ إليه.
       *
       * ولها سببان: أن يختار الطالب اسمه من قائمة فتتّحد كتابته بين الحصص
       * (لا «احمد» و«أحمد» صفَّين في التقرير)، وأن يرى المعلّم من لم يدخل بعد.
       * وهي **دليلٌ لا بوّابة**: من لم يجد اسمه يكتبه ويدخل — طالبٌ جديد أو
       * زائرٌ لا يجوز أن يُمنع من الحصة لأن قائمةً لم تُحدَّث.
       */
      roster: Array.isArray(raw?.roster)
        ? [...new Set(raw.roster.map((n) => clean(n, LIMITS.name)).filter(Boolean))].slice(0, LIMITS.participants)
        : [],

      /**
       * سجلّ الطلاب: معرّف الفصل الذي **شغّل معلّمه السجل** ونُسخ كشفه أعلاه.
       *
       * وهذا هو الاستثناء الوحيد لقاعدة «الكشف نسخةٌ لا إشارة»: النتيجة تُكتب
       * في ملفّ الطالب على هذا الفصل بعينه، فلا بدّ من معرّفه. null = لا يُكتب
       * شيء، وهو الأصل. (انظر records.js)
       */
      recordClassId: /^cl_[\w-]{4,40}$/.test(String(raw?.recordClassId || '')) ? String(raw.recordClassId) : null,

      /**
       * العلامة الكاملة للنشاط: «هذا الاختبار من ٣٠». صفر = بلا علامة.
       *
       * وهي شيء آخر غير النقاط: النقاط لعبةٌ تكافئ السرعة والسلسلة، والعلامة
       * سجلٌّ رسمي يذهب إلى دفتر المعلّم — فتُحسب من نسبة الإتقان وحدها،
       * لا من الثواني. طالبان أجابا الإجابات نفسها يأخذان العلامة نفسها
       * وإن سبق أحدهما الآخر، وإلا لصار المرء يُقيَّم على سرعة إصبعه.
       */
      // علامةٌ افتراضية معقولة لمن اختار وضع العلامات ولم يحدّد رقماً
      totalMark: marks ? totalMarkRaw || 20 : 0,
      // التوزيع بالتساوي هو الافتراضي: أكثر الاختبارات كذلك، ولا يطلب من المعلّم شيئاً
      markMode: marks && MARK_MODES.includes(raw?.markMode) ? raw.markMode : 'equal',
      // نسبة النجاح المئوية — يُبنى عليها «نجح/راسب» في التقرير
      passPercent: clamp(raw?.passPercent, 1, 100, 50),
    };
}

class Session {
  constructor(code, payload) {
    const quiz = normalizeQuiz(payload);
    this.code = code;
    this.hostToken = token();
    this.title = quiz.title;
    this.questions = quiz.questions;
    this.settings = quiz.settings;

    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.ownerId = null;
    this.ownerName = null;
    this.startedAt = null;
    this.endedAt = null;

    this.status = 'lobby'; // lobby | live | ended
    this.phase = 'lobby'; // lobby | question | results | leaderboard | final
    this.currentIndex = -1;
    this.questionOpensAt = null; // متى تُقبل الإجابات (بعد عدّاد «استعد»)
    this.questionStartedAt = null;
    this.questionEndsAt = null;
    this.locked = false;
    this._timer = null;
    this._autoTimer = null;
    this._autoAt = null;
    // مؤقّت فتح الاختبار في موعده، ومؤقّت إقفاله بعد انتهاء مدته
    this._openTimer = null;
    this._deadlineTimer = null;
    this.deadlineAt = null;

    /** @type {Map<string, any>} */
    this.participants = new Map();
    /** @type {Set<any>} sockets للمضيف */
    this.hostSockets = new Set();
    /** @type {Set<any>} سوكِتات شاشة العرض المنفصلة (بروجكتر) — قراءة فقط، بلا أزرار تحكم */
    this.screenSockets = new Set();

    // فرق ثابتة العدد تُنشأ مرة واحدة عند إنشاء الجلسة — التوزيع يتم عند انضمام كل مشارك
    this.rebuildTeams();

    this.armSchedule();
  }

  /** الفرق من الإعدادات — تُستدعى عند الإنشاء وعند تعديل الإعدادات قبل البدء */
  rebuildTeams() {
    this.teams = this.settings.teamMode
      ? TEAMS.slice(0, this.settings.teamCount).map((t, i) => ({ id: i, name: t.name, emoji: t.emoji }))
      : null;
  }

  /**
   * تعديلُ النشاط قبل بدئه: العنوان والأسئلة والإعدادات معاً.
   *
   * كان المسار يبدّل الحقول الثلاثة ويكتفي، فيبقى مؤقّتُ الموعد القديم مسلّحاً
   * على موعدٍ لم يعد موجوداً (أو لا يُسلَّح موعدٌ جديد أصلاً)، وتبقى الفرق
   * بعددها القديم فتُوزَّع على فرقٍ لا وجود لها. فكلُّ ما يُشتقّ من الإعدادات
   * يُعاد اشتقاقه هنا.
   */
  applyEdit(quiz) {
    this.title = quiz.title;
    this.questions = quiz.questions;
    this.settings = quiz.settings;
    this.rebuildTeams();
    for (const p of this.participants.values()) p.teamId = this.teams ? this.smallestTeam() : null;
    this.armSchedule();
    this.touch();
  }

  /** يضبط مؤقّت الفتح التلقائي إن كان للاختبار موعد */
  armSchedule() {
    if (this._openTimer) clearTimeout(this._openTimer);
    this._openTimer = null;
    const at = this.settings.opensAt;
    if (!at || this.status !== 'lobby') return;
    const delay = Math.max(0, at - Date.now());
    this._openTimer = setTimeout(() => {
      this._openTimer = null;
      if (this.status !== 'lobby') return;
      this.start();
      this.broadcastState();
    }, delay);
    this._openTimer.unref?.();
  }

  /**
   * يضبط مؤقّت الإقفال التلقائي. مصدران للموعد وأيّهما أقرب يُقفل:
   *  - `durationMinutes`: مهلةٌ **نسبية** تبدأ من انطلاق الجلسة — حصةٌ في قاعة.
   *  - `dueAt`: موعدٌ **مطلق** لا علاقة له بمتى بدأت — «سلّموا قبل الأحد».
   * وجمعُهما بـ`min` هو الصواب: من وضع الاثنين يقصد «ساعةٌ لكل طالب، على
   * ألّا يتجاوز أحدٌ الأحد» — لا أن يُلغي أحدهما الآخر.
   */
  armDeadline() {
    if (this._deadlineTimer) clearTimeout(this._deadlineTimer);
    this._deadlineTimer = null;
    if (this.status !== 'live') {
      this.deadlineAt = null;
      return;
    }
    const byDuration = this.settings.durationMinutes
      ? (this.startedAt || Date.now()) + this.settings.durationMinutes * 60000
      : null;
    const byDue = this.settings.dueAt || null;
    this.deadlineAt = byDuration && byDue ? Math.min(byDuration, byDue) : byDuration || byDue;
    if (!this.deadlineAt) return;
    const delay = Math.max(0, this.deadlineAt - Date.now());
    this._deadlineTimer = setTimeout(() => {
      this._deadlineTimer = null;
      if (this.status !== 'live') return;
      // انتهى وقت الاختبار: نُقفله للجميع كما لو ضغط المدرب «إنهاء»
      this.finish();
      this.broadcastState();
    }, delay);
    this._deadlineTimer.unref?.();
  }

  touch() {
    this.lastActivity = Date.now();
    // خطّاف يضعه المخزن ليحفظ هيكل الجلسة عند تغيّره — لا يعرف عنه هذا الملف شيئاً
    this.onChange?.();
  }

  // ------------------------------------------------- البقاء بعد إعادة التشغيل

  /**
   * لقطة تكفي لإحياء الجلسة بعد إعادة تشغيل الخادم — **بلا مشارك ولا إجابة**.
   *
   * وهذا ليس نقصاً في اللقطة بل هو وعد المنصة: إجابات الطلاب لا تُكتب على
   * قرص أبداً. ما يستحقّ النجاة هو ما لو ضاع بقي المعلّم بلا حيلة: الرمز
   * الذي وزّعه، وموعد اختباره المجدول، وأسئلته. أما ما أجابه الطلاب في
   * الدقائق الماضية فيضيع، ونقول ذلك للمعلّم صراحةً بدل أن نخفيه.
   */
  snapshot() {
    return {
      code: this.code,
      hostToken: this.hostToken,
      ownerId: this.ownerId,
      ownerName: this.ownerName,
      title: this.title,
      // الأسئلة كما هي الآن: لو خُلطت عند الإطلاق حُفظ الترتيب المخلوط
      questions: this.questions,
      settings: this.settings,
      shuffled: Boolean(this._shuffled),
      status: this.status,
      currentIndex: this.currentIndex,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      lastActivity: this.lastActivity,
      teams: this.teams,
    };
  }

  /** يبني جلسةً من لقطة. المشاركون يبدأون فارغين — لا سبيل غير ذلك. */
  static restore(snap) {
    const session = new Session(snap.code, { title: snap.title, questions: snap.questions, settings: snap.settings });
    session.hostToken = snap.hostToken || session.hostToken;
    session.ownerId = snap.ownerId ?? null;
    session.ownerName = snap.ownerName ?? null;
    session.createdAt = Number(snap.createdAt) || Date.now();
    // عمرٌ كامل بعد الإحياء: لا نُعاقب الجلسة بخمولٍ سببه توقّف الخادم
    session.lastActivity = Date.now();
    session._shuffled = Boolean(snap.shuffled);
    if (snap.teams) session.teams = snap.teams;
    /** علامةٌ يقرأها المضيف ليعرف أن ما قبل إعادة التشغيل لم يُحفظ */
    session.restored = true;

    // موعدٌ حلّ أثناء توقّف الخادم يبقى موعداً: `futureStamp` يمسح الماضي،
    // وبمسحه يعلق اختبارٌ مجدول في الانتظار إلى الأبد. نعيده ثم نُسلّح
    // المؤقّت — ومهلته صفر فينطلق فوراً، وهو ما كان سيحدث لولا الانقطاع.
    session.settings.opensAt = snap.settings?.opensAt ?? null;
    // وموعد التسليم كذلك: لو مضى أثناء التوقّف أُقفل الواجب فور الإحياء،
    // ولو مسحناه لبقي مفتوحاً بعد موعده يستقبل تسليماتٍ متأخرة بلا علم أحد
    session.settings.dueAt = snap.settings?.dueAt ?? null;

    if (snap.status === 'live') {
      session.status = 'live';
      session.startedAt = Number(snap.startedAt) || Date.now();
      session.armDeadline();
      if (session.settings.pace === 'self') {
        session.currentIndex = 0;
        session.phase = 'self';
      } else {
        // نعيد عرض السؤال الذي كان معروضاً؛ مؤقّته يبدأ من جديد لأن أحداً
        // لم يكن يجيب أثناء الانقطاع أصلاً
        session.goTo(Math.min(Math.max(0, Number(snap.currentIndex) || 0), session.questions.length - 1));
      }
    } else {
      session.armSchedule();
    }
    // واجبٌ مضى موعده أثناء التوقّف يُقفل فوراً: إحياؤه مفتوحاً يعني قبول
    // تسليماتٍ متأخرة بلا علم المعلّم، وهو أسوأ من ضياع الجلسة
    if (session.settings.dueAt && Date.now() >= session.settings.dueAt && session.status !== 'ended') session.finish();
    return session;
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (this._openTimer) clearTimeout(this._openTimer);
    this._openTimer = null;
    if (this._deadlineTimer) clearTimeout(this._deadlineTimer);
    this._deadlineTimer = null;
    this.clearAuto();
    for (const socket of this.allSockets()) {
      try {
        socket.close(4000, 'session closed');
      } catch {
        /* تجاهل */
      }
    }
  }

  // ---------------------------------------------------------------- المشاركون

  /** مفتاح المطابقة: يتجاهل الفروق التي لا يقصدها أحد (مسافات، حالة الأحرف) */
  static nameKey(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();
  }

  /** هل هذا الاسم داخلٌ بالفعل؟ — الحارس الثاني ضدّ الدخول مرّتين */
  hasName(name) {
    const key = Session.nameKey(name);
    if (!key) return false;
    for (const p of this.participants.values()) {
      if (Session.nameKey(p.name) === key) return true;
    }
    return false;
  }

  addParticipant({ name, avatar }) {
    if (this.participants.size >= LIMITS.participants) {
      throw Object.assign(new Error('اكتمل عدد المشاركين في هذه الجلسة'), { status: 429 });
    }
    /**
     * حارسٌ ضدّ الدخول مرّتين بالاسم نفسه.
     *
     * الجهاز يتذكّر مشاركه فيستأنف بدل أن يُنشئ غيره (الحارس الأول، في
     * ‎play.js‎)، لكن جهازاً آخر أو متصفّحاً بلا ذاكرة يفتح الباب لطالبٍ
     * يعيد الاختبار باسمه نفسه ويحتفظ بأفضل نتيجتين، أو يظهر مرّتين في
     * الترتيب. فالاسم المسجَّل لا يُقبل مرّتين.
     *
     * ولا يُقفل على أحد: المعلّم يزيل الاسم من لوحته فيعود صاحبه، ومن
     * يشارك زميلاً اسمه يضيف ما يميّزه. ولا يُطبَّق حين لا تُطلب الأسماء
     * أصلاً — فكلّهم «مشارك مجهول» حينها.
     */
    if (this.settings.requireName && this.hasName(name)) {
      throw Object.assign(new Error('هذا الاسم دخل النشاط بالفعل. اكتب اسماً يميّزك، أو اطلب من معلّمك إزالته من القائمة.'), {
        status: 409,
        code: 'name_taken',
      });
    }
    const participant = {
      id: id('p_'),
      token: token(),
      name: clean(name, LIMITS.name) || 'مشارك',
      avatar: normalizeAvatar(avatar),
      score: 0,
      streak: 0,
      bestStreak: 0,
      firstCount: 0, // كم مرة كان أول من أجاب
      prevRank: null, // ترتيبه قبل السؤال الحالي (لعرض الصعود والهبوط)
      // خاص بوضع «كل متدرب بسرعته»
      index: 0,
      phase: 'question', // question | feedback | done
      openedAt: null,
      endsAt: null,
      finishedAt: null,
      joinedAt: Date.now(),
      connected: true,
      lastReaction: 0,
      sockets: new Set(),
      answers: new Map(), // qid -> { value, at, ms, correct, points }
      // فريقه إن كان وضع الفرق مفعّلاً — يُحسب قبل الإضافة حتى يوازن العدد الحالي
      teamId: this.teams ? this.smallestTeam() : null,
      // ملفّه في سجلّ الفصل إن دخل باسمه ورمزه — يضبطه الخادم بعد التحقّق، لا هنا
      studentId: null,
    };
    this.participants.set(participant.id, participant);

    if (this.settings.pace === 'self') {
      /**
       * الوضع الحر مع البدء التلقائي: أول داخل يُشغّل النشاط — **إلا** أن
       * يكون للنشاط موعدٌ لم يحن بعد.
       *
       * كان يتجاهل الموعد تماماً، فيسقط الغرض من الجدولة كلها: معلّم يضبط
       * «يفتح الأحد التاسعة» ويوزّع الرابط الخميس، فيفتحه أولُ فضوليٍّ
       * ليلتها ويبدأ الاختبار للصفّ كلّه. والبدء المبكّر يبقى حقَّ المعلّم
       * وحده من زرّ «بدء النشاط».
       */
      const waitingForSchedule = this.settings.opensAt && Date.now() < this.settings.opensAt;
      if (this.status === 'lobby' && this.settings.autoStart && !waitingForSchedule) {
        /*
         * `start()` نفسها لا نسخةٌ يدوية منها.
         *
         * كان البدء هنا يقلب الحالة إلى `live` بثلاثة أسطر، فيبقى `startedAt`
         * فارغاً ولا تُسلَّح مهلةُ الإقفال ولا يُطبَّق خلطُ الأسئلة: واجبٌ له
         * موعد تسليم يقبل الإجابات بعد موعده، واختبارٌ من ثلاثين دقيقة لا
         * يُقفل أبداً — وهذا في المبدأ نفسه (حرّ + بدءٌ تلقائي)، أي لأغلب
         * الجلسات. وبعد إعادة النشر كانت تُسلَّح، فيختلف السلوك قبل النشر
         * وبعده. و`start()` تفتح السؤال لكل الحاضرين ومنهم هذا الداخل.
         */
        this.start();
      } else if (this.status === 'live') {
        // من ينضم بعد البدء يجب أن يُفتح له سؤاله فوراً بمؤقّته الخاص
        this.openFor(participant);
      }
    }

    this.touch();
    return participant;
  }

  removeParticipant(pid) {
    const p = this.participants.get(pid);
    if (!p) return;
    this.participants.delete(pid);
    this.touch();
  }

  // ------------------------------------------------------------- سير العرض

  get currentQuestion() {
    return this.questions[this.currentIndex] || null;
  }

  start() {
    // مرة واحدة عند الإطلاق: يمنع أن يعرف طلاب الحصة الثانية ترتيب الأسئلة
    if (this.settings.shuffleQuestions && !this._shuffled && this.questions.length > 1) {
      this.questions = seededShuffle(this.questions, this.code + ':q');
      this._shuffled = true;
    }
    if (this.status === 'ended') return;
    this.status = 'live';
    // لحظة الانطلاق الفعلية — منها تُحسب مدة النشاط في التقارير ومهلة الإقفال
    if (!this.startedAt) this.startedAt = Date.now();
    if (this._openTimer) {
      clearTimeout(this._openTimer);
      this._openTimer = null;
    }
    this.armDeadline();
    if (this.settings.pace === 'self') {
      // كل متدرب يبدأ من سؤاله الأول بسرعته الخاصة
      this.currentIndex = 0;
      this.phase = 'self';
      for (const p of this.participants.values()) this.openFor(p);
      this.touch();
      return;
    }
    this.currentIndex = -1;
    this.next();
  }

  // ------------------------------------------- وضع «كل متدرب بسرعته»

  /** فتح السؤال الحالي لمتدرب واحد */
  openFor(participant) {
    const q = this.questions[participant.index];
    if (!q) {
      participant.phase = 'done';
      participant.finishedAt = participant.finishedAt || Date.now();
      return;
    }
    participant.phase = 'question';
    participant.openedAt = Date.now();
    const secs = this.timeFor(q);
    participant.endsAt = secs ? participant.openedAt + secs * 1000 : null;
  }

  /** انتقال متدرب إلى سؤاله التالي (بعد الإجابة أو انتهاء وقته) */
  advance(participant) {
    if (this.settings.pace !== 'self' || this.status !== 'live') return false;
    if (participant.phase === 'done') return false;
    const q = this.questions[participant.index];
    if (!q) return false;
    const answered = participant.answers.has(q.id);
    const expired = participant.endsAt && Date.now() >= participant.endsAt;
    if (!answered && !expired) return false;
    participant.index += 1;
    this.openFor(participant);
    this.touch();
    return true;
  }

  /** هل أنهى الجميع في الوضع الحر؟ */
  allFinished() {
    if (this.settings.pace !== 'self' || this.participants.size === 0) return false;
    return [...this.participants.values()].every((p) => p.phase === 'done');
  }

  next() {
    if (this.status === 'ended') return;
    if (this.currentIndex + 1 >= this.questions.length) {
      this.finish();
      return;
    }
    this.currentIndex += 1;
    this.openQuestion();
  }

  prev() {
    if (this.currentIndex <= 0) return;
    this.currentIndex -= 1;
    this.openQuestion();
  }

  goTo(index) {
    // NaN يمرّ من كل مقارنة، وكان يضبط currentIndex على NaN فتموت الجلسة
    if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    this.openQuestion();
  }

  openQuestion() {
    const q = this.currentQuestion;
    if (!q) return;
    this.status = 'live';
    this.phase = 'question';
    this.locked = false;
    this.clearAuto();
    // لقطة للترتيب قبل السؤال حتى نُظهر الصعود والهبوط بعده
    const board = this.leaderboard(LIMITS.participants);
    for (const p of this.participants.values()) {
      p.prevRank = board.find((entry) => entry.id === p.id)?.rank ?? null;
    }
    // الأسئلة المؤقتة تبدأ بعد عدّاد قصير حتى ينطلق الجميع معاً
    const secs = this.timeFor(q);
    const ready = secs && this.settings.countdown ? READY_MS : 0;
    this.questionOpensAt = Date.now() + ready;
    this.questionStartedAt = this.questionOpensAt;
    this.questionEndsAt = secs ? this.questionOpensAt + secs * 1000 : null;
    this.armTimer();
    this.touch();
  }

  /** هل انتهى عدّاد «استعد»؟ */
  isOpen() {
    return !this.questionOpensAt || Date.now() >= this.questionOpensAt;
  }

  armTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (!this.questionEndsAt) return;
    const delay = Math.max(0, this.questionEndsAt - Date.now()) + 250;
    this._timer = setTimeout(() => {
      if (this.phase === 'question') {
        this.showResults();
        this.broadcastState();
      }
    }, delay);
    this._timer.unref?.();
  }

  /** إغلاق استقبال الإجابات دون كشف النتيجة */
  lock() {
    if (this.phase !== 'question') return;
    this.locked = true;
    this.questionEndsAt = Date.now();
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.touch();
  }

  showResults() {
    this.locked = true;
    this.phase = 'results';
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.scheduleAuto(() => {
      // في الوضع التلقائي: النتائج ← (الترتيب) ← السؤال التالي
      if (this.settings.showLeaderboard && this.hasScoredQuestions()) this.showLeaderboard();
      else this.next();
    });
    this.touch();
  }

  showLeaderboard() {
    this.locked = true;
    this.phase = 'leaderboard';
    this.scheduleAuto(() => this.next());
    this.touch();
  }

  /** مؤقّت الانتقال التلقائي (وضع auto فقط) */
  scheduleAuto(action) {
    this.clearAuto();
    if (this.settings.pace !== 'auto' || this.status !== 'live') return;
    const delay = this.settings.autoAdvanceSec * 1000;
    this._autoAt = Date.now() + delay;
    this._autoTimer = setTimeout(() => {
      this._autoTimer = null;
      if (this.status !== 'live') return;
      action();
      this.broadcastState();
    }, delay);
    this._autoTimer.unref?.();
  }

  clearAuto() {
    if (this._autoTimer) clearTimeout(this._autoTimer);
    this._autoTimer = null;
  }

  /** متى ينتقل تلقائياً (لعرض عدّاد للمدرب) */
  get autoNextAt() {
    return this._autoTimer && this.settings.pace === 'auto' ? this._autoAt : null;
  }

  finish() {
    if (this._deadlineTimer) clearTimeout(this._deadlineTimer);
    this._deadlineTimer = null;
    this.status = 'ended';
    this.phase = 'final';
    this.locked = true;
    this.endedAt = Date.now();
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.clearAuto();
    for (const p of this.participants.values()) p.phase = 'done';
    this.touch();
    // خطّاف يضعه المخزن ليكتب سجلّ الطلاب إن كان للجلسة فصلٌ مُسجَّل — لا يعرف عنه هذا الملف شيئاً
    this.onFinish?.();
  }

  acceptsAnswers() {
    return this.status === 'live' && this.phase === 'question' && !this.locked && this.isOpen();
  }

  /** تفاعل سريع (إيموجي) — يُبث للمضيف مع حد لمنع الإغراق */
  react(participant, emoji) {
    if (!REACTIONS.includes(emoji)) return false;
    if (this.status !== 'live') return false;
    const now = Date.now();
    if (now - (participant.lastReaction || 0) < REACTION_COOLDOWN_MS) return false;
    participant.lastReaction = now;
    this.touch();
    return true;
  }

  // -------------------------------------------------------------- الإجابات

  submitAnswer(participant, qid, rawValue) {
    let q;
    if (this.settings.pace === 'self') {
      if (this.status !== 'live') return { ok: false, error: 'النشاط غير نشط' };
      if (participant.phase !== 'question') return { ok: false, error: 'انتقل إلى السؤال التالي' };
      q = this.questions[participant.index];
      if (!q || q.id !== qid) return { ok: false, error: 'السؤال غير متاح الآن' };
      if (participant.endsAt && Date.now() > participant.endsAt) {
        return { ok: false, error: 'انتهى وقتك على هذا السؤال' };
      }
    } else {
      if (!this.isOpen()) {
        return { ok: false, error: 'انتظر… لم يبدأ السؤال بعد' };
      }
      if (!this.acceptsAnswers()) {
        return { ok: false, error: 'انتهى وقت الإجابة على هذا السؤال' };
      }
      q = this.currentQuestion;
      if (!q || q.id !== qid) {
        return { ok: false, error: 'السؤال غير متاح الآن' };
      }
    }
    if (CONTENT_TYPES.has(q.type)) {
      return { ok: false, error: 'هذه شريحة عرض لا سؤال' };
    }
    if (participant.answers.has(qid)) {
      return { ok: false, error: 'تم تسجيل إجابتك مسبقاً' };
    }

    const value = this.parseAnswerValue(q, rawValue);
    if (value === null) return { ok: false, error: 'إجابة غير صالحة' };

    const now = Date.now();
    const startedAt = this.settings.pace === 'self' ? participant.openedAt : this.questionStartedAt;
    const ms = Math.max(0, now - (startedAt || now));
    let correct = null;
    let points = 0;
    let multiplier = 1;

    // هل هو أول من أجاب على هذا السؤال؟
    const isFirst = ![...this.participants.values()].some((p) => p !== participant && p.answers.has(qid));

    // نسبة الإتقان (٠..١) مستقلّةً عن الزمن والسلسلة — عليها وحدها تُبنى العلامة
    let merit = null;

    if (SCORED_TYPES.has(q.type) && q.correct.length > 0) {
      const chosen = Array.isArray(value) ? value : [value];
      correct = chosen.length === q.correct.length && chosen.every((c) => q.correct.includes(c));
      merit = correct ? 1 : 0;
      if (correct) {
        const scored = this.scorePoints(q, ms, participant);
        points = scored.points;
        multiplier = scored.multiplier;
        participant.streak += 1;
        participant.bestStreak = Math.max(participant.bestStreak, participant.streak);
        if (isFirst) participant.firstCount += 1;
      } else {
        participant.streak = 0;
      }
      participant.score += points;
    } else if (PARTIAL_TYPES.has(q.type) && q.points > 0) {
      // نسبة الصواب تضرب في العلامة: ثلاثة من أربعة ليست كصفر من أربعة
      const ratio = ratioCorrect(q, value);
      merit = ratio;
      const scored = this.scorePoints(q, ms, participant);
      points = Math.round(scored.points * ratio);
      multiplier = scored.multiplier;
      correct = ratio >= 1 ? true : ratio > 0 ? 'partial' : false;
      if (correct === true) {
        participant.streak += 1;
        participant.bestStreak = Math.max(participant.bestStreak, participant.streak);
        if (isFirst) participant.firstCount += 1;
      } else {
        participant.streak = 0;
      }
      participant.score += points;
    }

    // سؤال مفتوح بعلامة: لا نتيجة قبل أن يقرأه المدرب ويمنح العلامة
    const pending = !!q.manual;
    // اليدوي: لا إتقان قبل أن يقرأه المدرب — يبقى null فلا يُحسب في العلامة
    participant.answers.set(qid, { value, at: now, ms, correct, points, multiplier, merit, pending, maxPoints: q.manual ? q.points : 0 });
    if (this.settings.pace === 'self') participant.phase = 'feedback';
    this.touch();
    return { ok: true, correct, points, multiplier, value, pending };
  }

  /**
   * تصحيح المدرب لإجابة نصّية: علامة كاملة أو جزئية أو صفر.
   * النقاط تُعدَّل فرقياً كي يصحّ التعديل بعد التصحيح الأول أيضاً.
   */
  grade(participantId, qid, rawPoints) {
    const participant = this.participants.get(participantId);
    if (!participant) return { ok: false, error: 'المشارك غير موجود' };
    const q = this.questions.find((item) => item.id === qid);
    if (!q || !q.manual) return { ok: false, error: 'هذا السؤال لا يُصحَّح يدوياً' };
    const answer = participant.answers.get(qid);
    if (!answer) return { ok: false, error: 'لا توجد إجابة لتصحيحها' };

    const points = clamp(rawPoints, 0, q.points, 0);
    participant.score += points - (answer.points || 0);
    answer.points = points;
    answer.pending = false;
    answer.gradedAt = Date.now();
    answer.merit = q.points > 0 ? points / q.points : 0;
    // كاملة = صحيحة، جزئية = 'partial'، صفر = خاطئة
    answer.correct = points >= q.points ? true : points > 0 ? 'partial' : false;
    this.touch();
    return { ok: true, points, correct: answer.correct };
  }

  /**
   * الأسئلة التي تدخل في العلامة، ومجموع علاماتها.
   *
   * الاستطلاع وسحابة الكلمات والمقياس والشريحة خارجها: لا صواب فيها فلا
   * يُحاسَب عليها أحد. وسؤالٌ علامته صفر خارجها أيضاً — المعلّم قال بذلك
   * إنه للإحماء لا للتقييم.
   */
  markedQuestions() {
    return this.questions.filter(
      (q) => q.points > 0 && ((SCORED_TYPES.has(q.type) && q.correct.length > 0) || PARTIAL_TYPES.has(q.type) || q.manual)
    );
  }

  get hasMark() {
    return this.settings.reward === 'marks' && this.settings.totalMark > 0 && this.markedQuestions().length > 0;
  }

  /** هل تُعرض النقاط أصلاً؟ في وضع العلامات تبقى داخلية للترتيب وحده */
  get showsPoints() {
    return this.settings.reward === 'points';
  }

  /**
   * علامة مشارك من العلامة الكاملة للنشاط.
   *
   * تُحسب من الإتقان لا من النقاط: النقاط فيها مكافأة السرعة ومضاعف
   * السلسلة، وكلاهما يجعل علامةً «من ٣٠» تتجاوز الثلاثين أو تظلم البطيء
   * الذي أصاب. والسؤال الذي لم يُصحَّح بعد يُستثنى من البسط والمقام معاً،
   * فلا تُحتسب علامة ناقصة على أنها ضعف.
   */
  /**
   * النافذة الزمنية الفعلية لسؤال. كل ما في الجلسة يمرّ من هنا: قراءة
   * `q.timeLimit` مباشرةً في موضعٍ واحد منسيّ تعني مؤقّتاً يخالف اختيار المعلّم.
   */
  timeFor(q) {
    if (!q) return 0;
    return this.settings.timeMode === 'all' ? this.settings.timeLimit || 0 : 0;
  }

  /**
   * نصيب السؤال من العلامة الكاملة.
   *
   * بالتساوي: العلامة ÷ عدد الأسئلة المحتسبة — «من ٣٠ وفيه ١٠ أسئلة» = ٣ لكل
   * سؤال. وبالتخصيص: ما كتبه المعلّم لهذا السؤال. ولا دخل للسرعة في أيّهما.
   */
  markShare(q) {
    const counted = this.markedQuestions();
    if (!counted.length) return 0;
    if (this.settings.markMode === 'custom') {
      const sum = counted.reduce((n, x) => n + (Number(x.mark) || 0), 0);
      // توزيعٌ مخصّص لم تُملأ أرقامه يعني صفراً للجميع — نرجع للتساوي بدل ذلك
      if (sum > 0) return Number(q.mark) || 0;
    }
    return this.settings.totalMark / counted.length;
  }

  markFor(participant) {
    const total = this.settings.totalMark;
    const questions = this.markedQuestions();
    if (this.settings.reward !== 'marks' || !total || !questions.length) return null;

    let earned = 0;
    let outOf = 0;
    let pending = 0;
    for (const q of questions) {
      const a = participant.answers.get(q.id);
      if (a?.pending) {
        pending += 1;
        continue; // بانتظار المدرب: خارج الحساب حتى يقرأه
      }
      const share = this.markShare(q);
      outOf += share;
      earned += (a?.merit || 0) * share;
    }
    if (!outOf) return { mark: 0, of: total, percent: 0, pending, band: 'none', passed: false };

    const percent = Math.round((earned / outOf) * 1000) / 10;
    // منزلة عشرية واحدة: «٢٤٫٥ من ٣٠» مقبولة في الدفاتر، وأكثر منها تشويش
    const mark = Math.round((earned / outOf) * total * 10) / 10;
    return {
      mark,
      of: total,
      percent,
      pending,
      band: gradeBand(percent),
      passed: percent >= this.settings.passPercent,
    };
  }

  /** رؤية العرض الخاصة بمشارك: بذرته الثابتة وهل يُخلط له الخيارات */
  viewFor(participant) {
    return { shuffleOptions: !!this.settings.shuffleOptions, seed: participant?.id || '' };
  }

  /**
   * مراجعة الطالب لأدائه بعد النشاط: كل سؤال، وما أجاب، وما الصحيح، والشرح.
   *
   * أهم ما في الاختبار تربوياً يأتي بعده لا أثناءه، وأكثر الطلاب لا يرون
   * الشرح لأنه يمرّ في ثوانٍ على الشاشة. هذه بياناته هو وحده — لا تُرسل
   * إلا إليه، وتموت مع الجلسة كبقية بياناته.
   */
  reviewFor(participant) {
    const items = [];
    // المراجعة تحترم مفاتيح المعلّم نفسها: لا إجابة صحيحة بلا كشف، ولا نقاط بلا نتيجة
    const reveal = this.settings.revealAnswer;
    const score = this.settings.showScore;
    this.questions.forEach((q, index) => {
      if (CONTENT_TYPES.has(q.type)) return;
      const a = participant.answers.get(q.id);
      const readable = (value) => {
        if (value == null) return '';
        if (q.type === 'order') {
          const byId = new Map(q.items.map((it) => [it.id, it.text]));
          return (Array.isArray(value) ? value : []).map((id2) => byId.get(id2) || id2).join(' ← ');
        }
        if (q.type === 'match') {
          return q.pairs.map((pr) => `${pr.left}: ${value?.[pr.id] || '—'}`).join(' · ');
        }
        if (Array.isArray(value)) {
          const byId = new Map(q.options.map((o) => [o.id, o.text]));
          return value.map((v) => byId.get(v) || v).join(t2(' + '));
        }
        return String(value);
      };
      const rightAnswer = () => {
        if (q.type === 'order') return q.items.map((it) => it.text).join(' ← ');
        if (q.type === 'match') return q.pairs.map((pr) => `${pr.left}: ${pr.right}`).join(' · ');
        if (q.type === 'blank') return q.blanks.filter(Boolean).join(' · ');
        const byId = new Map(q.options.map((o) => [o.id, o.text]));
        return q.correct.map((c) => byId.get(c) || c).join(' · ');
      };
      items.push({
        index: index + 1,
        type: q.type,
        text: q.text,
        explanation: reveal ? q.explanation || '' : '',
        mine: a ? readable(a.value) : '',
        answered: !!a,
        correct: reveal && a ? a.correct : null,
        points: score && a ? a.points || 0 : 0,
        maxPoints: score ? q.points || 0 : 0,
        right: reveal ? rightAnswer() : '',
        pending: !!a?.pending,
      });
    });
    return items;
  }

  /**
   * ما يُرسل للطالب عن إجابته هو. صحّتها لغةُ «إظهار الإجابة الصحيحة»،
   * ونقاطها لغةُ «إظهار النتيجة» — فما أطفأه المعلّم لا يغادر الخادم أصلاً،
   * لا يُخفى في الواجهة وحدها حيث يقرؤه من فتح أدوات المتصفح.
   */
  answeredFor(answer) {
    if (!answer) return null;
    const out = { value: answer.value, pending: !!answer.pending };
    if (this.settings.revealAnswer) out.correct = answer.correct;
    if (this.settings.showScore) {
      out.points = answer.points;
      out.multiplier = answer.multiplier;
      out.maxPoints = answer.maxPoints || 0;
    }
    return out;
  }

  /** بطاقة «أنا» على جهاز الطالب: بلا نقاطٍ ولا سلسلة حين تُخفى النتيجة */
  meFor(participant) {
    const show = this.settings.showScore;
    return {
      id: participant.id,
      name: participant.name,
      avatar: participant.avatar,
      score: show ? participant.score : 0,
      streak: show ? participant.streak : 0,
      team: this.teamOf(participant),
    };
  }

  /**
   * نتائج الصف على سؤالٍ كما تصل الطالب: تُحجب كلّها حين يُخفى الآخرون،
   * وتُنزع منها الإجابة الصحيحة حين لا تُكشف — كانت أعمدةُ «النتائج» في
   * وضع المدرّب تحمل `correct` لكل خيار مهما كان إعداد الكشف.
   */
  resultsFor(qIndex) {
    if (!this.settings.showOthers) return null;
    const agg = this.aggregate(qIndex);
    if (agg?.options && !this.settings.revealAnswer) {
      agg.options = agg.options.map(({ correct, ...rest }) => rest);
      delete agg.correctCount;
    }
    return agg;
  }

  /** الترتيب مقارنةٌ بالآخرين ورقمٌ عن نتيجتك معاً — فيلزمه الإذنان، ولا معنى له في استطلاع */
  rankFor(pid) {
    if (!this.isAssessed || !this.settings.showOthers || !this.settings.showScore) return null;
    return this.rankOf(pid);
  }

  /** كم إجابة لهذا المشارك تنتظر تصحيح المدرب */
  pendingGradesFor(participant) {
    let count = 0;
    for (const a of participant.answers.values()) if (a.pending) count += 1;
    return count;
  }

  /** ما ينتظر تصحيح المدرب: كل سؤال مفتوح بعلامة مع إجابات المشاركين */
  gradingQueue() {
    const queue = [];
    this.questions.forEach((q, index) => {
      if (!q.manual) return;
      const answers = [];
      for (const p of this.participants.values()) {
        const a = p.answers.get(q.id);
        if (!a) continue;
        answers.push({
          participantId: p.id,
          name: this.settings.requireName ? p.name : 'مشارك',
          avatar: p.avatar,
          text: Array.isArray(a.value) ? a.value.map((v) => v || '—').join(' · ') : String(a.value),
          parts: Array.isArray(a.value) ? a.value : null,
          at: a.at,
          points: a.points || 0,
          pending: !!a.pending,
          correct: a.correct,
        });
      }
      answers.sort((a, b) => Number(b.pending) - Number(a.pending) || a.at - b.at);
      queue.push({
        index,
        id: q.id,
        text: q.text,
        type: q.type,
        expected: q.type === 'blank' ? q.blanks : null,
        maxPoints: q.points,
        answers,
        pending: answers.filter((a) => a.pending).length,
      });
    });
    return queue;
  }

  /** حساب نقاط إجابة صحيحة حسب إعدادات النشاط */
  scorePoints(q, ms, participant) {
    const mode = this.settings.scoring;
    if (mode === 'none' || q.points <= 0) return { points: 0, multiplier: 1 };

    let points = q.points;
    const secs = this.timeFor(q);
    if (mode === 'speed' && secs) {
      // كاملة للإجابة الفورية، وتتناقص حتى نصف القيمة عند آخر ثانية
      const ratio = Math.max(0, 1 - ms / (secs * 1000));
      points = q.points * (0.5 + 0.5 * ratio);
    }

    /**
     * لا مضاعف سلسلة. كان يضرب نقاط الإجابة حتى ×١٫٥ بحسب صحيحاتٍ سابقة،
     * فيرى الطالب «+١٥٠٠» على سؤالٍ قيمته ألف ولا يعرف من أين جاء الفرق،
     * ويرى المعلّم ترتيباً لا يستطيع شرحه لوليّ أمر. والسلسلة تبقى ظاهرةً
     * شارةَ حماسٍ (🔥) ووسامَ «أطول سلسلة» — تحفيزٌ بلا رياضياتٍ خفيّة.
     */
    return { points: Math.round(points), multiplier: 1 };
  }

  parseAnswerValue(q, raw) {
    switch (q.type) {
      case 'mc':
      case 'poll': {
        const ids = new Set(q.options.map((o) => o.id));
        const arr = (Array.isArray(raw) ? raw : [raw]).map((v) => clean(v, 40)).filter((v) => ids.has(v));
        if (arr.length === 0) return null;
        const unique = [...new Set(arr)];
        // في الاختبار المصحّح يُسمح باختيار متعدد فقط إذا كانت الإجابة الصحيحة متعددة
        if (q.type === 'mc' && q.correct.length <= 1 && unique.length > 1) return [unique[0]];
        return unique;
      }
      case 'truefalse': {
        const v = clean(Array.isArray(raw) ? raw[0] : raw, 10);
        return v === 'true' || v === 'false' ? [v] : null;
      }
      case 'scale': {
        const v = Number(raw);
        if (!Number.isFinite(v)) return null;
        const n = Math.round(v);
        if (n < q.scale.min || n > q.scale.max) return null;
        return n;
      }
      case 'word': {
        const v = clean(raw, LIMITS.wordAnswer);
        return v.length ? v : null;
      }
      case 'open': {
        const v = clean(raw, LIMITS.openAnswer);
        return v.length ? v : null;
      }
      case 'order': {
        // ترتيب معرّفات العناصر كما رتّبها الطالب — يجب أن يشملها كلها مرة واحدة
        const ids = q.items.map((i) => i.id);
        const arr = (Array.isArray(raw) ? raw : []).map((v) => clean(v, 40));
        if (arr.length !== ids.length) return null;
        if (new Set(arr).size !== arr.length) return null;
        if (!arr.every((v) => ids.includes(v))) return null;
        return arr;
      }
      case 'match': {
        // خريطة: معرّف الزوج ← نصّ الطرف الأيمن الذي اختاره الطالب
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const out = {};
        for (const pair of q.pairs) {
          const picked = clean(raw[pair.id], LIMITS.itemText);
          if (picked) out[pair.id] = picked;
        }
        return Object.keys(out).length ? out : null;
      }
      case 'blank': {
        const count = q.blanks.length || 1;
        const arr = (Array.isArray(raw) ? raw : [raw]).slice(0, count).map((v) => clean(v, LIMITS.blankAnswer));
        while (arr.length < count) arr.push('');
        // فراغ واحد على الأقل مملوء وإلا فهي ليست إجابة
        return arr.some((v) => v.length) ? arr : null;
      }
      default:
        return null;
    }
  }

  // -------------------------------------------------------------- التجميعات

  /** تجميع نتائج سؤال واحد بشكل صالح للعرض العام (بلا كشف هوية في الاستطلاعات) */
  aggregate(qIndex) {
    const q = this.questions[qIndex];
    if (!q) return null;
    const answers = [];
    for (const p of this.participants.values()) {
      const a = p.answers.get(q.id);
      if (a) answers.push({ p, a });
    }

    const base = {
      questionId: q.id,
      type: q.type,
      total: answers.length,
      participants: this.participants.size,
    };

    if (q.type === 'mc' || q.type === 'poll' || q.type === 'truefalse') {
      const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
      for (const { a } of answers) {
        for (const v of a.value) if (counts[v] !== undefined) counts[v] += 1;
      }
      const totalVotes = Object.values(counts).reduce((s, n) => s + n, 0) || 0;
      return {
        ...base,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          count: counts[o.id],
          percent: totalVotes ? Math.round((counts[o.id] / totalVotes) * 100) : 0,
          correct: q.correct.includes(o.id),
        })),
        correctCount: answers.filter((x) => x.a.correct === true).length,
        avgMs: answers.length ? Math.round(answers.reduce((s, x) => s + x.a.ms, 0) / answers.length) : 0,
      };
    }

    if (CONTENT_TYPES.has(q.type)) return { ...base, content: true, total: 0 };

    if (PARTIAL_TYPES.has(q.type)) {
      // ما يهمّ المعلّم هنا: كم أتقنه الصف، وأي عنصر أو زوج تعثّر فيه أكثر
      const ratios = answers.map((x) => ratioCorrect(q, x.a.value));
      const spots =
        q.type === 'order'
          ? q.items.map((it, i) => ({
              text: it.text,
              right: answers.filter((x) => Array.isArray(x.a.value) && x.a.value[i] === it.id).length,
            }))
          : q.pairs.map((pr) => ({
              text: pr.left,
              right: answers.filter((x) => x.a.value && x.a.value[pr.id] === pr.right).length,
            }));
      return {
        ...base,
        spots: spots.map((sp) => ({
          text: sp.text,
          count: sp.right,
          percent: answers.length ? Math.round((sp.right / answers.length) * 100) : 0,
        })),
        perfect: answers.filter((x) => x.a.correct === true).length,
        partial: answers.filter((x) => x.a.correct === 'partial').length,
        avgPercent: ratios.length ? Math.round((ratios.reduce((n, r) => n + r, 0) / ratios.length) * 100) : 0,
        correctCount: answers.filter((x) => x.a.correct === true).length,
        avgMs: answers.length ? Math.round(answers.reduce((s2, x) => s2 + x.a.ms, 0) / answers.length) : 0,
      };
    }

    if (q.type === 'scale') {
      const values = answers.map((x) => x.a.value);
      const buckets = [];
      for (let i = q.scale.min; i <= q.scale.max; i++) {
        const count = values.filter((v) => v === i).length;
        buckets.push({ value: i, count, percent: values.length ? Math.round((count / values.length) * 100) : 0 });
      }
      const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
      return { ...base, scale: q.scale, buckets, average: Math.round(avg * 10) / 10 };
    }

    if (q.type === 'word') {
      const map = new Map();
      for (const { a } of answers) {
        const key = String(a.value).toLowerCase();
        const entry = map.get(key) || { text: a.value, count: 0 };
        entry.count += 1;
        map.set(key, entry);
      }
      const words = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 60);
      return { ...base, words };
    }

    // open + blank
    return {
      ...base,
      expected: q.type === 'blank' ? q.blanks : undefined,
      responses: answers
        .sort((a, b) => a.a.at - b.a.at)
        .slice(-60)
        .map(({ p, a }) => ({
          text: Array.isArray(a.value) ? a.value.map((v) => v || '—').join(' · ') : a.value,
          name: this.settings.requireName ? p.name : null,
          avatar: this.settings.requireName ? p.avatar : null,
        })),
    };
  }

  // ------------------------------------------------------------- الفرق

  /** أصغر فريق عدداً الآن — لتوزيع متوازن مع كل انضمام جديد */
  smallestTeam() {
    const counts = new Array(this.settings.teamCount).fill(0);
    for (const p of this.participants.values()) if (p.teamId !== null && p.teamId !== undefined) counts[p.teamId] += 1;
    let min = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] < counts[min]) min = i;
    return min;
  }

  teamOf(participant) {
    if (!this.teams || participant.teamId === null || participant.teamId === undefined) return null;
    const team = this.teams[participant.teamId];
    return team ? { id: team.id, name: team.name, emoji: team.emoji } : null;
  }

  /** ترتيب الفرق بمجموع نقاط أعضائها — null إن كان وضع الفرق مطفأً */
  teamLeaderboard() {
    if (!this.teams) return null;
    const scores = this.teams.map((t) => ({ ...t, score: 0, members: 0 }));
    for (const p of this.participants.values()) {
      if (p.teamId === null || p.teamId === undefined) continue;
      scores[p.teamId].score += p.score;
      scores[p.teamId].members += 1;
    }
    return scores
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .map((t, i) => ({ rank: i + 1, ...t }));
  }

  leaderboard(limit = 100) {
    return [...this.participants.values()]
      .filter((p) => p.score > 0 || this.hasScoredQuestions())
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .slice(0, limit)
      .map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        streak: p.streak,
        // في وضع العلامات تُعرض العلامة مكان النقاط في كل لوحة ترتيب
        mark: this.hasMark ? this.markFor(p) : null,
      }));
  }

  hasScoredQuestions() {
    if (this.settings.scoring === 'none') return false;
    return this.questions.some(
      (q) => ((SCORED_TYPES.has(q.type) && q.correct.length > 0) || PARTIAL_TYPES.has(q.type)) && q.points > 0
    );
  }

  /**
   * أوسمة تحفيزية تُحسب من الأداء الفعلي — لكل وسام صاحب واحد على الأكثر،
   * عدا ما يمكن أن يشترك فيه أكثر من متدرب (الدقة الكاملة والمثابرة).
   */
  /**
   * هل يُقيَّم هذا النشاط أصلاً؟ استطلاع الرأي وسحابة الكلمات والمقياس بلا
   * إجابة صحيحة، فلا معنى فيها لترتيب ولا لأوسمة أداء.
   */
  get isAssessed() {
    if (this.settings.scoring === 'none') return false;
    return this.questions.some(
      (q) =>
        (SCORED_TYPES.has(q.type) && q.correct.length > 0) ||
        (PARTIAL_TYPES.has(q.type) && q.points > 0) ||
        (q.manual && q.points > 0)
    );
  }

  badges() {
    const people = [...this.participants.values()];
    const result = new Map(people.map((p) => [p.id, []]));
    if (people.length === 0) return result;
    // نشاط بلا تقييم: المشارك يُشكَر لا يُقيَّم. لا وسام سرعة ولا سبق ولا مثابرة —
    // فكلها توحي بتفوّق على الآخرين في نشاط لا فائز فيه.
    if (!this.isAssessed) return result;

    const add = (pid, emoji, label) => result.get(pid)?.push({ emoji, label });
    const answeredCount = (p) => p.answers.size;
    const scoredAnswers = (p) => [...p.answers.values()].filter((a) => a.correct !== null);

    // 🎯 دقة كاملة: أجاب على سؤالين مصححين على الأقل وكلها صحيحة
    for (const p of people) {
      const scored = scoredAnswers(p);
      if (scored.length >= 2 && scored.every((a) => a.correct === true)) {
        add(p.id, '🎯', 'دقة كاملة');
      }
    }

    // 💪 المثابر: أجاب على كل الأسئلة المعروضة
    const asked =
      this.settings.pace === 'self'
        ? this.answerableUpTo(this.questions.length)
        : this.answerableUpTo(this.currentIndex + 1);
    if (asked >= 2) {
      for (const p of people) if (answeredCount(p) >= asked) add(p.id, '💪', 'أجاب على كل الأسئلة');
    }

    // ⚡ الأسرع: أقل متوسط زمن بين من أجابوا على نصف الأسئلة فأكثر
    const eligible = people.filter((p) => answeredCount(p) >= Math.max(1, Math.ceil(asked / 2)));
    if (eligible.length >= 2) {
      const avg = (p) => [...p.answers.values()].reduce((s, a) => s + a.ms, 0) / p.answers.size;
      const fastest = eligible.reduce((best, p) => (avg(p) < avg(best) ? p : best));
      add(fastest.id, '⚡', 'الأسرع إجابةً');
    }

    // 🔥 أطول سلسلة (٣ فأكثر)
    const bestStreak = Math.max(...people.map((p) => p.bestStreak));
    if (bestStreak >= 3) {
      const holder = people.find((p) => p.bestStreak === bestStreak);
      add(holder.id, '🔥', `أطول سلسلة (${bestStreak})`);
    }

    // 🚀 البادئ: الأكثر سبقاً في الإجابة
    const maxFirst = Math.max(...people.map((p) => p.firstCount));
    if (maxFirst >= 2) {
      const starter = people.find((p) => p.firstCount === maxFirst);
      add(starter.id, '🚀', 'أسرع من بدأ');
    }

    return result;
  }

  badgesFor(pid) {
    return this.badges().get(pid) || [];
  }

  rankOf(pid) {
    const board = this.leaderboard(LIMITS.participants);
    const entry = board.find((e) => e.id === pid);
    return entry ? { rank: entry.rank, of: board.length } : null;
  }

  /**
   * كم سؤالاً **يُجاب عليه** ضمن أول `upto` عنصراً.
   * شرائح المحتوى تعيش في المصفوفة نفسها، فلو عددناها لظهر الطالب وكأنه
   * ترك أسئلة لم يُسأل عنها أصلاً، ولانخفضت نسبة تقدّمه بلا ذنب.
   */
  answerableUpTo(upto) {
    const end = Math.max(0, Math.min(upto, this.questions.length));
    let n = 0;
    for (let i = 0; i < end; i += 1) if (!CONTENT_TYPES.has(this.questions[i].type)) n += 1;
    return n;
  }

  /**
   * من اختار كل خيار في سؤال استطلاع، ومن لم يشارك.
   *
   * الاستطلاع لا يُصحَّح، فجدول العلامات لا يقول للمعلّم شيئاً عنه؛ ما يفيده
   * أن يعرف من يقف أين ليتابع معه. وهذه بيانات **للمدرب وحده**: تُنزع قبل
   * إرسال اللوحة إلى شاشة العرض، فلا تظهر أسماء الآراء على بروجكتر الصف.
   */
  votersFor(q) {
    const byOption = new Map(q.options.map((o) => [o.id, []]));
    const silent = [];
    for (const p of this.participants.values()) {
      const a = p.answers.get(q.id);
      if (!a) {
        silent.push(p.name);
        continue;
      }
      for (const v of a.value || []) byOption.get(v)?.push(p.name);
    }
    return {
      options: q.options.map((o) => ({ id: o.id, names: byOption.get(o.id) || [] })),
      silent,
    };
  }

  /** إحصاءات كاملة للوحة تحكم المدرب */
  dashboard() {
    const participants = [...this.participants.values()];
    const scored = this.questions.filter((q) => SCORED_TYPES.has(q.type) && q.correct.length > 0);
    const selfPaced = this.settings.pace === 'self';
    // في الوضع الحر كل الأسئلة متاحة للجميع، وكل متدرب له تقدّمه الخاص
    const asked = selfPaced
      ? this.answerableUpTo(this.questions.length)
      : this.currentIndex >= 0
        ? this.answerableUpTo(this.currentIndex + 1)
        : 0;

    const perQuestion = this.questions.map((q, i) => {
      const answers = participants.map((p) => p.answers.get(q.id)).filter(Boolean);
      const correct = answers.filter((a) => a.correct === true).length;
      const scoredQ = (SCORED_TYPES.has(q.type) && q.correct.length > 0) || PARTIAL_TYPES.has(q.type);
      // كم متدرباً وصل إلى هذا السؤال (في الوضع الحر)
      const reached = selfPaced
        ? participants.filter((p) => p.phase === 'done' || p.index >= i).length
        : participants.length;
      return {
        index: i,
        id: q.id,
        text: q.text,
        content: CONTENT_TYPES.has(q.type),
        type: q.type,
        asked: selfPaced ? reached > 0 : i <= this.currentIndex,
        reached,
        responses: answers.length,
        responseRate: reached ? Math.round((answers.length / reached) * 100) : 0,
        correct: scoredQ ? correct : null,
        accuracy: scoredQ && answers.length ? Math.round((correct / answers.length) * 100) : null,
        avgMs: answers.length ? Math.round(answers.reduce((s, a) => s + a.ms, 0) / answers.length) : 0,
        // النتائج المجمّعة (سحابة الكلمات، أعمدة المقياس…) لعرضها في لوحة التحكم والوضع الحر
        results: answers.length ? this.aggregate(i) : null,
        // من اختار ماذا — للاستطلاع وحده، وللمدرب وحده (تُنزع قبل شاشة العرض)
        voters: q.type === 'poll' ? this.votersFor(q) : null,
      };
    });

    const rows = participants
      .map((p) => {
        const answered = [...p.answers.values()];
        const correct = answered.filter((a) => a.correct === true).length;
        const scoredAnswered = answered.filter((a) => a.correct !== null).length;
        // في الوضع الحر: عدد الأسئلة التي وصل إليها هذا المتدرب تحديداً
        const seen = selfPaced ? this.answerableUpTo(p.phase === 'done' ? this.questions.length : p.index + 1) : asked;
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          connected: p.connected,
          score: p.score,
          bestStreak: p.bestStreak,
          done: p.phase === 'done',
          answered: answered.length,
          asked: seen,
          correct,
          accuracy: scoredAnswered ? Math.round((correct / scoredAnswered) * 100) : null,
          avgMs: answered.length ? Math.round(answered.reduce((s, a) => s + a.ms, 0) / answered.length) : 0,
          progress: seen ? Math.round((answered.length / seen) * 100) : 0,
          mark: this.markFor(p),
          answers: this.questions.map((q) => {
            const a = p.answers.get(q.id);
            if (!a) return null;
            return { correct: a.correct, points: a.points };
          }),
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ar'));

    const askedQuestions = perQuestion.filter((q) => q.asked && !q.content);
    const totalResponses = askedQuestions.reduce((s, q) => s + q.responses, 0);
    // المتوقع = مجموع من وصل فعلاً لكل سؤال (يختلف عن الجميع في الوضع الحر)
    const expected = askedQuestions.reduce((s, q) => s + q.reached, 0);

    return {
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      currentIndex: this.currentIndex,
      questionCount: this.questions.length,
      pace: this.settings.pace,
      scoring: this.settings.scoring,
      hasScores: this.showsPoints && scored.length > 0,
      // اختيار المعلّم: نقاط أو علامات — لا يجتمعان في لوحة واحدة
      reward: this.settings.reward,
      hasMark: this.hasMark,
      totalMark: this.settings.totalMark,
      passPercent: this.settings.passPercent,
      /**
       * من في الكشف ولم يدخل بعد. هذا هو الغرض الأول من إرفاق الفصل: أن
       * يعرف المعلّم — وهو واقفٌ أمام صفّه — من لم يفتح الرابط، بدل أن
       * يعدّ الأسماء الظاهرة بإصبعه ويقارنها بدفتره.
       * والمقارنة بالنصّ المجرّد لأن الطالب اختار اسمه من القائمة نفسها.
       */
      hasRoster: (this.settings.roster || []).length > 0,
      missing: (() => {
        const roster = this.settings.roster || [];
        if (!roster.length) return [];
        const here = new Set(participants.map((p) => p.name));
        return roster.filter((name) => !here.has(name));
      })(),
      startedAt: this.createdAt,
      summary: {
        participants: participants.length,
        connected: participants.filter((p) => p.connected).length,
        finished: participants.filter((p) => p.phase === 'done').length,
        asked: askedQuestions.length,
        participation: expected ? Math.round((totalResponses / expected) * 100) : 0,
        avgScore: participants.length
          ? Math.round(participants.reduce((s, p) => s + p.score, 0) / participants.length)
          : 0,
        topScore: participants.reduce((m, p) => Math.max(m, p.score), 0),
        avgAccuracy: (() => {
          const withAcc = askedQuestions.filter((q) => q.accuracy !== null);
          return withAcc.length ? Math.round(withAcc.reduce((s, q) => s + q.accuracy, 0) / withAcc.length) : null;
        })(),
        // خلاصة العلامات: ما يكتبه المعلّم في تقريره بلا حساب يدوي
        avgMark: (() => {
          const marks = rows.map((r) => r.mark).filter(Boolean);
          if (!marks.length) return null;
          return Math.round((marks.reduce((n, m) => n + m.mark, 0) / marks.length) * 10) / 10;
        })(),
        passed: rows.filter((r) => r.mark?.passed).length,
      },
      perQuestion,
      participants: rows,
      teamLeaderboard: this.teamLeaderboard(),
      // ما ينتظر تصحيح المدرب (أسئلة نصّية بعلامة)
      grading: this.gradingQueue(),
    };
  }

  /** تصدير النتائج (يبقى مؤقتاً — ينزّله المدرب إن أراد الاحتفاظ به) */
  /**
   * تصدير كامل للنتائج: بطاقة تعريف النشاط (اسم، تاريخ، مدة، إعدادات)،
   * وإحصاء كل سؤال، ودرجة كل طالب بنسبتها وترتيبها. تُبنى منه ملفات Excel
   * وتقارير PDF والتحليلات، فكل ما تحتاجه تلك الشاشات يجب أن يكون هنا.
   */
  export() {
    const participants = [...this.participants.values()];
    const startedAt = this.startedAt || this.createdAt;
    const endedAt = this.endedAt || Date.now();
    // العلامة الكاملة الممكنة: المصحَّح آلياً + المصحَّح يدوياً
    const maxScore = this.questions.reduce((sum, q) => {
      if (q.manual) return sum + q.points;
      if (SCORED_TYPES.has(q.type) && q.correct.length > 0) return sum + q.points;
      if (PARTIAL_TYPES.has(q.type)) return sum + q.points;
      return sum;
    }, 0);

    const ranked = participants
      .slice()
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((p, i) => ({ id: p.id, rank: i + 1 }));
    const rankOf = new Map(ranked.map((r) => [r.id, r.rank]));

    const questionStat = (q, i) => {
      const answers = participants.map((p) => p.answers.get(q.id)).filter(Boolean);
      const graded = answers.filter((a) => a.correct !== null && a.correct !== undefined);
      const fullyCorrect = answers.filter((a) => a.correct === true).length;
      const partial = answers.filter((a) => a.correct === 'partial').length;
      const wrong = graded.length - fullyCorrect - partial;
      const scoredQ = q.manual || (SCORED_TYPES.has(q.type) && q.correct.length > 0) || PARTIAL_TYPES.has(q.type);
      return {
        index: i + 1,
        text: q.text,
        type: q.type,
        options: q.options.map((o) => o.text),
        correct: q.correct.map((c) => q.options.find((o) => o.id === c)?.text).filter(Boolean),
        // «أكمل الفراغ»: الإجابات المتوقعة تُصدَّر مكان الإجابة الصحيحة
        blanks: q.type === 'blank' ? q.blanks : undefined,
        maxPoints: scoredQ ? q.points : 0,
        scored: scoredQ,
        manual: !!q.manual,
        timeLimit: this.timeFor(q),
        responses: answers.length,
        pending: answers.filter((a) => a.pending).length,
        correctCount: fullyCorrect,
        partialCount: partial,
        wrongCount: Math.max(0, wrong),
        accuracy: scoredQ && graded.length ? Math.round((fullyCorrect / graded.length) * 100) : null,
        avgSeconds: answers.length ? Math.round((answers.reduce((sum, a) => sum + a.ms, 0) / answers.length) / 100) / 10 : 0,
        results: this.aggregate(i),
      };
    };

    return {
      title: this.title,
      code: this.code,
      // اسم المعلّم صاحب الجلسة — يُطبع في ترويسة التقرير
      teacher: this.ownerName || null,
      exportedAt: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      // مدة النشاط الفعلية بالدقائق — أول ما يسأل عنه المعلّم في التقرير
      durationMinutes: Math.max(1, Math.round((endedAt - startedAt) / 60000)),
      status: this.status,
      settings: {
        pace: this.settings.pace,
        scoring: this.settings.scoring,
        requireName: this.settings.requireName,
        showLeaderboard: this.settings.showLeaderboard,
        teamMode: this.settings.teamMode,
        scheduledAt: this.settings.opensAt ? new Date(this.settings.opensAt).toISOString() : null,
        durationMinutes: this.settings.durationMinutes || null,
      },
      // نظام العلامات: صفر يعني أن التقرير يبقى بالنقاط وحدها كما كان
      totalMark: this.hasMark ? this.settings.totalMark : 0,
      passPercent: this.settings.passPercent,
      questionCount: this.answerableUpTo(this.questions.length),
      participantCount: participants.length,
      maxScore,
      // الشرائح تُستثنى من التقرير: ليست أسئلة، ولا نتيجة لها تُحلَّل
      questions: this.questions.filter((q) => !CONTENT_TYPES.has(q.type)).map(questionStat),
      participants: participants.map((p) => {
        const answered = this.questions.filter((q) => p.answers.has(q.id)).length;
        const values = [...p.answers.values()];
        const correctCount = values.filter((a) => a.correct === true).length;
        const partialCount = values.filter((a) => a.correct === 'partial').length;
        const totalMs = values.reduce((sum, a) => sum + a.ms, 0);
        return {
          name: this.settings.requireName ? p.name : 'مجهول',
          team: this.teamOf(p)?.name || null,
          score: p.score,
          maxScore,
          percent: maxScore ? Math.round((p.score / maxScore) * 100) : null,
          rank: rankOf.get(p.id) || null,
          answered,
          unanswered: this.questions.length - answered,
          correctCount,
          partialCount,
          wrongCount: values.filter((a) => a.correct === false).length,
          pendingCount: values.filter((a) => a.pending).length,
          bestStreak: p.bestStreak,
          avgSeconds: values.length ? Math.round((totalMs / values.length) / 100) / 10 : 0,
          mark: this.markFor(p),
          answers: this.questions.map((q) => {
            const a = p.answers.get(q.id);
            if (!a) return null;
            const label = Array.isArray(a.value)
              ? a.value.map((v) => q.options.find((o) => o.id === v)?.text ?? v).join(' + ')
              : a.value;
            return {
              question: q.text,
              answer: label,
              correct: a.correct,
              points: a.points,
              maxPoints: a.maxPoints || (SCORED_TYPES.has(q.type) && q.correct.length ? q.points : 0),
              pending: !!a.pending,
              seconds: Math.round(a.ms / 100) / 10,
            };
          }),
        };
      }),
    };
  }

  // ------------------------------------------------------------------- البث

  allSockets() {
    const out = [...this.hostSockets, ...this.screenSockets];
    for (const p of this.participants.values()) out.push(...p.sockets);
    return out;
  }

  send(socket, message) {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* تجاهل */
    }
  }

  broadcast(message, filter) {
    for (const socket of this.allSockets()) {
      if (filter && !filter(socket)) continue;
      this.send(socket, message);
    }
  }

  /** الحالة المرئية للمشارك في وضع «كل متدرب بسرعته» */
  selfState(participant) {
    const q = this.questions[participant.index];
    const answer = q ? participant.answers.get(q.id) : null;
    const done = participant.phase === 'done' || this.status === 'ended';
    const state = {
      t: 'state',
      role: 'player',
      pace: 'self',
      code: this.code,
      title: this.title,
      status: this.status,
      phase: done ? 'final' : participant.phase,
      index: participant.index,
      total: this.questions.length,
      locked: false,
      endsAt: participant.endsAt,
      opensAt: null,
      serverNow: Date.now(),
      settings: this.settings,
      // هل يُقيَّم النشاط أصلاً؟ الاستطلاع لا ترتيب فيه ولا أوسمة
      assessed: this.isAssessed,
      me: this.meFor(participant),
      participants: this.settings.showOthers ? this.participants.size : null,
      scheduledAt: this.settings.opensAt,
      deadlineAt: this.deadlineAt,
      lang: this.settings.lang,
      answered: this.answeredFor(answer),
      // كم إجابة نصّية لم يصحّحها المدرب بعد — نتيجته لا تكتمل قبلها
      pendingGrades: this.pendingGradesFor(participant),
    };

    if (this.status === 'lobby') {
      state.phase = 'lobby';
      return state;
    }
    if (done) {
      const rank = this.rankFor(participant.id);
      if (rank) state.rank = rank;
      if (this.settings.showScore) {
        state.badges = this.badgesFor(participant.id);
        state.mark = this.markFor(participant);
      }
      if (this.settings.showLeaderboard) {
        state.leaderboard = this.leaderboard(10);
        state.teamLeaderboard = this.teamLeaderboard();
      }
      return state;
    }
    if (q) {
      // نكشف الإجابة الصحيحة والشرح بعد أن يجيب، إن سمح المدرب بذلك
      state.question = publicQuestion(q, participant.phase === 'feedback' && this.settings.revealAnswer, this.code, this.viewFor(participant), this.timeFor(q));
      if (participant.phase === 'feedback') state.results = this.resultsFor(participant.index);
    }
    return state;
  }

  /** الحالة المرئية للمشارك */
  participantState(participant) {
    if (this.settings.pace === 'self') return this.selfState(participant);
    const q = this.currentQuestion;
    const answer = q ? participant.answers.get(q.id) : null;
    const state = {
      t: 'state',
      role: 'player',
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      index: this.currentIndex,
      total: this.questions.length,
      locked: this.locked,
      endsAt: this.questionEndsAt,
      opensAt: this.questionOpensAt,
      serverNow: Date.now(),
      settings: this.settings,
      // هل يُقيَّم النشاط أصلاً؟ الاستطلاع لا ترتيب فيه ولا أوسمة
      assessed: this.isAssessed,
      me: this.meFor(participant),
      participants: this.settings.showOthers ? this.participants.size : null,
      scheduledAt: this.settings.opensAt,
      deadlineAt: this.deadlineAt,
      lang: this.settings.lang,
      answered: this.answeredFor(answer),
      pendingGrades: this.pendingGradesFor(participant),
    };

    if (q && (this.phase === 'question' || this.phase === 'results')) {
      /*
       * الكشف بإذن المعلّم وحده: بعد عرض النتائج للجميع، وقبلها لمن أجاب.
       * كان عرضُ النتائج يكشفها على جهاز الطالب ولو أطفأ المعلّم الخيار —
       * فالمعلّم الذي أطفأه يقصد ألّا تظهر على الجوّال أصلاً.
       */
      const reveal = this.settings.revealAnswer && (this.phase === 'results' || !!answer);
      state.question = publicQuestion(q, reveal, this.code, this.viewFor(participant), this.timeFor(q));
    }
    if (this.phase === 'results' && q) {
      state.results = this.resultsFor(this.currentIndex);
    }
    if (this.phase === 'leaderboard' || this.phase === 'final') {
      const rank = this.rankFor(participant.id);
      if (rank) state.rank = rank;
      // كم مركزاً صعد أو هبط منذ السؤال السابق
      if (participant.prevRank && state.rank) state.rankDelta = participant.prevRank - state.rank.rank;
      if (this.settings.showLeaderboard) {
        state.leaderboard = this.leaderboard(10);
        state.teamLeaderboard = this.teamLeaderboard();
      }
      if (this.phase === 'final' && this.settings.showScore) state.badges = this.badgesFor(participant.id);
    }
    // العلامة تُعرض في نهاية النشاط وحده: منتصفُه ليس موضع حكم — وبإذن «إظهار النتيجة»
    if ((this.phase === 'final' || this.status === 'ended') && this.settings.showScore) state.mark = this.markFor(participant);
    return state;
  }

  /** الحالة المرئية للمضيف (المدرب) */
  hostState() {
    const q = this.currentQuestion;
    const state = {
      t: 'state',
      role: 'host',
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      index: this.currentIndex,
      total: this.questions.length,
      locked: this.locked,
      endsAt: this.questionEndsAt,
      opensAt: this.questionOpensAt,
      serverNow: Date.now(),
      settings: this.settings,
      // نجت الجلسة إعادة تشغيل الخادم — والمضيف يستحقّ أن يعرف أن الإجابات لم تنجُ معها
      restored: Boolean(this.restored),
      questions: this.questions.map((item) => ({ id: item.id, text: item.text, type: item.type })),
      participants: [...this.participants.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        connected: p.connected,
        answeredCurrent: q ? p.answers.has(q.id) : false,
        // في الوضع الحر: أين وصل كل متدرب
        at: p.phase === 'done' ? this.questions.length : p.index + 1,
        done: p.phase === 'done',
        teamId: p.teamId,
      })),
      answeredCount: q ? [...this.participants.values()].filter((p) => p.answers.has(q.id)).length : 0,
      pace: this.settings.pace,
      // الجدولة: متى يفتح الاختبار ومتى يُقفل تلقائياً
      // (نسميه scheduledAt لا opensAt لأن opensAt محجوز لعدّاد «استعد» في السؤال)
      scheduledAt: this.settings.opensAt,
      lang: this.settings.lang,
      deadlineAt: this.deadlineAt,
      durationMinutes: this.settings.durationMinutes,
      autoNextAt: this._autoTimer ? this._autoAt : null,
      finishedCount: [...this.participants.values()].filter((p) => p.phase === 'done').length,
      teams: this.teams,
    };
    if (q) {
      state.question = publicQuestion(q, true, this.code, null, this.timeFor(q));
      state.results = this.aggregate(this.currentIndex);
    }
    // الترتيب دائماً: شاشة العرض تعرضه بين الأسئلة وبعد النتائج لا في مرحلة الترتيب فقط
    state.leaderboard = this.leaderboard(20);
    state.teamLeaderboard = this.teamLeaderboard();
    if (this.phase === 'final') {
      const badges = this.badges();
      state.badgeList = [...this.participants.values()]
        .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, badges: badges.get(p.id) || [] }))
        .filter((entry) => entry.badges.length > 0);
    }
    return state;
  }

  /**
   * هل يحتاج هذا المقبس لوحةَ الإحصاءات؟
   *
   * اللوحة أثقل ما نرسله بمراتب: أربعون كيلوبايت لصفٍّ من ستين في عشرة
   * أسئلة، ومئتان لصفٍّ من مئة وخمسين في ثلاثين. وكانت تُرسل إلى كل مضيفٍ
   * وكل شاشة عرضٍ مع كل دفعة إجابات — بينما الواجهة **تتجاهلها** ما لم يكن
   * المعلّم في تبويب «لوحة التحكم». فصار الإرسال بطلبٍ صريح: من فتح
   * التبويب اشترك، ومن خرج منه انصرف.
   *
   * والوضع الحرّ استثناء: مسرحه — عند المعلّم وعلى البروجكتر — مرسومٌ من
   * اللوحة نفسها، فلا معنى لانتظار طلب.
   */
  wantsDashboard(socket) {
    return socket.wantsDash === true || this.settings.pace === 'self';
  }

  broadcastState() {
    const state = this.hostState();
    // لا نبني اللوحة أصلاً إن لم يكن لها طالب
    const needs = [...this.hostSockets, ...this.screenSockets].some((s) => this.wantsDashboard(s));
    const data = needs ? this.dashboard() : null;
    // شاشة العرض معلّقة أمام الصف كله: أسماء من صوّت لكل رأي لا تُعرض هناك
    const forScreen = data && this.screenSockets.size ? { t: 'dashboard', data: withoutVoters(data) } : null;
    const dashboard = data ? { t: 'dashboard', data } : null;
    for (const socket of this.hostSockets) {
      this.send(socket, state);
      if (dashboard && this.wantsDashboard(socket)) this.send(socket, dashboard);
    }
    for (const socket of this.screenSockets) {
      this.send(socket, state);
      if (forScreen && this.wantsDashboard(socket)) this.send(socket, forScreen);
    }
    for (const p of this.participants.values()) {
      const payload = this.participantState(p);
      for (const socket of p.sockets) this.send(socket, payload);
    }
  }

  broadcastHost() {
    const payload = this.hostState();
    for (const socket of this.hostSockets) this.send(socket, payload);
    for (const socket of this.screenSockets) this.send(socket, payload);
  }
}

/** نسخة السؤال المرسلة للعملاء — تُخفي الإجابة الصحيحة أثناء الإجابة */
/**
 * خلط ثابت مبذور: نفس البذرة تعطي نفس الترتيب دائماً.
 * ضروري لأن الطالب قد يعيد الاتصال أو تُعاد الحالة إليه مرات، ولو تغيّر
 * ترتيب الخيارات بينها لبدا التطبيق مضطرباً — أو لأجاب على خيار غير الذي رآه.
 */
function seededShuffle(list, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * نسبة صواب إجابة تُصحَّح جزئياً (٠ إلى ١).
 * الترتيب: كم عنصراً وقع في موضعه الصحيح. المطابقة: كم زوجاً صحّ.
 */
function ratioCorrect(q, value) {
  if (q.type === 'order') {
    const right = q.items.map((i) => i.id);
    if (!Array.isArray(value) || !right.length) return 0;
    const hits = right.reduce((n, id, i) => n + (value[i] === id ? 1 : 0), 0);
    return hits / right.length;
  }
  if (q.type === 'match') {
    if (!value || typeof value !== 'object' || !q.pairs.length) return 0;
    const hits = q.pairs.reduce((n, pr) => n + (value[pr.id] === pr.right ? 1 : 0), 0);
    return hits / q.pairs.length;
  }
  return 0;
}

/**
 * @param {object} q
 * @param {boolean} revealCorrect
 * @param {string} code
 * @param {{shuffleOptions?: boolean, seed?: string}} [view] رؤية هذا الطالب تحديداً
 */
function publicQuestion(q, revealCorrect, code, view, seconds) {
  // خلط الخيارات لكل طالب على حدة: «ب» عند جاره ليست «ب» عنده، فلا يُجدي النقل
  const shuffle = view?.shuffleOptions && view?.seed;
  const order = shuffle ? seededShuffle(q.options, view.seed + q.id) : q.options;
  // «رتّب» يُخلط دائماً وإلا وصل الجواب مرتّباً؛ والبذرة تُثبّته لهذا الطالب
  const items = seededShuffle(q.items, (view?.seed || 'x') + q.id + ':items');
  // أطراف المطابقة اليمنى تُخلط كي لا يكون الترتيب نفسه هو الجواب
  const rights = seededShuffle(q.pairs.map((pr) => pr.right), (view?.seed || 'x') + q.id + ':right');
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    // الصورة تُقدَّم كرابط لا كـ data URL: تصل مرة واحدة ويخزّنها المتصفح
    imageUrl: q.image && code ? `/api/sessions/${code}/questions/${q.id}/image` : null,
    // الشرح لا يُرسل إلا مع كشف الإجابة
    explanation: revealCorrect ? q.explanation || '' : '',
    // الثواني الفعلية بعد تطبيق وضع الوقت — لا حقل السؤال وحده
    timeLimit: seconds === undefined ? q.timeLimit : seconds,
    points: q.points,
    options: order.map((o) => ({
      id: o.id,
      text: o.text,
      ...(revealCorrect ? { correct: q.correct.includes(o.id) } : {}),
    })),
    // «رتّب»: العناصر مخلوطة، والترتيب الصحيح لا يُكشف إلا بعد الإجابة
    items: items.map((it) => ({ id: it.id, text: it.text })),
    correctOrder: revealCorrect ? q.items.map((it) => it.id) : [],
    // «طابِق»: الأطراف اليسرى بترتيبها، واليمنى مخلوطة كخيارات لكل طرف
    pairs: q.pairs.map((pr) => ({ id: pr.id, left: pr.left, ...(revealCorrect ? { right: pr.right } : {}) })),
    rights,
    scale: q.scale,
    // نصّ شريحة المحتوى
    body: q.body || '',
    // قطعة القراءة تصل كاملةً: يقرؤها الطالب قبل أن يجيب وتبقى أمامه
    passage: q.passage || '',
    // معرّف الفيديو — تبنيه الواجهة رابطَ تضمين لنطاق يوتيوب وحده
    video: q.video || null,
    content: CONTENT_TYPES.has(q.type),
    // الطالب يحتاج عدد الفراغات ليكتب فيها؛ والإجابات المتوقعة لا تُكشف إلا مع الإجابة
    blankCount: q.blanks.length,
    blanks: revealCorrect ? q.blanks : [],
    // «مصحَّح» يعني: لا نكشف النتائج للقاعة أثناء الإجابة
    scored: (SCORED_TYPES.has(q.type) && q.correct.length > 0) || PARTIAL_TYPES.has(q.type) || !!q.manual,
    manual: !!q.manual,
    multi: q.correct.length > 1,
  };
}

function normalizeAvatar(avatar) {
  return {
    seed: clean(avatar?.seed, 32) || id(''),
    bg: clamp(avatar?.bg, 0, 11, 0),
    body: clamp(avatar?.body, 0, 11, 0),
    face: clamp(avatar?.face, 0, 11, 0),
    accessory: clamp(avatar?.accessory, 0, 11, 0),
  };
}

module.exports = { Session, normalizeQuiz, normalizeQuestion, QUESTION_TYPES, LIMITS, REACTIONS, READY_MS, publicQuestion, withoutVoters };
