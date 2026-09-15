'use strict';

/**
 * كشفُ الفصل ملفاً: أعمدةٌ تظهر بقدر ما يُعرف، واسمُ ملفٍّ يفتحه Excel.
 *
 * و`export.js` وحدةُ متصفّح، فنشغّلها هنا في سياقٍ صغير بـ`window` وحده —
 * فبناءُ الأوراق حسابٌ صِرف لا يمسّ صفحةً ولا شبكة، وهو ما يستحقّ الحراسة:
 * عمودُ الرمز يظهر لمن له رموز، وأعمدةُ النتائج لمن فتح سجلّه، والاسمُ
 * العربيّ لا يصير اسمَ ملفّ (Chromium يُسقط الامتداد معه فلا يُفتح الملفّ).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadExporter() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'export.js'), 'utf8');
  const window = {};
  vm.createContext(Object.assign(window, { window, TextEncoder, TextDecoder, Blob, console, Date, Intl }));
  vm.runInContext(code, window, { filename: 'export.js' });
  return window.Exporter;
}

const Exporter = loadExporter();

const ROWS = [
  { name: 'سارة قاسم', group: 'الدعم', pin: '8207', attempts: 2, avgPercent: 100, lastPercent: 100, lastAt: Date.UTC(2026, 8, 7) },
  { name: 'ليان محمود', group: 'الدعم', pin: '7268', attempts: 2, avgPercent: 33, lastPercent: 33, lastAt: Date.UTC(2026, 8, 7) },
];

test('الكشف بلا سجل: اسمٌ ومجموعةٌ ورمز — وبلا أعمدة نتائج', () => {
  const [sheet] = Exporter.rosterSheets({
    className: 'السابع أ',
    students: ROWS.map(({ name, group, pin }) => ({ name, group, pin })),
  });
  const head = sheet.rows[4];
  assert.deepEqual(head, ['xRosterNo', 'xRosterName', 'xRosterGroup', 'xRosterPin']);
  assert.deepEqual(sheet.rows[5], [1, 'سارة قاسم', 'الدعم', '8207']);
  assert.deepEqual(sheet.rows[6], [2, 'ليان محمود', 'الدعم', '7268']);
  assert.equal(sheet.rows[0][1], 'السابع أ', 'اسمُ الفصل داخل الملفّ لا في اسمه وحده');
  assert.equal(sheet.rows[1][1], 2);
  assert.equal(sheet.rows.length, 7, 'ثلاثةُ سطورِ تعريف، وفراغ، وترويسة، وطالبان');
});

test('ومع السجل: المحاولات والمتوسّط وآخر نتيجةٍ وتاريخها', () => {
  const [sheet] = Exporter.rosterSheets({ className: 'السابع أ', students: ROWS, stats: true });
  assert.deepEqual(sheet.rows[4], [
    'xRosterNo', 'xRosterName', 'xRosterGroup', 'xRosterPin',
    'xRosterAttempts', 'xRosterAvg', 'xRosterLast', 'xRosterLastAt',
  ]);
  const row = sheet.rows[5];
  assert.equal(row[4], 2);
  assert.equal(row[5], 100, 'المتوسّط رقمٌ لا نصّ — ليُجمع في Excel');
  assert.equal(typeof row[7], 'string');

  // ومن لا نتيجة له: خلايا فارغة لا أصفار — الصفرُ نتيجةٌ، والفراغُ «لم يحاول»
  const [empty] = Exporter.rosterSheets({
    className: 'ف',
    students: [{ name: 'هدى', group: '', pin: '', attempts: 0, avgPercent: null, lastPercent: null, lastAt: null }],
    stats: true,
  });
  assert.deepEqual(empty.rows[5], [1, 'هدى', '', 0, '', '', '']);
  assert.equal(empty.rows[4].includes('xRosterPin'), false, 'وبلا رموزٍ لا عمودَ رمز');
});

test('الملفّ حزمةُ xlsx حقيقية يقرؤها Excel', () => {
  const blob = Exporter.toXlsx(Exporter.rosterSheets({ className: 'السابع أ', students: ROWS, stats: true }));
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(blob.size > 1000);
});

// ------------------------------------------- النقاط لا تخرج إلا بنظامها

/** نشاطٌ صغير كما يصل من `/api/sessions/:code/export` */
const SESSION = (over) => ({
  title: 'اختبار الكسور',
  code: '123456',
  exportedAt: Date.UTC(2026, 8, 7),
  startedAt: Date.UTC(2026, 8, 7),
  endedAt: Date.UTC(2026, 8, 7),
  questionCount: 2,
  participantCount: 2,
  maxScore: 2000,
  totalMark: 0,
  passPercent: 50,
  settings: { pace: 'host', scoring: 'speed', reward: 'points' },
  questions: [
    { index: 1, type: 'mc', text: 'س١', options: ['أ', 'ب'], correct: ['أ'], maxPoints: 1000, markShare: 0, scored: true, responses: 2, correctCount: 1, partialCount: 0, wrongCount: 1, accuracy: 50, avgSeconds: 4 },
    { index: 2, type: 'mc', text: 'س٢', options: ['أ', 'ب'], correct: ['ب'], maxPoints: 1000, markShare: 0, scored: true, responses: 2, correctCount: 2, partialCount: 0, wrongCount: 0, accuracy: 100, avgSeconds: 3 },
  ],
  participants: [
    { name: 'سارة', score: 1800, maxScore: 2000, percent: 90, rank: 1, answered: 2, unanswered: 0, correctCount: 2, partialCount: 0, wrongCount: 0, pendingCount: 0, bestStreak: 2, avgSeconds: 3, mark: null, answers: [{ question: 'س١', answer: 'أ', correct: true, points: 900, maxPoints: 1000, seconds: 3 }] },
    { name: 'ليان', score: 700, maxScore: 2000, percent: 35, rank: 2, answered: 2, unanswered: 0, correctCount: 1, partialCount: 0, wrongCount: 1, pendingCount: 0, bestStreak: 1, avgSeconds: 5, mark: null, answers: [{ question: 'س١', answer: 'ب', correct: false, points: 0, maxPoints: 1000, seconds: 5 }] },
  ],
  ...over,
});

