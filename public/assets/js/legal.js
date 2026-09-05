(function (global) {
  'use strict';

  /**
   * سياسة الخصوصية وشروط الاستخدام كبيانات مهيكلة.
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
                  '<strong>بيانات الطلاب مؤقتة بالكامل</strong>: الأسماء والإجابات والنقاط في ذاكرة الخادم فقط، وتُمحى تلقائياً بعد انتهاء الجلسة أو خمولها أو إعادة تشغيل الخادم. لا تُكتب في أي قاعدة بيانات — <strong>إلا حين يشغّل المعلّم «سجلّ الطلاب» على فصلٍ بعينه</strong> (انظر البند التالي).',
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
              {
                p: '<strong>سجلّ الطلاب (اختياري، بقرار المعلّم)</strong>: إن شغّل المعلّم «سجلّ الطلاب» على فصلٍ من فصوله، صار لكل اسمٍ كتبه رمزٌ شخصي، وحُفظت نتيجة كل نشاطٍ يدخله الطالب باسمه ورمزه: عنوان النشاط وتاريخه، ونسبته وعلامته، والأسئلة التي أخطأ فيها. لا بريد ولا هاتف ولا صورة. المعلّم وحده يرى السجل، ويستطيع حذف سجلّ أي طالب أو الفصل كله في أي وقت، وحذف الفصل يمحو سجلّه. والطالب يرى سجلّه هو من الجهاز الذي دخل منه. الطالب الذي يدخل ضيفاً — بلا اسمٍ من الكشف ورمز — لا يُحفظ له شيء.',
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
                note: '<strong>نتائج الجلسات مؤقتة بطبيعتها ولا تُحفظ</strong> ما لم تشغّل «سجلّ الطلاب» على الفصل. إن أردت الاحتفاظ بعلامات طلابك فنزّلها قبل إغلاق الجلسة أو شغّل السجل. لا نتحمّل مسؤولية نتائج لم تُنزَّل ولم تُسجَّل.',
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
   * يرسم مستنداً قانونياً.
   * @param {HTMLElement} root
   * @param {'privacy'|'terms'} which
   */
  function render(root, which) {
    const copy = DOCS[which].ar;

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
