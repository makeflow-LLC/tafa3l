/* المسابقة المفتوحة — شاشة المتسابق: بطاقة، ثم أسئلة، ثم نتيجة ولوحة صدارة */
(function () {
  'use strict';

  const { $, el, api, toast, copyLink, store } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const app = $('#app');

  document.title = t('brand') + ' — ' + t('ctTitle');
  window.SiteTopbar?.mount({ links: [] });

  /** اسمُ المتسابق يبقى في جهازه: من يدخل مسابقةً ثانية لا يكتبه مرّتين */
  const NAME_KEY = 'tapio:contest:name';

  const state = { id: '', card: null, questions: [], answers: {}, at: 0, startedAt: 0, seed: '', done: null };

  window.addEventListener('hashchange', route);
  route();

  function route() {
    const board = location.hash.match(/^#\/c\/([\w-]+)\/board$/);
    if (board) return openBoard(board[1]);
    const one = location.hash.match(/^#\/c\/([\w-]+)/);
    if (one) return openCard(one[1]);
    app.replaceChildren(el('div', { class: 'card stack center' }, [el('h2', { text: t('ctTitle') }), el('p', { class: 'muted', text: t('ctNoLink') })]));
  }

  // تصريحُ دالة لا ثابتاً: `route()` تُستدعى عند التحميل قبل هذا السطر
  function spinner() {
    app.replaceChildren(el('div', { class: 'card center' }, el('div', { class: 'spinner' })));
  }

  function failCard(message) {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.2rem' }, text: '🏆' }),
        el('h2', { style: { margin: 0 }, text: t('ctTitle') }),
        el('p', { class: 'muted small', text: message }),
        el('a', { class: 'btn ghost', href: '/' }, t('joinBackHome')),
      ])
    );
  }

  /** كم بقي على الإغلاق — بالأيام إن بعُد، وبالساعات إن قرُب */
  function leftLabel(closesAt) {
    const ms = closesAt - Date.now();
    if (ms <= 0) return t('ctEnded');
    const hours = Math.ceil(ms / 3600000);
    return hours > 48 ? t('ctDaysLeft', { n: Math.ceil(hours / 24) }) : t('ctHoursLeft', { n: hours });
  }

  // ------------------------------------------------------------ البطاقة

  async function openCard(id) {
    state.id = id;
    spinner();
    let card;
    try {
      card = (await api('/api/contests/' + id + '/card')).contest;
    } catch (err) {
      return failCard(err.message);
    }
    state.card = card;

    const meta = el('div', { class: 'row wrap', style: { gap: '6px' } }, [
      el('span', { class: 'badge', text: t('ctQuestions', { n: card.questions }) }),
      card.subject ? el('span', { class: 'badge', text: tagLabel('subj', card.subject) }) : null,
      ...(card.grades || []).map((g) => el('span', { class: 'badge', text: tagLabel('grade', g) })),
      el('span', { class: 'badge', text: t('ctEntries', { n: card.entries }) }),
      el('span', { class: 'badge' + (card.status === 'open' ? '' : ' warn'), text: card.status === 'open' ? leftLabel(card.closesAt) : t('ctClosed') }),
    ]);

    const name = el('input', { maxlength: 40, placeholder: t('ctNamePlaceholder'), value: store.local.get(NAME_KEY, '') || '' });
    const start = el('button', { class: 'btn accent block big-cta', type: 'button' }, t('ctStart'));
    start.addEventListener('click', () => {
      const clean = name.value.trim();
      if (!clean) {
        name.focus();
        return toast(t('ctNeedName'), 'bad');
      }
      store.local.set(NAME_KEY, clean);
      begin(clean);
    });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && start.click());

    app.replaceChildren(
      el('div', { class: 'card stack' }, [
        el('div', { style: { fontSize: '2.2rem', textAlign: 'center' }, text: '🏆' }),
        el('h1', { style: { margin: 0, textAlign: 'center' }, text: card.title }),
        card.teacher ? el('p', { class: 'muted small center', style: { margin: 0 }, text: t('ctByTeacher', { name: card.teacher }) }) : null,
        card.description ? el('p', { class: 'muted small center', style: { margin: 0 }, text: card.description }) : null,
        meta,
        card.status === 'open'
          ? el('div', { class: 'stack' }, [
              el('label', {}, [el('span', { class: 'small', text: t('ctYourName') }), name]),
              start,
              el('p', { class: 'muted small', style: { margin: 0 }, text: card.retries ? t('ctRetriesOn') : t('ctRetriesOff') }),
              el('p', { class: 'muted small', style: { margin: 0 }, text: t('ctScoringNote') }),
            ])
          : el('div', { class: 'note warn small' }, t('ctClosedNote')),
        el('a', { class: 'btn ghost block', href: '#/c/' + id + '/board' }, t('ctSeeBoard')),
      ])
    );
  }

  // -------------------------------------------------------------- اللعب

  async function begin(name) {
    spinner();
    // البذرة من اسم المتسابق: ترتيبه ثابتٌ لو حدّث الصفحة، ومختلفٌ عن جاره
    state.seed = name;
    state.answers = {};
    try {
      const data = await api('/api/contests/' + state.id + '/play?seed=' + encodeURIComponent(name));
      state.questions = data.questions;
    } catch (err) {
      return failCard(err.message);
    }
    state.at = 0;
    state.startedAt = Date.now();
    drawQuestion(name);
  }

  function drawQuestion(name) {
    const q = state.questions[state.at];
    const last = state.at === state.questions.length - 1;

    const next = el('button', { class: 'btn accent block big-cta', type: 'button' }, last ? t('ctSubmit') : t('ctNext'));
    next.addEventListener('click', () => {
      if (last) return submit(name);
      state.at += 1;
      drawQuestion(name);
    });

    const back = el('button', { class: 'btn ghost sm', type: 'button', disabled: state.at === 0 }, t('ctBack'));
    back.addEventListener('click', () => {
      state.at -= 1;
      drawQuestion(name);
    });

    app.replaceChildren(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('span', { class: 'badge', dir: 'ltr', text: `${state.at + 1} / ${state.questions.length}` }),
          el('span', { class: 'muted small', text: name }),
        ]),
        // شريطُ تقدّمٍ يقول أين هو من المسابقة — لا مؤقّت: هذه تُلعب على مهل
        el('div', { class: 'ct-track' }, el('span', { class: 'ct-fill', style: { width: ((state.at + 1) / state.questions.length) * 100 + '%' } })),
        q.passage ? el('div', { class: 'passage', text: q.passage }) : null,
        el('h2', { style: { margin: 0 }, text: q.text }),
        q.multi ? el('p', { class: 'muted small', style: { margin: 0 }, text: t('ctMulti') }) : null,
        answerBody(q),
        el('div', { class: 'row', style: { gap: '6px' } }, [back, el('span', { class: 'grow' })]),
        next,
      ])
    );
  }

  /** جسم الإجابة بحسب النوع — الأنواع الأربعة التي تقبلها المسابقة وحدها */
  function answerBody(q) {
    if (q.type === 'mc' || q.type === 'truefalse') return choiceBody(q);
    if (q.type === 'order') return orderBody(q);
    if (q.type === 'match') return matchBody(q);
    return el('p', { class: 'muted small', text: t('ctUnsupported') });
  }

  function choiceBody(q) {
    const box = el('div', { class: 'stack tight' });
    const chosen = () => (Array.isArray(state.answers[q.id]) ? state.answers[q.id] : state.answers[q.id] ? [state.answers[q.id]] : []);
    const paint = () => {
      const on = chosen();
      [...box.children].forEach((node) => node.classList.toggle('on', on.includes(node.dataset.id)));
    };
    q.options.forEach((o) => {
      const btn = el('button', { class: 'ct-choice', type: 'button', 'data-id': o.id }, o.text);
      btn.addEventListener('click', () => {
        if (q.multi) {
          const on = chosen();
          state.answers[q.id] = on.includes(o.id) ? on.filter((x) => x !== o.id) : [...on, o.id];
        } else {
          state.answers[q.id] = o.id;
        }
        paint();
      });
      box.append(btn);
    });
    paint();
    return box;
  }

  /**
   * «رتّب»: أسهمٌ لا سحب.
   *
   * السحب على شاشة طفلٍ بإصبعٍ واحد أصعب مما يبدو، والمسابقة تُلعب على
   * هواتف متفاوتة. سهمان يرفعان العنصر ويخفضانه يفعلان الشيء نفسه ويعملان
   * بلوحة المفاتيح وقارئ الشاشة أيضاً.
   */
  function orderBody(q) {
    const box = el('div', { class: 'stack tight' });
    const order = state.answers[q.id] || q.items.map((i) => i.id);
    state.answers[q.id] = order;
    const label = (id) => q.items.find((i) => i.id === id)?.text || '';
    const move = (from, to) => {
      if (to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to], order[from]];
      draw();
    };
    const draw = () => {
      box.replaceChildren(
        ...order.map((id, i) =>
          el('div', { class: 'ct-row' }, [
            el('span', { class: 'ct-rank', dir: 'ltr', text: String(i + 1) }),
            el('span', { class: 'grow', text: label(id) }),
            el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': t('ctMoveUp'), disabled: i === 0, onclick: () => move(i, i - 1) }, '▲'),
            el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': t('ctMoveDown'), disabled: i === order.length - 1, onclick: () => move(i, i + 1) }, '▼'),
          ])
        )
      );
    };
    draw();
    return box;
  }

  /** «طابِق»: لكل طرفٍ أيسر قائمةٌ بالأطراف اليمنى مخلوطة */
  function matchBody(q) {
    const picked = state.answers[q.id] || {};
    state.answers[q.id] = picked;
    return el(
      'div',
      { class: 'stack tight' },
      q.pairs.map((pr) => {
        const select = el('select', {}, [
          el('option', { value: '', text: t('ctPick') }),
          ...q.rights.map((r) => el('option', { value: r, text: r })),
        ]);
        select.value = picked[pr.id] || '';
        select.addEventListener('change', () => {
          picked[pr.id] = select.value;
        });
        return el('div', { class: 'ct-row' }, [el('span', { class: 'grow', text: pr.left }), select]);
      })
    );
  }

  async function submit(name) {
    spinner();
    try {
      const data = await api('/api/contests/' + state.id + '/entries', {
        method: 'POST',
        body: { name, answers: state.answers, ms: Date.now() - state.startedAt },
      });
      state.done = data;
      drawResult(name, data);
    } catch (err) {
      toast(err.message, 'bad');
      drawQuestion(name);
    }
  }

  // ------------------------------------------------------------ النتيجة

  function drawResult(name, data) {
    const percent = data.result.max ? Math.round((data.result.score / data.result.max) * 100) : 0;
    const missed = (data.review || []).filter((r) => r.merit < 1);

    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.6rem' }, text: percent >= 80 ? '🏆' : percent >= 50 ? '🎉' : '💪' }),
        el('h1', { style: { margin: 0 }, text: t('ctYourScore') }),
        el('div', { class: 'ct-score', dir: 'ltr', text: `${data.result.score} / ${data.result.max}` }),
        el('p', { class: 'muted', style: { margin: 0 }, text: t('ctSummary', { correct: data.result.correct, total: data.result.total, percent }) }),
        data.rank ? el('div', { class: 'note ok', text: t('ctRank', { rank: data.rank, of: data.of }) }) : null,
      ]),
      missed.length
        ? el('div', { class: 'card stack' }, [
            el('h2', { style: { margin: 0 }, text: t('ctReview') }),
            ...missed.map((r) =>
              el('div', { class: 'stack tight' }, [
                el('strong', { text: r.text }),
                r.explanation ? el('span', { class: 'muted small', text: '💡 ' + r.explanation }) : null,
              ])
            ),
          ])
        : null,
      boardCard(data.board, data.of, name)
    );
    app.append(el('a', { class: 'btn ghost block', href: '/', style: { marginTop: '10px' } }, t('joinBackHome')));
  }

  // -------------------------------------------------------- لوحة الصدارة

  async function openBoard(id) {
    state.id = id;
    spinner();
    let data;
    try {
      data = await api('/api/contests/' + id + '/board');
    } catch (err) {
      return failCard(err.message);
    }
    app.replaceChildren(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/c/' + id }, t('ctBackToContest')),
        shareButton(location.origin + '/contest.html#/c/' + id),
      ]),
      boardCard(data.board, data.total, '')
    );
  }

  function boardCard(rows, total, me) {
    if (!rows?.length) {
      return el('div', { class: 'card stack center' }, [el('h2', { style: { margin: 0 }, text: t('ctBoard') }), el('p', { class: 'muted', text: t('ctBoardEmpty') })]);
    }
    const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank));
    return el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 }, text: t('ctBoard') }),
        el('span', { class: 'badge', text: t('ctEntries', { n: total }) }),
      ]),
      el(
        'div',
        { class: 'stack tight' },
        rows.map((r) =>
          el('div', { class: 'ct-row' + (me && r.name === me ? ' mine' : '') }, [
            el('span', { class: 'ct-rank', dir: 'ltr', text: medal(r.rank) }),
            el('span', { class: 'grow', text: r.name }),
            el('span', { class: 'badge', dir: 'ltr', text: `${r.score} / ${r.max}` }),
          ])
        )
      ),
    ]);
  }

  function shareButton(url) {
    const btn = el('button', { class: 'btn ghost sm', type: 'button' }, t('ctCopyLink'));
    btn.addEventListener('click', async () => {
      await copyLink(url);
      toast(t('gLinkCopied'), 'ok');
    });
    return btn;
  }
})();
