'use strict';

/**
 * «طابِق بين طرفين» حين يتكرّر الجواب.
 *
 * سؤالٌ فيه أربع كلمات، اثنتان جوابهما «لام شمسية» واثنتان «لام قمرية»، هو
 * سؤالٌ يكتبه المعلّم عمداً — وكانت المطابقةُ واحدةً لواحد فتُفرِغ الطرف
 * الأول حين يُختار جوابه نفسه لطرفٍ ثانٍ.
 */

const test = require('node:test');
const assert = require('node:assert');

const { normalizeQuiz, publicQuestion, Session } = require('../server/session');

const LAM = {
  type: 'match',
  text: 'طابِق كل كلمة بنوع لامها',
  points: 1000,
  pairs: [
    { id: 'p0', left: 'الشمس', right: 'لام شمسية' },
    { id: 'p1', left: 'القمر', right: 'لام قمرية' },
    { id: 'p2', left: 'الرحمن', right: 'لام شمسية' },
    { id: 'p3', left: 'البيت', right: 'لام قمرية' },
  ],
};

test('الأطراف تُحفظ كما كتبها المعلّم ولو تكرّر الجواب', () => {
  const q = normalizeQuiz({ questions: [LAM] }).questions[0];
  assert.equal(q.pairs.length, 4);
  assert.deepEqual(q.pairs.map((pr) => pr.right), ['لام شمسية', 'لام قمرية', 'لام شمسية', 'لام قمرية']);
});

test('ما يراه الطالب: كل جوابٍ مرّةً واحدة — لا بطاقتان بالنصّ نفسه', () => {
  const q = normalizeQuiz({ questions: [LAM] }).questions[0];
  const pub = publicQuestion(q, false, '123456', { seed: 'p_1' }, 0);
  assert.equal(pub.rights.length, 2, 'أربعة أطراف بجوابين اثنين');
  assert.deepEqual([...pub.rights].sort(), ['لام شمسية', 'لام قمرية']);
  // ولا يكشف أيُّ طرفٍ يقابل أيّاً: الأجوبة مخلوطة بلا اقترانٍ بالأطراف
  assert.equal(pub.pairs.length, 4);
  assert.ok(pub.pairs.every((pr) => pr.right === undefined));
});

test('التصحيح يقبل الجواب المكرّر: أربعةٌ من أربعة', () => {
  const session = new Session('111111', { questions: [LAM], settings: { pace: 'host' } });
  const p = session.addParticipant({ name: 'هدى' });
  session.start();
  const q = session.questions[0];
  const result = session.submitAnswer(p, q.id, {
    p0: 'لام شمسية',
    p1: 'لام قمرية',
    p2: 'لام شمسية',
    p3: 'لام قمرية',
  });
  assert.equal(result.ok, true);
  assert.equal(result.correct, true, 'إجابةٌ كاملة');
  const agg = session.aggregate(0);
  assert.equal(agg.avgPercent, 100, 'إتقانٌ كامل للصف');
  assert.equal(agg.perfect, 1);
  // وكلُّ زوجٍ أصابه الجميع — بما فيها الزوجان اللذان جوابهما واحد
  assert.deepEqual(agg.spots.map((sp) => sp.percent), [100, 100, 100, 100]);
});

test('ونصفُها صحيح حين يخلط الطالب بين النوعين', () => {
  const session = new Session('222222', { questions: [LAM], settings: { pace: 'host' } });
  const p = session.addParticipant({ name: 'سعد' });
  session.start();
  const q = session.questions[0];
  const result = session.submitAnswer(p, q.id, {
    p0: 'لام شمسية',
    p1: 'لام قمرية',
    p2: 'لام قمرية',
    p3: 'لام شمسية',
  });
  assert.equal(result.correct, 'partial', 'اثنان من أربعة');
  assert.equal(session.reviewFor(p)[0].mine, 'الشمس: لام شمسية · القمر: لام قمرية · الرحمن: لام قمرية · البيت: لام شمسية');
});

// ------------------------------------------------- تصحيح الإجابات المكتوبة

test('حالةُ المضيف تحمل عدد الإجابات المنتظرة للتصحيح', () => {
  const session = new Session('333333', {
    questions: [
      { type: 'open', text: 'اشرح', points: 1000 },
      { type: 'mc', text: 'س', options: ['أ', 'ب'], correct: ['أ'], points: 1000 },
    ],
    settings: { pace: 'host' },
  });
  const a = session.addParticipant({ name: 'هدى' });
  const b = session.addParticipant({ name: 'سعد' });
  session.start();
  const open = session.questions[0];
  assert.equal(session.hostState().pendingGrades, 0, 'قبل أن يجيب أحد');

  session.submitAnswer(a, open.id, 'لأن الشمس تسخّن الماء');
  session.submitAnswer(b, open.id, 'التبخّر');
  assert.equal(session.hostState().pendingGrades, 2, 'إجابتان تنتظران يد المعلّم');
  assert.equal(session.gradingQueue()[0].pending, 2);

  session.grade(a.id, open.id, open.points);
  assert.equal(session.hostState().pendingGrades, 1, 'تنقص مع كل تصحيح');
  session.grade(b.id, open.id, 0);
  assert.equal(session.hostState().pendingGrades, 0);
});
