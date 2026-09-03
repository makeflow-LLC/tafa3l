'use strict';

/**
 * حراسة نصوص الواجهة على مستوى المصدر.
 *
 * التطبيق عربيّ وحده، لكن نصّه يبقى في قاموسٍ واحد لا مبعثراً في الصفحات:
 * نصٌّ مكتوبٌ في HTML يفلت من المراجعة ومن أي تغييرٍ لاحق في الصياغة، ويعيد
 * إلينا العطل الذي بدأ منه هذا الملف — سطرٌ في الصفحة الرئيسية بقي كما هو
 * بينما تغيّر توأمه في القاموس. فنمنعه هنا: كل نصٍّ مرئيّ من القاموس،
 * والقاموس بلا مفاتيح مكرّرة تطمس بعضها بصمت.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const DICT_FILE = path.join(PUBLIC, 'assets', 'js', 'i18n.js');
const ARABIC = /[؀-ۿ]/;

/** مفاتيح كتلة اللغة داخل القاموس، بالترتيب */
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

test('القاموس عربيٌّ وحده، بلا مفاتيح مكرّرة', () => {
  const source = fs.readFileSync(DICT_FILE, 'utf8');
  const ar = dictKeys(source, 'ar');

  const dupAr = ar.filter((k, i) => ar.indexOf(k) !== i);
  assert.deepEqual(dupAr, [], 'مفاتيح مكرّرة (الأخيرة تطمس ما قبلها بصمت)');
  assert.ok(ar.length > 700, `عدد المفاتيح ${ar.length} — يبدو أن القاموس نقص`);
  assert.equal(source.indexOf('\n    en: {'), -1, 'عادت كتلة لغة إنجليزية إلى القاموس');
});

test('لا نصّ عربي مكتوب داخل صفحات HTML — كله من القاموس', () => {
  const offenders = [];
  // offline.html وحدها مستثناة: تُعرض والشبكة مقطوعة فلا تستطيع تحميل
  // القاموس، فنصّها مضمّن فيها.
  const EXEMPT = new Set(['offline.html']);
  for (const file of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html') && !EXEMPT.has(f))) {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    for (const text of visibleText(html)) {
      if (ARABIC.test(text)) offenders.push(`${file}: ${text.slice(0, 60)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'نصّ عربي مكتوب في HTML يفلت من القاموس — اجعله مفتاحاً واضبطه من JS'
  );
});

test('دليل المعلّم كاملٌ بأقسامه', () => {
  const helpSource = fs.readFileSync(path.join(PUBLIC, 'assets', 'js', 'help.js'), 'utf8');
  const ids = (helpSource.match(/id: '([a-z]+)'/g) || []).map((s) => s.replace(/id: '|'/g, ''));
  assert.ok(ids.length >= 9, `أقسام الدليل ${ids.length} — ناقصة`);
  assert.equal(new Set(ids).size, ids.length, 'معرّف قسمٍ مكرّر في الدليل');
});

test('لا بقايا لمبدّل اللغة في الواجهة', () => {
  const files = ['assets/js/i18n.js', 'assets/js/topbar.js', 'assets/js/screen.js', 'assets/js/host.js', 'assets/js/play.js', 'index.html', 'join.html'];
  for (const file of files) {
    const source = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    assert.equal(source.includes('I18n.mountToggle'), false, `${file}: بقي زرّ تبديل اللغة`);
    assert.equal(source.includes('I18n.setLang'), false, `${file}: بقي تبديل اللغة`);
  }
});
