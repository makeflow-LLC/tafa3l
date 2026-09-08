/**
 * دليل المعلّمين — يتصفّحه الطالب ليجد معلّمه.
 *
 * الطالب يعرف عن معلّمه اسمه ومادّته وصفّه وبلده، فهذه هي المرشّحات — لا
 * أكثر. والترشيح في الخادم لا هنا: الدليل قد يطول، والخادم يعرف ما يُعرض
 * وما لا يُعرض. والصفحة تكتب مرشّحاتها في العنوان فيُشارَك بحثٌ بعينه
 * («معلّمو الرياضيات في الأردن») كما يُشارَك أيّ رابط.
 */
(function () {
  'use strict';

  const { $, el, api } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const SUBJECTS = (window.I18n && window.I18n.SUBJECTS) || [];
  const GRADES = (window.I18n && window.I18n.GRADES) || [];
  const app = $('#app');
  const PAGE = 24;

  window.SiteTopbar?.mount({});
  document.title = t('tdTitle').replace(/^\S+\s/, '') + ' · Tapio';

  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') || '',
    country: params.get('country') || '',
    subject: params.get('subject') || '',
    grade: params.get('grade') || '',
    booking: params.get('booking') === '1',
    offset: 0,
  };

  let countryNames = null;
  const countryName = (code) => countryNames?.get(code) || code;

  function syncUrl() {
    const next = new URLSearchParams();
    if (state.q) next.set('q', state.q);
    if (state.country) next.set('country', state.country);
    if (state.subject) next.set('subject', state.subject);
    if (state.grade) next.set('grade', state.grade);
    if (state.booking) next.set('booking', '1');
    const qs = next.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function query() {
    const q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.country) q.set('country', state.country);
    if (state.subject) q.set('subject', state.subject);
    if (state.grade) q.set('grade', state.grade);
    if (state.booking) q.set('booking', '1');
    q.set('limit', String(PAGE));
    q.set('offset', String(state.offset));
    return '/api/teachers?' + q.toString();
  }

  function face(item) {
    if (item.photo) return el('img', { class: 'tp-face', src: '/api/teachers/' + item.id + '/photo', alt: item.name, loading: 'lazy' });
    return el('div', { class: 'tp-face tp-face--empty', text: (item.name || '؟').trim().charAt(0) });
  }

  function card(item) {
    const tags = [
      ...item.subjects.map((s) => el('span', { class: 'badge', text: tagLabel('subj', s) })),
      ...item.grades.map((g) => el('span', { class: 'badge', style: { opacity: 0.85 }, text: tagLabel('grade', g) })),
    ];
    const facts = [
      item.country ? countryName(item.country) : '',
      item.years ? t('tdYears', { n: item.years }) : '',
      item.published ? t('tdActivities', { n: item.published }) : '',
      item.games ? t('tdGames', { n: item.games }) : '',
    ].filter(Boolean);
    return el('a', { class: 'card td-card', href: '/t/' + encodeURIComponent(item.id) }, [
      face(item),
      el('div', { class: 'stack tight', style: { minWidth: 0 } }, [
        el('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, [
          el('strong', { text: item.name }),
          item.booking ? el('span', { class: 'badge ok', text: t('tdBooks') }) : null,
        ]),
        tags.length ? el('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } }, tags) : null,
        facts.length ? el('div', { class: 'muted small', text: facts.join(' · ') }) : null,
        item.bio ? el('div', { class: 'bio', text: item.bio }) : null,
        el('span', { class: 'small', style: { color: 'var(--brand)' }, text: t('tdOpen') }),
      ]),
    ]);
  }

  async function boot() {
    // الفلاتر تُبنى مرّةً — والشبكة وحدها تُعاد مع كل تغيير، فلا تسقط بؤرة الكتابة
    const search = el('input', { type: 'search', placeholder: t('tdSearch'), value: state.q, maxlength: 60, 'aria-label': t('tdSearch') });
    const country = el('select', { 'aria-label': t('tdAnyCountry') }, [el('option', { value: '', text: t('tdAnyCountry') })]);
    const subject = el('select', { 'aria-label': t('tdAnySubject') }, [
      el('option', { value: '', text: t('tdAnySubject') }),
      ...SUBJECTS.map((id) => el('option', { value: id, text: tagLabel('subj', id) })),
    ]);
    const grade = el('select', { 'aria-label': t('tdAnyGrade') }, [
      el('option', { value: '', text: t('tdAnyGrade') }),
      ...GRADES.map((id) => el('option', { value: id, text: tagLabel('grade', id) })),
    ]);
    subject.value = state.subject;
    grade.value = state.grade;
    const booking = el('input', { type: 'checkbox' });
    booking.checked = state.booking;
    const clear = el('button', { class: 'btn ghost sm', type: 'button' }, t('tdClear'));
    const count = el('span', { class: 'muted small' });
    const grid = el('div', { class: 'game-grid' });
    const empty = el('div', { class: 'card stack center hidden' }, [el('div', { style: { fontSize: '2.4rem' }, text: '🔍' }), el('p', { class: 'muted', text: t('tdNone') })]);
    const more = el('button', { class: 'btn ghost hidden', type: 'button' }, t('tdMore'));

    app.replaceChildren(
      el('h1', { style: { marginBottom: '4px' }, text: t('tdTitle') }),
      el('p', { class: 'muted small', style: { margin: '0 0 12px' }, text: t('tdIntro') }),
      el('div', { class: 'card stack tight' }, [
        el('div', { class: 'td-filters' }, [
          search,
          country,
          subject,
          grade,
          el('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, [booking, el('span', { class: 'small', text: t('tdBookingOnly') })]),
        ]),
        el('div', { class: 'row between' }, [count, clear]),
      ]),
      grid,
      empty,
      el('div', { class: 'center', style: { marginTop: '10px' } }, [more])
    );

    // أسماءُ البلدان بلغة القارئ، والقائمة تُحصر فيما في الدليل بعد أول جلب
    window.T.countryList()
      .then(({ arab, rest }) => {
        countryNames = new Map([...arab, ...rest].map((c) => [c.code, c.name]));
        draw.lastCountries && fillCountries(draw.lastCountries);
        draw.lastItems && paint(draw.lastItems, false);
      })
      .catch(() => {});

    function fillCountries(codes) {
      country.replaceChildren(
        el('option', { value: '', text: t('tdAnyCountry') }),
        ...codes.map((code) => el('option', { value: code, text: countryName(code) }))
      );
      country.value = codes.includes(state.country) ? state.country : '';
    }

    function paint(items, append) {
      if (!append) grid.replaceChildren();
      items.forEach((item) => grid.append(card(item)));
    }

    let seq = 0;
    async function draw(append = false) {
      const mine = ++seq;
      if (!append) state.offset = 0;
      syncUrl();
      let data;
      try {
        data = await api(query());
      } catch (err) {
        empty.classList.remove('hidden');
        empty.querySelector('p').textContent = err.message;
        return;
      }
      if (mine !== seq) return; // ردٌّ متأخّر لبحثٍ سابق
      draw.lastCountries = data.countries || [];
      draw.lastItems = append ? [...(draw.lastItems || []), ...data.items] : data.items;
      if (!append && !country.dataset.filled) {
        fillCountries(draw.lastCountries);
        country.dataset.filled = '1';
      }
      paint(data.items, append);
      const shown = state.offset + data.items.length;
      count.textContent = data.total === 1 ? t('tdCountOne') : t('tdCount', { n: data.total });
      const none = data.total === 0;
      empty.classList.toggle('hidden', !none);
      empty.querySelector('p').textContent = state.q || state.country || state.subject || state.grade || state.booking ? t('tdNone') : t('tdEmpty');
      grid.classList.toggle('hidden', none);
      more.classList.toggle('hidden', shown >= data.total);
      more.onclick = () => {
        state.offset = shown;
        draw(true);
      };
    }

    let timer = 0;
    search.addEventListener('input', () => {
      state.q = search.value.trim();
      clearTimeout(timer);
      timer = setTimeout(() => draw(), 220);
    });
    search.addEventListener('keydown', (e) => e.key === 'Enter' && search.blur());
    country.addEventListener('change', () => ((state.country = country.value), draw()));
    subject.addEventListener('change', () => ((state.subject = subject.value), draw()));
    grade.addEventListener('change', () => ((state.grade = grade.value), draw()));
    booking.addEventListener('change', () => ((state.booking = booking.checked), draw()));
    clear.addEventListener('click', () => {
      Object.assign(state, { q: '', country: '', subject: '', grade: '', booking: false });
      search.value = '';
      country.value = '';
      subject.value = '';
      grade.value = '';
      booking.checked = false;
      draw();
    });

    await draw();
  }

  boot();
})();
