/**
 * صفحة حجز الدرس الخصوصي — صفحةٌ مستقلّة أوسع من صفحة المعلّم.
 *
 * وفصلُها عن صفحة المعلّم مقصود: تلك تعريفٌ يُقرأ بتصفّح، وهذه **فعلٌ** له
 * ترتيب — تقرأ شروط المعلّم، ثم تختار يوماً ووقتاً، ثم تكتب بياناتك. وحشرُ
 * هذا كلّه أسفل صفحة تعريفٍ يجعل الشروط تُتخطّى والأوقات تضيق في عمود.
 *
 * وبعد الإرسال لا يُترك الطالب يخمّن: يُقال له صراحةً إن الطلب وصل، وإن
 * المعلّم **سيتواصل معه على واتساب ليؤكّد الموعد** — فالتأكيد قرارُ المعلّم
 * لا نتيجةُ الضغط على زرّ.
 */
(function () {
  'use strict';

  const { $, el, api, toast, store } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const app = $('#app');
  const id = new URLSearchParams(location.search).get('id') || '';
  const MINE_KEY = 'tafa3l:bookings';

  window.SiteTopbar?.mount({});

  /**
   * مفتاح اليوم **بتقويم القارئ** لا بتوقيت غرينتش.
   *
   * موعدُ الحادية عشرة ليلاً في القدس هو الثامنة مساءً بتوقيت غرينتش من اليوم
   * نفسه — لكن موعد الواحدة صباحاً يقع في يومٍ آخر عند أحدهما. فالتجميع هنا
   * بتقويم من ينظر إلى الشاشة، والخادم يرسل لحظاتٍ مطلقة لا أياماً.
   */
  const dayKey = (at) => {
    const d = new Date(at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayName = (at) => new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = (at) => new Date(at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  const when = (at) => new Date(at).toLocaleString('ar', { dateStyle: 'full', timeStyle: 'short' });

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
    let teacher;
    let schedule;
    try {
      [teacher, schedule] = await Promise.all([
        api('/api/teachers/' + encodeURIComponent(id)).then((d) => d.teacher),
        api('/api/teachers/' + encodeURIComponent(id) + '/slots'),
      ]);
    } catch (err) {
      return fail(err.message || t('tpNotFound'));
    }
    document.title = t('bpTitle', { name: teacher.name }) + ' — ' + t('brand');
    app.replaceChildren();

    // ---- ترويسة: من هو، ورابطُ صفحته الكاملة
    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row', style: { gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, [
          teacher.photo
            ? el('img', { class: 'tp-face', src: '/api/teachers/' + encodeURIComponent(id) + '/photo', alt: '' })
            : el('div', { class: 'tp-face tp-face--empty', text: (teacher.name || '؟').charAt(0) }),
          el('div', { class: 'stack tight grow' }, [
            el('h1', { style: { margin: 0 }, text: t('bpTitle', { name: teacher.name }) }),
            el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, [
              ...(teacher.subjects || []).map((s) => el('span', { class: 'badge', text: tagLabel('subj', s) })),
              teacher.years ? el('span', { class: 'badge ok', text: t('tpYears', { n: teacher.years }) }) : null,
            ]),
          ]),
          el('a', { class: 'btn ghost sm', href: '/t/' + encodeURIComponent(id) }, t('bpBackProfile')),
        ]),
      ])
    );

    if (!schedule.booking) {
      app.append(el('div', { class: 'card' }, el('p', { class: 'muted', style: { margin: 0 }, text: t('bpClosed') })));
      return;
    }

    /*
     * شروطُ المعلّم **قبل** الأوقات لا بعدها: من قرأ «الدرس ساعة والدفع
     * مقدّماً» ثم اختار وقتاً حجز وهو يعرف، ومن اختار أوّلاً لا يعود ليقرأ.
     */
    if (schedule.terms) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: t('bpTerms') }),
          el('p', { style: { margin: 0, whiteSpace: 'pre-wrap' }, text: schedule.terms }),
        ])
      );
    }

    const slots = schedule.slots || [];
    if (!slots.length) {
      app.append(el('div', { class: 'card' }, el('p', { class: 'muted', style: { margin: 0 }, text: t('tpNoSlots') })));
      mine();
      return;
    }

    // ---- الأيام وأوقاتها
    const byDay = [];
    const seen = new Map();
    slots.forEach((slot) => {
      const key = dayKey(slot.at);
      if (!seen.has(key)) {
        seen.set(key, { key, at: slot.at, slots: [] });
        byDay.push(seen.get(key));
      }
      seen.get(key).slots.push(slot);
    });

    const days = el('div', { class: 'chips' });
    const times = el('div', { class: 'slot-grid' });
    const formBox = el('div', { class: 'stack' });
    app.append(
      el('div', { class: 'card stack' }, [
        el('h2', { style: { margin: 0 }, text: t('bpPick') }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('bpPickHint') }),
        days,
        times,
        formBox,
      ])
    );

    let chosenDay = byDay[0];
    let chosen = null;

    const paintTimes = () => {
      times.replaceChildren(
        ...(chosenDay?.slots || []).map((slot) =>
          el('button', {
            class: 'slot' + (chosen?.id === slot.id ? ' on' : ''),
            type: 'button',
            onclick: () => {
              chosen = slot;
              paintTimes();
              paintForm();
            },
          }, [
            el('strong', { text: hour(slot.at) }),
            el('span', { class: 'muted small', text: t('tpMinutes', { n: slot.minutes }) }),
          ])
        )
      );
    };

    days.replaceChildren(
      ...byDay.map((d) =>
        el('button', {
          class: 'chip' + (d.key === chosenDay.key ? ' on' : ''),
          type: 'button',
          'data-day': d.key,
          onclick: () => {
            chosenDay = d;
            chosen = null;
            days.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.day === d.key));
            paintTimes();
            formBox.replaceChildren();
          },
          text: `${dayName(d.at)} · ${d.slots.length}`,
        })
      )
    );
    paintTimes();

    function paintForm() {
      if (!chosen) return formBox.replaceChildren();
      const name = el('input', { maxlength: 40, placeholder: t('tpNamePh'), value: store.local.get('tafa3l:name', '') || '' });
      const phone = el('input', { type: 'tel', inputmode: 'tel', maxlength: 24, placeholder: t('tpPhonePh') });
      const subject = el('input', {
        maxlength: 60,
        placeholder: t('tpSubjectPh'),
        value: (teacher.subjects || []).length === 1 ? tagLabel('subj', teacher.subjects[0]) : '',
      });
      const topic = el('textarea', { rows: 2, maxlength: 200, placeholder: t('tpTopicPh') });
      const send = el('button', { class: 'btn primary', type: 'button' }, t('tpSend'));

      send.addEventListener('click', async () => {
        send.disabled = true;
        try {
          const res = await api('/api/teachers/' + encodeURIComponent(id) + '/bookings', {
            method: 'POST',
            body: { slotId: chosen.id, name: name.value, phone: phone.value, subject: subject.value, topic: topic.value },
          });
          store.local.set('tafa3l:name', name.value.trim());
          remember(res.booking, teacher.name);
          done(res.booking, teacher, phone.value.trim());
        } catch (err) {
          toast(err.message, 'bad');
          send.disabled = false;
        }
      });

      formBox.replaceChildren(
        el('div', { class: 'note', text: t('tpChosen', { when: when(chosen.at) }) }),
        el('div', { class: 'book-form' }, [
          el('div', {}, [el('label', { text: t('tpName') }), name]),
          el('div', {}, [el('label', { text: t('tpPhone') }), phone, el('span', { class: 'muted small', text: t('tpPhoneHint') })]),
          el('div', {}, [el('label', { text: t('tpSubject') }), subject]),
          el('div', { style: { gridColumn: '1 / -1' } }, [el('label', { text: t('tpTopic') }), topic]),
        ]),
        send
      );
    }

    mine();
  }

  /**
   * بعد الإرسال: صفحةٌ واحدة تقول ما جرى وما سيجري.
   *
   * ولا تُترك الصفحة كما هي بشريط «أُرسل» يمرّ ويختفي: الطالب أرسل رقمه إلى
   * غريبٍ ينتظر ردّه، فيستحقّ جواباً واضحاً — طلبك وصل، وهذا موعده، والمعلّم
   * سيتواصل معك على واتساب ليؤكّده.
   */
  function done(bk, teacher, phone) {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.8rem' }, text: '📨' }),
        el('h1', { style: { margin: 0, textAlign: 'center' }, text: t('bpSentTitle') }),
        el('p', { class: 'note ok', style: { margin: 0 }, text: t('bpSentBody', { name: teacher.name }) }),
        el('div', { class: 'stack tight', style: { alignSelf: 'stretch' } }, [
          el('div', { class: 'row between', style: { gap: '8px' } }, [
            el('span', { class: 'muted small', text: t('bpWhen') }),
            el('strong', { text: when(bk.at) }),
          ]),
          el('div', { class: 'row between', style: { gap: '8px' } }, [
            el('span', { class: 'muted small', text: t('tpSubject') }),
            el('strong', { text: bk.subject || '—' }),
          ]),
          el('div', { class: 'row between', style: { gap: '8px' } }, [
            el('span', { class: 'muted small', text: t('tpPhone') }),
            el('strong', { style: { direction: 'ltr' }, text: phone }),
          ]),
        ]),
        el('p', { class: 'muted small', style: { margin: 0, textAlign: 'center' }, text: t('bpSentNote') }),
        el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } }, [
          el('a', { class: 'btn ghost sm', href: '/t/' + encodeURIComponent(id) }, t('bpBackProfile')),
          el('a', { class: 'btn ghost sm', href: location.pathname + location.search }, t('bpAnother')),
        ]),
      ])
    );
  }

  function remember(bk, teacherName) {
    const all = store.local.get(MINE_KEY, {}) || {};
    all[bk.id] = { id: bk.id, teacher: id, teacherName, at: bk.at };
    store.local.set(MINE_KEY, all);
  }

  /** طلباتي السابقة عند هذا المعلّم — حالتُها ورابط اللقاء إن قُبلت */
  function mine() {
    const all = store.local.get(MINE_KEY, {}) || {};
    const rows = Object.values(all).filter((b) => b.teacher === id);
    if (!rows.length) return;
    const card = el('div', { class: 'card stack' }, [el('h2', { style: { margin: 0 }, text: t('tpMine') })]);
    app.append(card);
    rows
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

  boot();
})();
