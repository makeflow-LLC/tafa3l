'use strict';

/**
 * توليد صورةٍ مصغّرة للعبة من شيفرتها — جسر Evolink.
 *
 * خطوتان بنموذجين:
 *  ١) نموذج نصّي يقرأ HTML اللعبة فيعرف ما هي، ويعيد اسمها بالعربية ووصفاً
 *     إنجليزياً للصورة (النماذج تفهم الوصف الإنجليزي أدقّ).
 *  ٢) نموذج صور يرسم الوصف — **والاسم العربي مرسومٌ داخل الصورة نفسها**،
 *     كما طلب صاحب المنصة. فالوصف يحمل الاسم بين علامتَي اقتباس ويشترط
 *     نسخه حرفاً بحرف بحروفٍ متّصلة من اليمين إلى اليسار.
 *
 * والمطلوب **غلافُ لعبة** لا رسمةٌ عامة: مشهدٌ حيٌّ يملأ الإطار كما تُصمَّم
 * صورة لعبةٍ في متجر التطبيقات. والعنوان هو النصّ **الوحيد** فيه — لا سطرٌ
 * فرعيّ ولا شعارٌ ولا زرٌّ ولا حروفُ زينة.
 *
 * وضمانةٌ خلف التعليمات: إن أغفل النموذج النصّي الاسمَ من وصفه ألحقناه به
 * هنا — فالشرط لا يُترك لحُسن ظنٍّ بنموذج.
 *
 * والمفتاح من البيئة وحدها (EVOLINK_API_KEY) كما مفتاح أزور — لا يُكتب في
 * المستودع ولا يصل المتصفّح: كل نداءٍ يمرّ من هنا.
 */

const TEXT_ENDPOINT = 'https://direct.evolink.ai/v1beta/models';
const IMAGE_ENDPOINT = 'https://api.evolink.ai/v1/images/generations';
/*
 * معرّف النموذج كما تقبله الخدمة لا كما يظهر في عنوان صفحته: جرّبنا
 * `gemini-3-1-flash-lite` (وهو اسم الصفحة) فردّت الخدمة بأنه غير معروف
 * وأنه خطأ دائم لا يُعاد معه المحاولة. القائمة الصالحة في
 * GET /v1/models، والمختار منها «Gemini 3.5 Flash Lite».
 */
const TEXT_MODEL = 'gemini-3.5-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

const REQUEST_TIMEOUT_MS = 90000;
/*
 * الرسم مهمّةٌ غير متزامنة: النداء يُرجع `id` و`status` و`progress`
 * و`task_info.estimated_time` و`credits_reserved` — أي أن الطلب سُجّل ولم
 * يُرسم بعد. فنستطلعه حتى يكتمل.
 */
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 120000;
const DONE_STATUS = new Set(['succeeded', 'success', 'completed', 'complete', 'finished', 'done', 'ok']);
const FAIL_STATUS = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected', 'timeout', 'expired']);
// ما يكفي النموذج ليعرف اللعبة بلا أن نبعث ملفاً كاملاً قد يبلغ ميغابايتين
const MAX_HTML_CHARS = 60000;

function config() {
  return {
    key: String(process.env.EVOLINK_API_KEY || '').trim(),
    textModel: String(process.env.EVOLINK_TEXT_MODEL || TEXT_MODEL).trim(),
    imageModel: String(process.env.EVOLINK_IMAGE_MODEL || IMAGE_MODEL).trim(),
    textEndpoint: String(process.env.EVOLINK_TEXT_ENDPOINT || TEXT_ENDPOINT).trim(),
    imageEndpoint: String(process.env.EVOLINK_IMAGE_ENDPOINT || IMAGE_ENDPOINT).trim(),
  };
}

/**
 * عناوين استطلاع المهمّة. وثائق الخدمة محجوبةٌ عن بيئتنا فلم نتحقّق من
 * العنوان الصحيح بنداءٍ حيّ — فنجرّب المرشّحين بالترتيب، وأولُ عنوانٍ يردّ
 * بجسمٍ يخصّ المهمّة نلزمه لبقيّة الاستطلاع. ومن عرف العنوان الصحيح يضبطه
 * بـ EVOLINK_TASK_ENDPOINT ({id} موضع المعرّف) فيُستعمل وحده.
 */
