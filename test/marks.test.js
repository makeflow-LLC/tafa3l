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
const { Session } = require('../server/session');

const MC = (n, points = 1000) => ({
  type: 'mc',
  text: 'س' + n,
  timeLimit: 0,
  points,
  options: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }],
  correct: ['a'],
});

const settings = (extra) => ({ pace: 'host', requireName: true, countdown: false, ...extra });

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
    settings: settings({ reward: 'marks', totalMark: 10, scoring: 'speed', streakBonus: true }),
    questions: [{ ...MC(1), timeLimit: 30 }, { ...MC(2), timeLimit: 30 }],
  });
  assert.equal(s.settings.scoring, 'flat', 'وضع العلامات يفرض النقاط الثابتة');
  assert.equal(s.settings.streakBonus, false, 'ولا مضاعف سلسلة يرفع العلامة فوق سقفها');

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

test('علامات الأسئلة تزن العلامة النهائية', () => {
  const s = new Session('000403', {
    title: 'اختبار',
    settings: settings({ totalMark: 10, scoring: 'flat' }),
    // سؤال بثلاثة أضعاف وزن الآخر: الصواب في الثقيل وحده = ٧٫٥ من ١٠
    questions: [MC(1, 300), MC(2, 100)],
  });
  const p = s.addParticipant({ name: 'رنا' });
  s.start();
  s.submitAnswer(p, s.questions[0].id, 'a');
  s.goTo(1);
  s.submitAnswer(p, s.questions[1].id, 'b');
  assert.equal(s.markFor(p).mark, 7.5);
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