/** نشاطٌ بالعلامات: النقاط فيه رقمٌ داخليّ للترتيب لا غير */
const MARKED = SESSION({
  totalMark: 20,
  settings: { pace: 'host', scoring: 'speed', reward: 'marks' },
  questions: SESSION().questions.map((q) => ({ ...q, markShare: 10 })),
  participants: [
    { ...SESSION().participants[0], percent: 100, mark: { mark: 20, of: 20, percent: 100, band: 'excellent', passed: true } },
    { ...SESSION().participants[1], percent: 50, mark: { mark: 10, of: 20, percent: 50, band: 'fair', passed: true } },
  ],
});

const flat = (sheets) => JSON.stringify(sheets);

test('نشاطٌ بالنقاط: أعمدة النقاط في مكانها كما كانت', () => {
  const sheets = Exporter.buildSheets(SESSION());
  const people = sheets[1].rows;
  assert.ok(people[0].includes('aScore'), 'عمود النقاط');
  assert.ok(people[0].includes('xMaxScore'));
  assert.ok(sheets[0].rows.some((r) => r[0] === 'xScoringLabel'), 'وسطرُ احتساب النقاط');
  assert.ok(sheets[2].rows[0].includes('xPointsCol'), 'ونقاط السؤال');
  assert.ok(sheets[3].rows[0].includes('xPoints'), 'وتفصيلُ نقاط كل إجابة');
});

test('نشاطٌ بالعلامات: لا نقطة في التقرير — لا عموداً ولا سطراً ولا في ورقة الإجابات', () => {
  const sheets = Exporter.buildSheets(MARKED);
  const people = sheets[1].rows;
  assert.ok(people[0].includes('mMarkOf'), 'العلامة حاضرة');
  assert.equal(people[0].includes('aScore'), false, 'ولا عمود نقاط');
  assert.equal(people[0].includes('xMaxScore'), false);
  assert.equal(sheets[0].rows.some((r) => r[0] === 'xScoringLabel'), false, 'ولا سطر احتساب نقاط');
  assert.equal(sheets[0].rows.some((r) => r[0] === 'xMaxScore'), false);
  assert.ok(sheets[0].rows.some((r) => r[0] === 'mTotalMarkRow'), 'بل العلامة الكاملة');
  // عمود وزن السؤال يصير علامته لا نقاطه
  assert.ok(sheets[2].rows[0].includes('mQuestionMarkCol'));
  assert.equal(sheets[2].rows[0].includes('xPointsCol'), false);
  assert.equal(sheets[2].rows[1].includes(1000), false, 'ولا تتسرّب النقاط قيمةً');
  assert.ok(sheets[2].rows[1].includes(10), 'بل نصيب السؤال من العلامة');
  // ورقة الإجابات بلا عمودَي نقاط
  assert.equal(sheets[3].rows[0].includes('xPoints'), false);
  assert.equal(sheets[3].rows[0].includes('aOutOf'), false);
  assert.equal(flat([sheets[1], sheets[3]]).includes('1800'), false, 'ولا نقاط طالبٍ في أي خلية');
});

test('نشاطٌ بلا نقاط ولا علامات: لا عمود درجةٍ أصلاً', () => {
  const none = SESSION({ settings: { pace: 'host', scoring: 'none', reward: 'none' } });
  const sheets = Exporter.buildSheets(none);
  assert.equal(sheets[1].rows[0].includes('aScore'), false);
  assert.equal(sheets[2].rows[0].includes('xPointsCol'), false);
  assert.equal(sheets[2].rows[0].includes('mQuestionMarkCol'), false);
});

test('تقريرُ نشاطٍ قديمٍ بلا حقل النظام يُستنتج من علامته الكاملة', () => {
  const legacy = SESSION({ totalMark: 20, settings: { pace: 'host', scoring: 'speed' } });
  const sheets = Exporter.buildSheets(legacy);
  assert.equal(sheets[1].rows[0].includes('aScore'), false, 'علامةٌ كاملة تعني نظام العلامات');
  assert.ok(sheets[1].rows[0].includes('mMarkOf'));
});

test('جدول العلامات المطبوع يرتّب بالعلامة لا بالنقاط', () => {
  // الأسرع نقاطاً أقلُّ علامةً: الترتيب يتبع العلامة التي يقرؤها وليّ الأمر
  const swapped = {
    ...MARKED,
    participants: [
      { ...MARKED.participants[0], name: 'سريع', score: 1900, rank: null, percent: 50, mark: { mark: 10, of: 20, percent: 50, band: 'fair', passed: true } },
      { ...MARKED.participants[1], name: 'متقن', score: 600, rank: null, percent: 100, mark: { mark: 20, of: 20, percent: 100, band: 'excellent', passed: true } },
    ],
  };
  const html = Exporter.resultsPdfHtml(swapped);
  assert.ok(html.indexOf('متقن') < html.indexOf('سريع'), 'المتقن أولاً');
  assert.equal(html.includes('1900'), false, 'ولا نقاط في الورقة المطبوعة');
});
