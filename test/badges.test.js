'use strict';

/**
 * قاعدة: النشاط الذي لا يُقيَّم لا يمنح أوسمة ولا ترتيباً.
 *
 * كان المستطلَع يخرج من استطلاع رأي بثلاثة أوسمة (المثابرة والسرعة والسبق)
 * ومركزٍ بين المشاركين — وهي كلها توحي بتفوّق في نشاط لا فائز فيه أصلاً،
 * لأن الاستطلاع بلا إجابة صحيحة ولا علامات. هذه الاختبارات تثبّت التمييز.
 */

const test = require('node:test');
const assert = require('node:assert');
const { Session } = require('../server/session');

const MC = (n) => ({
  type: 'mc',
  text: 'س' + n,
  options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
  correct: ['o0'],
  points: 1000,
  timeLimit: 0,
});

const POLL = (n) => ({
  type: 'poll',
  text: 'رأيك ' + n,
  options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
});

/** يبني جلسة ويجعل مشاركَين يجيبان عن كل أسئلتها */
function play(questions, settings) {
  // هذه الاختبارات تقود الأسئلة بنفسها، فتطلب وضع المدرب صراحةً
  const session = new Session('000100', { questions, settings: { pace: 'host', ...settings } });
  const fast = session.addParticipant({ name: 'سريع' });
  const slow = session.addParticipant({ name: 'بطيء' });
  session.start();
  for (let i = 0; i < questions.length; i += 1) {
    const q = session.currentQuestion;
    session.submitAnswer(fast, q.id, 'o0');
    session.submitAnswer(slow, q.id, 'o1');
    if (i < questions.length - 1) session.goTo(i + 1);
  }
  return { session, fast, slow };
}

test('استطلاع خالص: لا أوسمة ولا ترتيب لأحد', () => {
  const { session, fast } = play([POLL(1), POLL(2), POLL(3)]);

  assert.equal(session.isAssessed, false, 'الاستطلاع ليس نشاطاً مُقيَّماً');
  assert.deepEqual(session.badgesFor(fast.id), [], 'لا وسام في نشاط بلا تقييم');

  session.finish();
  const state = session.participantState(fast);
  assert.equal(state.rank, undefined, 'لا مركز: لا فائز في استطلاع');
  assert.equal(state.assessed, false, 'الحالة تُخبر الواجهة أن النشاط غير مُقيَّم');
});

test('اختبار مصحَّح: الأوسمة والترتيب كما هي', () => {
  const { session, fast } = play([MC(1), MC(2), MC(3)]);

  assert.equal(session.isAssessed, true);
  const badges = session.badgesFor(fast.id);
  assert.ok(badges.length > 0, 'المتفوّق في اختبار مصحَّح يستحق أوسمته');
  assert.ok(
    badges.some((b) => b.emoji === '🎯'),
    'من أجاب على كل الأسئلة صحيحاً ينال وسام الدقة الكاملة'
  );

  session.finish();
  const state = session.participantState(fast);
  assert.equal(state.rank?.rank, 1, 'الترتيب يظهر في النشاط المُقيَّم');
  assert.equal(state.assessed, true);
});

test('نشاط مختلط فيه سؤال مصحَّح واحد يُعدّ مُقيَّماً', () => {
  const { session } = play([POLL(1), MC(1), POLL(2)]);
  assert.equal(session.isAssessed, true, 'وجود سؤال مصحَّح واحد يكفي');
});

test('«بلا نقاط» يلغي التقييم حتى مع أسئلة لها إجابة صحيحة', () => {
  const { session, fast } = play([MC(1), MC(2)], { scoring: 'none' });

  assert.equal(session.isAssessed, false, 'المدرب اختار ألا يُنقِّط، فلا ترتيب ولا أوسمة');
  assert.deepEqual(session.badgesFor(fast.id), []);
});

test('سؤال نصّي بعلامة يُصحّحه المدرب يجعل النشاط مُقيَّماً', () => {
  const session = new Session('000101', { settings: { pace: 'host' }, questions: [{ type: 'open', text: 'اشرح', points: 5 }] });
  assert.equal(session.isAssessed, true, 'العلامة اليدوية تقييم أيضاً');

  const free = new Session('000102', { settings: { pace: 'host' }, questions: [{ type: 'open', text: 'رأيك؟', points: 0 }] });
  assert.equal(free.isAssessed, false, 'سؤال مفتوح بلا علامة = رأي حرّ لا تقييم');
});
