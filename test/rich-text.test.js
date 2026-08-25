'use strict';

/**
 * ترجمة رموز ماركداون إلى تنسيق — `T.richText` في common.js.
 *
 * النصّ يأتي من نموذجٍ خارجي، فهذا محلّلٌ يقرأ مدخلاً لا نثق به: ما يجب أن
 * يبقى مضبوطاً هو أنّه **يبني عُقَداً ولا يفسّر وسماً**، وأنّ ما لم يفهمه
 * يتركه حرفاً كما كُتب. ولا متصفّح هنا، فنُركّب أصغر DOM يكفي المحلّل —
 * وهو أرخص من إضافة jsdom إلى المشروع كلّه من أجل ملفٍّ واحد.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ------------------------------------------------------------- DOM مصغّر

const VOID = new Set(['hr', 'br', 'img']);

class Node {
  constructor(tag) {
    this.tagName = tag ? tag.toUpperCase() : '';
    this.children = [];
    this.attrs = {};
    this.text = null; // عقدة نصّ إن لم يكن لها وسم
  }
  get className() {
    return this.attrs.class || '';
  }
  set className(v) {
    this.attrs.class = v;
  }
  set textContent(v) {
    this.children = [textNode(String(v))];
  }
  set href(v) {
    this.attrs.href = v;
  }
  set target(v) {
    this.attrs.target = v;
  }
  set rel(v) {
    this.attrs.rel = v;
  }
  set start(v) {
    this.attrs.start = String(v);
  }
  append(...kids) {
    for (const kid of kids) {
      if (kid.tagName === '#fragment') this.children.push(...kid.children);
      else this.children.push(kid);
    }
  }
}

function textNode(value) {
  const node = new Node(null);
  node.tagName = '#text';
  node.text = value;
  return node;
}

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function serialize(node) {
  if (node.tagName === '#text') return escape(node.text);
  const inner = node.children.map(serialize).join('');
  if (node.tagName === '#fragment') return inner;
  const tag = node.tagName.toLowerCase();
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${inner}</${tag}>`;
}

/** يحمّل common.js في بيئةٍ مصنوعة ويعيد كائن `T` */
function loadCommon() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'common.js'), 'utf8');
  const document = {
    createElement: (tag) => new Node(tag),
    createTextNode: textNode,
    createDocumentFragment: () => {
      const frag = new Node(null);
      frag.tagName = '#fragment';
      return frag;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: {},
    body: { append() {} },
  };
  const win = {
    document,
    navigator: { language: 'ar' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: 'https:', href: 'https://x/', search: '' },
    addEventListener() {},
    setTimeout,
    clearTimeout,
  };
  new Function('window', 'document', 'navigator', 'localStorage', 'location', source)(
    win,
    document,
    win.navigator,
    win.localStorage,
    win.location
  );
  return win.T;
}

const T = loadCommon();
const html = (source) => serialize(T.richText(source));

// ------------------------------------------------------------ ما يُترجَم

test('العريض والمائل والشيفرة السطرية تصير وسوماً لا نجمات', () => {
  assert.equal(html('اجعلها **متدرّجة** و_واضحة_ واكتب `rtl`.'), '<p>اجعلها <strong>متدرّجة</strong> و<em>واضحة</em> واكتب <code>rtl</code>.</p>');
});

test('العنوان يصير سطراً عريضاً — والفقاعة ليست صفحةً لها هرمُ عناوين', () => {
  assert.equal(html('### الأفكار\nاختر رقماً.'), '<div class="md-h">الأفكار</div><p>اختر رقماً.</p>');
});

test('القائمة النقطية تُجمع في ul واحد مهما اختلفت علامتها', () => {
  assert.equal(html('- أولى\n* ثانية\n• ثالثة'), '<ul><li>أولى</li><li>ثانية</li><li>ثالثة</li></ul>');
});

test('القائمة المرقّمة ol تبدأ من رقم النموذج لا من واحدٍ دائماً', () => {
  assert.equal(html('3. ثالثة\n4. رابعة'), '<ol start="3"><li>ثالثة</li><li>رابعة</li></ol>');
});

test('كتلة الشيفرة تُنسخ حرفاً بحرف ولا تُفسَّر وسماً', () => {
  assert.equal(html('مثال:\n```html\n<b>مرحبا</b>\n```'), '<p>مثال:</p><pre><code>&lt;b&gt;مرحبا&lt;/b&gt;</code></pre>');
});

test('الاقتباس والفاصل عنصران لا شرطاتٌ وسهم', () => {
  assert.equal(html('> ملاحظة\n\n---'), '<blockquote>ملاحظة</blockquote><hr>');
});

test('التنسيق يتداخل: مائلٌ داخل عنصر قائمةٍ داخل قائمة', () => {
  assert.equal(html('1. **سباق** الكسور — *تطبيق*'), '<ol start="1"><li><strong>سباق</strong> الكسور — <em>تطبيق</em></li></ol>');
});

// ------------------------------------------------- ما يبقى حرفاً كما كُتب

test('نجمةُ الضرب ليست تشديداً، وعلامةٌ بلا قرين تبقى كما هي', () => {
  assert.equal(html('الضرب 3 * 4 = 12، والنتيجة *صحيحة'), '<p>الضرب 3 * 4 = 12، والنتيجة *صحيحة</p>');
});

test('علامةٌ يليها فراغ لا تفتح تنسيقاً — «** » ليست بداية عريض', () => {
  assert.equal(html('انتبه ** هنا ** فقط'), '<p>انتبه ** هنا ** فقط</p>');
});

test('أسطر الفقرة الواحدة تبقى أسطراً كما كتبها النموذج', () => {
  assert.equal(html('سطر أول\nسطر ثانٍ'), '<p>سطر أول\nسطر ثانٍ</p>');
});

// ------------------------------------------------------------- الأمان

test('الوسوم في نصّ النموذج تبقى نصّاً — لا عنصر يُبنى منها', () => {
  const out = T.richText('خطر <img src=x onerror=alert(1)> و<script>alert(2)</script>');
  const tags = [];
  const walk = (n) => {
    if (n.tagName !== '#text' && n.tagName !== '#fragment') tags.push(n.tagName.toLowerCase());
    n.children.forEach(walk);
  };
  walk(out);
  assert.deepEqual(tags, ['p'], 'لا img ولا script — فقرةٌ وحدها');
  assert.match(serialize(out), /&lt;img/);
});

test('الرابط لا يُبنى إلا لـhttp(s) — وjavascript: يبقى نصّاً', () => {
  assert.equal(
    html('[اضغط](javascript:alert(1))'),
    '<p>[اضغط](javascript:alert(1))</p>',
    'رابطٌ بمخطّطٍ غير مأمون لا يصير عنصر <a> أصلاً'
  );
  assert.equal(
    html('[الدليل](https://example.com/x)'),
    '<p><a href="https://example.com/x" target="_blank" rel="noopener noreferrer nofollow">الدليل</a></p>'
  );
});

test('نصٌّ فارغ أو غائب لا يرمي', () => {
  assert.equal(html(''), '');
  assert.equal(html(null), '');
  assert.equal(html(undefined), '');
});

test('تداخلٌ عميقٌ شاذّ ينتهي ولا يدور', () => {
  const nested = '*'.repeat(60) + 'نصّ' + '*'.repeat(60);
  assert.ok(html(nested).includes('نصّ'));
});
