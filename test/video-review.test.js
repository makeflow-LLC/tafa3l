'use strict';

/**
 * رابط الفيديو ومراجعة الطالب — وكلاهما سطح هجوم قبل أن يكون ميزة:
 *
 * ١) حقل نصّي حرّ يُبنى منه `iframe` هو حقن جاهز، فالخادم لا يخزّن رابطاً
 *    إطلاقاً بل معرّف يوتيوب وحده، وما لا يُطابق يوتيوب يصير `null`.
 * ٢) المراجعة تكشف الإجابات الصحيحة، فلا تُبنى إلا لمن انتهى — وهذه
 *    الاختبارات تثبّت شكل بياناتها لا فتحها (الفتح محروس في طبقة المقبس).
 */

const test = require('node:test');
const assert = require('node:assert');
const { Session, normalizeQuestion } = require('../server/session');

const videoOf = (value) => normalizeQuestion({ type: 'mc', text: 'س', video: value }, 0).video;

test('يقبل صيغ يوتيوب المعروفة ويستخرج المعرّف وحده', () => {
  const ID = 'dQw4w9WgXcQ';
  assert.equal(videoOf('https://www.youtube.com/watch?v=' + ID), ID);
  assert.equal(videoOf('https://www.youtube.com/watch?t=30&v=' + ID + '&list=x'), ID);
  assert.equal(videoOf('https://youtu.be/' + ID + '?t=12'), ID);
  assert.equal(videoOf('https://www.youtube.com/embed/' + ID), ID);
  assert.equal(videoOf('https://www.youtube.com/shorts/' + ID), ID);
  assert.equal(videoOf('https://www.youtube.com/live/' + ID), ID);
  assert.equal(videoOf('https://www.youtube-nocookie.com/embed/' + ID), ID);
  assert.equal(videoOf(ID), ID, 'المعرّف المجرّد يُقبل كما هو');
});

test('يرفض كل ما ليس يوتيوب — لا رابط ولا شفرة تصل إلى src', () => {
  const bad = [
    'https://evil.example.com/embed/dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    'https://vimeo.com/123456',
    'https://youtu.be/short',
    '',
    null,
    undefined,
    42,
  ];
  bad.forEach((value) => assert.equal(videoOf(value), null, 'كان يجب رفض: ' + String(value)));
});

const MC = (n, correct) => ({
  type: 'mc',
  text: 'س' + n,
  explanation: 'شرح ' + n,
  options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }],
  correct: [correct],
  points: 1000,
  timeLimit: 0,
});

function playedSession() {
  const session = new Session('000200', {
    title: 'مراجعة',
    settings: { pace: 'host', scoring: 'flat', requireName: true, countdown: false },
    questions: [MC(1, 'o0'), { type: 'slide', text: 'شريحة', body: 'نصّ' }, MC(2, 'o0')],
  });
  const p = session.addParticipant({ name: 'ليان' });
  session.start();
  session.submitAnswer(p, session.questions[0].id, 'o0'); // صحيحة
  session.goTo(1);
  session.goTo(2);
  session.submitAnswer(p, session.questions[2].id, 'o1'); // خاطئة
  session.finish();
  return { session, p };
}

test('المراجعة تستثني الشرائح وتحمل إجابة الطالب والصحيحة والشرح', () => {
  const { session, p } = playedSession();
  const items = session.reviewFor(p);
  assert.equal(items.length, 2, 'الشريحة لا تُراجَع — لا جواب لها');
  // الرقم هو رقم الشريحة/السؤال كما رآه الطالب على شاشته («سؤال ٣ من ٣»)،
  // لا ترقيماً جديداً للمراجعة — رقمان مختلفان للشيء نفسه يربكانه.
  assert.deepEqual(items.map((x) => x.index), [1, 3], 'يحتفظ برقم السؤال كما ظهر للطالب');

  const [first, second] = items;
  assert.equal(first.correct, true);
  assert.equal(first.mine, 'أ');
  assert.equal(first.right, 'أ');
  assert.equal(first.explanation, 'شرح 1');
  assert.equal(second.correct, false);
  assert.equal(second.mine, 'ب', 'نص الخيار لا معرّفه — الطالب لا يعرف o1');
  assert.equal(second.right, 'أ');
});

test('السؤال المتروك يظهر «لم يُجب» لا إجابةً خاطئة', () => {
  const session = new Session('000201', { title: 'ت', questions: [MC(1, 'o0')] });
  const p = session.addParticipant({ name: 'سامي' });
  session.start();
  session.finish();
  const [item] = session.reviewFor(p);
  assert.equal(item.answered, false);
  assert.equal(item.points, 0);
  assert.equal(item.right, 'أ', 'ومع ذلك يرى الجواب الصحيح ليتعلّم');
});

test('الإجابة النصّية التي لم تُصحَّح بعد تُعلَّم انتظاراً لا صفراً', () => {
  const session = new Session('000202', { title: 'ت', questions: [{ type: 'open', text: 'علّل', points: 500, timeLimit: 0 }] });
  const p = session.addParticipant({ name: 'رنا' });
  session.start();
  session.submitAnswer(p, session.questions[0].id, 'لأن الماء يتبخّر');
  session.finish();
  const [item] = session.reviewFor(p);
  assert.equal(item.pending, true);
  assert.equal(item.mine, 'لأن الماء يتبخّر');
});
