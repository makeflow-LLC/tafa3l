'use strict';

/**
 * روابط المعلّم على وسائل التواصل — رابطان على الأكثر.
 *
 * وهذه الروابط **تُنشر على صفحةٍ عامّة يفتحها طلاب**، فالتحقّق منها أمنٌ لا
 * ترتيب: `javascript:` في حقل رابطٍ يُعرض بوسم `a` شفرةٌ تعمل بنقرة الطالب.
 * ولذلك القاعدة هنا **قائمةٌ بيضاء للبروتوكول** لا قائمةً سوداء لما يُمنع:
 * `http` و`https` وحدهما يمرّان، وكلُّ ما عداهما يُرفض بلا استثناء ولا
 * محاولة تصحيح.
 *
 * والمنصّة تُستنتج من النطاق لا يكتبها المعلّم: من ألصق رابط إنستغرام لا
 * يصحّ أن يُسأل «أيّ منصّة هذه؟».
 */

const MAX_LINKS = 2;
const MAX_URL = 200;

/**
 * النطاقات المعروفة وأسماؤها. الترتيب يهمّ: `youtu.be` قبل `youtube.com`
 * لا فرق هنا لأن المطابقة على النطاق كاملاً أو لاحقةً منه.
 */
const PLATFORMS = [
  { key: 'facebook', label: 'فيسبوك', icon: 'f', hosts: ['facebook.com', 'fb.com', 'fb.me', 'fb.watch'] },
  { key: 'instagram', label: 'إنستغرام', icon: '📷', hosts: ['instagram.com', 'instagr.am'] },
  { key: 'x', label: 'X', icon: '𝕏', hosts: ['x.com', 'twitter.com', 't.co'] },
  { key: 'youtube', label: 'يوتيوب', icon: '▶', hosts: ['youtube.com', 'youtu.be'] },
  { key: 'tiktok', label: 'تيك توك', icon: '🎵', hosts: ['tiktok.com'] },
  { key: 'telegram', label: 'تيليجرام', icon: '✈️', hosts: ['t.me', 'telegram.me', 'telegram.org'] },
  { key: 'whatsapp', label: 'واتساب', icon: '💬', hosts: ['wa.me', 'whatsapp.com', 'chat.whatsapp.com'] },
  { key: 'snapchat', label: 'سناب شات', icon: '👻', hosts: ['snapchat.com'] },
  { key: 'linkedin', label: 'لينكدإن', icon: 'in', hosts: ['linkedin.com'] },
  { key: 'threads', label: 'ثريدز', icon: '@', hosts: ['threads.net', 'threads.com'] },
];

/** المنصّة من النطاق — أو `site` لأيّ موقعٍ آخر (مدوّنة المعلّم مثلاً) */
function detect(url) {
  let host = '';
  try {
    host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'site';
  }
  const hit = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h)));
  return hit ? hit.key : 'site';
}

/** وصفُ منصّةٍ بمفتاحها — للواجهة، وللخادم حين يكتب صفحة مشاركة */
function platformOf(key) {
  return PLATFORMS.find((p) => p.key === key) || { key: 'site', label: 'الموقع', icon: '🌐', hosts: [] };
}

/**
 * ينظّف رابطاً واحداً: `https` تُضاف لمن كتب النطاق وحده، وما ليس
 * `http(s)` يُرفض.
 *
 * @returns {string} الرابط بعد التطبيع، أو فراغٌ إن كان غير صالح
 */
function cleanOne(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > MAX_URL) return '';

  /*
   * من يكتب «instagram.com/me» يقصد رابطاً، ومن يكتب «javascript:alert(1)»
   * يقصد شيئاً آخر. فالإضافة لا تجري إلا حين لا يكون في النصّ بروتوكولٌ
   * أصلاً — وإلّا صار `https://` + `javascript:…` بابَ تحايلٍ مفتوحاً.
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : 'https://' + text);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  // نطاقٌ حقيقيّ فيه نقطة على الأقل: «https://me» ليس حساباً على شيء
  if (!url.hostname.includes('.')) return '';
  const out = url.toString();
  return out.length > MAX_URL ? '' : out;
}

/**
 * ينظّف ما وصل من المتصفّح: رابطان على الأكثر، بلا تكرار ولا فراغ.
 * ويرمي خطأً ذا حالة إن أرسل المتصفّح رابطاً غير صالح — الصمت هنا يعني
 * معلّماً يحفظ ثم يفتح صفحته فلا يجد ما كتب.
 */
function cleanList(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    const text = String(item ?? '').trim();
    if (!text) continue;
    const url = cleanOne(text);
    if (!url) {
      const err = new Error('رابط غير صالح: اكتب عنواناً كاملاً يبدأ بـ https');
      err.status = 400;
      throw err;
    }
    if (!out.includes(url)) out.push(url);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** الشكل الذي تُرسل به إلى المتصفّح: رابطٌ ومنصّته */
function publicList(links) {
  return (Array.isArray(links) ? links : []).slice(0, MAX_LINKS).map((url) => {
    const platform = platformOf(detect(url));
    return { url, platform: platform.key, label: platform.label, icon: platform.icon };
  });
}

module.exports = { PLATFORMS, MAX_LINKS, MAX_URL, detect, platformOf, cleanOne, cleanList, publicList };
