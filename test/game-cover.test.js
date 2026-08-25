'use strict';

/**
 * توليد صورة اللعبة من شيفرتها: النموذج النصّي يقرأ الكود ويصف الصورة،
 * ونموذج الصور يرسمها. النداءان الحقيقيان مُستبدلان بردٍّ مزيّف، والاختبار
 * يثبت **شكل الطلب** كما تنصّ عليه الخدمة — فهو ما لا يُكتشف خطؤه إلا في
 * الإنتاج.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-cover-'));
process.env.EVOLINK_API_KEY = 'test-evolink-key';
const cover = require('../server/game-cover');

const HTML = '<html><body><h1>لعبة جمع الأعداد</h1><script>const answer = a + b;</script></body></html>';

/** يلتقط النداءين ويردّ عليهما */
function mockEvolink({ text, image, imageStatus = 200 }) {
  const original = global.fetch;
  const seen = { calls: [] };
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts?.body ? JSON.parse(opts.body) : null;
    seen.calls.push({ url: u, headers: opts?.headers, body });
    if (u.includes('generateContent')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      };
    }
    if (u.includes('/images/generations')) {
      return {
        ok: imageStatus === 200,
        status: imageStatus,
        text: async () => JSON.stringify(image),
      };
    }
    return original(url, opts);
  };
  return { seen, restore: () => (global.fetch = original) };
}

const B64 = Buffer.from('fake-png-bytes').toString('base64');

test('يقرأ الشيفرة ثم يرسم: نداءان بالشكل الذي تنصّ عليه الخدمة', async () => {
  const m = mockEvolink({
    text: '{"name":"جمع الأعداد","prompt":"Flat vector illustration of colourful numbers with the Arabic title \\"جمع الأعداد\\" written large in the lower part"}',
    image: { data: [{ b64_json: B64 }] },
  });
  try {
    const out = await cover.generate({ html: HTML, title: '', subject: 'رياضيات', grades: ['g3', 'g4'] });

    assert.equal(m.seen.calls.length, 2, 'نداءان لا أكثر');

    // ── النداء الأول: قراءة الشيفرة
    const first = m.seen.calls[0];
    assert.equal(
      first.url,
      'https://direct.evolink.ai/v1beta/models/gemini-3.5-flash-lite:generateContent',
      'المعرّف كما تقبله الخدمة — لا اسم صفحة النموذج'
    );
    assert.equal(first.headers.Authorization, 'Bearer test-evolink-key');
    assert.equal(first.body.contents[0].role, 'user');
    const asked = first.body.contents[0].parts[0].text;
    assert.match(asked, /لعبة جمع الأعداد/, 'شيفرة اللعبة نفسها تصل النموذج');
    assert.match(asked, /g3, g4/, 'ومعها الصفوف كي تناسب الصورة عمر الطالب');
    assert.match(asked, /must be rendered INSIDE the image as real readable text/, 'والاسم العربي مطلوبٌ داخل الصورة');

    // ── النداء الثاني: الرسم
    const second = m.seen.calls[1];
    assert.equal(second.url, 'https://api.evolink.ai/v1/images/generations');
    assert.equal(second.headers.Authorization, 'Bearer test-evolink-key');
    assert.deepEqual(
      { model: second.body.model, size: second.body.size, quality: second.body.quality, model_params: second.body.model_params },
      { model: 'gemini-3.1-flash-lite-image', size: '16:9', quality: '1K', model_params: { thinking_level: 'auto' } }
    );
    assert.match(second.body.prompt, /colourful numbers/, 'الوصف الذي استخرجه النموذج هو ما يُرسم');

    assert.equal(out.name, 'جمع الأعداد', 'والاسم العربي يعود مع الصورة');
    assert.match(second.body.prompt, /جمع الأعداد/, 'واسم اللعبة داخل وصف الرسم نفسه');
    assert.match(out.image, /^data:image\/png;base64,/, 'والصورة data URL جاهزة');
  } finally {
    m.restore();
  }
});

