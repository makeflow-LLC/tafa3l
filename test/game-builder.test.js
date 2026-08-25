'use strict';

/**
 * منشئ الألعاب التفاعلية: النموذج يبني ملفَّ HTML كاملاً، ونحن نفصله عن
 * نصّ الردّ ونصله إن بُتر. النداء الحقيقي مُستبدلٌ بردٍّ مزيّف، والاختبار
 * يثبت **شكل الطلب** وسلوك الحارس — وهما ما لا يُكتشف خطؤه إلا في الإنتاج.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-gb-'));
process.env.EVOLINK_API_KEY = 'test-evolink-key';
const builder = require('../server/game-builder');

const GAME = '<!doctype html>\n<html lang="ar" dir="rtl"><body><h1>لعبة</h1></body></html>';

/** يلتقط النداءات ويردّ عليها بالترتيب المُملى */
function mockModel(replies) {
  const original = global.fetch;
  const seen = { calls: [] };
  let i = 0;
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    seen.calls.push({ url: String(url), headers: opts?.headers, body });
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    const status = reply.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        JSON.stringify(
          status === 200
            ? { candidates: [{ content: { parts: [{ text: reply.text }] }, finishReason: reply.finish || 'STOP' }] }
            : { error: { message: reply.error || 'bad' } }
        ),
    };
  };
  return { seen, restore: () => (global.fetch = original) };
}

// ------------------------------------------------------------ فصل الملفّ

test('splitGame يفصل الملفّ المسوّر عن نصّ الردّ', () => {
  const { text, html } = builder.splitGame('تفضّل لعبتك 👇\n\n```html\n' + GAME + '\n```');
  assert.equal(text, 'تفضّل لعبتك 👇');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(builder.isComplete(html));
});

test('splitGame يقبل مستنداً بلا أسوار', () => {
  const { text, html } = builder.splitGame('جاهزة:\n' + GAME);
  assert.equal(text, 'جاهزة:');
  assert.ok(html.endsWith('</html>'));
});

test('splitGame يلتقط كتلةً بُدئت ولم تُغلق — وهي حال الملفّ المبتور', () => {
  const cut = '```html\n<!doctype html>\n<html><body><h1>لعبة';
  const { html } = builder.splitGame(cut);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.equal(builder.isComplete(html), false);
});

test('splitGame لا يعدّ الردَّ النصّي لعبةً — سؤال العمر يبقى نصّاً', () => {
  const { text, html } = builder.splitGame('لأي عمر أو صف هذه اللعبة؟');
  assert.equal(html, '');
  assert.equal(text, 'لأي عمر أو صف هذه اللعبة؟');
});

test('stitch يصل التتمّة بلا أسوار ولا سطرٍ زائد', () => {
  const joined = builder.stitch('<html><body><h1>لع', '```html\nبة</h1></body></html>\n```');
  assert.equal(joined, '<html><body><h1>لعبة</h1></body></html>\n');
});

// -------------------------------------------------------- إعدادات المعلّم

test('readConfig يحصر القيم في حدودها ويردّ الشاذّ إلى الافتراضي', () => {
  const cfg = builder.readConfig({ correctPoints: 9999, hintPenalty: -4, itemsPerRun: 'كثير' });
  assert.equal(cfg.correctPoints, 100);
  assert.equal(cfg.hintPenalty, 0);
  assert.equal(cfg.itemsPerRun, 12);
});

test('بنك المحتوى لا يقلّ عمّا يُعرض في الجولة — وإلا تكرّرت العناصر', () => {
  const cfg = builder.readConfig({ itemsPerRun: 30, bankSize: 10 });
  assert.equal(cfg.bankSize, 30);
});

test('كتلة CONFIG تُكتب أرقاماً لا أسماء متغيّرات', () => {
  const block = builder.configBlock(builder.readConfig({ correctPoints: 25, playMinutes: 12 }));
  assert.match(block, /CORRECT_POINTS\s+= 25/);
  assert.match(block, /TARGET_PLAY_TIME\s+= 12 minutes/);
  assert.equal(/\bCORRECT_POINTS\b(?![\s=])/.test(block.replace(/CORRECT_POINTS\s+= 25/, '')), false);
});

test('تعليمات النظام تحمل إعدادات المعلّم لا الافتراضات', () => {
  const prompt = builder.systemPrompt(builder.readConfig({ hintPenalty: 40, bankSize: 50, itemsPerRun: 20 }));
  assert.match(prompt, /costing 40 points/);
  assert.match(prompt, /Bank of 50 items; each run draws 20\./);
  assert.match(prompt, /Interactive Learning Game Builder/);
});

// ------------------------------------------------------------ شكل الطلب

