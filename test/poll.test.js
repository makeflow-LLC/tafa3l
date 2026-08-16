'use strict';

/**
 * نتائج الاستطلاع للمدرب: من اختار ماذا، ومن لم يشارك.
 *
 * الحدّ المهمّ هنا ليس صحّة العدّ بل **من يراه**: البروجكتر معلّق أمام الصفّ
 * كله، فأسماء أصحاب الآراء لا تُرسَل إليه إطلاقاً.
 */

const test = require('node:test');
const assert = require('node:assert');
const { Session, withoutVoters } = require('../server/session');

const POLL = {
  type: 'poll',
  text: 'أي درس تفضّل؟',
  timeLimit: 0,
  options: [{ id: 'g', text: 'الجغرافيا' }, { id: 'h', text: 'التاريخ' }],
};

const SETTINGS = { pace: 'host', scoring: 'none', requireName: true, countdown: false };

function polled() {
  const session = new Session('000300', { title: 'رأي', settings: SETTINGS, questions: [POLL] });
  const layla = session.addParticipant({ name: 'ليلى' });
  const omar = session.addParticipant({ name: 'عمر' });
  const sara = session.addParticipant({ name: 'سارة' });
  session.start();
  const qid = session.questions[0].id;
  session.submitAnswer(layla, qid, 'g');
  session.submitAnswer(omar, qid, 'g');
  // سارة لا تجيب
  return { session, sara };
}

test('المدرب يرى من اختار كل رأي ومن لم يشارك', () => {
  const { session } = polled();
  const q = session.dashboard().perQuestion[0];
  assert.ok(q.voters, 'الاستطلاع يحمل تفصيل المصوّتين');
  const byId = Object.fromEntries(q.voters.options.map((o) => [o.id, o.names]));
  assert.deepEqual(byId.g, ['ليلى', 'عمر']);
  assert.deepEqual(byId.h, []);
  assert.deepEqual(q.voters.silent, ['سارة'], 'من لم يشارك يُذكر أيضاً — هو ما يتابعه المعلّم');
});

test('شاشة العرض لا تصلها أسماء المصوّتين إطلاقاً', () => {
  const { session } = polled();
  const forScreen = withoutVoters(session.dashboard());
  assert.equal(forScreen.perQuestion[0].voters, null);
  assert.equal(JSON.stringify(forScreen.perQuestion).includes('ليلى'), false, 'لا اسم في نتائج الأسئلة المرسلة للبروجكتر');
  // ومع ذلك تبقى النتيجة المجمّعة كاملة: الرأي يُعرض، وصاحبه لا
  assert.equal(forScreen.perQuestion[0].results.options[0].count, 2);
});

test('الأسئلة المصحَّحة لا تحمل تفصيل مصوّتين', () => {
  const session = new Session('000301', {
    title: 'اختبار',
    settings: SETTINGS,
    questions: [{ type: 'mc', text: 'س', timeLimit: 0, options: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }], correct: ['a'] }],
  });
  const p = session.addParticipant({ name: 'ريم' });
  session.start();
  session.submitAnswer(p, session.questions[0].id, 'a');
  assert.equal(session.dashboard().perQuestion[0].voters, null);
});

test('استطلاع بلا إجابات: التفصيل يذكر الجميع كغير مشاركين', () => {
  const session = new Session('000302', { title: 'رأي', settings: SETTINGS, questions: [POLL] });
  session.addParticipant({ name: 'نور' });
  session.start();
  const q = session.dashboard().perQuestion[0];
  assert.deepEqual(q.voters.silent, ['نور']);
  assert.equal(q.results, null, 'ولا نتائج مجمّعة قبل أول إجابة');
});