test('الاسم شرطٌ لا اقتراح: يُلحق بالوصف إن أغفله النموذج', async () => {
  const m = mockEvolink({
    text: '{"name":"مطابقة الحروف","prompt":"Flat vector illustration of playful letters"}',
    image: { data: [{ b64_json: B64 }] },
  });
  try {
    await cover.generate({ html: HTML, title: '', subject: '', grades: [] });
    const prompt = m.seen.calls[1].body.prompt;
    assert.match(prompt, /مطابقة الحروف/, 'الاسم أُلحق بالوصف');
    assert.match(prompt, /perfectly readable Arabic text/, 'مع شرط وضوح الحروف');
    assert.match(prompt, /cursive and properly joined, right-to-left/, 'ومتّصلةً من اليمين لليسار');
  } finally {
    m.restore();
  }
});

test('عنوان المعلّم إن كتبه هو ما يُرسم لا اسمُ النموذج', async () => {
  const m = mockEvolink({
    text: '{"name":"اسم اخترعه النموذج","prompt":"Flat vector illustration"}',
    image: { data: [{ b64_json: B64 }] },
  });
  try {
    const out = await cover.generate({ html: HTML, title: 'رحلة الفضاء', subject: '', grades: [] });
    assert.equal(out.name, 'رحلة الفضاء');
    assert.match(m.seen.calls[1].body.prompt, /رحلة الفضاء/, 'وهو ما يُرسم في الصورة');
  } finally {
    m.restore();
  }
});

test('الشيفرة الطويلة تُقصّ فلا يُبعث ملفٌ بميغابايتين', async () => {
  const huge = '<html>' + 'x'.repeat(cover.MAX_HTML_CHARS + 50000) + '</html>';
  const m = mockEvolink({ text: '{"name":"ل","prompt":"p"}', image: { data: [{ b64_json: B64 }] } });
  try {
    await cover.generate({ html: huge, title: '', subject: '', grades: [] });
    const asked = m.seen.calls[0].body.contents[0].parts[0].text;
    assert.ok(asked.length < cover.MAX_HTML_CHARS + 4000, 'الطلب يبقى في حجمٍ معقول');
  } finally {
    m.restore();
  }
});

test('ردّ الصورة برابطٍ بدل البيانات: يُجلب في الخادم فلا يعتمد المتصفّح على نطاقٍ خارجي', async () => {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('generateContent')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"name":"ل","prompt":"p"}' }] } }] }) };
    }
    if (u.includes('/images/generations')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ url: 'https://cdn.example/img.png' }] }) };
    }
    if (u === 'https://cdn.example/img.png') {
      return { ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => Buffer.from('bytes') };
    }
    return original(url, opts);
  };
  try {
    const out = await cover.generate({ html: HTML, title: 'ل', subject: '', grades: [] });
    assert.ok(seen.includes('https://cdn.example/img.png'), 'الخادم جلب الصورة بنفسه');
    assert.match(out.image, /^data:image\/png;base64,/);
  } finally {
    global.fetch = original;
  }
});

test('يجد الصورة مهما اختلف شكل الردّ — الخدمة وسيطٌ أمام نماذج شتّى', () => {
  const b64 = 'A'.repeat(900);
  const shapes = {
    'OpenAI b64': { data: [{ b64_json: b64 }] },
    'OpenAI url': { data: [{ url: 'https://cdn.x/i.png' }] },
    'Gemini inlineData': { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/webp', data: b64 } }] } }] },
    'Gemini inline_data': { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: b64 } }] } }] },
    'data URL في نصّ': { data: [{ image: 'data:image/png;base64,' + b64 }] },
    'مغلَّف في output': { output: { images: [{ b64: b64 }] } },
    'مغلَّف في result': { result: { data: [{ image_url: 'https://cdn.x/a.jpg' }] } },
    'مصفوفة نصوص': { images: ['data:image/jpeg;base64,' + b64] },
  };
  for (const [label, payload] of Object.entries(shapes)) {
    const found = cover.imageFrom(payload);
    assert.ok(found, `لم يجد الصورة في شكل «${label}»`);
    assert.ok(found.b64 || found.url, `شكل «${label}» بلا بيانات ولا رابط`);
  }
});

