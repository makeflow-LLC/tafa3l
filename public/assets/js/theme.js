/**
 * سِمَة فاتحة/داكنة يختارها الزائر.
 *
 * الرموز اللونية الداكنة موجودة أصلاً في `html.stage` (سِمَة الجلسة
 * المباشرة)، فلا نكرّرها: نضيف `html.dark` كاسمٍ ثانٍ للكتلة نفسها.
 *
 * يُحمَّل في <head> قبل أي رسم: لو انتظر نهاية الصفحة لَومَض الأبيض في وجه
 * من اختار الداكنة. ولهذا لا يعتمد على أي ملفٍّ آخر.
 */
(function (global) {
  'use strict';

  const KEY = 'tapio:theme';
  const media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : '';
    } catch {
      return '';
    }
  }

  /**
   * سِمَةٌ تفرضها الصفحة حين لا يختار الزائر شيئاً.
   *
   * شاشتا الطالب والبروجكتر مصمَّمتان داكنتين: ألوان الخيارات وبطاقة النتيجة
   * كلها مبنيّة على أرضيةٍ داكنة، وقاعةٌ مضاءة لا تُقرأ فيها شاشةٌ بيضاء.
   * فتبقيان داكنتين افتراضاً — واختيارُ الزائر الصريح يعلو عليهما دائماً،
   * لأن من يقرأ تحت الشمس أو يجد الداكنة متعبةً له الحقّ في أن يقلبها.
   */
  const pageDefault = () => document.documentElement.getAttribute('data-theme-default') || '';

  /** المطبَّق فعلاً: اختيارُ الزائر، ثم افتراضُ الصفحة، ثم ما يقوله نظامه */
  function effective() {
    return stored() || pageDefault() || (media && media.matches ? 'dark' : 'light');
  }

  function apply() {
    const dark = effective() === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12102e' : '#ffffff');
  }
  apply();

  // من لم يختر يدوياً يتبع نظامه ولو غيّره والصفحة مفتوحة — ما لم تفرض
  // الصفحة سِمَتها (شاشة العرض لا تنقلب لأن حاسوب المعلّم غيّر إعداده)
  media?.addEventListener?.('change', () => {
    if (!stored() && !pageDefault()) apply();
  });

  function set(value) {
    try {
      if (value === 'dark' || value === 'light') localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {
      /* تخزين معطّل — تبقى السِمَة لهذه الصفحة */
    }
    apply();
  }

  /** زرّ تبديل: يقلب إلى عكس المطبَّق الآن ويثبّته اختياراً صريحاً */
  function mountToggle(container, labels) {
    if (!container) return null;
    const btn = document.createElement('button');
    btn.className = 'icon-btn theme-btn';
    btn.type = 'button';
    const paint = () => {
      const dark = effective() === 'dark';
      const label = dark ? labels?.toLight || 'Light' : labels?.toDark || 'Dark';
      btn.textContent = dark ? '☀️' : '🌙';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    };
    btn.addEventListener('click', () => {
      set(effective() === 'dark' ? 'light' : 'dark');
      paint();
    });
    paint();
    global.addEventListener('themechange', paint);
    container.append(btn);
    return btn;
  }

  /**
   * لوحة المعلّم صفحةٌ واحدة تنتقل بين شاشاتٍ لكلٍّ منها افتراضها: الجلسة
   * المباشرة داكنة والتصفّح فاتح. فتُبدّل `data-theme-default` ثم تنادي هذه.
   */
  function refresh() {
    apply();
    global.dispatchEvent(new CustomEvent('themechange'));
  }

  global.Theme = { effective, set, mountToggle, refresh };
})(window);