test('الطلب يمضي إلى gemini-3.7-flash بالشكل الأصلي وبمفتاح البيئة', async () => {
  const mock = mockModel([{ text: '```html\n' + GAME + '\n```' }]);
  try {
    const out = await builder.chat({ turns: [{ role: 'user', text: 'دورة الماء للصف الرابع' }], config: {} });
    const call = mock.seen.calls[0];
    assert.match(call.url, /gemini-3\.7-flash:generateContent$/);
    assert.equal(call.headers.Authorization, 'Bearer test-evolink-key');
    assert.match(call.body.systemInstruction.parts[0].text, /Interactive Learning Game Builder/);
    assert.deepEqual(call.body.contents, [{ role: 'user', parts: [{ text: 'دورة الماء للصف الرابع' }] }]);
    assert.equal(out.html.trim(), GAME);
    assert.equal(out.truncated, false);
  } finally {
    mock.restore();
  }
});

test('دور المساعد يُرسل باسم model — وهو ما تفهمه واجهة Gemini', async () => {
  const mock = mockModel([{ text: 'تمام' }]);
  try {
    await builder.chat({
      turns: [
        { role: 'user', text: 'الصف الرابع' },
        { role: 'model', text: 'لأي عمر؟' },
        { role: 'user', text: 'ابنِها' },
      ],
    });
    assert.deepEqual(
      mock.seen.calls[0].body.contents.map((c) => c.role),
      ['user', 'model', 'user']
    );
  } finally {
    mock.restore();
  }
});

test('٤٠٠ وحدها تُعيد النداء بالشكل المختصر وتعليماتُ النظام مطويّة', async () => {
  const mock = mockModel([{ status: 400, error: 'Unknown field systemInstruction' }, { text: 'تمام' }]);
  try {
    await builder.chat({ turns: [{ role: 'user', text: 'مرحباً' }] });
    assert.equal(mock.seen.calls.length, 2);
    const second = mock.seen.calls[1].body;
    assert.equal(second.systemInstruction, undefined);
    assert.equal(second.generationConfig, undefined);
    assert.match(second.contents[0].parts[0].text, /Interactive Learning Game Builder[\s\S]*مرحباً/);
  } finally {
    mock.restore();
  }
});

test('٤٢٩ لا تُعاد بشكلٍ آخر — تبديل الشكل لا يصلح حدَّ استعمال', async () => {
  const mock = mockModel([{ status: 429, error: 'rate limit' }]);
  try {
    await assert.rejects(() => builder.chat({ turns: [{ role: 'user', text: 'مرحباً' }] }), /rate limit/);
    assert.equal(mock.seen.calls.length, 1);
  } finally {
    mock.restore();
  }
});

// ----------------------------------------------------- وصلُ ما بلغ السقف

test('ملفٌّ بلغ سقف المخرجات يُكمَل بنداءٍ متابع ثم يُسلَّم كاملاً', async () => {
  const head = '```html\n<!doctype html>\n<html><body><h1>لع';
  const tail = 'بة</h1></body></html>\n';
  const mock = mockModel([
    { text: head, finish: 'MAX_TOKENS' },
    { text: tail, finish: 'STOP' },
  ]);
  try {
    const out = await builder.chat({ turns: [{ role: 'user', text: 'ابنِها' }] });
    assert.equal(mock.seen.calls.length, 2);
    assert.match(mock.seen.calls[1].body.contents.at(-1).parts[0].text, /أكمله من آخر حرفٍ كتبتَه/);
    assert.equal(out.truncated, false);
    assert.ok(builder.isComplete(out.html));
    assert.match(out.html, /<h1>لعبة<\/h1>/);
  } finally {
    mock.restore();
  }
});

test('ملفٌّ ظلّ ناقصاً بعد المحاولات يُسلَّم موسوماً بأنه ناقص لا صامتاً', async () => {
  const mock = mockModel([{ text: '```html\n<!doctype html>\n<html><body>', finish: 'MAX_TOKENS' }]);
  try {
    const out = await builder.chat({ turns: [{ role: 'user', text: 'ابنِها' }] });
    assert.equal(out.truncated, true);
    assert.equal(out.continuations, 2);
  } finally {
    mock.restore();
  }
});

test('ردٌّ نصّيٌّ محض لا يُنتظر له متابعة — سؤال العمر ليس ملفّاً مبتوراً', async () => {
  const mock = mockModel([{ text: 'لأي عمر أو صف هذه اللعبة؟' }]);
  try {
    const out = await builder.chat({ turns: [{ role: 'user', text: 'أريد لعبة' }] });
    assert.equal(mock.seen.calls.length, 1);
    assert.equal(out.html, '');
    assert.equal(out.truncated, false);
    assert.equal(out.text, 'لأي عمر أو صف هذه اللعبة؟');
  } finally {
    mock.restore();
  }
});

test('خادمٌ بلا مفتاح يقول ذلك صراحةً بدل أن ينادي', async () => {
  const key = process.env.EVOLINK_API_KEY;
  delete process.env.EVOLINK_API_KEY;
  try {
    assert.equal(builder.isConfigured(), false);
    await assert.rejects(() => builder.chat({ turns: [{ role: 'user', text: 'مرحباً' }] }), /EVOLINK_API_KEY/);
  } finally {
    process.env.EVOLINK_API_KEY = key;
  }
});
