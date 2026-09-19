'use strict';

/**
 * قياسُ الاستعمال (Microsoft Clarity) — حراسةٌ على مصدر الصفحات.
 *
 * أداةُ قياسٍ خارجية في منصّةٍ فيها أسماءُ أطفال وإجاباتُهم ورموزُهم الشخصية
 * تحتاج ثلاثة شروطٍ لا يصحّ أن يسقط أحدها بسهوٍ في تعديلٍ لاحق:
 *
 *   ١) تُحمَّل في **كل** صفحة — صفحةٌ جديدة تُنسى تعني قياساً بثقبٍ فيه.
 *   ٢) **التقنيع قبل التحميل**: الوسم على جذر الصفحة قبل أن يُدرَج وسمُ
 *      السكربت، وإلا سبق التسجيلُ التقنيعَ فخرج نصٌّ لا يُسترجع.
 *   ٣) **لا تعمل محلياً**: جلساتُ التطوير والاختبار لا تُخلط بجلسات المعلّمين.
 *
 * ويُحرَس معها ما وعدت به صفحةُ الخصوصية: أداةٌ تُضاف بلا ذكرٍ هناك وعدٌ مكسور.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const LOADER = fs.readFileSync(path.join(PUBLIC, 'assets', 'js', 'clarity.js'), 'utf8');
const LEGAL = fs.readFileSync(path.join(PUBLIC, 'assets', 'js', 'legal.js'), 'utf8');
const VERSION = require('../package.json').version;

/** صفحات التطبيق — و`offline.html` تعمل بلا شبكة فلا قياس فيها */
const pages = fs
  .readdirSync(PUBLIC)
  .filter((name) => name.endsWith('.html') && name !== 'offline.html');

test('كل صفحةٍ تحمل القياس في رأسها، وبنسخة التطبيق نفسها', () => {
  assert.ok(pages.length >= 15, `عدد الصفحات ${pages.length} — يبدو أن القائمة لم تُقرأ`);
  for (const name of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes(`/assets/js/clarity.js?v=${VERSION}`), `${name}: القياس مفقود من <head> أو نسخته قديمة`);
  }
});

test('التقنيع يسبق تحميل الأداة — لا نصّ يخرج قبل أن يُقنَّع', () => {
  const mask = LOADER.indexOf("setAttribute('data-clarity-mask'");
  const tag = LOADER.indexOf('clarity.ms/tag/');
  assert.ok(mask > 0, 'وسم التقنيع مكتوب');
  assert.ok(tag > mask, 'ووضعُه قبل إدراج وسم السكربت لا بعده');
  assert.match(LOADER, /documentElement\.setAttribute\('data-clarity-mask', 'true'\)/, 'على جذر الصفحة فيسري على كل ما تحته');
});

test('لا قياس على المضيف المحلّي ولا من ملفّ', () => {
  assert.match(LOADER, /location\.protocol === 'file:'/);
  assert.match(LOADER, /localhost/);
  assert.match(LOADER, /127\\\.0\\\.0\\\.1/);
  // الحارس يخرج قبل أن يُدرَج شيء
  const guard = LOADER.indexOf('return;');
  assert.ok(guard > 0 && guard < LOADER.indexOf('clarity.ms/tag/'), 'الخروج قبل التحميل');
});

test('سياسة الخصوصية تذكر الأداة وكعكتيها — ولا تَعِد بما لم يعد صحيحاً', () => {
  assert.ok(LEGAL.includes('Microsoft Clarity'), 'الأداة مذكورة بالاسم');
  assert.ok(LEGAL.includes('_clck') && LEGAL.includes('_clsk'), 'وكعكتاها');
  assert.equal(
    LEGAL.includes('لا إعلانات ولا متتبّعات ولا تحليلات طرف ثالث'),
    false,
    'الوعد القديم «لا تحليلات طرف ثالث» لم يعد صحيحاً فلا يبقى مكتوباً'
  );
});
