(function (global) {
  'use strict';

  /**
   * شريطٌ علويٌّ موحَّد لكل صفحات التطبيق.
   *
   * كانت كل صفحةٍ تبنيه بنفسها، فاختلف الترتيب من صفحةٍ إلى أخرى: الشعار في
   * البداية هنا وفي النهاية هناك، و`EN` قبل مبدّل السِمَة في الألعاب وبعده في
   * الدليل — لأن `mountToggle` يُلحق داخل `#langRow`، و`#langRow` كان أحياناً
   * يحوي روابط التنقّل وأحياناً يسبقها. والنتيجة أن كل صفحةٍ بدت من تطبيقٍ
   * آخر، وأن زرّ «الرئيسية» ظهر في صفحتين وغاب عن البقيّة.
   *
   * القاعدة الواحدة هنا، على ترتيب `host.html` نفسه:
   *
   *   [الرئيسية] [روابط الصفحة]  ………  [الشعار] [EN] [السِمَة]
   *
   * جهة بداية القراءة للتنقّل، وجهة نهايتها للهوية والمبدّلين — بهذا الترتيب
   * في كل صفحة بلا استثناء.
   */

  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);

  /** رقم النسخة من وسم موجود في الصفحة، فلا يُكتب مرّتين */
  function version() {
    const tag = document.querySelector('script[src*="?v="], link[href*="?v="]');
    const src = tag ? tag.getAttribute('src') || tag.getAttribute('href') : '';
    return (src.match(/\?v=([\d.]+)/) || [])[1] || '';
  }

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    (kids || []).filter(Boolean).forEach((kid) => node.append(kid));
    return node;
  }

  /** الشعار: نسختان تتبادلان بالسِمَة كما في بقية الصفحات */
  function brand(href) {
    const v = version() ? '?v=' + version() : '';
    const img = (cls, file) =>
      el('img', { class: 'logo ' + cls, src: '/assets/logo' + file + '.svg' + v, alt: 'Tapio', width: '249', height: '159' });
    return el('a', { class: 'brand', href, style: 'text-decoration: none; color: inherit' }, [
      img('light-only', ''),
      img('dark-only', '-white'),
    ]);
  }

  /**
   * يبني الشريط داخل `.topbar` الموجود في الصفحة.
   *
   * @param {object} opts
   * @param {string} [opts.home='/']  وجهة زرّ الرئيسية والشعار معاً
   * @param {Array}  [opts.links=[]]  روابط إضافية للصفحة `{label, href}`
   * @param {Array}  [opts.end=[]]    عناصر تسبق الشعار (شارة اتصالٍ مثلاً)
   */
  function mount(opts) {
    const options = opts || {};
    const bar = document.querySelector('.topbar');
    if (!bar) return null;
    const home = options.home || '/';

    const start = el('div', { class: 'topbar-nav' }, [
      el('a', { class: 'btn ghost sm', href: home, text: t('hhome') }),
      ...(options.links || []).map((link) => el('a', { class: 'btn ghost sm', href: link.href, text: link.label })),
    ]);

    const themeRow = el('span', { id: 'themeRow' });
    const end = el('div', { class: 'topbar-actions' }, [...(options.end || []), brand(home), themeRow]);

    bar.replaceChildren(start, end);

    global.Theme?.mountToggle(themeRow, { toDark: t('themeToDark'), toLight: t('themeToLight') });
    return bar;
  }

  global.SiteTopbar = { mount };
})(window);
