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
 * وضمانةٌ خلف التعليمات: إن أغفل النموذج النصّي الاسمَ من وصفه ألحقناه به
 * هنا — فالشرط لا يُترك لحُسن ظنٍّ بنموذج.
 *
 * والمفتاح من البيئة وحدها (EVOLINK_API_KEY) كما مفتاح أزور — لا يُكتب في
 * المستودع ولا يصل المتصفّح: كل نداءٍ يمرّ من هنا.
 */

const TEXT_ENDPOINT = 'https://direct.evolink.ai/v1beta/models';
const IMAGE_ENDPOINT = 'https://api.evolink.ai/v1/images/generations';
const TEXT_MODEL = 'gemini-3-1-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

const REQUEST_TIMEOUT_MS = 90000;
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

function isConfigured() {
  return Boolean(config().key);
}

async function callJson(url, key, body) {
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
      err.name === 'AbortError' ? 'انتهت مهلة توليد الصورة — أعد المحاولة' : 'تعذّر الوصول إلى خدمة توليد الصور'
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
    const err = new Error(detail ? `خدمة الصور ردّت بخطأ: ${detail}` : 'تعذّر توليد الصورة — أعد المحاولة');
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

/** أول صورة في ردّ التوليد — تُقبل b64 أو رابط */
function imageFrom(payload) {
  const item = payload?.data?.[0] || payload?.images?.[0] || null;
  if (!item) return null;
  const b64 = item.b64_json || item.b64 || item.image_base64 || (typeof item === 'string' && !/^https?:/.test(item) ? item : '');
  if (b64) return { b64: String(b64) };
  const url = item.url || (typeof item === 'string' ? item : '');
  return url ? { url: String(url) } : null;
}

/**
 * الجملة التي تفرض رسم الاسم العربي داخل الصورة — تُستعمل ضمانةً حين
 * يُغفلها النموذج النصّي، وتُختبر بنصّها فلا تضيع في تعديلٍ لاحق.
 */
const titleClause = (name) =>
  `The Arabic title "${name}" must appear inside the image as large, bold, perfectly readable Arabic text ` +
  'in a clean modern Arabic display font, cursive and properly joined, right-to-left, spelled exactly ' +
  'character for character, centred in the lower part of the image on a simple high-contrast band. ' +
  'No Latin text, no pseudo-Arabic shapes, no misspelling, no extra words.';

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
    '"prompt": an English image-generation prompt for the game\'s thumbnail. Requirements:',
    '- Describe a bright, friendly, flat vector illustration that shows what the game is about.',
    '- Age-appropriate for the grades above: playful and cartoonish for young children, cleaner and more mature for older grades.',
    '- Name the concrete objects of the game (numbers, letters, planets, shapes, animals…) so the picture reads at a glance.',
    '- Cheerful colours, simple shapes, soft background, no clutter.',
    '- **The Arabic game title must be rendered INSIDE the image as real readable text.**',
    '  Write the exact Arabic title in double quotes inside the prompt, then demand it be reproduced',
    '  character for character with correct Arabic letterforms: cursive, joined, right-to-left,',
    '  fully diacritic-free, in a clean bold modern Arabic display font, large and centred in the',
    '  lower part of the image, high contrast against a simple band or panel behind it so it reads at',
    '  thumbnail size. No Latin text anywhere, no invented or decorative pseudo-Arabic glyphs,',
    '  no misspelling, no extra words beyond the title itself.',
    '',
    'GAME SOURCE:',
    String(html || '').slice(0, MAX_HTML_CHARS),
  ].join('\n');

  const url = `${cfg.textEndpoint}/${encodeURIComponent(cfg.textModel)}:generateContent`;
  const payload = await callJson(url, cfg.key, {
    contents: [{ role: 'user', parts: [{ text: instruction }] }],
  });

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
  const payload = await callJson(cfg.imageEndpoint, cfg.key, {
    model: cfg.imageModel,
    prompt,
    size: '16:9',
    quality: '1K',
    model_params: { thinking_level: 'auto' },
  });

  const image = imageFrom(payload);
  if (!image) {
    const err = new Error('لم تُرجع خدمة الصور صورةً — أعد المحاولة');
    err.status = 502;
    throw err;
  }
  if (image.b64) {
    const clean = image.b64.replace(/^data:[a-z/+-]+;base64,/i, '');
    return `data:image/png;base64,${clean}`;
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

module.exports = { generate, describe, draw, isConfigured, config, geminiText, imageFrom, titleClause, TEXT_MODEL, IMAGE_MODEL, MAX_HTML_CHARS };
