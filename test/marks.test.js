'use strict';

/**
 * نظام العلامات: «هذا الاختبار من ٣٠».
 *
 * العلامة ليست النقاط. النقاط لعبةٌ تكافئ السرعة والسلسلة، والعلامة سجلٌّ
 * رسمي يذهب إلى دفتر المعلّم. فما تثبّته هذه الاختبارات هو **عدل العلامة**:
 * لا تتأثر بالثواني، ولا تتجاوز سقفها، ولا تُحتسب قبل التصحيح اليدوي.
 */

const test = require('node:test');
const assert = require('node:assert');
const { Session, normalizeQuestion } = require('../server/session');

const MC = (n, points = 1000) => ({
  type: 'mc',
  text: 'س' + n,
  timeLimit: 0,
  points,
  options: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }],
  correct: ['a'],
});

const settings = (extra) => ({ pace: 'host', requireName: true, countdown: false, ...extra });

// ------------------------------------------------------- «صح / خطأ»
//
// النوع الذي يخطئ فيه الجميع مرة واحدة: جوابه يُخزَّن نصّاً ('true'/'false')
// لا قيمةً منطقية. ولو مرّر أحدٌ `false` المنطقية لسقطت في المصفاة وصار
// السؤال بلا إجابةٍ صحيحة — أي استطلاعَ رأيٍ لا يُصحَّح، بلا أن يدري أحد.

test('«صح/خطأ»: الجواب نصٌّ، و«خطأ» جوابٌ مشروع كـ«صحيح»', () => {
  const asFalse = normalizeQuestion({ type: 'truefalse', text: 'الشمس تدور حول الأرض', correct: ['false'] }, 0);
  assert.deepEqual(asFalse.options.map((o) => o.id), ['true', 'false']);
  assert.deepEqual(asFalse.options.map((o) => o.text), ['صحيح', 'خطأ']);
  assert.deepEqual(asFalse.correct, ['false'], '«خطأ» جوابٌ صحيح لا قيمةٌ فارغة');

  const asTrue = normalizeQuestion({ type: 'truefalse', text: 'الماء يغلي عند ١٠٠', correct: 'true' }, 0);
  assert.deepEqual(asTrue.correct, ['true'], 'ويُقبل نصّاً مفرداً لا مصفوفةً فقط');
});

test('«صح/خطأ»: القيمة المنطقية تُقبل ولا تُقلَب — والمساعد يرسلها كذلك', () => {
  // المساعد الذكي يكتب `correct: true` منطقيةً لا نصّاً، فقبولها ليس تساهلاً
  // بل ضرورة. والمهمّ أن تُقبل **بمعناها**: false ⇐ «خطأ» لا «صحيح».
  assert.deepEqual(normalizeQuestion({ type: 'truefalse', text: 'س', correct: false }, 0).correct, ['false']);
  assert.deepEqual(normalizeQuestion({ type: 'truefalse', text: 'س', correct: true }, 0).correct, ['true']);
  assert.deepEqual(normalizeQuestion({ type: 'truefalse', text: 'س', correct: [false] }, 0).correct, ['false']);
});

test('«صح/خطأ»: رمزٌ لا معنى له يسقط بدل أن يُخمَّن', () => {
  // الأسوأ من السقوط أن يُختار جوابٌ عشوائي فيُصحَّح الصفُّ كلّه بالخطأ.
  // والسقوط ظاهرٌ لا صامت: المحرّر يقول «حدّد الإجابة الصحيحة» في المراجعة.
  for (const bad of [0, 1, 'yes', 'صح', 'o0', '']) {
    const q = normalizeQuestion({ type: 'truefalse', text: 'س', correct: [bad] }, 0);
    assert.deepEqual(q.correct, [], `«${String(bad)}» لا يصلح معرّفَ خيار`);
  }
});

