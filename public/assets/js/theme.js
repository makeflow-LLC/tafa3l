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

  function stored() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : '';
    } catch {
      return '';
    }
  }

  /** سِمَةٌ تفرضها صفحةٌ بعينها حين لا يختار الزائر شيئاً — لا صفحة تفعل اليوم */
  const pageDefault = () => document.documentElement.getAttribute('data-theme-default') || '';

  /**
   * سِمَة المنصة الافتراضية: **داكنة**.
   *
   * قرارُ صاحب المنصة، لا استنتاجُ إعدادِ نظامٍ ولا تفضيلُ متصفّح: Tapio
   * تُعرض على شاشات صفوفٍ وبروجكترات، وهويّتها البصرية داكنة. فمن لم يختر
   * شيئاً يرى الداكنة، ولو كان نظامه فاتحاً.
   *
   * والاختيار الصريح يعلو عليها دائماً: زرّ السِمَة في كل صفحة، وما يختاره
   * الزائر يُحفظ ويرافقه بين الصفحات.
   */
  const FALLBACK = 'dark';

  /** المطبَّق فعلاً: اختيارُ الزائر، ثم افتراضُ الصفحة، ثم افتراض المنصة */
  function effective() {
    return stored() || pageDefault() || FALLBACK;
  }

  function apply() {
    const dark = effective() === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12102e' : '#ffffff');
  }
  apply();

  // إعداد النظام لم يعد يقرّر شيئاً بعد أن صار افتراض المنصة داكناً صراحةً،
  // فلا نستمع إلى تغيّره: صفحةٌ تنقلب لأن حاسوب المعلّم بدّل إعداده مفاجأةٌ
  // لا ميزة. والزرّ وحده هو ما يبدّل السِمَة.

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

  /** إعادة تطبيقٍ بعد تغيّر افتراض الصفحة، مع إعلام أزرار التبديل لتُعيد رسم نفسها */
  function refresh() {
    apply();
    global.dispatchEvent(new CustomEvent('themechange'));
  }

  global.Theme = { effective, set, mountToggle, refresh };
})(window);
