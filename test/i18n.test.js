'use strict';

/**
 * حراسة اللغتين على مستوى المصدر.
 *
 * السبب الجذري لعطل «الدليل يظهر بالعربية فقط» لم يكن في الدليل نفسه: كان
 * رابطه في الصفحة الرئيسية مكتوباً نصاً عربياً داخل HTML بلا مفتاح ترجمة،
 * فبقي عربياً مهما بدّل الزائر اللغة. هذا النوع من الخطأ صامت — لا يكسر شيئاً
 * ولا يظهر في اختبار وظيفي — فنمنعه هنا: أي نص مرئي في HTML يجب أن يأتي من
 * القاموس، والقاموس نفسه يجب أن يبقى متطابق المفاتيح بين اللغتين.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const DICT_FILE = path.join(PUBLIC, 'assets', 'js', 'i18n.js');
const ARABIC = /[؀-ۿ]/;

/** مفاتيح كتلة لغة داخل القاموس، بالترتيب */
function dictKeys(source, lang) {
  const start = source.indexOf(`    ${lang}: {`);
  assert.notEqual(start, -1, `لم أجد كتلة اللغة ${lang}`);
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\n    },');
  const block = rest.slice(0, end === -1 ? undefined : end);
  return block.match(/^ {6}([A-Za-z_][A-Za-z0-9_]*):/gm).map((line) => line.trim().replace(':', ''));
}

/**
 * نصوص HTML المرئية: ما بين الوسوم، بعد إزالة التعليقات والنصوص البرمجية
 * والأنماط. لا نفحص السمات لأن `lang="ar"` و`dir="rtl"` مقصودة.
 */
function visibleText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const out = [];
  const re = />([^<]+)</g;
  let m;
  while ((m = re.exec(stripped))) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

test('القاموس متطابق المفاتيح بين العربية والإنجليزية', () => {
  const source = fs.readFileSync(DICT_FILE, 'utf8');
  const ar = dictKeys(source, 'ar');
  const en = dictKeys(source, 'en');

  const missingEn = ar.filter((k) => !en.includes(k));
  const missingAr = en.filter((k) => !ar.includes(k));
  assert.deepEqual(missingEn, [], 'مفاتيح بلا ترجمة إنجليزية');
  assert.deepEqual(missingAr, [], 'مفاتيح بلا نصّ عربي');

  const dupAr = ar.filter((k, i) => ar.indexOf(k) !== i);
  const dupEn = en.filter((k, i) => en.indexOf(k) !== i);
  assert.deepEqual(dupAr, [], 'مفاتيح مكرّرة في العربية (الأخيرة تطمس ما قبلها بصمت)');
  assert.deepEqual(dupEn, [], 'مفاتيح مكرّرة في الإنجليزية');
  assert.ok(ar.length > 700, `عدد المفاتيح ${ar.length} — يبدو أن القاموس نقص`);
});

test('لا نصّ عربي مكتوب داخل صفحات HTML — كله من القاموس', () => {
  const offenders = [];
  for (const file of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'))) {
    // الدليل صفحة محتوى تُرسم كلها من help.js، وHTML فيها هيكل فارغ
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    for (const text of visibleText(html)) {
      if (ARABIC.test(text)) offenders.push(`${file}: ${text.slice(0, 60)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'نصّ عربي مكتوب في HTML لن يتبدّل مع اللغة — اجعله مفتاحاً في القاموس واضبطه من JS'
  );
});

test('دليل المعلّم موجود بلغتيه وبالبنية نفسها', () => {
  const helpSource = fs.readFileSync(path.join(PUBLIC, 'assets', 'js', 'help.js'), 'utf8');
  // نستخرج معرّفات الأقسام لكل لغة بترتيب ورودها
  const arBlock = helpSource.slice(helpSource.indexOf('    ar: {'), helpSource.indexOf('    en: {'));
  const enStart = helpSource.indexOf('    en: {');
  const enBlock = helpSource.slice(enStart, helpSource.indexOf('\n  };', enStart));
  const ids = (block) => (block.match(/id: '([a-z]+)'/g) || []).map((s) => s.replace(/id: '|'/g, ''));

  const arIds = ids(arBlock);
  const enIds = ids(enBlock);
  assert.ok(arIds.length >= 9, `أقسام الدليل العربية ${arIds.length} — ناقصة`);
  assert.deepEqual(enIds, arIds, 'أقسام الدليل الإنجليزية لا تطابق العربية ترتيباً ومعرّفاً');

  // ولا حرف عربي في نصوص الكتلة الإنجليزية
  const arabicInEnglish = (enBlock.match(/'[^']*[؀-ۿ][^']*'/g) || [])
    // «العربية» و«EN» ترد عمداً كأسماء أزرار داخل نصوص إنجليزية
    .filter((s) => !/العربية|EN|AR/.test(s));
  assert.deepEqual(arabicInEnglish, [], 'نصّ عربي داخل النسخة الإنجليزية من الدليل');
});