test('«صح/خطأ»: التصحيح لا يُخطئ حين يكون الجواب «خطأ»', () => {
  const s = new Session('000501', {
    title: 'صح وخطأ',
    settings: settings({ reward: 'marks', totalMark: 10, pace: 'host', countdown: false }),
    questions: [
      { type: 'truefalse', text: 'الشمس تدور حول الأرض', points: 1000, correct: ['false'] },
      { type: 'truefalse', text: 'الماء يغلي عند ١٠٠', points: 1000, correct: ['true'] },
    ],
  });
  const right = s.addParticipant({ name: 'مصيب' });
  const wrong = s.addParticipant({ name: 'مخطئ' });
  s.start();

  s.goTo(0);
  assert.equal(s.submitAnswer(right, s.questions[0].id, 'false').correct, true, '«خطأ» على سؤالٍ جوابه خطأ = إصابة');
  assert.equal(s.submitAnswer(wrong, s.questions[0].id, 'true').correct, false);

  s.goTo(1);
  assert.equal(s.submitAnswer(right, s.questions[1].id, 'true').correct, true);
  assert.equal(s.submitAnswer(wrong, s.questions[1].id, 'false').correct, false);

  assert.equal(s.markFor(right).mark, 10, 'من أصاب الاثنين علامته كاملة');
  assert.equal(s.markFor(wrong).mark, 0, 'ومن أخطأهما صفر');

  // والتجميع يعلّم الخيار الصحيح بنصّه لا برمزه
  const agg = s.aggregate(0);
  assert.deepEqual(agg.options.map((o) => [o.text, o.correct]), [['صحيح', false], ['خطأ', true]]);
  s.dispose();
});

test('العلامة من ٣٠: أربع صحيحة من خمس = ٢٤', () => {
  const s = new Session('000400', {
    title: 'اختبار',
    settings: settings({ totalMark: 30, scoring: 'flat' }),
    questions: [MC(1), MC(2), MC(3), MC(4), MC(5)],
  });
  const p = s.addParticipant({ name: 'ليان' });
  s.start();
  s.questions.forEach((q, i) => {
    s.goTo(i);
    s.submitAnswer(p, q.id, i < 4 ? 'a' : 'b');
  });
  const m = s.markFor(p);
  assert.equal(m.mark, 24);
  assert.equal(m.of, 30);
  assert.equal(m.percent, 80);
  assert.equal(m.band, 'veryGood');
  assert.equal(m.passed, true);
});

test('وضع العلامات يُلغي أثر السرعة على النتيجة كلها', () => {
  // المعلّم اختار العلامات، فلا سباق ثوانٍ: الخادم يفرض النقاط الثابتة داخلياً
  const s = new Session('000401', {
    title: 'اختبار',
    settings: settings({ reward: 'marks', totalMark: 10, scoring: 'speed' }),
    questions: [{ ...MC(1), timeLimit: 30 }, { ...MC(2), timeLimit: 30 }],
  });
  assert.equal(s.settings.scoring, 'flat', 'وضع العلامات يفرض النقاط الثابتة');
  // ومضاعف السلسلة حُذف من المنصة كلها، فلا سبيل لرفع علامةٍ فوق سقفها
  assert.equal(s.settings.streakBonus, undefined);

  const fast = s.addParticipant({ name: 'سريع' });
  const slow = s.addParticipant({ name: 'بطيء' });
  s.start();
  s.questions.forEach((q, i) => {
    s.goTo(i);
    s.submitAnswer(fast, q.id, 'a');
    s.questionStartedAt -= 20000; // البطيء يجيب بعد عشرين ثانية
    s.submitAnswer(slow, q.id, 'a');
  });
  assert.equal(s.markFor(fast).mark, 10);
  assert.equal(s.markFor(slow).mark, 10, 'إجابتان متطابقتان ⇒ علامتان متطابقتان');
  assert.equal(fast.score, slow.score, 'وحتى الترتيب الداخلي لا يفرّق بينهما');
});

test('النظامان لا يجتمعان: اختيار أحدهما يُلغي الآخر', () => {
  const marks = new Session('000411', {
    title: 'ت',
    settings: settings({ reward: 'marks', totalMark: 30 }),
    questions: [MC(1)],
  });
  assert.equal(marks.hasMark, true);
  assert.equal(marks.showsPoints, false, 'وضع العلامات: النقاط داخلية لا تُعرض');
  assert.equal(marks.dashboard().hasScores, false);

  const points = new Session('000412', {
    title: 'ت',
    settings: settings({ reward: 'points', totalMark: 30 }),
    questions: [MC(1)],
  });
  assert.equal(points.settings.totalMark, 0, 'وضع النقاط يُسقط العلامة الكاملة');
  assert.equal(points.hasMark, false);
  assert.equal(points.showsPoints, true);

  const none = new Session('000413', { title: 'ت', settings: settings({ reward: 'none' }), questions: [MC(1)] });
  assert.equal(none.hasMark, false);
  assert.equal(none.showsPoints, false);
  assert.equal(none.settings.scoring, 'none');
});

