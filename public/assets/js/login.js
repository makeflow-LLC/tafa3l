/* تسجيل دخول المدرب وإنشاء الحساب */
(function () {
  'use strict';

  const { $, el, toast, api } = window.T;
  const app = $('#app');

  // إلى أين نعود بعد الدخول (نقبل المسارات الداخلية فقط)
  const params = new URLSearchParams(location.search);
  const requested = params.get('next') || '/host.html#/mine';
  const next = /^\/[^/]/.test(requested) ? requested : '/host.html#/mine';

  let mode = params.get('mode') === 'signup' ? 'signup' : 'login';

  boot();

  async function boot() {
    try {
      const { user } = await api('/api/auth/me');
      if (user) return renderAlready(user);
    } catch {
      /* الخادم قد يكون متوقفاً — نعرض النموذج على أي حال */
    }
    render();
  }

  function renderAlready(user) {
    app.innerHTML = '';
    app.append(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.4rem' }, text: '👋' }),
        el('h1', { text: 'أهلاً ' + user.name }),
        el('p', { class: 'muted small', text: user.email }),
        el('a', { class: 'btn primary block', href: '/host.html#/mine' }, '📚 نشاطاتي'),
        el('a', { class: 'btn ghost block', href: '/host.html#/' }, '➕ نشاط جديد'),
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
          'تسجيل الخروج'
        ),
      ])
    );
  }

  function render() {
    const signup = mode === 'signup';
    app.innerHTML = '';

    const nameInput = el('input', { id: 'name', maxlength: 60, placeholder: 'مثال: أ. محمد', autocomplete: 'name' });
    const emailInput = el('input', {
      id: 'email',
      type: 'email',
      placeholder: 'teacher@example.com',
      autocomplete: 'email',
      style: { direction: 'ltr', textAlign: 'left' },
    });
    const passwordInput = el('input', {
      id: 'password',
      type: 'password',
      placeholder: '••••••••',
      autocomplete: signup ? 'new-password' : 'current-password',
      style: { direction: 'ltr', textAlign: 'left' },
    });

    const submit = el('button', { class: 'btn primary block', type: 'submit' }, signup ? 'إنشاء الحساب' : 'دخول');

    const card = el('div', { class: 'card stack' }, [
      el('h1', { text: signup ? 'حساب مدرب جديد' : 'دخول المدرب' }),
      el('p', {
        class: 'muted small',
        text: signup
          ? 'الحساب يحفظ أنشطتك لتعيد فتحها وإطلاقها متى شئت. نتائج الطلاب تبقى مؤقتة ولا تُحفظ.'
          : 'ادخل لتصل إلى أنشطتك المحفوظة.',
      }),
      signup ? el('div', {}, [el('label', { for: 'name', text: 'الاسم' }), nameInput]) : null,
      el('div', {}, [el('label', { for: 'email', text: 'البريد الإلكتروني' }), emailInput]),
      el('div', {}, [
        el('label', { for: 'password', text: 'كلمة المرور' }),
        passwordInput,
        signup ? el('div', { class: 'muted small', style: { marginTop: '4px' }, text: '٨ أحرف على الأقل' }) : null,
      ]),
      submit,
    ]);

    const form = el('form', { class: 'stack' }, [card]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = {
        email: emailInput.value.trim(),
        password: passwordInput.value,
        ...(signup ? { name: nameInput.value.trim() } : {}),
      };
      submit.disabled = true;
      submit.textContent = 'لحظة…';
      try {
        await api(signup ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body });
        location.href = next;
      } catch (err) {
        toast(err.message, 'bad');
        submit.disabled = false;
        submit.textContent = signup ? 'إنشاء الحساب' : 'دخول';
      }
    });

    app.append(form);

    app.append(
      el('div', { class: 'card center stack' }, [
        el('p', { class: 'muted small', style: { margin: 0 }, text: signup ? 'لديك حساب بالفعل؟' : 'ليس لديك حساب؟' }),
        el(
          'button',
          {
            class: 'btn ghost',
            type: 'button',
            onclick: () => {
              mode = signup ? 'login' : 'signup';
              render();
            },
          },
          signup ? 'تسجيل الدخول' : 'إنشاء حساب جديد'
        ),
      ])
    );

    app.append(
      el('p', { class: 'footer' }, 'يمكنك أيضاً استخدام تفاعل بلا حساب — لكن أنشطتك لن تُحفظ لإعادة استخدامها.')
    );
  }
})();
