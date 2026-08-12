'use strict';

/** اختبار وحدة لوضع الفرق: التوزيع المتوازن، الترتيب الجماعي، والتحقق من الإعدادات. */

const test = require('node:test');
const assert = require('node:assert');
const { Session, normalizeQuiz } = require('../server/session');

const QUESTIONS = [
  { type: 'mc', text: 'س', options: [{ id: 'o0', text: 'أ' }, { id: 'o1', text: 'ب' }], correct: ['o0'], points: 1000, timeLimit: 0 },
];

test('normalizeQuiz: teamMode مطفأ افتراضياً، وteamCount محدود بين ٢ و٨', () => {
  const off = normalizeQuiz({ questions: QUESTIONS });
  assert.equal(off.settings.teamMode, false);
  assert.equal(off.settings.teamCount, 4, 'القيمة الافتراضية حتى لو كان الوضع مطفأً');

  const tooFew = normalizeQuiz({ questions: QUESTIONS, settings: { teamMode: true, teamCount: 1 } });
  assert.equal(tooFew.settings.teamCount, 2);

  const tooMany = normalizeQuiz({ questions: QUESTIONS, settings: { teamMode: true, teamCount: 99 } });
  assert.equal(tooMany.settings.teamCount, 8);

  const ok = normalizeQuiz({ questions: QUESTIONS, settings: { teamMode: true, teamCount: 3 } });
  assert.equal(ok.settings.teamMode, true);
  assert.equal(ok.settings.teamCount, 3);
});

test('الجلسة بلا وضع فرق: teams فارغ ولا أحد له فريق', () => {
  const s = new Session('000001', { questions: QUESTIONS });
  assert.equal(s.teams, null);
  const p = s.addParticipant({ name: 'أحمد' });
  assert.equal(p.teamId, null);
  assert.equal(s.teamOf(p), null);
  assert.equal(s.teamLeaderboard(), null);
});

test('التوزيع على الفرق يبقى متوازناً مع كل انضمام', () => {
  const s = new Session('000002', { questions: QUESTIONS, settings: { teamMode: true, teamCount: 2 } });
  assert.equal(s.teams.length, 2);
  assert.equal(s.teams[0].name, 'الفريق الوردي');
  assert.equal(s.teams[1].name, 'الفريق الأزرق');

  const p1 = s.addParticipant({ name: 'أ' }); // team0: 1
  const p2 = s.addParticipant({ name: 'ب' }); // team1: 1
  const p3 = s.addParticipant({ name: 'ج' }); // تعادل ١-١ → أصغر فهرس: team0: 2
  const p4 = s.addParticipant({ name: 'د' }); // team1: 2

  assert.equal(p1.teamId, 0);
  assert.equal(p2.teamId, 1);
  assert.equal(p3.teamId, 0);
  assert.equal(p4.teamId, 1);

  assert.deepEqual(s.teamOf(p1), { id: 0, name: 'الفريق الوردي', emoji: '🩷' });
});

test('ترتيب الفرق يجمع نقاط أعضائها وينزل ترتيبها تنازلياً', () => {
  const s = new Session('000003', { questions: QUESTIONS, settings: { teamMode: true, teamCount: 2, scoring: 'flat' } });
  const p1 = s.addParticipant({ name: 'أ' }); // team0
  const p2 = s.addParticipant({ name: 'ب' }); // team1
  const p3 = s.addParticipant({ name: 'ج' }); // team0 (تعادل)

  s.start();
  const q = s.currentQuestion;

  s.submitAnswer(p1, q.id, 'o0'); // صحيح: +1000 لفريق٠
  s.submitAnswer(p2, q.id, 'o1'); // خطأ: +0 لفريق١
  s.submitAnswer(p3, q.id, 'o0'); // صحيح: +1000 لفريق٠ (المجموع ٢٠٠٠)

  const board = s.teamLeaderboard();
  assert.equal(board[0].id, 0);
  assert.equal(board[0].score, 2000);
  assert.equal(board[0].members, 2);
  assert.equal(board[0].rank, 1);
  assert.equal(board[1].id, 1);
  assert.equal(board[1].score, 0);
  assert.equal(board[1].rank, 2);
});