test('نشاط قديم بلا «reward» يُستنتج وضعه من إعداداته', () => {
  const legacyPoints = new Session('000414', { title: 'ت', settings: settings({ scoring: 'speed' }), questions: [MC(1)] });
  assert.equal(legacyPoints.settings.reward, 'points');
  const legacyMarks = new Session('000415', { title: 'ت', settings: settings({ totalMark: 25 }), questions: [MC(1)] });
  assert.equal(legacyMarks.settings.reward, 'marks');
  const legacyNone = new Session('000416', { title: 'ت', settings: settings({ scoring: 'none' }), questions: [MC(1)] });
  assert.equal(legacyNone.settings.reward, 'none');
});

test('العلامة الكاملة سقفٌ لا يُتجاوز', () => {
  const s = new Session('000402', {
    title: 'اختبار',
    settings: settings({ reward: 'marks', totalMark: 20, scoring: 'speed', streakBonus: true }),
    questions: [MC(1), MC(2), MC(3), MC(4), MC(5), MC(6)],
  });
  const p = s.addParticipant({ name: 'متفوّق' });
  s.start();
  s.questions.forEach((q, i) => {
    s.goTo(i);
    s.submitAnswer(p, q.id, 'a');
  });
  const m = s.markFor(p);
  assert.equal(m.mark, 20, 'العلامة الكاملة لا أكثر');
  assert.equal(m.percent, 100);
  assert.equal(m.band, 'excellent');
});

test('التوزيع بالتساوي: النقاط لا تزن العلامة — ٣٠ على ١٠ أسئلة = ٣ لكل سؤال', () => {
  const s = new Session('000403', {
    title: 'اختبار',
    settings: settings({ totalMark: 30, scoring: 'flat' }),
    questions: Array.from({ length: 10 }, (_, i) => MC(i + 1, i === 0 ? 5000 : 100)),
  });
  assert.equal(s.settings.markMode, 'equal', 'وهو الافتراضي');
  // السؤال الأول نقاطه خمسون ضعفاً — ومع ذلك نصيبه من العلامة ٣ كغيره
  assert.equal(Math.round(s.markShare(s.questions[0]) * 100) / 100, 3);
  assert.equal(Math.round(s.markShare(s.questions[9]) * 100) / 100, 3);

  const p = s.addParticipant({ name: 'رنا' });
  s.start();
  s.questions.forEach((q, i) => {
    s.goTo(i);
    s.submitAnswer(p, q.id, i < 7 ? 'a' : 'b');
  });
  assert.equal(s.markFor(p).mark, 21, 'سبعٌ صحيحة × ٣ = ٢١ مهما تفاوتت النقاط');
});

