'use strict';

/**
 * المسابقات المفتوحة.
 *
 * الجلسة الحيّة تجمع الصفّ في لحظةٍ واحدة: المدرّب يفتح، والطلاب يجيبون
 * معاً، وتُغلق. ومن لم يكن في الصفّ تلك اللحظة فاتته. والمسابقة المفتوحة
 * عكسها في المحور الزمني وحده: تبقى أياماً، ويدخلها الطالب متى شاء برابطٍ
 * واحد، ويجيب على مهله، وتتراكم لوحة الصدارة.
 *
 * ولذلك بُنيت بلا WebSocket ولا حالةٍ في الذاكرة: طلبُ HTTP يجلب الأسئلة،
 * وطلبٌ يُسلّم الإجابات، ولا شيء بينهما. من يفتحها على هاتفٍ ينقطع اتصاله
 * ثم يعود لا يفقد شيئاً.
 *
 * ## التقييم
 *
 * **العلامة مجموعُ الإتقان، والوقت فاصلُ تعادلٍ لا أكثر.**
 *
 * الجلسة الحيّة تكافئ السرعة لأن الجميع أمام السؤال نفسه في اللحظة نفسها.
 * أمّا مسابقةٌ تُلعب على مدى أيام فسرعتُها ليست سرعة الطالب: هي سرعة
 * هاتفه وشبكته. فمن أتقن أكثر يتقدّم، ومن تساويا في الإتقان يتقدّم أسرعهما
 * — وهذا كلُّ ما للوقت من أثر.
 *
 * ## ما لا يدخل مسابقةً مفتوحة
 *
 * ما يحتاج تصحيح المعلّم بيده (جواب حرّ، أكمل الفراغ بعلامة) وما لا إجابة
 * صحيحة له أصلاً (استطلاع، سحابة كلمات، مقياس). الأول يجعل لوحة الصدارة
 * تنتظر المعلّم إلى الأبد، والثاني لا يُرتَّب به أحد. تُرفض عند الإنشاء لا
 * تُحذف بصمت: المعلّم يعرف لماذا.
 */

const { normalizeQuiz, ratioCorrect, SCORED_TYPES, PARTIAL_TYPES, CONTENT_TYPES } = require('./session');

/** الأنواع التي تُصحَّح آلياً وتُرتَّب — وهي وحدها ما تقبله المسابقة */
const RANKABLE = new Set([...SCORED_TYPES, ...PARTIAL_TYPES]);

const MAX_QUESTIONS = 40;
const MAX_NAME = 40;
/** أطول مدّة تبقى المسابقة مفتوحة — ثلاثون يوماً */
const MAX_DAYS = 30;
const DAY_MS = 86400000;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * يبني مسابقةً من حمولة المعلّم.
 *
 * الأسئلة تمرّ من `normalizeQuiz` نفسه الذي تمرّ منه الجلسة الحيّة — فلا
 * شكلان للسؤال الواحد في المنصّة، ولا قاعدةُ تحقّقٍ تنحرف عن أختها.
 */
function build(payload, ownerId) {
  const quiz = normalizeQuiz({ title: payload?.title, settings: payload?.settings || {}, questions: payload?.questions });
  const questions = (quiz.questions || []).filter((q) => !CONTENT_TYPES.has(q.type));

  if (!questions.length) throw fail('المسابقة بلا أسئلة');
  if (questions.length > MAX_QUESTIONS) throw fail(`لا تتجاوز ${MAX_QUESTIONS} سؤالاً في المسابقة الواحدة`);

  const rejected = questions.filter((q) => !RANKABLE.has(q.type) || (SCORED_TYPES.has(q.type) && !q.correct.length));
  if (rejected.length) {
    throw fail(
      `المسابقة المفتوحة تُصحَّح وحدها، فلا تقبل ${rejected.length} من أسئلتك ` +
        '(جواب حرّ، أو أكمل الفراغ، أو استطلاع، أو سحابة كلمات، أو مقياس، أو سؤال اختيارٍ بلا إجابة صحيحة). ' +
        'احذفها أو استبدلها بأسئلةٍ لها إجابةٌ واحدة صحيحة.'
    );
  }

  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(payload?.days)) || 7));
  const now = Date.now();
  return {
    ownerId,
    title: clean(payload?.title, 120) || 'مسابقة',
    description: clean(payload?.description, 300),
    subject: clean(payload?.subject, 40),
    grades: Array.isArray(payload?.grades) ? [...new Set(payload.grades.map((g) => clean(g, 40)).filter(Boolean))].slice(0, 12) : [],
    questions,
    // خلطُ الأسئلة والخيارات افتراضيّاً: المسابقة تُلعب على مدى أيام، وأول
    // من يلعبها يستطيع أن يُملي الترتيب على من بعده
    shuffleQuestions: payload?.shuffleQuestions !== false,
    shuffleOptions: payload?.shuffleOptions !== false,
    // محاولةٌ واحدة ما لم يسمح المعلّم بغيرها — والسماح يجعل الترتيب لعبةَ تكرار
    retries: payload?.retries === true,
    days,
    opensAt: now,
    closesAt: now + days * DAY_MS,
    createdAt: now,
    updatedAt: now,
  };
}

/** هل هي مفتوحةٌ الآن؟ الإغلاق اليدويّ يعلو على الموعد */
function isOpen(contest, at = Date.now()) {
  if (!contest || contest.closed) return false;
  return at >= (contest.opensAt || 0) && at < (contest.closesAt || 0);
}

