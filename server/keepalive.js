'use strict';

/**
 * إبقاء الخادم مستيقظاً أثناء المحاضرة.
 *
 * الاستضافات المجانية (مثل خطة Render المجانية) توقف الخدمة بعد ١٥ دقيقة
 * بلا طلبات واردة، وإيقافها يمسح كل الجلسات لأن التخزين في الذاكرة.
 * لذلك نرسل طلباً خفيفاً لأنفسنا عبر العنوان العام كل بضع دقائق —
 * لكن فقط ما دامت هناك جلسة قائمة، حتى لا نستهلك ساعات الخطة المجانية بلا داعٍ.
 */

const DEFAULT_MINUTES = 10;

/** نبضة واحدة — تُرسل فقط إن كانت هناك جلسة قائمة. تعيد true إن أُرسلت. */
async function pingOnce(base, store) {
  if (!base || store.stats().sessions === 0) return false;
  try {
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), 10000);
    await fetch(`${base.replace(/\/+$/, '')}/api/health`, {
      headers: { 'x-keep-alive': '1' },
      signal: controller.signal,
    });
    clearTimeout(abort);
    return true;
  } catch {
    // فشل النبضة لا يضر — نحاول في الدورة التالية
    return false;
  }
}

function keepAliveUrl() {
  // Render يضبط RENDER_EXTERNAL_URL تلقائياً؛ وعلى غيرها اضبط KEEP_ALIVE_URL يدوياً
  return String(process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
}

function startKeepAlive(store) {
  const base = keepAliveUrl();
  if (!base) return null;

  const minutes = Number(process.env.KEEP_ALIVE_MINUTES) || DEFAULT_MINUTES;
  // أقل من دقيقة أو أكثر من ١٤ دقيقة لا يخدم الغرض (حد النوم ١٥ دقيقة)
  const everyMs = Math.min(14, Math.max(1, minutes)) * 60 * 1000;

  const timer = setInterval(() => pingOnce(base, store), everyMs);

  timer.unref?.();
  if (process.env.PORT !== '0') console.log(`إبقاء الخادم مستيقظاً: نبضة كل ${everyMs / 60000} دقيقة إلى ${base} أثناء وجود جلسات`);
  return timer;
}

module.exports = { startKeepAlive, pingOnce, keepAliveUrl };
