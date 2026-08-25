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

// ------------------------------------------------- الميزات التي تُطفأ

/**
 * المهمّ ليس أن تُكتب `off` في كتلة CONFIG — بل أن **تتغيّر التعليمات**.
 * نصُّ النظام يأمر بزرّ تلميح، ويقول عن محرّك المتعة «All mandatory»،
 * ويشترط في الفحص الصامت إعادةَ البناء إن غابت الشخصية. فلو بقيت تلك
 * الأسطر مع `off` لتناقض النصّ مع نفسه، والنموذج يتّبع الأمر الصريح لا
 * سطر الإعداد. هذه الاختبارات تحرس ذلك بالضبط.
 */

const prompt = (over) => builder.systemPrompt(builder.readConfig(over));

test('المبدأ: كل الميزات مُشغَّلة، فمن لم يمسّ الإعدادات يجد اللعبة كاملة', () => {
  const cfg = builder.readConfig({});
  for (const name of Object.keys(builder.SWITCHES)) assert.equal(cfg[name], true, name);
  const p = prompt({});
  assert.match(p, /Hint button suited to the activity, costing 5 points/);
  assert.match(p, /CHARACTER: one simple animated SVG companion/);
  assert.match(p, /countdown \/ limited lives/);
});

test('إطفاء التلميحات ينزع الأمر بالزرّ ويضع مكانه نهياً صريحاً', () => {
  const p = prompt({ hints: false });
  assert.equal(/Hint button suited to the activity/.test(p), false, 'لم يعد يأمر بزرّ التلميح');
  assert.match(p, /NO hint button and no hint system of any kind/);
  assert.match(p, /a hint button or any hint affordance/, 'ووجودُه صار عطلاً في الفحص الصامت');
  // وخصم التلميح يصير صفراً في كتلة CONFIG، فلا رقمٌ لميزةٍ لا وجود لها
  assert.match(builder.configBlock(builder.readConfig({ hints: false, hintPenalty: 30 })), /HINT_PENALTY\s+= 0/);
});

test('إطفاء المؤقّت ينزع العدّ التنازلي من خيارات التشويق كلّها', () => {
  const p = prompt({ timer: false });
  assert.equal(/countdown \/ limited lives/.test(p), false, 'العدّ التنازلي خرج من قائمة الخيارات');
  assert.match(p, /THE TIMER IS OFF/);
  assert.match(p, /no per-question time limit/);
  assert.match(p, /no time-based scoring or bonus/);
  // ونقرةُ الثواني الأخيرة تخرج من لوحة الأصوات وإن كان الصوت مُشغَّلاً
  assert.equal(/tick \(last 5 seconds\)/.test(p), false);
  // والتشويق يبقى قائماً — أطفأ المؤقّت لا اللعبة
  assert.match(p, /7\. TENSION — exactly one: limited lives/);
});

test('تشويقٌ بصفر: لا مؤقّت ولا أرواح ولا سلاسل — ووجودُ أيّها عطل', () => {
  const p = prompt({ tensionSystems: 0 });
  assert.match(p, /7\. TENSION — NONE/);
  assert.match(p, /any tension system at all is present/);
  // ومؤشّر التشويق يخرج من الشريط العلوي: لا مؤشّر لما لا وجود له
  assert.equal(/and the tension indicator/.test(p), false);
});

test('إطفاء الصوت يجعل اللعبة صامتة تماماً — بلا زرّ كتم أصلاً', () => {
  const p = prompt({ sound: false });
  assert.match(p, /the game must be completely silent/);
  assert.equal(/rising pitch tone/.test(p), false);
  assert.equal(/mute button \(there is nothing to mute\)/.test(p), true);
  assert.match(p, /any sound, AudioContext, or mute button/);
});

test('إطفاء الشخصية يمحوها من كل موضعٍ ذُكرت فيه لا من سطرها وحده', () => {
  const p = prompt({ character: false });
  assert.match(p, /CHARACTER: OFF/);
  // كانت مذكورة في ثلاثة مواضع: سطرها، وتشجيعُها عند الصواب، ورقصُها عند الترقّي
  assert.equal(/character cheers/.test(p), false);
  assert.equal(/character dance/.test(p), false);
  assert.equal(/tapping the character 5 times/.test(p), false, 'ومفاجأةٌ مبنيّة عليها تُستبدل بغيرها');
  assert.match(p, /a hidden bonus round after a long streak/);
});

test('الفحص الصامت لا يطلب ما أُطفئ — وإلا أعاد النموذج البناء إلى الأبد', () => {
  const p = prompt({ character: false, celebrations: false, surprises: false });
  const check = p.split('\n').find((line) => line.startsWith('Rebuild if:'));
  for (const demand of ['no character', 'no celebration', 'no surprise']) {
    assert.equal(check.includes(demand), false, `لم يعد يطلب «${demand}»`);
  }
  for (const ban of ['a mascot, avatar, or speech bubble', 'confetti, screen flash', 'an easter egg or hidden bonus']) {
    assert.ok(check.includes(ban), `وصار وجودُه عطلاً: ${ban}`);
  }
});

test('إطفاء بطاقة النتيجة يبقي شاشة النهاية وينزع خانة الاسم وحدها', () => {
  const p = prompt({ resultCard: false });
  assert.match(p, /End screen: score, errors, most-missed concept/, 'الشاشة باقية');
  assert.match(p, /NO name field and NO shareable result card/);
});

test('إطفاء كتلة تعديل المعلّم يحذف سطرها بلا أن يترك فراغاً', () => {
  const p = prompt({ teacherEditBlock: false });
  assert.equal(/TEACHER EDIT BLOCK: one clearly named JS array/.test(p), false);
  assert.equal(/\n\n\n/.test(p), false, 'لا سطر فارغ مضاعف مكان المحذوف');
});

test('المفتاح الغائب يأخذ مبدأه — فطلبٌ قديم بلا مفاتيح يعمل كما كان', () => {
  const cfg = builder.readConfig({ correctPoints: 15 });
  assert.equal(cfg.hints, true);
  assert.equal(cfg.timer, true);
  // والصريح وحده يُطفئ: أيّ قيمةٍ غير false تُقرأ تشغيلاً
  assert.equal(builder.readConfig({ hints: false }).hints, false);
  assert.equal(builder.readConfig({ hints: 'نعم' }).hints, true);
  assert.equal(builder.readConfig({ hints: 0 }).hints, true);
});

test('كتلة CONFIG تعلن حال كل ميزة on/off — والمفاتيح كلّها فيها', () => {
  const block = builder.configBlock(builder.readConfig({ hints: false, sound: false }));
  assert.match(block, /HINTS\s+= off/);
  assert.match(block, /SOUND\s+= off/);
  assert.match(block, /TIMER\s+= on/);
  for (const spec of Object.values(builder.SWITCHES)) assert.match(block, new RegExp(`${spec.key}\\s+= (on|off)`));
});