test('التوزيع المخصّص: علامة كل سؤال كما كتبها المعلّم', () => {
  const s = new Session('000413', {
    title: 'اختبار',
    settings: settings({ totalMark: 10, scoring: 'flat', markMode: 'custom' }),
    // سؤالٌ من ٧٫٥ وآخر من ٢٫٥ — والمجموع ١٠
    questions: [{ ...MC(1), mark: 7.5 }, { ...MC(2), mark: 2.5 }],
  });
  const p = s.addParticipant({ name: 'رنا' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'a');
  s.goTo(1);
  s.submitAnswer(p, s.questions[1].id, 'b');
  assert.equal(s.markFor(p).mark, 7.5, 'الثقيل وحده صحيح');
});

test('توزيعٌ مخصّص لم تُملأ أرقامه يرجع للتساوي لا يصفّر الجميع', () => {
  const s = new Session('000423', {
    title: 'اختبار',
    settings: settings({ totalMark: 10, scoring: 'flat', markMode: 'custom' }),
    questions: [MC(1), MC(2)], // بلا mark إطلاقاً
  });
  const p = s.addParticipant({ name: 'سلمى' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'a');
  s.goTo(1);
  s.submitAnswer(p, s.questions[1].id, 'b');
  assert.equal(s.markFor(p).mark, 5, 'واحدة من اثنتين = نصف العلامة');
});

test('السؤال المتروك صفرٌ في العلامة لا استثناءٌ منها', () => {
  const s = new Session('000404', {
    title: 'اختبار',
    settings: settings({ totalMark: 10, scoring: 'flat' }),
    questions: [MC(1), MC(2)],
  });
  const p = s.addParticipant({ name: 'سامي' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'a');
  s.goTo(1); // لا يجيب على الثاني
  assert.equal(s.markFor(p).mark, 5);
});

test('الإجابة النصّية قبل التصحيح خارج البسط والمقام معاً', () => {
  const s = new Session('000405', {
    title: 'اختبار',
    settings: settings({ totalMark: 20, scoring: 'flat' }),
    questions: [MC(1, 1000), { type: 'open', text: 'علّل', points: 1000, timeLimit: 0 }],
  });
  const p = s.addParticipant({ name: 'نور' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'a');
  s.goTo(1);
  s.submitAnswer(p, s.questions[1].id, 'لأن الماء يتبخّر');

  const before = s.markFor(p);
  assert.equal(before.pending, 1);
  assert.equal(before.mark, 20, 'أصاب كل ما صُحِّح — لا نحسبها ١٠ من ٢٠ بذنب سؤال لم يُقرأ بعد');

  s.grade(p.id, s.questions[1].id, 500); // نصف علامة
  const after = s.markFor(p);
  assert.equal(after.pending, 0);
  assert.equal(after.mark, 15, 'بعد التصحيح: ١٠٠٪ + ٥٠٪ من علامتين متساويتين');
});

test('التصحيح الجزئي في «رتّب» ينعكس على العلامة', () => {
  const s = new Session('000406', {
    title: 'اختبار',
    settings: settings({ totalMark: 8, scoring: 'flat' }),
    questions: [{
      type: 'order',
      text: 'رتّب',
      points: 1000,
      timeLimit: 0,
      items: [{ id: 'i0', text: 'أولاً' }, { id: 'i1', text: 'ثانياً' }, { id: 'i2', text: 'ثالثاً' }, { id: 'i3', text: 'رابعاً' }],
    }],
  });
  const p = s.addParticipant({ name: 'ريم' });
  s.start();
  // ثلاثة في مواضعها والرابع لا: ٧٥٪ من ٨ = ٦
  s.submitAnswer(p, s.questions[0].id, ['i0', 'i1', 'i3', 'i2']);
  assert.equal(s.markFor(p).mark, 4, 'عنصران فقط في موضعهما = ٥٠٪');
});

test('الاستطلاع لا يدخل العلامة، ولا علامة لنشاط كله استطلاع', () => {
  const s = new Session('000407', {
    title: 'رأي',
    settings: settings({ totalMark: 10 }),
    questions: [{ type: 'poll', text: 'رأيك؟', timeLimit: 0, options: [{ id: 'x', text: 'أ' }, { id: 'y', text: 'ب' }] }],
  });
  const p = s.addParticipant({ name: 'هناء' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'x');
  assert.equal(s.hasMark, false);
  assert.equal(s.markFor(p), null, 'لا علامة تُخترع لنشاط لا يُصحَّح');
});

test('بلا علامة كاملة = لا نظام علامات إطلاقاً', () => {
  const s = new Session('000408', { title: 'ت', settings: settings({}), questions: [MC(1)] });
  const p = s.addParticipant({ name: 'ليان' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'a');
  assert.equal(s.hasMark, false);
  assert.equal(s.markFor(p), null);
  assert.equal(s.dashboard().hasMark, false);
});

test('التقديرات ونسبة النجاح', () => {
  const s = new Session('000409', {
    title: 'اختبار',
    settings: settings({ totalMark: 100, passPercent: 60, scoring: 'flat' }),
    questions: Array.from({ length: 10 }, (_, i) => MC(i + 1)),
  });
  const p = s.addParticipant({ name: 'ليان' });
  s.start();
  s.questions.forEach((q, i) => {
    s.goTo(i);
    s.submitAnswer(p, q.id, i < 6 ? 'a' : 'b');
  });
  const m = s.markFor(p);
  assert.equal(m.mark, 60);
  assert.equal(m.band, 'fair');
  assert.equal(m.passed, true, 'ستون بالضبط عند حدّ ستين = نجاح');

  const q = s.addParticipant({ name: 'ضعيف' });
  assert.equal(s.markFor(q).band, 'weak');
  assert.equal(s.markFor(q).passed, false);
});

test('لوحة المدرب تحمل علامة كل طالب ومتوسط الصفّ وعدد الناجحين', () => {
  const s = new Session('000410', {
    title: 'اختبار',
    settings: settings({ totalMark: 10, passPercent: 50, scoring: 'flat' }),
    questions: [MC(1), MC(2)],
  });
  const good = s.addParticipant({ name: 'ناجح' });
  const bad = s.addParticipant({ name: 'راسب' });
  s.start();
  s.questions.forEach((q, i) => {
    s.goTo(i);
    s.submitAnswer(good, q.id, 'a');
    s.submitAnswer(bad, q.id, 'b');
  });
  const d = s.dashboard();
  assert.equal(d.hasMark, true);
  assert.equal(d.totalMark, 10);
  assert.equal(d.participants.find((r) => r.name === 'ناجح').mark.mark, 10);
  assert.equal(d.participants.find((r) => r.name === 'راسب').mark.mark, 0);
  assert.equal(d.summary.avgMark, 5);
  assert.equal(d.summary.passed, 1);
});

// ------------------------------------------- النافذة الزمنية: اختيارية

test('وقتٌ واحد لكل الأسئلة يعلو على مؤقّت السؤال', () => {
  const s = new Session('000430', {
    title: 'ت',
    settings: settings({ timeMode: 'all', timeLimit: 45 }),
    questions: [{ ...MC(1), timeLimit: 10 }, { ...MC(2), timeLimit: 0 }],
  });
  assert.equal(s.timeFor(s.questions[0]), 45);
  assert.equal(s.timeFor(s.questions[1]), 45, 'حتى السؤال الذي كان بلا مؤقّت');
});

test('«بلا وقت» يُلغي كل المؤقّتات مهما كتب المعلّم تحت الأسئلة', () => {
  const s = new Session('000431', {
    title: 'ت',
    settings: settings({ timeMode: 'none' }),
    questions: [{ ...MC(1), timeLimit: 30 }],
  });
  assert.equal(s.timeFor(s.questions[0]), 0);
  s.addParticipant({ name: 'ن' });
  s.start();
  assert.equal(s.questionEndsAt, null, 'ولا ينتهي السؤال بمهلة');
});

test('الافتراضي بلا وقت — والمؤقّت قرارٌ يتّخذه المعلّم لا شيء يقع عليه', () => {
  const s = new Session('000432', { title: 'ت', settings: settings({}), questions: [MC(1)] });
  assert.equal(s.settings.timeMode, 'none');
  assert.equal(s.timeFor(s.questions[0]), 0);
});

test('نشاطٌ قديم مؤقّت لا يفقد وقته صامتاً — يُستنتج وضعٌ موحّد بأطول مهلة', () => {
  // قبل وجود timeMode كان الوقت تحت كل سؤال. إسقاطه يعني اختباراً مؤقّتاً
  // صار بلا وقت بلا أن يدري صاحبه.
  const s = new Session('000434', {
    title: 'ت',
    settings: settings({}),
    questions: [{ ...MC(1), timeLimit: 15 }, { ...MC(2), timeLimit: 40 }],
  });
  assert.equal(s.settings.timeMode, 'all');
  assert.equal(s.settings.timeLimit, 40, 'أطول مهلة — فلا يُقصَّر على طالبٍ وقتُه');
  assert.equal(s.timeFor(s.questions[0]), 40);

  // واختيارٌ صريح يعلو على الاستنتاج دائماً
  const explicit = new Session('000435', {
    title: 'ت',
    settings: settings({ timeMode: 'none' }),
    questions: [{ ...MC(1), timeLimit: 30 }],
  });
  assert.equal(explicit.timeFor(explicit.questions[0]), 0);
});

test('احتساب السرعة يتبع النافذة الفعلية لا حقل السؤال', () => {
  // مؤقّت السؤال ١٠ ثوانٍ، والوضع يفرض ١٠٠ — فإجابةٌ بعد ٢٠ ثانية ما زالت مبكّرة
  const s = new Session('000433', {
    title: 'ت',
    settings: settings({ reward: 'points', scoring: 'speed', timeMode: 'all', timeLimit: 100, streakBonus: false }),
    questions: [{ ...MC(1), timeLimit: 10 }],
  });
  const p = s.addParticipant({ name: 'ن' });
  s.start();
  s.questionStartedAt -= 20000;
  s.submitAnswer(p, s.questions[0].id, 'a');
  // ٨٠٪ من الوقت باقٍ ⇒ 0.5 + 0.5×0.8 = 0.9 من النقاط
  assert.ok(p.score > 850 && p.score < 950, 'النقاط تُحسب على ١٠٠ ثانية لا على ١٠: ' + p.score);
});