test('لا يخلط رسالة الخطأ بصورة، ولا نصّاً قصيراً ببيانات', () => {
  assert.equal(cover.imageFrom({ error: { message: 'x'.repeat(900) } }), null, 'رسالة الخطأ ليست صورة');
  assert.equal(cover.imageFrom({ model: 'gemini', created: 1 }), null, 'حقولُ الوصف ليست صورة');
  // الرابط تحت مفتاح url في ردّ صورٍ هو الصورة ولو بلا امتداد (روابط موقّعة)
  assert.deepEqual(cover.imageFrom({ data: [{ url: 'https://cdn.x/abc?sig=1' }] }), { url: 'https://cdn.x/abc?sig=1' });
});

test('حين لا تُرجع صورةً: الرسالة تكشف شكل الردّ لا تُخفيه', async () => {
  const m = mockEvolink({
    text: '{"name":"ل","prompt":"p"}',
    image: { created: 1, model: 'x', usage: { total: 3 } },
  });
  try {
    await assert.rejects(
      () => cover.generate({ html: HTML }),
      (err) => {
        assert.match(err.message, /لم نجد صورةً في ردّ الخدمة/);
        assert.match(err.message, /created/, 'ومفاتيح الردّ الحقيقية فيها');
        assert.match(err.message, /usage/);
        return true;
      }
    );
  } finally {
    m.restore();
  }
});

test('نوع الصورة يُحفظ كما جاء لا يُفترض PNG دائماً', async () => {
  const m = mockEvolink({
    text: '{"name":"ل","prompt":"p"}',
    image: { data: [{ b64_json: 'data:image/webp;base64,' + 'B'.repeat(900) }] },
  });
  try {
    const out = await cover.generate({ html: HTML });
    assert.match(out.image, /^data:image\/webp;base64,/);
  } finally {
    m.restore();
  }
});

/** الردّ الحقيقي الذي وصل من الخدمة: مهمّةٌ سُجّلت ولم تُرسم بعد */
const TASK_ACCEPTED = {
  created: 1, id: 'a'.repeat(32), model: 'gemini-3.1-flash-lite-image',
  object: 'image.generation.task', progress: 0, status: 'processing',
  task_info: { can_cancel: true, estimated_time: 30 }, type: 'image',
  usage: { billing_rule: 'reserved', credits_reserved: 4, user_group: 'default' },
};

/** يحاكي الخدمة غير المتزامنة: تسجيلٌ ثم استطلاعٌ حتى الاكتمال */
function mockAsync({ pollUrlMatch = '/v1/tasks/', readyAfter = 2, finalBody } = {}) {
  const original = global.fetch;
  const seen = { polls: [], tried: [] };
  let polls = 0;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('generateContent')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"name":"ل","prompt":"p"}' }] } }] }) };
    }
    if (u.includes('/images/generations') && opts?.method === 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify(TASK_ACCEPTED) };
    }
    seen.tried.push(u);
    if (!u.includes(pollUrlMatch)) return { ok: false, status: 404, text: async () => '{"error":{"message":"not found"}}' };
    seen.polls.push(u);
    polls += 1;
    const body = polls >= readyAfter
      ? (finalBody || { id: 'x', status: 'succeeded', progress: 100, data: [{ b64_json: 'C'.repeat(900) }] })
      : { id: 'x', status: 'processing', progress: 40 };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { seen, restore: () => (global.fetch = original) };
}

test('الرسم مهمّةٌ غير متزامنة: تُستطلَع حتى تكتمل فتصل الصورة', async () => {
  const m = mockAsync({});
  try {
    const out = await cover.generate({ html: HTML, title: 'ل' });
    assert.match(out.image, /^data:image\/png;base64,/, 'الصورة وصلت بعد الاستطلاع');
    assert.ok(m.seen.polls.length >= 2, 'استُطلعت أكثر من مرّة حتى اكتملت');
    assert.ok(m.seen.polls.every((u) => u.includes(m.seen.polls[0])), 'ولزم العنوان الذي ردّ أولاً');
  } finally {
    m.restore();
  }
});

test('فشل المهمّة يصل كسببٍ مفهوم لا كانتظارٍ بلا نهاية', async () => {
  const m = mockAsync({ readyAfter: 1, finalBody: { status: 'failed', error: { message: 'content policy' } } });
  try {
    await assert.rejects(() => cover.generate({ html: HTML }), /فشل رسم الصورة: content policy/);
  } finally {
    m.restore();
  }
});

