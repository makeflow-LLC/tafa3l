(function (global) {
  'use strict';

  /**
   * تذييل موحّد لكل صفحات التطبيق: هوية الشركة، قناة الدعم، الروابط القانونية،
   * وزر تثبيت التطبيق على الجوال.
   *
   * يُركَّب مرة واحدة في نهاية كل صفحة بدل تكراره في ست ملفات HTML، فيبقى
   * محتواه في مكان واحد ويتبدّل مع اللغة كبقية الواجهة.
   */

  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const MAKEFLOW_URL = 'https://makeflow.tech';
  const SUPPORT_WHATSAPP = '970597750343';

  function link(href, text, opts) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (opts?.external) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    return a;
  }

  /**
   * زر تثبيت التطبيق. المتصفحات لا تسمح باستدعاء نافذة التثبيت إلا من حدث
   * `beforeinstallprompt` مخزَّن، ولا تُطلقه أصلاً إن كان التطبيق مثبّتاً أو
   * كان المتصفح لا يدعمه — فنُظهر الزر عند توفّره فقط، ولا نَعِد بما لا نملك.
   */
  const install = { event: null, button: null };

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  /** iOS لا يدعم beforeinstallprompt، والتثبيت فيه يدوي من قائمة المشاركة */
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  function showInstall() {
    if (!install.button) return;
    install.button.classList.remove('hidden');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // نؤجّلها لزرّنا بدل شريط المتصفح
    install.event = event;
    showInstall();
  });

  window.addEventListener('appinstalled', () => {
    install.event = null;
    install.button?.classList.add('hidden');
  });

  function installButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn accent sm install-btn hidden';
    btn.textContent = t('fInstall');
    btn.addEventListener('click', async () => {
      if (install.event) {
        install.event.prompt();
        const choice = await install.event.userChoice.catch(() => null);
        install.event = null;
        if (choice?.outcome === 'accepted') btn.classList.add('hidden');
        return;
      }
      // iOS: لا نافذة تثبيت، فنشرح الخطوة اليدوية بدل زر لا يفعل شيئاً
      if (global.T?.toast) global.T.toast(t('fInstallIos'), 'ok');
    });
    install.button = btn;
    // الجوال فقط، وليس التطبيق المثبّت أصلاً
    const mobile = window.matchMedia?.('(max-width: 720px)').matches;
    if (mobile && !isStandalone() && (install.event || isIos())) showInstall();
    return btn;
  }

  /** يبني عقدة التذييل */
  function build() {
    const foot = document.createElement('footer');
    foot.className = 'site-footer';

    const actions = document.createElement('div');
    actions.className = 'site-footer-actions';
    actions.append(installButton());

    const support = document.createElement('p');
    support.className = 'site-footer-support';
    support.append(
      document.createTextNode(t('fSupport') + ' '),
      link(
        `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(t('fSupportMessage'))}`,
        '💬 ' + SUPPORT_WHATSAPP,
        { external: true }
      )
    );

    const legal = document.createElement('p');
    legal.className = 'site-footer-legal';
    legal.append(link('/privacy.html', t('fPrivacy')), document.createTextNode(' · '), link('/terms.html', t('fTerms')));

    const by = document.createElement('p');
    by.className = 'site-footer-by';
    by.append(
      document.createTextNode(t('fByPrefix') + ' '),
      link(MAKEFLOW_URL, 'makeflow', { external: true }),
      document.createTextNode(' · ' + t('fRights', { year: new Date().getFullYear() }))
    );

    foot.append(actions, support, legal, by);
    return foot;
  }

  /** يركّب التذييل في نهاية الصفحة (مرة واحدة) */
  function mount(target) {
    registerWorker();
    if (document.querySelector('.site-footer')) return null;
    const foot = build();
    (target || document.body).append(foot);
    return foot;
  }

  /**
   * تسجيل عامل الخدمة. هو شرط المتصفح لإتاحة التثبيت، ولا يخزّن ملفات
   * التطبيق كي لا يرى معلّم واجهةً قديمة بعد النشر (انظر sw.js).
   */
  function registerWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* غيابه يعطّل زر التثبيت وحده، والتطبيق يعمل كاملاً بدونه */
    });
  }

  global.SiteFooter = { mount, build, registerWorker, MAKEFLOW_URL, SUPPORT_WHATSAPP };
})(window);
