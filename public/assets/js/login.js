/* تسجيل دخول المدرب — عبر جوجل فقط */
(function () {
  'use strict';

  const { $, el, toast, api } = window.T;
  const t = window.I18n.t;
  const app = $('#app');

  document.title = t('brand') + ' — ' + t('loginTitle');
  // الشريط العلوي مشترك: يبني «الرئيسية» والشعار ومبدّلي اللغة والسِمَة بنفسه

  // إلى أين نعود بعد الدخول (نقبل المسارات الداخلية فقط)
  const params = new URLSearchParams(location.search);
  const requested = params.get('next') || '/host.html#/mine';
  const next = /^\/[^/]/.test(requested) ? requested : '/host.html#/mine';
  const errorMsg = params.get('error');

  // أيقونة جوجل الملوّنة المعتادة لأزرار الدخول
  const GOOGLE_ICON =
    '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.4 0 6.4 1.2 8.8 3.5l6.6-6.6C35.2 2.6 30 0.5 24 0.5 14.8 0.5 6.9 5.8 3 13.5l7.7 6C12.5 13.6 17.7 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.6 37.6 46.5 31.6 46.5 24.5z"/>' +
    '<path fill="#FBBC05" d="M10.7 19.5A14.5 14.5 0 0 0 9.9 24c0 1.6.3 3.1.8 4.5l-7.7 6A24 24 0 0 1 0 24c0-3.9.9-7.6 2.6-10.8l8.1 6.3z"/>' +
    '<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.5-4.1-13.3-9.8l-8.1 6.3C6.9 42.2 14.8 48 24 48z"/>' +
    '</svg>';

  boot();

  async function boot() {
    let googleConfigured = true;
    // عدد أيام المنحة من الخادم لا رقماً مكتوباً هنا: يتغيّر بمتغيّر بيئة،
    // وصفحة الدخول أسوأ مكانٍ يَعِد فيه رقمٌ قديم بما لا يحدث
    let trialDays = 0;
    try {
      const { user, googleConfigured: configured, premium } = await api('/api/auth/me');
      googleConfigured = configured !== false;
      trialDays = premium?.plan?.signupTrialDays || 0;
      if (user) return renderAlready(user);
    } catch {
      /* الخادم قد يكون متوقفاً — نعرض الزر على أي حال */
    }
    render(googleConfigured, trialDays);
    if (errorMsg) toast(errorMsg, 'bad');
  }

  function renderAlready(user) {
    app.innerHTML = '';
    app.append(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.4rem' }, text: '👋' }),
        el('h1', { text: t('loginWelcome', { name: window.T.userName(user) }) }),
        el('p', { class: 'muted small', text: user.email }),
        el('a', { class: 'btn primary block', href: '/host.html#/mine' }, t('loginMyActivities')),
        el('a', { class: 'btn ghost block', href: '/host.html#/' }, t('loginNewActivity')),
        el(
          'button',
          {
            class: 'btn ghost sm',
            type: 'button',
            onclick: async () => {
              await api('/api/auth/logout', { method: 'POST' });
              location.reload();
            },
          },
          t('loginLogout')
        ),
      ])
    );
  }

  function render(googleConfigured, trialDays) {
    app.innerHTML = '';

    const googleBtn = el(
      'a',
      {
        class: 'btn primary block google-btn',
        href: '/api/auth/google?next=' + encodeURIComponent(next),
      },
      [el('span', { html: GOOGLE_ICON }), el('span', { text: t('loginGoogleBtn') })]
    );

    app.append(
      el('div', { class: 'card stack center' }, [
        el('h1', { text: t('loginTitle') }),
        // المنحة فوق الزرّ لا تحته: هي سببُ الضغط عليه
        trialDays ? el('div', { class: 'trial', style: { margin: 0 } }, t('loginTrialBadge', { days: trialDays })) : null,
        el('p', { class: 'muted small', text: t('loginSubtitle') }),
        googleConfigured
          ? googleBtn
          : el('div', { class: 'banner' }, [
              el('strong', { text: t('loginNotConfiguredTitle') }),
              el('div', { class: 'small', text: t('loginNotConfiguredBody') }),
            ]),
      ])
    );

    app.append(el('p', { class: 'footer' }, t('loginFooter')));
  }
})();
