(function (global) {
  'use strict';

  /**
   * سياسة الخصوصية وشروط الاستخدام، بلغتيهما، كبيانات مهيكلة.
   *
   * كُتبت لتصف ما يفعله التطبيق فعلاً لا ما تفعله المنصات عادةً: نتائج الطلاب
   * لا تُحفظ إطلاقاً، ولا نستخدم متتبّعات، ولا نبيع شيئاً. أي تغيير في سلوك
   * التطبيق يجب أن ينعكس هنا.
   */

  const SUPPORT = '970597750343';
  const COMPANY_URL = 'https://makeflow.tech';

  const DOCS = {
    privacy: {
      ar: {
        docTitle: 'سياسة الخصوصية — Tapio',
        pageTitle: '🔒 سياسة الخصوصية',
        intro: 'باختصار: لا نحتفظ بإجابات الطلاب، ولا نتتبّع أحداً، ولا نبيع أي بيانات. وهذه التفاصيل.',
        updated: 'آخر تحديث: أغسطس ٢٠٢٦',
        sections: [
          {
            title: '١. الخلاصة في ثلاثة أسطر',
            blocks: [
              {
                ul: [
                  '<strong>بيانات الطلاب مؤقتة بالكامل</strong>: الأسماء والإجابات والنقاط في ذاكرة الخادم فقط، وتُمحى تلقائياً بعد انتهاء الجلسة أو خمولها أو إعادة تشغيل الخادم. لا تُكتب في أي قاعدة بيانات.',
                  '<strong>الطالب لا يحتاج حساباً</strong>، ولا نطلب منه بريداً ولا هاتفاً ولا أي معرّف — اسم أو كنية يكتبها هو، ويستطيع المعلّم إلغاء طلب الاسم كلياً.',
                  '<strong>لا إعلانات ولا متتبّعات ولا تحليلات طرف ثالث</strong>، ولا نبيع أو نشارك أي بيانات مع أحد.',
                ],
              },
            ],
          },
          {
            title: '٢. ما نحفظه فعلاً',
            blocks: [
              { p: 'الشيء الدائم الوحيد هو <strong>حساب المعلّم ومحتواه هو</strong>، وباختياره:' },
              {
                ul: [
                  '<strong>بيانات الحساب</strong>: الاسم والبريد والصورة الرمزية كما تصلنا من تسجيل الدخول بجوجل، وتاريخ التسجيل، وتاريخ انتهاء الاشتراك إن وُجد. لا نستلم كلمة مرورك ولا نراها إطلاقاً.',
                  '<strong>أنشطتك وأسئلتك</strong> المحفوظة في «نشاطاتي» و«بنك الأسئلة» — وهي من تأليفك أنت.',
                  '<strong>ملفات تعريف الارتباط</strong>: كعكة جلسة واحدة تُبقيك مسجّلاً، وكعكة مؤقتة أثناء تسجيل الدخول لحماية العملية. لا كعكات إعلانية ولا تتبّعية.',
                ],
              },
              {
                note: 'نتائج أي جلسة تُمحى تلقائياً. إن أردت الاحتفاظ بها فنزّلها (Excel أو PDF) قبل إغلاق الجلسة — وبعدها تصبح ملفاً على جهازك أنت، لا عندنا.',
                tone: 'warn',
              },
            ],
          },
          {
            title: '٣. لماذا نحفظه',
            blocks: [
              {
                ul: [
                  'لتبقى أنشطتك وأسئلتك متاحة لك في المرة القادمة.',
                  'لتمييز حسابك وإبقائك مسجّلاً بين الزيارات.',
                  'لمعرفة حالة اشتراكك في الخطة المدفوعة.',
                ],
              },
              { p: 'لا نستعمل بياناتك لأي غرض آخر — لا تسويق ولا تحليل سلوك ولا بناء ملفات اهتمامات.' },
            ],
          },
          {
            title: '٤. مع من نتشارك',
            blocks: [
              { p: 'لا نبيع بياناتك ولا نشاركها لأغراض تجارية. تمرّ بياناتك بمزوّدي خدمة تقنيين فقط، كلٌّ في حدود دوره:' },
              {
                table: {
                  head: ['الجهة', 'دورها', 'ما يصلها'],
                  rows: [
                    ['Google', 'تسجيل الدخول', 'اسمك وبريدك وصورتك — بموافقتك عند الدخول'],
                    ['Render', 'استضافة الخادم', 'ما يمرّ عبر الخادم أثناء التشغيل'],
                    ['Supabase', 'قاعدة بيانات الحسابات', 'حسابك وأنشطتك المحفوظة'],
                    ['Microsoft Azure', 'مساعد الذكاء الاصطناعي (اختياري)', 'نصّ محادثتك مع المساعد فقط، حين تستخدمه'],
                  ],
                },
              },
              { muted: 'مساعد الذكاء الاصطناعي لا يُستدعى إلا حين تفتحه وتكتب فيه، ولا تُرسَل إليه أي بيانات طلاب.' },
            ],
          },
          {
            title: '٥. حقوقك',
            blocks: [
              {
                ul: [
                  '<strong>الاطّلاع</strong>: كل ما نحفظه عنك ظاهر لك داخل التطبيق (حسابك، أنشطتك، بنك أسئلتك).',
                  '<strong>التصحيح والحذف</strong>: تستطيع تعديل أنشطتك أو حذفها في أي لحظة.',
                  '<strong>حذف الحساب كاملاً</strong>: راسلنا على واتساب الدعم أدناه ونحذف حسابك وكل محتواه.',
                  '<strong>الاستخدام بلا حساب</strong>: التطبيق يعمل كاملاً بلا تسجيل — عندها لا نحفظ عنك شيئاً إطلاقاً.',
                ],
              },
            ],
          },
          {
            title: '٦. الأطفال والمدارس',
            blocks: [
              {
                p: 'الطلاب يشاركون <strong>بلا حساب وبلا بيانات شخصية</strong> — اسم أو كنية فقط، وهو مؤقت يُمحى مع الجلسة. ننصح المعلّم بإطفاء «طلب الاسم» في الاستطلاعات الحسّاسة، أو استخدام أسماء مستعارة مع الصفوف الصغيرة.',
              },
              { p: 'حساب المعلّم للبالغين. إن كنت مسؤول مدرسة وتحتاج اتفاقية معالجة بيانات، راسلنا.' },
            ],
          },
          {
            title: '٧. الأمان',
            blocks: [
              {
                ul: [
                  'كل الاتصالات مشفّرة عبر HTTPS، والاتصال المباشر عبر WSS.',
                  'كعكة الجلسة محميّة (HttpOnly و Secure و SameSite) فلا تصل إليها أي شيفرة في الصفحة.',
                  'لا نخزّن كلمات مرور إطلاقاً — الدخول عبر جوجل وحدها.',
                  'رمز الجلسة ومفتاح المضيف مؤقتان وينتهيان بانتهاء الجلسة.',
                ],
              },
              { p: 'لا يوجد نظام محصّن تماماً. إن اكتشفت ثغرة فأبلغنا على واتساب الدعم ونتعامل معها فوراً.' },
            ],
          },
          {
            title: '٨. التغييرات والتواصل',
            blocks: [
              { p: 'إن غيّرنا هذه السياسة سنحدّث تاريخها أعلاه، وأي تغيير جوهري سنعلنه داخل التطبيق.' },
              { contact: true },
            ],
          },
        ],
      },

      en: {
        docTitle: 'Privacy policy — Tapio',
        pageTitle: '🔒 Privacy policy',
        intro: 'In short: we do not keep student answers, we do not track anyone, and we do not sell any data. Here are the details.',
        updated: 'Last updated: August 2026',
        sections: [
          {
            title: '1. The short version',
            blocks: [
              {
                ul: [
                  '<strong>Student data is entirely temporary</strong>: names, answers and points live in the server’s memory only, and are erased automatically when the session ends, goes idle, or the server restarts. They are never written to any database.',
                  '<strong>Students need no account</strong>, and we ask them for no email, no phone and no identifier — just a name or nickname they choose, and the teacher can switch off the name request entirely.',
                  '<strong>No ads, no trackers, no third-party analytics</strong>, and we never sell or share data with anyone.',
                ],
              },
            ],
          },
          {
            title: '2. What we actually store',
            blocks: [
              { p: 'The only permanent thing is <strong>the teacher’s account and their own content</strong>, and only if they choose to have one:' },
              {
                ul: [
                  '<strong>Account details</strong>: the name, email and avatar as they reach us from Google sign-in, the registration date, and the subscription expiry if there is one. We never receive or see your password.',
                  '<strong>Your activities and questions</strong> saved in “My activities” and the “Question bank” — content you authored.',
                  '<strong>Cookies</strong>: one session cookie that keeps you signed in, and a short-lived cookie during sign-in that protects the process. No advertising or tracking cookies.',
                ],
              },
              {
                note: 'Any session’s results are erased automatically. If you want to keep them, download them (Excel or PDF) before closing the session — after that they are a file on your device, not with us.',
                tone: 'warn',
              },
            ],
          },
          {
            title: '3. Why we store it',
            blocks: [
              {
                ul: [
                  'So your activities and questions are waiting for you next time.',
                  'To recognise your account and keep you signed in between visits.',
                  'To know the state of your paid subscription.',
                ],
              },
              { p: 'We use your data for nothing else — no marketing, no behavioural analysis, no interest profiling.' },
            ],
          },
          {
            title: '4. Who we share with',
            blocks: [
              { p: 'We do not sell your data or share it for commercial purposes. It passes through technical service providers only, each within its role:' },
              {
                table: {
                  head: ['Provider', 'Role', 'What reaches it'],
                  rows: [
                    ['Google', 'Sign-in', 'Your name, email and avatar — with your consent at sign-in'],
                    ['Render', 'Server hosting', 'Whatever passes through the server while it runs'],
                    ['Supabase', 'Accounts database', 'Your account and saved activities'],
                    ['Microsoft Azure', 'AI assistant (optional)', 'The text of your chat with the assistant only, when you use it'],
                  ],
                },
              },
              { muted: 'The AI assistant is only called when you open it and type in it, and no student data is ever sent to it.' },
            ],
          },
          {
            title: '5. Your rights',
            blocks: [
              {
                ul: [
                  '<strong>Access</strong>: everything we hold about you is visible to you inside the app (your account, activities and question bank).',
                  '<strong>Correction and deletion</strong>: you can edit or delete your activities at any moment.',
                  '<strong>Full account deletion</strong>: message us on the support WhatsApp below and we delete your account and all its content.',
                  '<strong>Use without an account</strong>: the app works fully without signing up — in that case we store nothing about you at all.',
                ],
              },
            ],
          },
          {
            title: '6. Children and schools',
            blocks: [
              {
                p: 'Students take part <strong>with no account and no personal data</strong> — a name or nickname only, and it is temporary and erased with the session. We recommend teachers switch off “require a name” for sensitive polls, or use pseudonyms with younger classes.',
              },
              { p: 'Teacher accounts are for adults. If you are a school administrator who needs a data processing agreement, contact us.' },
            ],
          },
          {
            title: '7. Security',
            blocks: [
              {
                ul: [
                  'All traffic is encrypted over HTTPS, and the live connection over WSS.',
                  'The session cookie is protected (HttpOnly, Secure, SameSite) so no script on the page can reach it.',
                  'We store no passwords at all — sign-in is through Google only.',
                  'The session code and host key are temporary and expire with the session.',
                ],
              },
              { p: 'No system is perfectly secure. If you find a vulnerability, report it on the support WhatsApp and we will act on it immediately.' },
            ],
          },
          {
            title: '8. Changes and contact',
            blocks: [
              { p: 'If we change this policy we will update the date above, and announce any material change inside the app.' },
              { contact: true },
            ],
          },
        ],
      },
    },

    terms: {
      ar: {
        docTitle: 'شروط الاستخدام — Tapio',
        pageTitle: '📜 شروط الاستخدام',
        intro: 'شروط مختصرة وواضحة لاستخدام Tapio. باستخدامك التطبيق فأنت توافق عليها.',
        updated: 'آخر تحديث: أغسطس ٢٠٢٦',
        sections: [
          {
            title: '١. الخدمة',
            blocks: [
              {
                p: 'Tapio منصة لإنشاء أسئلة واستطلاعات تفاعلية حيّة، تُقدّمها شركة <strong>makeflow</strong>. الاستخدام الأساسي مجاني بلا حدود على عدد الأنشطة أو الأسئلة أو الجلسات.',
              },
            ],
          },
          {
            title: '٢. حسابك',
            blocks: [
              {
                ul: [
                  'الحساب اختياري — التطبيق يعمل كاملاً بدونه، لكنه يحفظ أنشطتك.',
                  'أنت مسؤول عن حماية حساب جوجل الذي تدخل به.',
                  'الحساب شخصي؛ لا تشاركه ولا تنتحل صفة غيرك.',
                ],
              },
            ],
          },
          {
            title: '٣. محتواك',
            blocks: [
              {
                p: '<strong>أسئلتك وأنشطتك ملكك أنت.</strong> لا ندّعي ملكيتها ولا نستخدمها لغير تشغيل الخدمة لك، ولا نطّلع عليها إلا بقدر ما يلزم تقنياً أو حين تطلب دعماً.',
              },
              {
                p: 'وأنت مسؤول عمّا تنشره: لا تضع محتوى مخالفاً للقانون، أو مسيئاً، أو ينتهك حقوق غيرك، أو يكشف بيانات شخصية لأحد بلا إذنه.',
              },
            ],
          },
          {
            title: '٤. الاستخدام المقبول',
            blocks: [
              { p: 'يُمنع:' },
              {
                ul: [
                  'محاولة تعطيل الخدمة أو إغراقها أو اختراقها أو الوصول إلى جلسات لا تخصّك.',
                  'استخدام آليات آلية لإنشاء جلسات أو إغراق المشاركين.',
                  'إعادة بيع الخدمة أو تقديمها كأنها منتجك.',
                  'استخدام المنصة في غشّ أكاديمي أو في إيذاء أحد.',
                ],
              },
              { muted: 'قد نوقف حساباً يخالف هذه الشروط، ونبلّغه بالسبب حين يكون ذلك ممكناً.' },
            ],
          },
          {
            title: '٥. الاشتراك المدفوع',
            blocks: [
              {
                ul: [
                  'الخطة المدفوعة تفتح: تصميم النشاط بالذكاء الاصطناعي، وصور الأسئلة، وتصدير النتائج Excel و PDF.',
                  'الاشتراك شهري، ويُفعَّل يدوياً بعد التواصل على واتساب.',
                  'يمكنك التوقف في أي وقت؛ تبقى الميزات إلى نهاية المدة المدفوعة.',
                  'إن انتهت المدة يعود حسابك مجانياً بكل ميزاته الأساسية — لا يُحذف شيء من أنشطتك.',
                ],
              },
            ],
          },
          {
            title: '٦. حدود الخدمة والمسؤولية',
            blocks: [
              {
                note: '<strong>نتائج الجلسات مؤقتة بطبيعتها ولا تُحفظ.</strong> إن أردت الاحتفاظ بعلامات طلابك فنزّلها قبل إغلاق الجلسة. لا نتحمّل مسؤولية نتائج لم تُنزَّل.',
                tone: 'warn',
              },
              {
                p: 'نبذل وسعنا لإبقاء الخدمة متاحة وسليمة، لكنها تُقدَّم «كما هي» بلا ضمان انقطاعٍ صفري. لا نتحمّل الأضرار غير المباشرة الناتجة عن انقطاع أو خطأ، وتبقى مسؤوليتنا في حدود ما دفعته خلال الأشهر الثلاثة السابقة.',
              },
              { p: 'قد نغيّر الميزات أو نوقف بعضها، وسنُعلن التغييرات الجوهرية داخل التطبيق.' },
            ],
          },
          {
            title: '٧. الخصوصية',
            blocks: [
              { p: 'معالجة البيانات موضّحة في <a href="/privacy.html">سياسة الخصوصية</a>، وهي جزء من هذه الشروط.' },
            ],
          },
          {
            title: '٨. التواصل',
            blocks: [{ contact: true }],
          },
        ],
      },

      en: {
        docTitle: 'Terms of use — Tapio',
        pageTitle: '📜 Terms of use',
        intro: 'Short, clear terms for using Tapio. By using the app you agree to them.',
        updated: 'Last updated: August 2026',
        sections: [
          {
            title: '1. The service',
            blocks: [
              {
                p: 'Tapio is a platform for live interactive questions and polls, provided by <strong>makeflow</strong>. Core use is free with no limit on the number of activities, questions or sessions.',
              },
            ],
          },
          {
            title: '2. Your account',
            blocks: [
              {
                ul: [
                  'An account is optional — the app works fully without one, but an account saves your activities.',
                  'You are responsible for protecting the Google account you sign in with.',
                  'Accounts are personal; do not share yours or impersonate anyone.',
                ],
              },
            ],
          },
          {
            title: '3. Your content',
            blocks: [
              {
                p: '<strong>Your questions and activities are yours.</strong> We claim no ownership, use them for nothing but running the service for you, and access them only as far as is technically necessary or when you ask for support.',
              },
              {
                p: 'You are responsible for what you publish: do not post content that is unlawful, abusive, infringes others’ rights, or exposes someone’s personal data without their permission.',
              },
            ],
          },
          {
            title: '4. Acceptable use',
            blocks: [
              { p: 'The following is prohibited:' },
              {
                ul: [
                  'Attempting to disrupt, flood or break into the service, or to reach sessions that are not yours.',
                  'Using automated means to create sessions or flood participants.',
                  'Reselling the service or presenting it as your own product.',
                  'Using the platform for academic dishonesty or to harm anyone.',
                ],
              },
              { muted: 'We may suspend an account that breaches these terms, and will tell it why where that is possible.' },
            ],
          },
          {
            title: '5. Paid subscription',
            blocks: [
              {
                ul: [
                  'The paid plan unlocks: designing activities with AI, question images, and exporting results to Excel and PDF.',
                  'The subscription is monthly, and is activated manually after contacting us on WhatsApp.',
                  'You may stop at any time; the features remain until the end of the paid period.',
                  'When the period ends your account returns to free with all its core features — none of your activities are deleted.',
                ],
              },
            ],
          },
          {
            title: '6. Service limits and liability',
            blocks: [
              {
                note: '<strong>Session results are temporary by design and are not stored.</strong> If you want to keep your students’ marks, download them before closing the session. We are not responsible for results that were not downloaded.',
                tone: 'warn',
              },
              {
                p: 'We do our best to keep the service available and correct, but it is provided “as is” with no guarantee of zero downtime. We are not liable for indirect damages arising from an outage or a fault, and our liability is limited to what you paid over the preceding three months.',
              },
              { p: 'We may change features or retire some of them, and will announce material changes inside the app.' },
            ],
          },
          {
            title: '7. Privacy',
            blocks: [
              { p: 'How data is handled is set out in the <a href="/privacy.html">privacy policy</a>, which forms part of these terms.' },
            ],
          },
          {
            title: '8. Contact',
            blocks: [{ contact: true }],
          },
        ],
      },
    },
  };

  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);

  function elem(tag, attrs, html) {
    const node = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function listNode(items) {
    const list = elem('ul');
    list.style.cssText = 'line-height: 2; padding-inline-start: 22px; margin: 0';
    items.forEach((item) => list.append(elem('li', null, item)));
    return list;
  }

  function tableNode(spec) {
    const head = elem('tr');
    spec.head.forEach((c) => head.append(elem('th', null, c)));
    const thead = elem('thead');
    thead.append(head);
    const body = elem('tbody');
    spec.rows.forEach((row) => {
      const tr = elem('tr');
      row.forEach((c) => tr.append(elem('td', null, c)));
      body.append(tr);
    });
    const table = elem('table');
    table.append(thead, body);
    const wrap = elem('div', { class: 'table-wrap' });
    wrap.append(table);
    return wrap;
  }

  function contactNode() {
    const p = elem('p', { style: 'margin: 0' });
    const wa = elem('a', {
      class: 'btn primary sm',
      href: `https://wa.me/${SUPPORT}?text=${encodeURIComponent(t('fSupportMessage'))}`,
      target: '_blank',
      rel: 'noopener',
    });
    wa.textContent = '💬 ' + t('lContactSupport');
    const site = elem('a', { class: 'btn ghost sm', href: COMPANY_URL, target: '_blank', rel: 'noopener' });
    site.textContent = '🌐 makeflow.tech';
    const row = elem('div', { class: 'row', style: 'gap: 8px; margin-top: 6px' });
    row.append(wa, site);
    p.append(row);
    return p;
  }

  function blockNode(block) {
    if (block.p) return elem('p', { style: 'margin: 0' }, block.p);
    if (block.muted) return elem('p', { class: 'muted small', style: 'margin: 0' }, block.muted);
    if (block.note) return elem('div', { class: 'note small' + (block.tone ? ' ' + block.tone : '') }, block.note);
    if (block.ul) return listNode(block.ul);
    if (block.table) return tableNode(block.table);
    if (block.contact) return contactNode();
    return null;
  }

  /**
   * يرسم مستنداً قانونياً باللغة الحالية.
   * @param {HTMLElement} root
   * @param {'privacy'|'terms'} which
   */
  function render(root, which) {
    const lang = global.I18n && global.I18n.getLang() === 'en' ? 'en' : 'ar';
    const copy = DOCS[which][lang];

    document.title = copy.docTitle;
    document.querySelectorAll('[data-nav="home"]').forEach((n) => (n.textContent = t('lBackHome')));

    root.innerHTML = '';
    root.append(elem('h1', null, copy.pageTitle));
    root.append(elem('p', { class: 'muted' }, copy.intro));
    root.append(elem('p', { class: 'muted small' }, copy.updated));

    copy.sections.forEach((section) => {
      const card = elem('div', { class: 'card stack' });
      card.append(elem('h2', { style: 'margin: 0' }, section.title));
      section.blocks.forEach((block) => {
        const node = blockNode(block);
        if (node) card.append(node);
      });
      root.append(card);
    });
  }

  global.Legal = { render, DOCS };
})(window);
