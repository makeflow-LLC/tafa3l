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
