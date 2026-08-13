'use strict';

/**
 * جسر الذكاء الاصطناعي — Azure OpenAI (واجهة Responses).
 *
 * المفتاح لا يُكتب في المستودع أبداً: يأتي من متغيّرات البيئة على الخادم فقط
 * (AZURE_OPENAI_KEY). المتصفّح لا يرى المفتاح ولا يتصل بأزور مباشرة — كل نداء
 * يمرّ عبر خادمنا.
 */

const DEFAULT_ENDPOINT =
  'https://makeflow-ai-resource.services.ai.azure.com/api/projects/makeflow-ai/openai/v1/responses';

const REQUEST_TIMEOUT_MS = 60000;

function config() {
  return {
    endpoint: String(process.env.AZURE_OPENAI_ENDPOINT || DEFAULT_ENDPOINT).trim(),
    key: String(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || '').trim(),
    model: String(process.env.AZURE_OPENAI_MODEL || 'gpt-4.1').trim(),
    // واجهة /openai/v1/ لا تحتاج api-version؛ نضيفها فقط إن طُلبت لمسار قديم
    apiVersion: String(process.env.AZURE_OPENAI_API_VERSION || '').trim(),
  };
}

/** هل الخادم مهيّأ للنداء؟ (المفتاح موجود) */
function isConfigured() {
  return Boolean(config().key);
}

function requestUrl(cfg) {
  const url = new URL(cfg.endpoint);
  const isV1 = /\/openai\/v1(\/|$)/.test(url.pathname);
  if (cfg.apiVersion && !isV1 && !url.searchParams.has('api-version')) {
    url.searchParams.set('api-version', cfg.apiVersion);
  }
  return url.toString();
}

/** يستخرج النص من ردّ واجهة Responses مهما اختلف تفصيلها */
function extractText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const chunks = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (typeof node.text === 'string' && (!node.type || String(node.type).includes('text'))) chunks.push(node.text);
    if (node.content) walk(node.content);
  };
  walk(data.output);
  if (!chunks.length && Array.isArray(data.choices)) {
    // في حال وُجّه المسار إلى واجهة chat/completions بدل responses
    for (const choice of data.choices) if (choice?.message?.content) chunks.push(String(choice.message.content));
  }
  return chunks.join('\n').trim();
}

function errorFrom(status, payload) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    (typeof payload === 'string' && payload.slice(0, 300)) ||
    'تعذّر الاتصال بخدمة الذكاء الاصطناعي';
  const err = new Error(message);
  err.status = status === 401 || status === 403 ? 502 : status >= 500 ? 502 : 400;
  err.upstreamStatus = status;
  return err;
}

async function callOnce(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * محادثة واحدة مع النموذج.
 * @param {{system?:string, messages:Array<{role:string,content:string}>, maxOutputTokens?:number, temperature?:number}} opts
 * @returns {Promise<string>} نص الردّ
 */
async function complete({ system, messages, maxOutputTokens = 2000, temperature = 0.4 }) {
  const cfg = config();
  if (!cfg.key) {
    const err = new Error('خدمة الذكاء الاصطناعي غير مُفعّلة على هذا الخادم');
    err.status = 503;
    throw err;
  }

  // نقاط Foundry تتحقق بصرامة من حقل type لكل عنصر ولكل جزء محتوى
  const item = (role, text) => ({
    type: 'message',
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: String(text ?? '') }],
  });
  const input = [];
  if (system) input.push(item('system', system));
  for (const m of messages) input.push(item(m.role === 'assistant' ? 'assistant' : 'user', m.content));

  const url = requestUrl(cfg);
  const body = { model: cfg.model, input, max_output_tokens: maxOutputTokens, temperature };

  let response;
  try {
    response = await callOnce(url, { 'api-key': cfg.key }, body);
    // بعض نقاط Foundry تقبل Bearer فقط
    if (response.status === 401 || response.status === 403) {
      response = await callOnce(url, { authorization: `Bearer ${cfg.key}` }, body);
    }
  } catch (err) {
    const wrapped = new Error(
      err.name === 'AbortError' ? 'انتهت مهلة الردّ من خدمة الذكاء الاصطناعي — أعد المحاولة' : 'تعذّر الوصول إلى خدمة الذكاء الاصطناعي'
    );
    wrapped.status = 504;
    throw wrapped;
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw errorFrom(response.status, payload);

  const reply = extractText(payload);
  if (!reply) {
    const err = new Error('وصل ردّ فارغ من النموذج — أعد المحاولة');
    err.status = 502;
    throw err;
  }
  return reply;
}

module.exports = { complete, isConfigured, config, extractText, requestUrl, DEFAULT_ENDPOINT };
