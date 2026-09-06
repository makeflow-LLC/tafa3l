/**
 * صفحة المعلّم العامّة — رابطٌ يشاركه على فيسبوك وواتساب.
 *
 * وهي أوّل ما يراه من لا يعرف المعلّم: صورتُه واسمه وموادُّه وسنواتُ خبرته
 * وشهاداتُه والمدارس التي درّس فيها، وعيّنةٌ من درسه، وتحتها ما نشره من
 * أنشطة وما بناه من ألعاب — ثم **زرُّ حجز موعد**.
 *
 * بلا حساب: من يفتحها زائرٌ غالباً، واشتراطُ تسجيلٍ قبل أن يطلب موعداً يقتل
 * الغرض. فيكفي اسمُه ورقم واتسابه — وهو الرقم الذي سيردّ عليه المعلّم.
 */
(function () {
  'use strict';

  const { $, el, api, toast, store, copyLink } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const app = $('#app');
  const id = new URLSearchParams(location.search).get('id') || '';
  /** طلباتي على هذا الجهاز — بها أعود لأرى إن قُبل الموعد */
  const MINE_KEY = 'tafa3l:bookings';

  // الشريط يحمل «الرئيسية» بنفسه — ولا نكرّرها
  window.SiteTopbar?.mount({});

  const dayName = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = (at) => new Date(at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  const when = (at) => new Date(at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });

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

    // ---- الخبرة: الشهادات والمدارس — وما لم يُملأ لا يُعرض أصلاً
    if (teacher.credentials || teacher.schools) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: t('tpExperience') }),
          teacher.credentials
            ? el('div', { class: 'stack tight' }, [
                el('strong', { class: 'small', text: t('tpCredentials') }),
                el('p', { class: 'muted', style: { margin: 0, whiteSpace: 'pre-wrap' }, text: teacher.credentials }),
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

    // ---- عيّنة من درسه
    if (teacher.sample) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: t('tpSample') }),
          el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap' } }, [
            el('div', { class: 'stack tight grow' }, [
              el('strong', { text: teacher.sample.title }),
              el('span', { class: 'muted small', text: t('hQuestionCount', { count: teacher.sample.questionCount }) }),
            ]),
            el('a', { class: 'btn primary sm', href: '/host.html#/library/' + teacher.sample.id }, t('tpOpenSample')),
          ]),
        ])
      );
    }

    if (teacher.booking) app.append(bookingCard(teacher));
    mineCard();
    listsCard();
  }

  /**
   * الحجز: أيّامٌ أزرارها أوقات — كما في Calendly.
   *
   * والترتيب مقصود: يختار اليوم فيرى أوقاته، ثم يملأ اسمه ورقمه ومادّته.
   * ولا يُطلب منه شيءٌ قبل أن يعرف أنّ ثمّة وقتاً يناسبه أصلاً.
   */
  function bookingCard(teacher) {
    const card = el('div', { class: 'card stack' }, [
      el('h2', { style: { margin: 0 }, text: t('tpBookTitle') }),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('tpBookIntro', { name: teacher.name }) }),
    ]);
    const days = el('div', { class: 'chips' });
    const times = el('div', { class: 'slot-grid' });
    const formBox = el('div', { class: 'stack' });
    card.append(days, times, formBox);

    let chosenDay = null;
    let chosenSlot = null;

    api('/api/teachers/' + encodeURIComponent(id) + '/slots')
      .then((data) => {
        const list = data.days || [];
        if (!list.length) {
          days.replaceChildren(el('span', { class: 'muted small', text: t('tpNoSlots') }));
          return;
        }
        const paintTimes = () => {
          const day = list.find((d) => d.day === chosenDay);
          times.replaceChildren(
            ...(day?.slots || []).map((slot) => {
              const btn = el('button', {
                class: 'slot' + (chosenSlot?.id === slot.id ? ' on' : ''),
                type: 'button',
                onclick: () => {
                  chosenSlot = slot;
                  paintTimes();
                  paintForm();
                },
              }, [
                el('strong', { text: hour(slot.at) }),
                el('span', { class: 'muted small', text: t('tpMinutes', { n: slot.minutes }) }),
              ]);
              return btn;
            })
          );
        };
        days.replaceChildren(
          ...list.map((d) =>
            el('button', {
              class: 'chip' + (d.day === chosenDay ? ' on' : ''),
              type: 'button',
              onclick: () => {
                chosenDay = d.day;
                chosenSlot = null;
                days.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.day === d.day));
                paintTimes();
                formBox.replaceChildren();
              },
              'data-day': d.day,
              text: dayName(d.day) + ' · ' + d.slots.length,
            })
          )
        );
        // اليوم الأول مفتوحٌ سلفاً: صفحةٌ تُفتح على أوقاتٍ جاهزة أقربُ إلى الحجز
        days.querySelector('.chip')?.click();
      })
      .catch(() => days.replaceChildren(el('span', { class: 'muted small', text: t('tpNoSlots') })));

    function paintForm() {
      if (!chosenSlot) return formBox.replaceChildren();
      const name = el('input', { maxlength: 40, placeholder: t('tpNamePh'), value: store.local.get('tafa3l:name', '') || '' });
      const phone = el('input', { type: 'tel', inputmode: 'tel', maxlength: 24, placeholder: t('tpPhonePh') });
      const subject = el('input', { maxlength: 60, placeholder: t('tpSubjectPh'), value: (teacher.subjects || []).length === 1 ? tagLabel('subj', teacher.subjects[0]) : '' });
      const topic = el('textarea', { rows: 2, maxlength: 200, placeholder: t('tpTopicPh') });
      const send = el('button', { class: 'btn primary', type: 'button' }, t('tpSend'));

      send.addEventListener('click', async () => {
        send.disabled = true;
        try {
          const res = await api('/api/teachers/' + encodeURIComponent(id) + '/bookings', {
            method: 'POST',
            body: { slotId: chosenSlot.id, name: name.value, phone: phone.value, subject: subject.value, topic: topic.value },
          });
          store.local.set('tafa3l:name', name.value.trim());
          remember(res.booking, teacher.name);
          toast(t('tpSent'), 'ok');
          boot();
        } catch (err) {
          toast(err.message, 'bad');
          send.disabled = false;
        }
      });

      formBox.replaceChildren(
        el('div', { class: 'note', text: t('tpChosen', { when: when(chosenSlot.at) }) }),
        el('div', {}, [el('label', { text: t('tpName') }), name]),
        el('div', {}, [el('label', { text: t('tpPhone') }), phone, el('span', { class: 'muted small', text: t('tpPhoneHint') })]),
        el('div', {}, [el('label', { text: t('tpSubject') }), subject]),
        el('div', {}, [el('label', { text: t('tpTopic') }), topic]),
        send
      );
    }

    return card;
  }

  /** يحفظ الطلب على الجهاز — به يعود صاحبه ليرى إن قُبل */
  function remember(bk, teacherName) {
    const all = store.local.get(MINE_KEY, {}) || {};
    all[bk.id] = { id: bk.id, teacher: id, teacherName, at: bk.at };
    store.local.set(MINE_KEY, all);
  }

  /** طلباتي عند هذا المعلّم: حالتُها ورابط اللقاء إن قُبلت */
  function mineCard() {
    const all = store.local.get(MINE_KEY, {}) || {};
    const mine = Object.values(all).filter((b) => b.teacher === id);
    if (!mine.length) return;
    const card = el('div', { class: 'card stack' }, [el('h2', { style: { margin: 0 }, text: t('tpMine') })]);
    app.append(card);
    mine
      .sort((a, b) => a.at - b.at)
      .forEach((row) => {
        const line = el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--border)' } }, [
          el('span', { class: 'grow', text: when(row.at) }),
          el('span', { class: 'muted small', text: '…' }),
        ]);
        card.append(line);
        api('/api/bookings/' + encodeURIComponent(row.id) + '/status')
          .then(({ booking }) => {
            const tone = booking.status === 'confirmed' ? 'ok' : booking.status === 'declined' ? 'bad' : 'warn';
            /*
             * `replaceChildren` تكتب «null» نصّاً حين يمرّ عليها فراغ — بخلاف
             * `el` التي تُسقطه. فالقائمة تُبنى ثم تُصفّى قبل أن تُمرَّر.
             */
            const parts = [
              el('div', { class: 'stack tight grow' }, [
                el('strong', { text: when(booking.at) }),
                booking.subject ? el('span', { class: 'muted small', text: booking.subject }) : null,
              ]),
              el('span', { class: 'badge ' + tone, text: t('tpStatus_' + booking.status) }),
            ];
            if (booking.link) {
              parts.push(el('a', { class: 'btn primary sm', href: booking.link, target: '_blank', rel: 'noopener' }, t('tpJoinMeet')));
            }
            line.replaceChildren(...parts);
          })
          .catch(() => line.remove());
      });
  }

  /** ما نشره وما بناه: أنشطته في المكتبة وألعابه */
  function listsCard() {
    api('/api/library?teacher=' + encodeURIComponent(id) + '&limit=12')
      .then(({ items }) => {
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
                el('a', { class: 'btn ghost sm', href: '/host.html#/library/' + a.id }, t('tpOpen')),
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