test('لا عنوان متابعةٍ يردّ: الرسالة تسمّي ما جُرّب وتقول ما يُضبط', async () => {
  const m = mockAsync({ pollUrlMatch: '/never-matches/' });
  try {
    await assert.rejects(
      () => cover.generate({ html: HTML }),
      (err) => {
        assert.match(err.message, /تعذّر متابعة مهمّة الرسم/);
        assert.match(err.message, /404/, 'ومعها ما ردّ به كل عنوان');
        assert.match(err.message, /EVOLINK_TASK_ENDPOINT/, 'وكيف يُضبط الصحيح');
        return true;
      }
    );
  } finally {
    m.restore();
  }
});

test('عنوان المتابعة يُضبط من البيئة فيُستعمل وحده', () => {
  const before = process.env.EVOLINK_TASK_ENDPOINT;
  process.env.EVOLINK_TASK_ENDPOINT = 'https://api.evolink.ai/v1/jobs/{id}/status';
  try {
    const urls = cover.taskUrls(cover.config(), 'abc123');
    assert.deepEqual(urls, ['https://api.evolink.ai/v1/jobs/abc123/status'], 'المضبوط وحده لا المرشّحون');
  } finally {
    if (before === undefined) delete process.env.EVOLINK_TASK_ENDPOINT;
    else process.env.EVOLINK_TASK_ENDPOINT = before;
  }
});

test('مرشّحو المتابعة يُشتقّون من عنوان الصور نفسه', () => {
  const urls = cover.taskUrls(cover.config(), 'abc123');
  assert.ok(urls.length >= 4, 'أكثر من مرشّح');
  assert.ok(urls.includes('https://api.evolink.ai/v1/tasks/abc123'));
  assert.ok(urls.includes('https://api.evolink.ai/v1/images/generations/abc123'));
  assert.ok(urls.every((u) => u.startsWith('https://api.evolink.ai/v1/')), 'كلّها تحت نفس الأصل');
});

test('بلا شيفرة لا توليد — الصورة تُقرأ من اللعبة لا تُخترع', async () => {
  await assert.rejects(() => cover.generate({ html: '   ', title: 'لعبة' }), /أرفق شيفرة اللعبة/);
});

test('بلا مفتاح: رسالةٌ تقول ما ينقص الخادم لا انهيار', async () => {
  const key = process.env.EVOLINK_API_KEY;
  delete process.env.EVOLINK_API_KEY;
  try {
    assert.equal(cover.isConfigured(), false);
    await assert.rejects(() => cover.generate({ html: HTML }), /EVOLINK_API_KEY/);
  } finally {
    process.env.EVOLINK_API_KEY = key;
  }
});

test('خطأ من الخدمة يصل كرسالة مفهومة', async () => {
  const m = mockEvolink({
    text: '{"name":"ل","prompt":"p"}',
    image: { error: { message: 'quota exceeded' } },
    imageStatus: 429,
  });
  try {
    await assert.rejects(() => cover.generate({ html: HTML }), /رسم الصورة — ردّت الخدمة: quota exceeded/);
  } finally {
    m.restore();
  }
});

test('خطأ النموذج النصّي يقول إنّه في قراءة اللعبة لا في الصور', async () => {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('generateContent')) {
      return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: "Model 'x' is not available" } }) };
    }
    return original(url);
  };
  try {
    await assert.rejects(() => cover.generate({ html: HTML }), /تعذّر قراءة اللعبة — ردّت الخدمة: Model 'x' is not available/);
  } finally {
    global.fetch = original;
  }
});

test('ردٌّ بلا JSON صالح لا يمرّ صامتاً', async () => {
  const m = mockEvolink({ text: 'عذراً لم أفهم', image: { data: [{ b64_json: B64 }] } });
  try {
    await assert.rejects(() => cover.generate({ html: HTML }), /تعذّر وصف اللعبة/);
  } finally {
    m.restore();
  }
});

test('المفتاح لا يُكتب في المستودع', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'game-cover.js'), 'utf8');
  assert.equal(/sk-[A-Za-z0-9]{20,}/.test(src), false, 'لا مفتاح مكتوب في الشيفرة');
  assert.match(src, /process\.env\.EVOLINK_API_KEY/, 'بل من البيئة وحدها');
});
