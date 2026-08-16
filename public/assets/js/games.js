/* قسم الألعاب التفاعلية — تصفّح وبحث وتشغيل داخل إطار معزول */
(function () {
  'use strict';

  const { $, el, api, toast } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const app = $('#app');

  document.title = t('brand') + ' — ' + t('gTitle');
  $('#navHome').textContent = t('hhomePage');
  $('#navMine').textContent = t('gMine');
  if (window.I18n) window.I18n.mountToggle($('#langRow'));

  const state = { q: '', subject: '', grade: '', teacher: '', sort: 'popular', page: 0, items: [], total: 0, rated: new Set() };

  /** التقييم مرة واحدة لكل متصفّح — الخادم يحرس أيضاً بالعنوان */
  const RATED_KEY = 'tapio:ratedGames';
  try {
    JSON.parse(localStorage.getItem(RATED_KEY) || '[]').forEach((id) => state.rated.add(id));
  } catch {
    /* تخزين معطّل */
  }
  const rememberRated = (id) => {
    state.rated.add(id);
    try {
      localStorage.setItem(RATED_KEY, JSON.stringify([...state.rated].slice(-300)));
    } catch {
      /* تخزين معطّل */
    }
  };

  window.addEventListener('hashchange', route);
  route();

  function route() {
    const hash = location.hash.slice(1) || '/';
    const one = hash.match(/^\/g\/([\w-]+)$/);
    if (one) return openGame(one[1]);
    return openList();
  }

  // ------------------------------------------------------------- الفهرس

  const facet = (key) => [...new Set(state.items.flatMap((g) => (Array.isArray(g[key]) ? g[key] : [g[key]])).filter(Boolean))].sort();

  async function openList(keep) {
    if (!keep) Object.assign(state, { page: 0, items: [] });
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    let data;
    try {
      const query = new URLSearchParams({ q: state.q, subject: state.subject, grade: state.grade, teacher: state.teacher, sort: state.sort, page: String(state.page) });
      data = await api('/api/games?' + query);
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('gTitle') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }
    state.items = state.page ? [...state.items, ...data.items] : data.items;
    state.total = data.total;

    app.innerHTML = '';
    app.append(el('h1', { style: { marginBottom: '4px' }, text: t('gTitle') }));
    app.append(el('p', { class: 'muted small', text: t('gIntro') }));

    const search = el('input', { type: 'search', placeholder: t('gSearchPlaceholder'), value: state.q, maxlength: 80 });
    const run = () => {
      state.q = search.value;
      state.page = 0;
      openList();
    };
    search.addEventListener('keydown', (e) => e.key === 'Enter' && run());

    const pick = (key, allLabel, options) => {
      const sel = el('select', {}, [el('option', { value: '', text: allLabel }), ...options.map((o) => el('option', { value: o.value ?? o, text: o.label ?? o }))]);
      sel.value = state[key];
      sel.addEventListener('change', () => {
        state[key] = sel.value;
        state.page = 0;
        openList();
      });
      return sel;
    };

    app.append(
      el('div', { class: 'card stack tight' }, [
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('span', { class: 'grow' }, search),
          el('button', { class: 'btn primary sm', type: 'button', onclick: run }, t('gSearchBtn')),
        ]),
        el('div', { class: 'row filters', style: { gap: '6px' } }, [
          pick('subject', t('gAllSubjects'), facet('subject')),
          pick('grade', t('gAllGrades'), facet('grades')),
          pick('sort', '', [
            { value: 'popular', label: t('gSortPopular') },
            { value: 'rated', label: t('gSortRated') },
            { value: 'new', label: t('gSortNew') },
          ]),
          el('span', { class: 'grow' }),
          el('span', { class: 'muted small', text: t('gCount', { n: state.total }) }),
        ]),
        state.teacher
          ? el('div', { class: 'row', style: { gap: '6px' } }, [
              el('span', { class: 'badge', text: t('gByTeacher', { name: state.items[0]?.author || '' }) }),
              el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.teacher = ''; state.page = 0; openList(); } }, t('gAllTeachers')),
            ])
          : null,
      ])
    );

    if (!state.items.length) {
      const filtered = state.q || state.subject || state.grade || state.teacher;
      app.append(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.4rem' }, text: filtered ? '🔍' : '🎮' }),
          el('p', { class: 'muted', text: filtered ? t('gEmpty') : t('gEmptyAll') }),
          el('a', { class: 'btn primary', href: '/host.html#/games' }, t('gUploadCta')),
        ])
      );
      return;
    }

    const grid = el('div', { class: 'game-grid' });
    state.items.forEach((game) => grid.append(gameCard(game)));
    app.append(grid);

    if (state.items.length < state.total) {
      const more = el('button', { class: 'btn ghost block', type: 'button' }, t('gMore'));
      more.addEventListener('click', () => {
        state.page += 1;
        openList(true);
      });
      app.append(more);
    }
  }

  function gameCard(game) {
    return el('a', { class: 'card stack tight game-card', href: '#/g/' + game.id }, [
      el('div', { class: 'row between' }, [
        el('strong', { text: game.title }),
        game.rating ? el('span', { class: 'badge', text: `⭐ ${game.rating}` }) : null,
      ]),
      game.description ? el('span', { class: 'muted small', text: game.description }) : null,
      el('div', { class: 'row', style: { gap: '6px' } }, [
        game.subject ? el('span', { class: 'badge', text: game.subject }) : null,
        ...(game.grades.length ? game.grades.slice(0, 3).map((g) => el('span', { class: 'badge', text: g })) : [el('span', { class: 'badge', text: t('gAllStages') })]),
      ]),
      el('div', { class: 'row between' }, [
        el('span', { class: 'muted small', text: game.author ? t('gBy', { name: game.author }) : '' }),
        el('span', { class: 'muted small', text: t('gPlays', { n: game.plays }) }),
      ]),
    ]);
  }

  // ------------------------------------------------------------ اللعب

  async function openGame(id) {
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    let game;
    try {
      game = (await api('/api/games/' + id)).game;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('p', { class: 'muted', text: err.message }), el('a', { class: 'btn primary', href: '#/' }, t('gBack'))]));
      return;
    }

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('gBack')),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: () => frame.requestFullscreen?.() }, t('gFullscreen')),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' }, text: game.title }));
    app.append(
      el('div', { class: 'row', style: { gap: '6px', marginBottom: '10px' } }, [
        game.author
          ? el('a', { class: 'badge', href: '#/', onclick: () => { state.teacher = game.authorId; state.page = 0; } }, t('gBy', { name: game.author }))
          : null,
        game.subject ? el('span', { class: 'badge', text: game.subject }) : null,
        ...(game.grades.length ? game.grades.map((g) => el('span', { class: 'badge', text: g })) : [el('span', { class: 'badge', text: t('gAllStages') })]),
        el('span', { class: 'badge', text: t('gPlays', { n: game.plays }) }),
      ])
    );
    if (game.description) app.append(el('p', { class: 'muted small', text: game.description }));

    /**
     * الإطار المعزول. غياب `allow-same-origin` مقصود وهو كل الحماية: أصل
     * اللعبة يصير «مبهماً» فلا كوكي ولا تخزين ولا وصول إلى هذه الصفحة.
     * لا تُضِف `allow-same-origin` هنا مهما بدا مغرياً.
     */
    const frame = el('iframe', {
      class: 'game-frame',
      src: '/api/games/' + game.id + '/frame',
      title: game.title,
      sandbox: 'allow-scripts allow-forms allow-modals allow-pointer-lock',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    });
    app.append(el('div', { class: 'game-stage' }, frame));

    app.append(rateCard(game));
    app.append(
      el('p', { class: 'footer' }, [
        el('span', { class: 'muted small', text: t('gSafetyNote') }),
        el('br'),
        el(
          'a',
          {
            class: 'muted small',
            target: '_blank',
            rel: 'noopener',
            href: 'https://wa.me/970597750343?text=' + encodeURIComponent(`${t('gReport')}: ${location.origin}/games.html#/g/${game.id}`),
          },
          t('gReport')
        ),
      ])
    );
  }

  /** نجومٌ تُنقر — والتقييم مرة واحدة لكل متصفّح */
  function rateCard(game) {
    const box = el('div', { class: 'card stack center' });
    const done = state.rated.has(game.id);
    const line = el('div', { class: 'row', style: { gap: '4px', justifyContent: 'center' } });

    const paint = (value) => {
      line.innerHTML = '';
      for (let i = 1; i <= 5; i += 1) {
        const star = el('button', { class: 'star' + (i <= value ? ' on' : ''), type: 'button', 'aria-label': String(i) }, '★');
        star.disabled = state.rated.has(game.id);
        star.addEventListener('click', async () => {
          try {
            const res = await api(`/api/games/${game.id}/rate`, { method: 'POST', body: { stars: i } });
            rememberRated(game.id);
            paint(i);
            box.querySelector('.rate-msg').textContent = t('gRated', { avg: res.rating, n: res.ratingCount });
          } catch (err) {
            toast(err.message, 'bad');
          }
        });
        line.append(star);
      }
    };

    box.append(el('strong', { text: done ? t('gThanksRating') : t('gRateIt') }));
    box.append(line);
    box.append(
      el('p', {
        class: 'muted small rate-msg',
        style: { margin: 0 },
        text: game.rating ? t('gRated', { avg: game.rating, n: game.ratingCount }) : t('gNoRating'),
      })
    );
    paint(Math.round(game.rating || 0));
    return box;
  }
})();