/** حالُها بكلمة — تفهمها الواجهة بلا حسابٍ ثانٍ */
function statusOf(contest, at = Date.now()) {
  if (!contest) return 'missing';
  if (contest.closed) return 'closed';
  if (at < (contest.opensAt || 0)) return 'soon';
  if (at >= (contest.closesAt || 0)) return 'ended';
  return 'open';
}

/** أعلى علامةٍ ممكنة — عليها تُحسب النسبة */
const maxScore = (contest) => (contest.questions || []).reduce((n, q) => n + (Number(q.points) || 0), 0);

/**
 * يصحّح تسليماً كاملاً.
 *
 * @param {object} contest
 * @param {Record<string, any>} answers معرّف السؤال → قيمة الإجابة
 * @returns {{score:number, max:number, correct:number, total:number, detail:Array}}
 */
function grade(contest, answers) {
  const given = answers && typeof answers === 'object' ? answers : {};
  let score = 0;
  let correct = 0;
  const detail = [];

  for (const q of contest.questions || []) {
    const value = given[q.id];
    let merit = 0;

    if (SCORED_TYPES.has(q.type)) {
      const chosen = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
      const picked = [...new Set(chosen.map((c) => String(c)))];
      merit = picked.length === q.correct.length && picked.every((c) => q.correct.includes(c)) ? 1 : 0;
    } else if (PARTIAL_TYPES.has(q.type)) {
      merit = ratioCorrect(q, value);
    }

    const points = Math.round((Number(q.points) || 0) * merit);
    score += points;
    if (merit >= 1) correct += 1;
    detail.push({ id: q.id, merit, points });
  }

  return { score, max: maxScore(contest), correct, total: (contest.questions || []).length, detail };
}

/**
 * الأسئلة كما يراها المتسابق — بلا إجاباتٍ صحيحة.
 *
 * والحذف هنا صريحٌ لا اعتمادٌ على `publicQuestion`: تلك مبنيّةٌ لجلسةٍ حيّة
 * تكشف الإجابة في لحظةٍ يقرّرها المدرّب، وهذه لا تكشف شيئاً قبل التسليم.
 * وبذرةُ الخلط من اسم المتسابق: ترتيبُه ثابتٌ لو حدّث الصفحة، ومختلفٌ عن
 * ترتيب جاره.
 */
function playable(contest, seed) {
  const order = contest.shuffleQuestions ? shuffled(contest.questions, seed + ':q') : contest.questions;
  return order.map((q) => ({
    id: q.id,
    type: q.type,
    text: q.text,
    passage: q.passage || '',
    points: q.points,
    options: (contest.shuffleOptions ? shuffled(q.options, seed + q.id) : q.options).map((o) => ({ id: o.id, text: o.text })),
    // «رتّب» يُخلط دائماً وإلا وصل الجواب مرتّباً
    items: shuffled(q.items, seed + q.id + ':i').map((it) => ({ id: it.id, text: it.text })),
    pairs: q.pairs.map((pr) => ({ id: pr.id, left: pr.left })),
    rights: shuffled(q.pairs.map((pr) => pr.right), seed + q.id + ':r'),
    multi: q.correct.length > 1,
  }));
}

/** خلطٌ ثابتٌ لبذرةٍ واحدة — فترتيب المتسابق لا يتبدّل تحت يده */
function shuffled(list, seed) {
  const items = [...(list || [])];
  let h = 0;
  for (let i = 0; i < String(seed).length; i += 1) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  for (let i = items.length - 1; i > 0; i -= 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * لوحة الصدارة.
 *
 * الترتيب: العلامة أولاً، ثم الأسرع، ثم الأسبق تسليماً. والوقت فاصلُ تعادل
 * لا مكافأةً — انظر رأس الملفّ.
 */
function board(entries, limit = 50) {
  return [...(entries || [])]
    .sort((a, b) => b.score - a.score || a.ms - b.ms || a.at - b.at)
    .slice(0, limit)
    .map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, max: e.max, correct: e.correct, total: e.total, ms: e.ms, at: e.at }));
}

/** رتبةُ تسليمٍ بعينه بين الجميع — يراها المتسابق فور انتهائه */
function rankOf(entries, entryId) {
  const sorted = [...(entries || [])].sort((a, b) => b.score - a.score || a.ms - b.ms || a.at - b.at);
  const at = sorted.findIndex((e) => e.id === entryId);
  return { rank: at < 0 ? null : at + 1, of: sorted.length };
}

/** بطاقة المسابقة للمتصفّح — بلا أسئلةٍ ولا إجابات */
function card(contest, at = Date.now()) {
  return {
    id: contest.id,
    title: contest.title,
    description: contest.description || '',
    subject: contest.subject || '',
    grades: contest.grades || [],
    questions: (contest.questions || []).length,
    max: maxScore(contest),
    retries: Boolean(contest.retries),
    opensAt: contest.opensAt,
    closesAt: contest.closesAt,
    status: statusOf(contest, at),
    entries: Number(contest.entryCount) || 0,
    createdAt: contest.createdAt,
  };
}

module.exports = { build, grade, playable, board, rankOf, card, isOpen, statusOf, maxScore, shuffled, RANKABLE, MAX_QUESTIONS, MAX_NAME, MAX_DAYS, clean };
