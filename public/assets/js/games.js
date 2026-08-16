/* قسم الألعاب التفاعلية — تصفّح وبحث وتشغيل ملء الشاشة داخل إطار معزول */
(function () {
  'use strict';

  const { $, el, api, toast, copyLink } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const SUBJECTS = (window.I18n && window.I18n.SUBJECTS) || [];
  const GRADES = (window.I18n && window.I18n.GRADES) || [];
  const app = $('#app');

  document.title = t('brand') + ' — ' + t('gTitle');
  $('#navHome').textContent = t('hhomePage');
  $('#navMine').textContent = t('gMine');
  if (window.I18n) window.I18n.mountToggle($('#langRow'));

  const state = { q: '', subject: '', grade: '', teacher: '', sort: 'popular', page: 0, items: [], total: 0, rated: new Set(), saved: new Set() };

  if (window.Theme) window.Theme.mountToggle($('#themeRow'), { toDark: t('gThemeDark'), toLight: t('gThemeLight') });

  /** الألعاب المحفوظة على هذا الجهاز — الحقيقة في مخبأ عامل الخدمة، وهذه مرآتها للواجهة */
  const SAVED_KEY = 'tapio:offlineGames';
  const readSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    } catch {
      return [];
    }
  };
  readSaved().forEach((id) => state.saved.add(id));
  const writeSaved = () => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify([...state.saved]));
    } catch {
      /* تخزين معطّل */
    }
  };

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
    // اللعب مسارٌ مستقلّ لا حالةً داخلية: زرّ الرجوع في الجوال يخرج من
    // اللعبة كما يتوقّع الطالب، والرابط يصلح للمشاركة كما هو
    const play = hash.match(/^\/g\/([\w-]+)\/play$/);
    if (play) return openGame(play[1], true);
    const one = hash.match(/^\/g\/([\w-]+)$/);
    if (one) return openGame(one[1], false);
    if (hash === '/teachers') return openTeachers();
    const teacher = hash.match(/^\/t\/([\w-]+)$/);
    if (teacher) {
      if (state.teacher !== teacher[1]) Object.assign(state, { teacher: teacher[1], q: '', subject: '', grade: '', page: 0, items: [] });
      return openList(true);
    }
    if (state.teacher) Object.assign(state, { teacher: '', page: 0, items: [] });
    return openList();
  }

  // تصريحُ دالة لا ثابتاً: `route()` تُستدعى عند التحميل قبل هذا السطر
  function exitImmersive() {
    document.body.classList.remove('playing');
  }

  // ------------------------------------------------------------- الفهرس

  async function openList(keep) {
    exitImmersive();
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
    const teacherName = state.teacher ? state.items[0]?.author || '' : '';
    app.append(el('h1', { style: { marginBottom: '4px' }, text: state.teacher ? t('gByTeacher', { name: teacherName }) : t('gTitle') }));
    app.append(el('p', { class: 'muted small', text: state.teacher ? t('gTeacherIntro') : t('gIntro') }));

    const search = el('input', { type: 'search', placeholder: t('gSearchPlaceholder'), value: state.q, maxlength: 80 });
    const run = () => {
      state.q = search.value;
      state.page = 0;
      openList(true);
    };
    search.addEventListener('keydown', (e) => e.key === 'Enter' && run());

    const pick = (key, allLabel, options) => {
      const sel = el('select', {}, [el('option', { value: '', text: allLabel }), ...options.map((o) => el('option', { value: o.value ?? o, text: o.label ?? o }))]);
      sel.value = state[key];
      sel.addEventListener('change', () => {
        state[key] = sel.value;
        state.page = 0;
        openList(true);
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
          // القوائم ثابتة لا مشتقّة من نتائج الصفحة: المادة موجودة في
          // القائمة حتى لو لم تظهر لعبةٌ منها في الصفحة الأولى
          pick('subject', t('gAllSubjects'), SUBJECTS.map((id) => ({ value: id, label: tagLabel('subj', id) }))),
          pick('grade', t('gAllGrades'), GRADES.map((id) => ({ value: id, label: tagLabel('grade', id) }))),
          pick('sort', '', [
            { value: 'popular', label: t('gSortPopular') },
            { value: 'rated', label: t('gSortRated') },
            { value: 'new', label: t('gSortNew') },
          ]),
          el('a', { class: 'btn ghost sm', href: '#/teachers' }, t('gTeachersNav')),
          el('span', { class: 'grow' }),
          el('span', { class: 'muted small', text: t('gCount', { n: state.total }) }),
        ]),
        state.teacher
          ? el('div', { class: 'row', style: { gap: '6px' } }, [
              shareButton(location.origin + '/games.html#/t/' + state.teacher, t('gCopyShelf')),
              el('a', { class: 'btn ghost sm', href: '#/' }, t('gAllTeachers')),
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

  // -------------------------------------------------------- دليل المعلّمين

  /** يتصفّح الطالب حسب معلّمه لا حسب المادة وحدها */
  async function openTeachers() {
    exitImmersive();
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    let items;
    try {
      items = (await api('/api/game-teachers')).items;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('gTeachersTitle') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [el('a', { class: 'btn ghost sm', href: '#/' }, t('gBack')), el('span')])
    );
    app.append(el('h1', { style: { marginBottom: '4px' }, text: t('gTeachersTitle') }));
    app.append(el('p', { class: 'muted small', text: t('gTeachersIntro') }));

    if (!items.length) {
      app.append(el('div', { class: 'card stack center' }, [el('div', { style: { fontSize: '2.4rem' }, text: '👩‍🏫' }), el('p', { class: 'muted', text: t('gTeachersEmpty') })]));
      return;
    }

    const grid = el('div', { class: 'game-grid' });
    items.forEach((tch) => {
      grid.append(
        el('a', { class: 'card stack tight teacher-card', href: '#/t/' + tch.id }, [
          el('div', { class: 'teacher-face' }, el('span', { text: (tch.name || '؟').trim().slice(0, 1) })),
          el('strong', { class: 'center', text: tch.name }),
          el('div', { class: 'row', style: { gap: '6px', justifyContent: 'center' } }, [
            el('span', { class: 'badge', text: t('gCount', { n: tch.games }) }),
            el('span', { class: 'badge', text: t('gPlays', { n: tch.plays }) }),
          ]),
        ])
      );
    });
    app.append(grid);
  }

  /** صورة اللعبة، وبديلٌ مولَّد لألعابٍ رُفعت قبل أن تصير الصورة مطلوبة */
  function gameThumb(game) {
    const box = el('div', { class: 'game-thumb' });
    if (game.cover) {
      box.append(el('img', { src: '/api/games/' + game.id + '/cover', alt: game.title, loading: 'lazy' }));
    } else {
      box.classList.add('blank');
      box.append(el('span', { text: (game.title || '🎮').trim().slice(0, 1) }));
    }
    return box;
  }

  function shareButton(url, label) {
    const btn = el('button', { class: 'btn ghost sm', type: 'button' }, '🔗 ' + label);
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const done = await copyLink(url);
      toast(done ? t('gLinkCopied') : url, done ? 'ok' : '');
    });
    return btn;
  }

  function gameCard(game) {
    return el('a', { class: 'card stack tight game-card', href: '#/g/' + game.id }, [
      gameThumb(game),
      el('div', { class: 'row between' }, [
        el('strong', { text: game.title }),
        game.rating ? el('span', { class: 'badge', text: `⭐ ${game.rating}` }) : null,
      ]),
      game.description ? el('span', { class: 'muted small', text: game.description }) : null,
      el('div', { class: 'row', style: { gap: '6px' } }, [
        game.subject ? el('span', { class: 'badge', text: tagLabel('subj', game.subject) }) : null,
        ...(game.grades.length
          ? game.grades.slice(0, 3).map((g) => el('span', { class: 'badge', text: tagLabel('grade', g) }))
          : [el('span', { class: 'badge', text: t('gAllStages') })]),
      ]),
      el('div', { class: 'row between' }, [
        el('span', { class: 'muted small', text: game.author ? t('gBy', { name: game.author }) : '' }),
        el('span', { class: 'muted small', text: t('gPlays', { n: game.plays }) }),
      ]),
    ]);
  }

  // ------------------------------------------------------------ اللعب

  async function openGame(id, immersive) {
    exitImmersive();
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    let game;
    try {
      game = (await api('/api/games/' + id)).game;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('p', { class: 'muted', text: err.message }), el('a', { class: 'btn primary', href: '#/' }, t('gBack'))]));
      return;
    }
    return immersive ? renderPlay(game) : renderDetails(game);
  }

  /** بطاقة اللعبة قبل اللعب: الصورة والمعلومات ورابط المشاركة وزرّ البدء */
  function renderDetails(game) {
    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('gBack')),
        shareButton(location.origin + '/games.html#/g/' + game.id, t('gCopyLink')),
      ])
    );

    const cover = gameThumb(game);
    cover.classList.add('big');
    app.append(cover);

    app.append(el('h1', { style: { marginBottom: '4px' }, text: game.title }));
    app.append(
      el('div', { class: 'row', style: { gap: '6px', marginBottom: '10px' } }, [
        game.author ? el('a', { class: 'badge', href: '#/t/' + game.authorId }, t('gBy', { name: game.author })) : null,
        game.subject ? el('span', { class: 'badge', text: tagLabel('subj', game.subject) }) : null,
        ...(game.grades.length
          ? game.grades.map((g) => el('span', { class: 'badge', text: tagLabel('grade', g) }))
          : [el('span', { class: 'badge', text: t('gAllStages') })]),
        el('span', { class: 'badge', text: t('gPlays', { n: game.plays }) }),
        game.rating ? el('span', { class: 'badge', text: `⭐ ${game.rating}` }) : null,
      ])
    );
    if (game.description) app.append(el('p', { class: 'muted small', text: game.description }));

    app.append(el('a', { class: 'btn accent block big-cta', href: '#/g/' + game.id + '/play' }, t('gPlayNow')));
    app.append(el('p', { class: 'muted small center', style: { marginTop: '6px' }, text: t('gPlayFullNote') }));

    if (game.offlineOk) app.append(offlineCard(game));

    if (game.author) {
      app.append(el('a', { class: 'btn ghost block', href: '#/t/' + game.authorId }, t('gMoreByTeacher', { name: game.author })));
    }
    app.append(rateCard(game));
    app.append(reportNote(game));
  }

  /**
   * اللعب ملء الشاشة. الإطار باقٍ لأنه هو الحماية — غياب `allow-same-origin`
   * يجعل أصل اللعبة مبهماً — لكنه لم يعد «مربّعاً داخل صفحة»: يغطّي الشاشة
   * كاملةً بلا شريطٍ ولا تمرير، فيتصرّف في الجوال كتطبيق.
   * لا تُضِف `allow-same-origin` هنا مهما بدا مغرياً.
   */
  function renderPlay(game) {
    app.innerHTML = '';
    document.body.classList.add('playing');

    const frame = el('iframe', {
      class: 'game-frame',
      src: '/api/games/' + game.id + '/frame',
      title: game.title,
      sandbox: 'allow-scripts allow-forms allow-modals allow-pointer-lock',
      allow: 'fullscreen; gamepad; accelerometer; gyroscope',
      referrerpolicy: 'no-referrer',
    });

    const stage = el('div', { class: 'game-stage immersive' }, [
      frame,
      el('div', { class: 'game-hud' }, [
        el('a', { class: 'hud-btn', href: '#/g/' + game.id, title: t('gExit'), 'aria-label': t('gExit') }, '✕'),
        el(
          'button',
          {
            class: 'hud-btn',
            type: 'button',
            title: t('gFullscreen'),
            'aria-label': t('gFullscreen'),
            onclick: () => (document.fullscreenElement ? document.exitFullscreen?.() : stage.requestFullscreen?.().catch(() => {})),
          },
          '⛶'
        ),
      ]),
    ]);
    app.append(stage);
  }


  /**
   * حفظ اللعبة على الجهاز للّعب بلا إنترنت — بلا تنزيل ملفّها.
   * التنزيل كان سيُخرج اللعبة من عزلنا (تسقط ترويسة CSP، فتصير صفحةً كاملة
   * الصلاحيات على جهاز الطالب) ويمنع سحبَها لو تبيّن أنها مخالفة. أما هنا
   * فتبقى داخل الإطار المعزول نفسه: Cache API تحفظ الترويسات معها.
   */
  function offlineCard(game) {
    const box = el('div', { class: 'card stack tight' });
    const line = el('p', { class: 'muted small', style: { margin: 0 } });
    const btn = el('button', { class: 'btn ghost block', type: 'button' });
    const ready = 'serviceWorker' in navigator;

    const paint = () => {
      const on = state.saved.has(game.id);
      btn.textContent = on ? t('gOfflineRemove') : t('gOfflineSave');
      btn.classList.toggle('danger', on);
      line.textContent = on ? t('gOfflineReady') : t('gOfflineHint');
    };

    btn.addEventListener('click', async () => {
      if (!ready) return toast(t('gOfflineUnsupported'), 'bad');
      btn.disabled = true;
      const reg = await navigator.serviceWorker.ready;
      const worker = reg.active;
      if (!worker) {
        btn.disabled = false;
        return toast(t('gOfflineUnsupported'), 'bad');
      }
      const on = state.saved.has(game.id);
      const done = (e) => {
        const d = e.data || {};
        if (d.id !== game.id) return;
        navigator.serviceWorker.removeEventListener('message', done);
        btn.disabled = false;
        if (d.type === 'gameSaved' && d.ok) {
          state.saved.add(game.id);
          toast(t('gOfflineSaved'), 'ok');
        } else if (d.type === 'gameSaved') {
          toast(t('gOfflineFailed'), 'bad');
        } else if (d.type === 'gameDropped') {
          state.saved.delete(game.id);
          toast(t('gOfflineRemoved'), 'ok');
        }
        writeSaved();
        paint();
      };
      navigator.serviceWorker.addEventListener('message', done);
      worker.postMessage({ type: on ? 'dropGame' : 'saveGame', id: game.id });
      // لو صمت العامل لا نترك الزرّ معطّلاً إلى الأبد
      setTimeout(() => {
        if (!btn.disabled) return;
        navigator.serviceWorker.removeEventListener('message', done);
        btn.disabled = false;
        toast(t('gOfflineFailed'), 'bad');
      }, 15000);
    });

    box.append(el('strong', { text: t('gOfflineTitle') }));
    box.append(line);
    box.append(btn);
    paint();
    return box;
  }

  function reportNote(game) {
    return el('p', { class: 'footer' }, [
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
    ]);
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