function taskUrls(cfg, id) {
  const custom = String(process.env.EVOLINK_TASK_ENDPOINT || '').trim();
  if (custom) return [custom.includes('{id}') ? custom.replace('{id}', encodeURIComponent(id)) : `${custom.replace(/\/$/, '')}/${encodeURIComponent(id)}`];
  const base = cfg.imageEndpoint.replace(/\/v1\/.*$/, '/v1');
  const key = encodeURIComponent(id);
  return [
    `${base}/tasks/${key}`,
    `${base}/images/generations/${key}`,
    `${base}/images/tasks/${key}`,
    `${base}/task/${key}`,
    `${base}/tasks/${key}/result`,
  ];
}

function isConfigured() {
  return Boolean(config().key);
}

async function callJson(url, key, body, step) {
  const label = step === 'text' ? 'قراءة اللعبة' : 'رسم الصورة';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const wrapped = new Error(
      err.name === 'AbortError' ? `انتهت مهلة ${label} — أعد المحاولة` : `تعذّر الوصول إلى خدمة ${label}`
    );
    wrapped.status = 504;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const detail =
      (payload && (payload.error?.message || payload.message)) || (typeof payload === 'string' ? payload.slice(0, 200) : '');
    const err = new Error(detail ? `تعذّر ${label} — ردّت الخدمة: ${detail}` : `تعذّر ${label} — أعد المحاولة`);
    err.status = response.status === 429 ? 429 : 502;
    throw err;
  }
  return payload;
}

/** نصُّ ردّ Gemini مهما اختلف تفصيل الغلاف */
function geminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts.map((p) => p?.text || '').join('').trim();
    if (joined) return joined;
  }
  if (typeof payload?.text === 'string') return payload.text.trim();
  return '';
}

/**
 * أول صورة في ردّ التوليد — **بحثٌ عميق** لا مسارٌ واحد.
 *
 * الخدمة وسيطٌ أمام نماذج شتّى، وشكل ردّها ليس واحداً: قد يأتي على هيئة
 * OpenAI (‎data[0].b64_json‎ أو ‎data[0].url‎)، وقد يأتي على هيئة Gemini
 * الأصلية (‎candidates[0].content.parts[].inlineData.data‎)، وقد يُغلَّف
 * في ‎output‎ أو ‎result‎ أو ‎images‎. وقد ردّت علينا فعلاً بـ200 وشكلٍ لم
 * نتوقّعه فسقط التوليد عند «لم تُرجع صورة» ونحن لا نعرف ماذا وصل.
 *
 * فبدل ملاحقة الأشكال واحداً واحداً نمشي في الردّ كلّه: أول قيمةٍ تشبه
 * صورةً — data URL، أو base64 طويل تحت مفتاحٍ معروف، أو رابط صورة — هي
 * المطلوبة. والعمق محدودٌ فلا يدور في ردٍّ متشعّب.
 */
/*
 * مفتاحان بدرجتَي ثقة:
 *  - الصريحة: اسمُها يقول إنّها صورة، فتُقبل مهما قصرت.
 *  - العامّة: قد تحمل أيّ شيء (`model: "x"`)، فتُشترط فيها طولاً ومحارف
 *    base64 كي لا نلتقط كلمةً ونحسبها صورة.
 */
const B64_KEYS_EXPLICIT = new Set(['b64_json', 'b64', 'base64', 'image_base64', 'imageBase64']);
const B64_KEYS_LOOSE = new Set(['data', 'image', 'content']);
const URL_KEYS = new Set(['url', 'image_url', 'imageUrl', 'uri', 'src', 'link']);

