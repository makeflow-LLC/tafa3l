'use strict';

/**
 * نشاط المراجعة — يُبنى ممّا أخطأ فيه الطلاب فعلاً، لا ممّا نظنّ أنهم يحتاجونه.
 *
 * السجل يحفظ لكل محاولةٍ ما أُخطئ فيه: نصّ السؤال، والمهارة التي وُسم بها،
 * والإجابة الصحيحة (انظر records.js). وهذا يكفي **للتشخيص** ولا يكفي لبناء
 * سؤالٍ يُجاب: خياراتُ الاختيار من متعدد ليست فيه، ولا أزواجُ سؤال «طابِق».
 * فالمراجعة لا تخترع أسئلة، بل **تجمع أسئلة المعلّم نفسه** — من أنشطته
 * المحفوظة وبنكه — التي تقابل ما تعثّر فيه طلابه.
 *
 * وترتيب الأولوية فيها مقصود:
 *   ١. السؤالُ بعينه الذي أخطأ فيه الطلاب — لا شيء أقرب إلى المراجعة منه.
 *   ٢. سؤالٌ آخر على **المهارة** التي تكرّر الخطأ فيها — وهذا ما يجعل الوسم
 *      يستحقّ عناءه: «جمع الكسور» تُراجَع بسؤالٍ لم يره الطالب من قبل، فلا
 *      يحفظ الجواب بل يتعلّم.
 *
 * وما لا يقابله شيءٌ في أسئلة المعلّم لا يُلفَّق له سؤال: نقول له إن مراجعةً
 * لا تُبنى، ولماذا.
 */

/** حدُّ نصّ السؤال في السجل (records.MAX_ITEM_TEXT) — نقارن على القدر نفسه */
const ITEM_TEXT = 140;
const DEFAULT_LIMIT = 12;
/** أنواعٌ لا تُراجَع: الشريحة محتوى لا سؤال */
const SKIPPED_TYPES = new Set(['slide']);

function norm(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase().slice(0, ITEM_TEXT);
}

/**
 * ما تعثّر فيه الطلاب: نصوصُ الأسئلة ومهاراتُها بعدد مرّات الخطأ.
 *
 * والخطأ الجزئي يُحسب مثل الخطأ الكامل هنا عمداً: من طابَق نصف الأزواج
 * صحيحاً لم يُتقن المهارة، والمراجعة تُبنى على من لم يُتقن.
 */
function missSummary(records) {
  const byText = new Map();
  const bySkill = new Map();
  for (const row of records || []) {
    for (const item of row.items || []) {
      if (item.ok !== false && item.ok !== 'partial') continue;
      const text = norm(item.text);
      if (text) byText.set(text, (byText.get(text) || 0) + 1);
      const skill = norm(item.skill);
      if (skill) bySkill.set(skill, (bySkill.get(skill) || 0) + 1);
    }
  }
  return { byText, bySkill };
}

/**
 * يختار أسئلة المراجعة من أسئلة المعلّم.
 *
 * @param {object} opts
 * @param {Array} opts.records سطور السجل للطالب أو الفصل أو المجموعة
 * @param {Array} opts.questions كل أسئلة المعلّم — `{question, from}` أو أسئلة مجرّدة
 * @param {number} [opts.limit] أقصى عدد أسئلة في النشاط الناتج
 * @returns {{questions:Array, direct:number, bySkill:number, skills:string[]}}
 */
function pickReviewQuestions({ records = [], questions = [], limit = DEFAULT_LIMIT } = {}) {
  const { byText, bySkill } = missSummary(records);
  const cap = Math.max(1, Math.min(50, Number(limit) || DEFAULT_LIMIT));
  const seen = new Set();
  const picked = [];

  for (const entry of questions) {
    const q = entry && entry.question ? entry.question : entry;
    if (!q || SKIPPED_TYPES.has(q.type)) continue;
    const text = norm(q.text);
    if (!text) continue;
    // سؤالٌ واحد قد يكون في نشاطين — يُراجَع مرّة
    const key = q.type + '|' + text;
    if (seen.has(key)) continue;
    const direct = byText.get(text) || 0;
    const skill = norm(q.skill);
    const skillMisses = skill ? bySkill.get(skill) || 0 : 0;
    if (!direct && !skillMisses) continue;
    seen.add(key);
    picked.push({
      question: q,
      direct,
      skillMisses,
      // السؤال بعينه يسبق سؤال المهارة مهما كثر خطأ المهارة: المراجعة تبدأ
      // ممّا أخطأ فيه هو، لا ممّا يشبهه
      score: direct * 1000 + skillMisses,
    });
  }

  picked.sort((a, b) => b.score - a.score);
  const chosen = picked.slice(0, cap);
  return {
    // بلا المعرّف: النشاط الجديد يولّد معرّفاته، وسؤالٌ منسوخ بمعرّف أصله
    // يصطدم بأخيه حين يأتي السؤالان من نشاطين مختلفين
    questions: chosen.map(({ question }) => {
      const { id, ...rest } = question;
      return rest;
    }),
    direct: chosen.filter((p) => p.direct > 0).length,
    bySkill: chosen.filter((p) => !p.direct && p.skillMisses > 0).length,
    skills: [...new Set(chosen.map((p) => String(p.question.skill || '').trim()).filter(Boolean))],
  };
}

module.exports = { pickReviewQuestions, missSummary, DEFAULT_LIMIT };
