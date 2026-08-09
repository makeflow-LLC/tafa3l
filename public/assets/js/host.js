/* لوحة المدرب — إنشاء النشاط، إدارة العرض المباشر، والإحصاءات */
(function () {
  'use strict';

  const { $, el, avatarNode, toast, api, connect, store, TYPE_LABELS, TYPE_EMOJI, fmtMs } = window.T;

  const app = $('#app');
  const bar = $('#bar');
  const connBadge = $('#conn');
  const codeBadge = $('#codeBadge');

  const HOSTS_KEY = 'tafa3l:hosts';

  const state = {
    code: null,
    hostToken: null,
    socket: null,
    live: null, // آخر حالة من الخادم
    dashboard: null,
    tab: 'stage',
    tickTimer: null,
    joinUrl: '',
  };

  // -------------------------------------------------------------- التوجيه

  function route() {
    const hash = location.hash.slice(1) || '/';
    const match = hash.match(/^\/live\/(\d{6})$/);
    if (match) return openLive(match[1]);
    return openBuilder();
  }

  window.addEventListener('hashchange', route);

  function hostTokenFor(code) {
    const hosts = store.local.get(HOSTS_KEY, {});
    return hosts[code] || null;
  }

  function rememberHost(code, hostToken, title) {
    const hosts = store.local.get(HOSTS_KEY, {});
    hosts[code] = hostToken;
    store.local.set(HOSTS_KEY, hosts);
    store.local.set('tafa3l:host:last', { code, hostToken, title });
  }

  // ------------------------------------------------------------- المحرّر

  function openBuilder() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';
    const root = el('div', { class: 'stack' });
    app.append(el('h1', { text: 'إنشاء نشاط تفاعلي' }));
    app.append(root);
    window.Builder.mount(root, async (draft) => {
      try {
        const payload = {
          title: draft.title,
          settings: draft.settings,
          questions: draft.questions.map((question) => ({
            ...question,
            options: (question.options || []).filter((option) => option.text.trim()),
          })),
        };
        const created = await api('/api/sessions', { method: 'POST', body: payload });
        rememberHost(created.code, created.hostToken, created.title);
        location.hash = '#/live/' + created.code;
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  }

  // ---------------------------------------------------------- العرض المباشر

  function openLive(code) {
    const hostToken = hostTokenFor(code);
    if (!hostToken) {
      app.innerHTML = '';
      app.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { text: 'لا نملك مفتاح هذه الجلسة على هذا الجهاز' }),
          el('p', { class: 'muted small', text: 'مفتاح المضيف محفوظ في متصفح الجهاز الذي أنشأ الجلسة فقط.' }),
          el('a', { class: 'btn primary', href: '#/' }, 'إنشاء نشاط جديد'),
        ])
      );
      return;
    }

    teardown();
    state.code = code;
    state.hostToken = hostToken;
    state.tab = 'stage';
    codeBadge.textContent = '🔑 ' + code;
    codeBadge.classList.remove('hidden');
    connBadge.classList.remove('hidden');

    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    state.socket = connect({
      onOpen: () => state.socket.send({ t: 'host:hello', code, hostToken }),
      onStatus: (status) => {
        connBadge.className = 'badge ' + (status === 'online' ? 'ok' : status === 'offline' ? 'bad' : '');
        connBadge.textContent = status === 'online' ? 'مباشر' : status === 'offline' ? 'انقطع' : 'اتصال…';
      },
      onMessage: (msg) => {
        if (msg.t === 'state') {
          state.live = msg;
          renderLive();
        } else if (msg.t === 'dashboard') {
          state.dashboard = msg.data;
          if (state.tab === 'dashboard') renderLive();
        } else if (msg.t === 'session:closed') {
          toast('انتهت الجلسة', 'bad');
          teardown();
          location.hash = '#/';
        } else if (msg.t === 'error') {
          toast(msg.message, 'bad');
          if (msg.code === 'no_session' || msg.code === 'forbidden') {
            const hosts = store.local.get(HOSTS_KEY, {});
            delete hosts[code];
            store.local.set(HOSTS_KEY, hosts);
            setTimeout(() => (location.hash = '#/'), 1200);
          }
        }
      },
    });

    api('/api/sessions/' + code)
      .then((info) => {
        state.joinUrl = info.joinUrl;
      })
      .catch(() => {});
  }

  function teardown() {
    state.socket?.close();
    state.socket = null;
    state.live = null;
    state.dashboard = null;
    clearTick();
  }

  function send(type, extra) {
    if (!state.socket?.send({ t: type, ...(extra || {}) })) toast('لا يوجد اتصال', 'bad');
  }

  // ------------------------------------------------------------- الرسم

  function renderLive() {
    const s = state.live;
    if (!s) return;
    clearTick();
    app.innerHTML = '';

    app.append(
      el('div', { class: 'row between', style: { marginBottom: '12px' } }, [
        el('div', { class: 'grow' }, [
          el('h1', { text: s.title, style: { margin: 0, fontSize: '1.3rem' } }),
          el('div', { class: 'muted small', text: statusLabel(s) }),
        ]),
        el('span', { class: 'badge live' }, `👥 ${s.participants.length}`),
      ])
    );

    const tabs = el('div', { class: 'tabs', style: { marginBottom: '12px' } }, [
      tabBtn('stage', '🎬 العرض'),
      tabBtn('dashboard', '📊 لوحة التحكم'),
      tabBtn('share', '🔗 المشاركة'),
    ]);
    app.append(tabs);

    if (state.tab === 'stage') renderStage(s);
    else if (state.tab === 'dashboard') renderDashboard();
    else renderShare(s);

    renderBar(s);
  }

  function tabBtn(key, label) {
    const button = el('button', { class: state.tab === key ? 'on' : '', type: 'button' }, label);
    button.addEventListener('click', () => {
      state.tab = key;
      if (key === 'dashboard') send('host:dashboard');
      renderLive();
    });
    return button;
  }

  function statusLabel(s) {
    if (s.status === 'ended') return 'انتهى النشاط';
    if (s.status === 'lobby') return 'في انتظار البدء — شارك الرمز مع المشاركين';
    const phase = { question: 'الإجابة جارية', results: 'عرض النتائج', leaderboard: 'لوحة الترتيب' }[s.phase] || '';
    return `سؤال ${s.index + 1} من ${s.total} · ${phase}`;
  }

  // ------------------------------------------------------------- المسرح

  function renderStage(s) {
    if (s.status === 'lobby') return renderLobby(s);
    if (s.status === 'ended' || s.phase === 'final') return renderFinal(s);
    if (s.phase === 'leaderboard') return renderBoard(s);
    return renderQuestion(s);
  }

  function renderLobby(s) {
    app.append(
      el('div', { class: 'card' }, [
        el('div', { class: 'joinbox' }, [qrBox(), joinInfo(s)]),
      ])
    );
    app.append(peopleCard(s));
  }

  function qrBox() {
    const box = el('div', { class: 'qr' });
    const url = state.joinUrl || `${location.origin}/j/${state.code}`;
    fetch('/api/qr?text=' + encodeURIComponent(url))
      .then((response) => response.text())
      .then((svg) => {
        box.innerHTML = svg;
      })
      .catch(() => {
        box.textContent = 'تعذّر توليد QR';
      });
    return box;
  }

  function joinInfo(s) {
    const url = state.joinUrl || `${location.origin}/j/${state.code}`;
    return el('div', { class: 'stack center' }, [
      el('p', { class: 'muted small', style: { margin: 0 }, text: 'ادخل من المتصفح إلى' }),
      el('div', { style: { direction: 'ltr', fontWeight: '700' }, text: url.replace(/^https?:\/\//, '') }),
      el('p', { class: 'muted small', style: { margin: '6px 0 0' }, text: 'أو أدخل الرمز' }),
      el('div', { class: 'bigcode', text: state.code }),
      el('div', { class: 'row', style: { justifyContent: 'center' } }, [
        el('button', { class: 'btn sm', type: 'button', onclick: () => copy(url) }, '📋 نسخ الرابط'),
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => share(url, s.title) }, '↗ مشاركة'),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: s.settings.requireName ? 'سيُطلب من المشاركين اسم أو كنية' : 'وضع مجهول: لن يُطلب اسم' }),
    ]);
  }

  function peopleCard(s) {
    const people = el('div', { class: 'people' });
    if (!s.participants.length) {
      people.append(el('span', { class: 'muted small', text: 'لم ينضم أحد بعد…' }));
    }
    s.participants.forEach((participant) => {
      const chip = el(
        'span',
        { class: 'chip' + (participant.answeredCurrent ? ' answered' : '') + (participant.connected ? '' : ' off') },
        [avatarNode(participant.avatar, 'sm'), el('span', { text: participant.name })]
      );
      chip.title = 'اضغط مطولاً للإخراج';
      chip.addEventListener('dblclick', () => {
        if (confirm(`إخراج ${participant.name} من الجلسة؟`)) send('host:kick', { participantId: participant.id });
      });
      people.append(chip);
    });
    return el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('h2', { text: `المشاركون (${s.participants.length})`, style: { margin: 0 } }),
        el('span', { class: 'muted small', text: 'نقرة مزدوجة على الاسم للإخراج' }),
      ]),
      people,
    ]);
  }

  function renderQuestion(s) {
    const q = s.question;
    const results = s.results;
    const answered = s.answeredCount;
    const total = s.participants.length;

    const head = el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('span', { class: 'badge' }, `${TYPE_EMOJI[q.type]} ${TYPE_LABELS[q.type]}`),
        el('span', { class: 'badge' + (answered === total && total > 0 ? ' ok' : '') }, `أجاب ${answered} من ${total}`),
      ]),
      el('h2', { class: 'big-q', text: q.text }),
    ]);

    if (q.timeLimit && s.phase === 'question') {
      head.append(
        el('div', { class: 'timer' }, [
          el('span', { class: 'num', id: 'tnum', text: String(q.timeLimit) }),
          el('div', { class: 'progress' }, el('i', { id: 'tbar', style: { width: '100%' } })),
        ])
      );
    }
    app.append(head);

    // شريط تقدّم الإجابات
    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between small muted' }, [el('span', { text: 'نسبة الإجابة' }), el('span', { text: total ? Math.round((answered / total) * 100) + '٪' : '—' })]),
        el('div', { class: 'progress thin' }, el('i', { style: { width: (total ? (answered / total) * 100 : 0) + '%' } })),
      ])
    );

    app.append(resultsView(q, results, s.phase === 'results'));
    if (s.phase === 'question') startTick(s, q);
  }

  function resultsView(q, results, reveal) {
    const card = el('div', { class: 'card stack' });
    if (!results || results.total === 0) {
      card.append(el('p', { class: 'muted center', style: { margin: 0 }, text: 'لا توجد إجابات بعد…' }));
      return card;
    }

    if (results.options) {
      const options = el('div', { class: 'options' });
      results.options.forEach((option, index) => {
        options.append(
          el(
            'div',
            { class: `opt c${index % 8}` + (reveal && option.correct ? ' correct' : '') + (reveal && !option.correct && q.scored ? ' dim' : '') },
            [
              el('i', { class: 'bar', style: { width: option.percent + '%' } }),
              el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
              el('span', { class: 'grow', text: option.text }),
              option.correct ? el('span', { class: 'badge ok', text: '✓' }) : null,
              el('span', { class: 'count', text: `${option.percent}٪ · ${option.count}` }),
            ]
          )
        );
      });
      card.append(options);
      if (q.scored) {
        card.append(
          el('p', { class: 'muted small center', style: { margin: 0 } }, `إجابات صحيحة: ${results.correctCount} من ${results.total} · متوسط الزمن ${fmtMs(results.avgMs)}`)
        );
      }
      return card;
    }

    if (results.words) {
      const cloud = el('div', { class: 'cloud' });
      const max = Math.max(1, ...results.words.map((word) => word.count));
      const colors = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#22d3ee'];
      results.words.forEach((word, index) => {
        cloud.append(
          el('span', {
            text: word.text + (word.count > 1 ? ` ×${word.count}` : ''),
            style: { fontSize: (1 + (word.count / max) * 2.2).toFixed(2) + 'rem', color: colors[index % colors.length] },
          })
        );
      });
      card.append(cloud);
      return card;
    }

    if (results.buckets) {
      results.buckets.forEach((bucket) => {
        card.append(
          el('div', { class: 'row' }, [
            el('span', { class: 'badge', text: String(bucket.value) }),
            el('div', { class: 'progress grow' }, el('i', { style: { width: bucket.percent + '%' } })),
            el('span', { class: 'small muted', text: `${bucket.percent}٪ (${bucket.count})` }),
          ])
        );
      });
      card.append(el('p', { class: 'center', style: { margin: 0 } }, [el('strong', { text: 'المتوسط: ' + results.average })]));
      return card;
    }

    if (results.responses) {
      const quotes = el('div', { class: 'quotes' });
      results.responses
        .slice()
        .reverse()
        .forEach((response) => {
          quotes.append(
            el('div', { class: 'quote' }, [
              response.name ? el('div', { class: 'small muted', text: response.name }) : null,
              el('div', { text: response.text }),
            ])
          );
        });
      card.append(quotes);
      return card;
    }

    return card;
  }

  function renderBoard(s) {
    app.append(el('h2', { class: 'center', text: '🏆 لوحة الترتيب' }));
    app.append(el('div', { class: 'card' }, boardList(s.leaderboard || [])));
  }

  function renderFinal(s) {
    app.append(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '3rem' }, text: '🎊' }),
        el('h2', { text: 'انتهى النشاط', style: { margin: 0 } }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: 'حمّل النتائج الآن إن أردت الاحتفاظ بها — ستُحذف الجلسة تلقائياً.' }),
        el('button', { class: 'btn accent', type: 'button', onclick: exportResults }, '⬇ تنزيل النتائج (JSON)'),
      ])
    );
    if (s.leaderboard?.length) app.append(el('div', { class: 'card stack' }, [el('h2', { text: 'الأوائل' }), boardList(s.leaderboard)]));
  }

  function boardList(list) {
    const board = el('div', { class: 'board' });
    if (!list.length) board.append(el('p', { class: 'muted center', text: 'لا توجد نتائج بعد' }));
    list.forEach((entry) => {
      board.append(
        el('div', { class: 'item' }, [
          el('span', { class: 'rank', text: String(entry.rank) }),
          avatarNode(entry.avatar, 'sm'),
          el('span', { class: 'grow', text: entry.name }),
          entry.streak > 1 ? el('span', { class: 'badge', text: `🔥 ${entry.streak}` }) : null,
          el('span', { class: 'score', text: String(entry.score) }),
        ])
      );
    });
    return board;
  }

  // -------------------------------------------------------- لوحة التحكم

  function renderDashboard() {
    const data = state.dashboard;
    if (!data) {
      app.append(el('div', { class: 'card center' }, el('div', { class: 'spinner' })));
      send('host:dashboard');
      return;
    }
    const summary = data.summary;

    app.append(
      el('div', { class: 'stats' }, [
        stat(summary.participants, 'مشارك'),
        stat(summary.connected, 'متصل الآن'),
        stat(summary.asked + ' / ' + data.questionCount, 'أسئلة عُرضت'),
        stat(summary.participation + '٪', 'نسبة التفاعل'),
        data.hasScores ? stat(summary.avgScore, 'متوسط النقاط') : null,
        data.hasScores && summary.avgAccuracy !== null ? stat(summary.avgAccuracy + '٪', 'متوسط الدقة') : null,
      ].filter(Boolean))
    );

    // جدول الأسئلة
    const qRows = data.perQuestion.map((question) =>
      el('tr', {}, [
        el('td', {}, [el('span', { class: 'badge', text: TYPE_EMOJI[question.type] }), ' ' + (question.index + 1)]),
        el('td', { style: { whiteSpace: 'normal', minWidth: '180px' } }, question.text),
        el('td', {}, question.asked ? `${question.responses} (${question.responseRate}٪)` : '—'),
        el('td', {}, question.accuracy === null ? '—' : question.accuracy + '٪'),
        el('td', {}, question.responses ? fmtMs(question.avgMs) : '—'),
      ])
    );

    app.append(
      el('div', { class: 'card stack' }, [
        el('h2', { text: 'أداء الأسئلة', style: { margin: 0 } }),
        el('div', { class: 'table-wrap' }, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '#'), el('th', {}, 'السؤال'), el('th', {}, 'الإجابات'), el('th', {}, 'الدقة'), el('th', {}, 'الزمن')])),
            el('tbody', {}, qRows),
          ]),
        ]),
      ])
    );

    // جدول المشاركين
    const pRows = data.participants.map((participant, index) => {
      const dots = el(
        'span',
        { class: 'dots' },
        participant.answers.map((answer) =>
          el('i', { class: answer === null ? '' : answer.correct === true ? 'ok' : answer.correct === false ? 'bad' : 'neutral' })
        )
      );
      return el('tr', {}, [
        el('td', {}, String(index + 1)),
        el('td', {}, [
          el('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, [
            avatarNode(participant.avatar, 'sm'),
            el('span', { text: participant.name }),
            participant.connected ? null : el('span', { class: 'badge bad', text: 'غير متصل' }),
          ]),
        ]),
        el('td', {}, [
          el('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, [
            el('div', { class: 'progress thin', style: { width: '60px' } }, el('i', { style: { width: Math.min(100, participant.progress) + '%' } })),
            el('span', { class: 'small muted', text: `${participant.answered}/${participant.asked}` }),
          ]),
        ]),
        data.hasScores ? el('td', {}, participant.accuracy === null ? '—' : participant.accuracy + '٪') : null,
        data.hasScores ? el('td', {}, String(participant.score)) : null,
        el('td', {}, fmtMs(participant.avgMs)),
        el('td', {}, dots),
      ].filter(Boolean));
    });

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { text: `تقدّم المشاركين (${data.participants.length})`, style: { margin: 0 } }),
          el('button', { class: 'btn sm ghost', type: 'button', onclick: exportResults }, '⬇ تنزيل'),
        ]),
        data.participants.length
          ? el('div', { class: 'table-wrap' }, [
              el('table', {}, [
                el(
                  'thead',
                  {},
                  el('tr', {}, [
                    el('th', {}, '#'),
                    el('th', {}, 'المشارك'),
                    el('th', {}, 'التقدّم'),
                    data.hasScores ? el('th', {}, 'الدقة') : null,
                    data.hasScores ? el('th', {}, 'النقاط') : null,
                    el('th', {}, 'متوسط الزمن'),
                    el('th', {}, 'الإجابات'),
                  ].filter(Boolean))
                ),
                el('tbody', {}, pRows),
              ]),
            ])
          : el('p', { class: 'muted center', text: 'لا يوجد مشاركون بعد' }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: '🟢 صحيحة · 🔴 خاطئة · 🔵 إجابة بلا تصحيح (استطلاع)' }),
      ])
    );

    app.append(el('p', { class: 'footer', text: 'كل هذه البيانات مؤقتة في ذاكرة الخادم وتُمحى عند انتهاء الجلسة.' }));
  }

  function stat(value, label) {
    return el('div', { class: 'stat' }, [el('div', { class: 'v', text: String(value) }), el('div', { class: 'k', text: label })]);
  }

  // ------------------------------------------------------------- المشاركة

  function renderShare(s) {
    app.append(el('div', { class: 'card' }, [el('div', { class: 'joinbox' }, [qrBox(), joinInfo(s)])]));
    app.append(
      el('div', { class: 'card stack' }, [
        el('h2', { text: 'كيف يدخل المتدربون؟' }),
        el('ol', { class: 'muted small', style: { margin: 0, paddingInlineStart: '20px', lineHeight: '2' } }, [
          el('li', {}, 'يمسحون رمز QR بكاميرا الجوال، أو يفتحون الرابط أعلاه.'),
          el('li', {}, s.settings.requireName ? 'يكتبون اسمهم أو كنيتهم ويحصلون على أفاتار عشوائي.' : 'يدخلون مباشرة بلا اسم (وضع مجهول).'),
          el('li', {}, 'يجيبون على الأسئلة أولاً بأول، وأنت تتحكم بالانتقال.'),
        ]),
        el('button', { class: 'btn danger', type: 'button', onclick: endSession }, 'إنهاء الجلسة وحذف بياناتها'),
      ])
    );
  }

  // -------------------------------------------------------- شريط التحكم

  function renderBar(s) {
    bar.innerHTML = '';
    if (state.tab !== 'stage') return;

    const actions = [];
    if (s.status === 'lobby') {
      actions.push(
        el('button', { class: 'btn primary', type: 'button', disabled: s.participants.length === 0, onclick: () => send('host:start') },
          s.participants.length ? '▶ بدء النشاط' : 'بانتظار المشاركين')
      );
    } else if (s.status === 'ended') {
      actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: exportResults }, '⬇ تنزيل النتائج'));
      actions.push(el('button', { class: 'btn danger', type: 'button', onclick: endSession }, '🗑 حذف الجلسة'));
    } else {
      actions.push(el('button', { class: 'icon-btn', type: 'button', title: 'السؤال السابق', disabled: s.index <= 0, onclick: () => send('host:prev') }, '⟩'));
      if (s.phase === 'question') {
        actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => send('host:lock') }, '⏸ إغلاق الإجابة'));
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:results') }, '👁 عرض النتائج'));
      } else if (s.phase === 'results') {
        if (s.settings.showLeaderboard) {
          actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => send('host:leaderboard') }, '🏆 الترتيب'));
        }
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:skip') }, s.index + 1 >= s.total ? '🏁 إنهاء' : '⟨ السؤال التالي'));
      } else {
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:skip') }, s.index + 1 >= s.total ? '🏁 إنهاء' : '⟨ السؤال التالي'));
      }
      actions.push(el('button', { class: 'icon-btn', type: 'button', title: 'إنهاء النشاط', onclick: () => confirm('إنهاء النشاط الآن؟') && send('host:end') }, '⏹'));
    }

    bar.append(el('div', { class: 'actionbar' }, actions));
  }

  // ------------------------------------------------------------- أدوات

  function exportResults() {
    const url = `/api/sessions/${state.code}/export?hostToken=${encodeURIComponent(state.hostToken)}`;
    const link = el('a', { href: url, download: `tafa3l-${state.code}.json` });
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function endSession() {
    if (!confirm('إنهاء الجلسة وحذف كل بياناتها من الذاكرة؟')) return;
    try {
      await api(`/api/sessions/${state.code}?hostToken=${encodeURIComponent(state.hostToken)}`, { method: 'DELETE' });
      toast('تم حذف الجلسة', 'ok');
      const hosts = store.local.get(HOSTS_KEY, {});
      delete hosts[state.code];
      store.local.set(HOSTS_KEY, hosts);
      teardown();
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('تم نسخ الرابط', 'ok');
    } catch {
      toast(text);
    }
  }

  function share(url, title) {
    if (navigator.share) navigator.share({ title: title || 'تفاعل', text: 'انضم إلى النشاط', url }).catch(() => {});
    else copy(url);
  }

  function startTick(s, q) {
    if (!s.endsAt) return;
    const offset = s.serverNow ? Date.now() - s.serverNow : 0;
    const num = $('#tnum');
    const barEl = $('#tbar');
    if (!num || !barEl) return;
    const total = q.timeLimit * 1000;
    state.tickTimer = setInterval(() => {
      const left = Math.max(0, s.endsAt - (Date.now() - offset));
      num.textContent = String(Math.ceil(left / 1000));
      barEl.style.width = Math.max(0, (left / total) * 100) + '%';
      if (left <= 0) clearTick();
    }, 200);
  }

  function clearTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
  }

  // تنبيه قبل مغادرة صفحة جلسة مباشرة
  window.addEventListener('beforeunload', (event) => {
    if (state.live && state.live.status === 'live') {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  route();
})();