function imageFrom(payload, depth = 0) {
  if (payload === null || payload === undefined || depth > 6) return null;

  if (typeof payload === 'string') {
    const value = payload.trim();
    if (/^data:image\/[a-z+.-]+;base64,/i.test(value)) return { b64: value };
    if (/^https?:\/\//i.test(value)) return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(value) ? { url: value } : null;
    // base64 عارٍ: طويلٌ بما يكفي ليكون صورة، وبمحارف base64 وحدها
    if (value.length > 512 && /^[A-Za-z0-9+/\s]+={0,2}$/.test(value)) return { b64: value.replace(/\s+/g, '') };
    return null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = imageFrom(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof payload !== 'object') return null;

  // Gemini الأصلية: بياناتٌ مضمّنة بنوعها
  const inline = payload.inlineData || payload.inline_data;
  if (inline && typeof inline.data === 'string' && inline.data.length > 64) {
    const mime = String(inline.mimeType || inline.mime_type || 'image/png');
    return { b64: `data:${mime};base64,${inline.data.replace(/\s+/g, '')}` };
  }

  // المفاتيح المعروفة أولاً، ثم بقيّة الردّ
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (typeof value !== 'string') continue;
    const clean = value.trim();
    if (!clean) continue;
    const explicit = B64_KEYS_EXPLICIT.has(key);
    if (explicit || B64_KEYS_LOOSE.has(key)) {
      if (/^data:image\//i.test(clean)) return { b64: clean };
      // العامّة وحدها تُشترط فيها العتبة؛ الصريحة اسمُها يكفي
      const looksB64 = /^[A-Za-z0-9+/\s]+={0,2}$/.test(clean);
      if (looksB64 && (explicit || clean.length > 512)) return { b64: clean.replace(/\s+/g, '') };
    }
    // رابطٌ تحت مفتاحٍ يقول إنّه رابط: نقبله بلا اشتراط امتداد — روابط
    // الشبكات الموقّعة تأتي بلا `.png` وهي صورٌ صحيحة
    if (URL_KEYS.has(key) && /^https?:\/\//i.test(clean)) return { url: clean };
  }
  for (const key of Object.keys(payload)) {
    if (key === 'error') continue;
    const found = imageFrom(payload[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** وصفٌ مختصر لشكل الردّ — يُذكر في الخطأ فيُعرف ما وصل بلا تخمين */
function describeShape(payload, depth = 0) {
  if (payload === null) return 'null';
  if (Array.isArray(payload)) return depth > 2 ? 'array' : `[${payload.length ? describeShape(payload[0], depth + 1) : ''}]`;
  if (typeof payload === 'string') return `string(${payload.length})`;
  if (typeof payload !== 'object') return typeof payload;
  if (depth > 2) return 'object';
  return `{${Object.keys(payload).slice(0, 12).map((k) => `${k}: ${describeShape(payload[k], depth + 1)}`).join(', ')}}`;
}

/**
 * الجملة التي تفرض رسم الاسم العربي داخل الصورة — تُستعمل ضمانةً حين
 * يُغفلها النموذج النصّي، وتُختبر بنصّها فلا تضيع في تعديلٍ لاحق.
 */
const titleClause = (name) =>
  `Game cover art, 16:9, filling the frame edge to edge. The Arabic title "${name}" must appear inside ` +
  'the image as large, bold, perfectly readable Arabic text styled like a game logo, in a modern Arabic ' +
  'display font, cursive and properly joined, right-to-left, spelled exactly character for character, ' +
  'centred and integrated into the artwork with enough contrast to read at thumbnail size. ' +
  'That title is the ONLY text in the whole image: no subtitle, tagline, caption, watermark, logo, ' +
  'button or UI, no Latin characters, no pseudo-Arabic shapes, no misspelling, no extra words.';

const GRADE_HINT = (grades) =>
  Array.isArray(grades) && grades.length ? `The game targets these school grades: ${grades.join(', ')}.` : 'The game targets school children.';

/**
 * الخطوة الأولى: النموذج يقرأ الشيفرة ويعيد اسم اللعبة ووصف صورتها.
 * نطلب JSON صريحاً، ونتسامح مع أسوار ```json حوله.
 */
async function describe({ html, title, subject, grades }) {
  const cfg = config();
  const instruction = [
    'You are given the full HTML source of a small educational browser game used by Arabic-speaking school teachers.',
    'Read the code — its texts, variable names, mechanics and visuals — and work out what the game actually is.',
    '',
    `Teacher-provided title (may be empty or vague): "${String(title || '').slice(0, 120)}"`,
    `Subject: "${String(subject || '').slice(0, 60)}". ${GRADE_HINT(grades)}`,
    '',
    'Reply with ONLY a JSON object, no prose, no code fence:',
    '{"name": "...", "prompt": "..."}',
    '',
    '"name": a short Arabic name for the game (2-5 words) that a teacher would recognise. Use the teacher title if it fits.',
    '"prompt": an English image-generation prompt for the GAME COVER ART. Requirements:',
    '- This is cover art for an educational game — it must LOOK like a game, not like a diagram,',
    '  a worksheet, a poster or a corporate illustration. Think of the key art of a polished mobile',
    '  game on a store page: a lively little scene with a clear focal subject, rich saturated colours,',
    '  soft depth and lighting, rounded playful shapes, a sense of fun and motion.',
    '- Age-appropriate for the grades above: cute and cartoonish for young children, bolder and',
    '  more adventurous for older grades.',
    '- Show the concrete subject of the game (numbers, letters, planets, shapes, animals…) as the',
    '  hero of the scene, so a teacher knows what the game is at a glance.',
    '- Composition: the illustration fills the whole frame edge to edge as a 16:9 landscape cover.',
    '  No borders, no frames, no white margins, no UI mock-ups, no screenshots of a phone or browser.',
    '',
    '- **The Arabic game title is the ONLY text allowed in the entire image.**',
    '  Write the exact Arabic title in double quotes inside the prompt, then demand it be reproduced',
    '  character for character with correct Arabic letterforms: cursive, joined, right-to-left,',
    '  fully diacritic-free, in a bold modern Arabic display font styled like a game logo —',
    '  large, centred, integrated into the artwork, with enough contrast (a soft shadow, glow or',
    '  simple panel behind it) that it reads at thumbnail size.',
    '- Everything else in the frame is pure illustration. Absolutely NO other text of any kind:',
    '  no subtitle, no tagline, no label, no caption, no watermark, no logo, no button, no score,',
    '  no numbers or letters used as decoration, no Latin characters anywhere, and no invented or',
    '  decorative pseudo-Arabic glyphs. The title, and nothing else.',
    '',
    'GAME SOURCE:',
    String(html || '').slice(0, MAX_HTML_CHARS),
  ].join('\n');

  const url = `${cfg.textEndpoint}/${encodeURIComponent(cfg.textModel)}:generateContent`;
  const payload = await callJson(url, cfg.key, { contents: [{ role: 'user', parts: [{ text: instruction }] }] }, 'text');

  const raw = geminiText(payload);
  if (!raw) {
    const err = new Error('لم يفهم النموذج شيفرة اللعبة — اكتب اسم اللعبة ثم أعد المحاولة');
    err.status = 502;
    throw err;
  }
  const fenced = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/m, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  let parsed = null;
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(fenced.slice(start, end + 1));
    } catch {
      parsed = null;
    }
  }
  // عنوان المعلّم إن كتبه هو الاسم، فهو ما يتوقّع رؤيته على الغلاف
  const name = String(title || parsed?.name || '').trim().slice(0, 60);
  let prompt = String(parsed?.prompt || '').trim().slice(0, 1200);
  if (!prompt) {
    const err = new Error('تعذّر وصف اللعبة للرسم — أعد المحاولة');
    err.status = 502;
    throw err;
  }
  // الاسم شرطٌ لا اقتراح: إن غاب عن الوصف أُلحق به
  if (name && !prompt.includes(name)) prompt = `${prompt} ${titleClause(name)}`;
  return { name, prompt };
}

/** الخطوة الثانية: الرسم. يعيد data URL جاهزاً للواجهة */
async function draw(prompt) {
  const cfg = config();
  const payload = await callJson(
    cfg.imageEndpoint,
    cfg.key,
    { model: cfg.imageModel, prompt, size: '16:9', quality: '1K', model_params: { thinking_level: 'auto' } },
    'image'
  );

  let image = imageFrom(payload);
  // مهمّةٌ سُجّلت ولم تُرسم بعد: نستطلعها حتى تكتمل
  if (!image && payload && typeof payload === 'object' && payload.id) {
    image = await awaitTask(cfg, String(payload.id));
  }
  if (!image) {
    // الشكل في الرسالة: بلا هذا يبقى العطل تخميناً في كل مرة
    const err = new Error(`لم نجد صورةً في ردّ الخدمة. شكل الردّ: ${describeShape(payload).slice(0, 400)}`);
    err.status = 502;
    throw err;
  }
  if (image.b64) {
    // نوع الصورة إن جاء في الـdata URL يبقى كما هو، وإلا PNG
    const match = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(image.b64);
    if (match) return `data:${match[1]};base64,${match[2]}`;
    return `data:image/png;base64,${image.b64}`;
  }
  // رابطٌ بدل البيانات: نجلبه هنا فلا يعتمد المتصفّح على نطاقٍ خارجي
  const res = await fetch(image.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error('تعذّر جلب الصورة المولَّدة — أعد المحاولة');
    err.status = 502;
    throw err;
  }
  const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${buf.toString('base64')}`;
}

/**
 * يستطلع المهمّة حتى تُرسم الصورة أو تفشل.
 *
 * وإن لم يردّ أيُّ عنوانٍ من المرشّحين، فالرسالة تسمّيها كلّها وتقول بم
 * ردّت — فيُعرف العنوان الصحيح من جولةٍ واحدة لا من تخمينٍ ثالث.
 */
async function awaitTask(cfg, id) {
  const started = Date.now();
  const candidates = taskUrls(cfg, id);
  const tried = [];
  let endpoint = null;

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const urls = endpoint ? [endpoint] : candidates;
    for (const url of urls) {
      let res;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        if (!endpoint) tried.push(`${url} → تعذّر الاتصال`);
        continue;
      }
      const text = await res.text().catch(() => '');
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        if (!endpoint) tried.push(`${url} → ${res.status}`);
        continue;
      }
      // عنوانٌ ردّ بنجاح: نلزمه فلا نُتعب الخدمة ببقيّة المرشّحين
      endpoint = url;

      const found = imageFrom(body);
      if (found) return found;

      const status = String(body?.status || body?.state || '').toLowerCase();
      if (FAIL_STATUS.has(status)) {
        const why = body?.error?.message || body?.message || body?.fail_reason || status;
        const err = new Error(`فشل رسم الصورة: ${String(why).slice(0, 200)}`);
        err.status = 502;
        throw err;
      }
      if (DONE_STATUS.has(status)) {
        // اكتملت ولا صورة: شكلُها في الرسالة كي يُعرف موضعها
        const err = new Error(`اكتمل الرسم ولم نجد الصورة. شكل الردّ: ${describeShape(body).slice(0, 400)}`);
        err.status = 502;
        throw err;
      }
      break; // ما زالت تُرسم — ننتظر الدورة التالية
    }

    if (!endpoint && tried.length >= candidates.length) {
      const err = new Error(
        `تعذّر متابعة مهمّة الرسم. جرّبنا: ${tried.slice(0, candidates.length).join(' | ')}. ` +
          'اضبط EVOLINK_TASK_ENDPOINT بعنوان متابعة المهمّة الصحيح ({id} موضع المعرّف).'
      );
      err.status = 502;
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const err = new Error('طال رسم الصورة أكثر من دقيقتين — أعد المحاولة');
  err.status = 504;
  throw err;
}

/** الخطوتان معاً — يعيد { name, prompt, image } */
async function generate({ html, title, subject, grades }) {
  if (!isConfigured()) {
    const err = new Error('توليد الصور غير مُفعّل على هذا الخادم — أضف المتغيّر EVOLINK_API_KEY');
    err.status = 503;
    throw err;
  }
  if (!String(html || '').trim()) {
    const err = new Error('أرفق شيفرة اللعبة أولاً كي يقرأها النموذج');
    err.status = 400;
    throw err;
  }
  const { name, prompt } = await describe({ html, title, subject, grades });
  const image = await draw(prompt);
  return { name, prompt, image };
}

module.exports = { generate, describe, draw, awaitTask, taskUrls, isConfigured, config, geminiText, imageFrom, describeShape, titleClause, TEXT_MODEL, IMAGE_MODEL, MAX_HTML_CHARS };
