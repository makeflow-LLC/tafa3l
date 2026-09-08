/**
 * صفحة المعلّم العامّة — رابطٌ يشاركه على فيسبوك وواتساب.
 *
 * وهي أوّل ما يراه من لا يعرف المعلّم: صورتُه واسمه وموادُّه وسنواتُ خبرته
 * والمدارس التي درّس فيها، وروابطُ عيّناتٍ من دروسه، وما نشره من أنشطة وما
 * بناه من ألعاب — ثم زرٌّ يفتح **صفحة الحجز** (book.js).
 *
 * بلا حساب: من يفتحها زائرٌ غالباً، فلا تطلب تسجيلاً ولا تعرف من يقرؤها.
 */
(function () {
  'use strict';

  const { $, el, api, toast, copyLink } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const app = $('#app');
  const id = new URLSearchParams(location.search).get('id') || '';

  // الشريط يحمل «الرئيسية» بنفسه — ولا نكرّرها
  window.SiteTopbar?.mount({});


  function fail(message) {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.4rem' }, text: '🧭' }),
        el('p', { class: 'muted', style: { margin: 0 }, text: message }),
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhome')),
      ])
    );
  }

  async function boot() {
    if (!id) return fail(t('tpNotFound'));
    let data;
    try {
      data = await api('/api/teachers/' + encodeURIComponent(id));
    } catch (err) {
      return fail(err.message || t('tpNotFound'));
    }
    const teacher = data.teacher;
    document.title = teacher.name + ' — ' + t('brand');
    app.replaceChildren();

    // ---- بطاقة التعريف
    const photo = teacher.photo
      ? el('img', { class: 'tp-face', src: '/api/teachers/' + encodeURIComponent(id) + '/photo', alt: '' })
      : el('div', { class: 'tp-face tp-face--empty', text: (teacher.name || '؟').charAt(0) });

    const head = el('div', { class: 'card stack' }, [
      el('div', { class: 'row', style: { gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, [
        photo,
        el('div', { class: 'stack tight grow' }, [
          el('h1', { style: { margin: 0 }, text: teacher.name }),
          el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, [
            ...(teacher.subjects || []).map((s) => el('span', { class: 'badge', text: tagLabel('subj', s) })),
            ...(teacher.grades || []).map((g) => el('span', { class: 'badge', style: { opacity: 0.85 }, text: tagLabel('grade', g) })),
            teacher.years ? el('span', { class: 'badge ok', text: t('tpYears', { n: teacher.years }) }) : null,
          ]),
        ]),
      ]),
      teacher.bio ? el('p', { style: { margin: 0, whiteSpace: 'pre-wrap' }, text: teacher.bio }) : null,
      // زرُّ المشاركة هنا لا في آخر الصفحة: من أعجبته الصفحة يشاركها فور قراءتها
      el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn ghost sm', type: 'button',
          onclick: async () => {
            const url = location.origin + '/t/' + encodeURIComponent(id);
            if (navigator.share) {
              try {
                await navigator.share({ title: teacher.name, url });
                return;
              } catch {
                /* أغلق نافذة المشاركة — نُكمل بالنسخ */
              }
            }
            toast((await copyLink(url)) ? t('tpCopied') : url, 'ok');
          },
        }, t('tpShare')),
        // الروابط بأيقونة منصّتها واسمها — كما تُعرض في بطاقة اللعبة
        ...(teacher.links || []).map((link) =>
          el('a', { class: 'btn ghost sm', href: link.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, `${link.icon} ${link.label}`)
        ),
      ]),
    ]);
    app.append(head);

    // ---- الخبرة: سنواتُها والمدارس. والسنوات سطرٌ صريح لا شارةً وحدها —
    // شارةٌ بين شاراتٍ تُقرأ بالعين ولا تُقرأ بالانتباه، وهي أوّل ما يُسأل عنه
    if (teacher.years || teacher.schools) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: t('tpExperience') }),
          teacher.years
            ? el('div', { class: 'row between', style: { gap: '8px' } }, [
                el('span', { class: 'muted small', text: t('profYears') }),
                el('strong', { text: t('tpYears', { n: teacher.years }) }),
              ])
            : null,
          teacher.schools
            ? el('div', { class: 'stack tight' }, [
                el('strong', { class: 'small', text: t('tpSchools') }),
                el('p', { class: 'muted', style: { margin: 0, whiteSpace: 'pre-wrap' }, text: teacher.schools }),
              ])
            : null,
        ])
      );
    }

    /*
     * عيّناتٌ من دروسه — **روابطُ خارجية** يضعها بنفسه: فيديو على يوتيوب،
     * ملفٌّ على درايف، منشورٌ فيه شرح. وهي أصدق ممّا ننتقيه له من داخل
     * المنصّة: الدرسُ الذي يفخر به قد لا يكون نشاطاً هنا أصلاً.
     */
    if ((teacher.samples || []).length) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: t('tpSample') }),
          ...teacher.samples.map((sample) =>
            el('a', {
              class: 'sample-link',
              href: sample.url,
              target: '_blank',
              rel: 'noopener noreferrer nofollow ugc',
            }, [
              el('span', { class: 'grow', text: sample.title }),
              el('span', { class: 'muted small', style: { direction: 'ltr' }, text: hostOf(sample.url) }),
              el('span', { 'aria-hidden': 'true', text: '↗' }),
            ])
          ),
        ])
      );
    }

    /*
     * الحجز صفحةٌ مستقلّة لا بطاقةٌ في ذيل هذه: فيها شروط المعلّم وأوقاته
     * في شبكةٍ واسعة، وهي **فعل** لا تعريف — فتُفتح بقرارٍ من الطالب.
     */
    if (teacher.booking) {
      app.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { style: { margin: 0 }, text: t('tpBookTitle') }),
          el('p', { class: 'muted small', style: { margin: 0, textAlign: 'center' }, text: t('tpBookIntro', { name: teacher.name }) }),
          el('a', { class: 'btn primary', href: '/book/' + encodeURIComponent(id) }, t('tpBookCta')),
        ])
      );
    }
    listsCard();
  }

  /** نطاقُ الرابط — يقول للطالب إلى أين يذهب قبل أن يضغط */
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * ما نشره وما بناه: أنشطته في المكتبة وألعابه.
   *
   * والفرق بين الاثنين عند الزائر جوهريّ: **اللعبة يفتحها بنفسه**، أمّا
   * النشاط فيُطلقه معلّمه في حصّة — وأسئلته وإجاباتها الصحيحة في المكتبة
   * لأصحاب الحسابات. فكان زرّ «افتح» يقود الطالبَ إلى بوّابة دخولٍ لا
   * تعنيه؛ صار يظهر لمن يملك حساباً، ويقرأ الطالبُ مكانَه جملةً تقول له
   * كيف يصله النشاط.
   */
  function listsCard() {
    Promise.all([
      api('/api/library?teacher=' + encodeURIComponent(id) + '&limit=12'),
      api('/api/auth/me').then((d) => Boolean(d.user)).catch(() => false),
    ])
      .then(([{ items }, signedIn]) => {
        if (!items?.length) return;
        app.append(
          el('div', { class: 'card stack' }, [
            el('h2', { style: { margin: 0 }, text: t('tpActivities') }),
            ...items.map((a) =>
              el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
                el('div', { class: 'stack tight grow' }, [
                  el('strong', { text: a.title }),
                  el('span', { class: 'muted small', text: [a.subject ? tagLabel('subj', a.subject) : '', t('hQuestionCount', { count: a.questionCount })].filter(Boolean).join(' · ') }),
                ]),
                signedIn
                  ? el('a', { class: 'btn ghost sm', href: '/host.html#/library/' + a.id }, t('tpOpen'))
                  : el('span', { class: 'muted small', text: t('tpActivityNote') }),
              ])
            ),
          ])
        );
      })
      .catch(() => {});

    api('/api/games?teacher=' + encodeURIComponent(id) + '&sort=new&limit=12')
      .then(({ items }) => {
        if (!items?.length) return;
        app.append(
          el('div', { class: 'card stack' }, [
            el('h2', { style: { margin: 0 }, text: t('tpGames') }),
            ...items.map((g) =>
              el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
                el('strong', { class: 'grow', text: g.title }),
                el('a', { class: 'btn ghost sm', href: '/games.html#/g/' + g.id }, t('tpPlay')),
              ])
            ),
          ])
        );
      })
      .catch(() => {});
  }

  boot();
})();
