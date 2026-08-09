/* شاشة المشارك — خفيفة، جوال أولاً */
(function () {
  'use strict';

  const { $, el, avatarNode, toast, api, connect, store, vibrate, fmtMs } = window.T;

  const app = $('#app');
  const connBadge = $('#conn');
  const scoreBadge = $('#scoreBadge');

  const code = (new URLSearchParams(location.search).get('code') || '').replace(/\D/g, '').slice(0, 6);
  if (!code) {
    location.replace('/');
    return;
  }

  const SESSION_KEY = 'tafa3l:play:' + code;

  const state = {
    info: null, // معلومات الجلسة العامة
    avatar: window.Avatar.random(),
    joined: false,
    last: null, // آخر رسالة حالة
    selection: [],
    submitting: false,
    tickTimer: null,
    renderedKey: '',
  };

  // ------------------------------------------------------------- الاتصال

  const socket = connect({
    onOpen: () => {
      const saved = store.get(SESSION_KEY, null);
      if (saved?.participantId && saved?.participantToken) {
        socket.send({ t: 'rejoin', code, participantId: saved.participantId, participantToken: saved.participantToken });
      }
    },
    onStatus: (status) => {
      connBadge.className = 'badge ' + (status === 'online' ? 'ok' : status === 'offline' ? 'bad' : '');
      connBadge.textContent = status === 'online' ? 'متصل' : status === 'offline' ? 'انقطع الاتصال' : 'جارٍ الاتصال';
    },
    onMessage: handleMessage,
  });

  function handleMessage(msg) {
    switch (msg.t) {
      case 'joined':
        state.joined = true;
        store.set(SESSION_KEY, { participantId: msg.participantId, participantToken: msg.participantToken });
        break;
      case 'state':
        state.last = msg;
        state.joined = true;
        render();
        break;
      case 'answer:accepted':
        vibrate(msg.correct === true ? [18, 60, 18] : 18);
        state.submitting = false;
        break;
      case 'answer:rejected':
        state.submitting = false;
        toast(msg.message, 'bad');
        render(true);
        break;
      case 'kicked':
        store.del(SESSION_KEY);
        state.joined = false;
        state.last = null;
        renderMessage('👋', 'تم إخراجك من الجلسة', 'يمكنك الدخول مجدداً برمز الجلسة.');
        break;
      case 'session:closed':
        renderMessage('🔒', 'انتهت الجلسة', 'شكراً لمشاركتك!');
        socket.close();
        break;
      case 'error':
        if (msg.code === 'no_participant') {
          store.del(SESSION_KEY);
          state.joined = false;
          renderJoin();
        } else if (msg.code === 'no_session' || msg.code === 'ended') {
          renderMessage('🔒', msg.message, 'تأكد من الرمز أو اسأل المدرب.');
        } else {
          toast(msg.message, 'bad');
        }
        break;
    }
  }

  // ------------------------------------------------------- شاشة الانضمام

  async function boot() {
    try {
      state.info = await api('/api/sessions/' + code);
      document.title = state.info.title + ' — تفاعل';
      $('#quizTitle').textContent = state.info.title;
      if (!store.get(SESSION_KEY, null)) renderJoin();
    } catch (err) {
      renderMessage('❓', 'لم نعثر على الجلسة', err.message);
    }
  }

  function renderJoin() {
    const info = state.info || {};
    const anonymous = info.requireName === false;
    app.innerHTML = '';

    const preview = avatarNode(state.avatar, 'lg');

    const nameInput = el('input', {
      id: 'name',
      maxlength: 24,
      placeholder: 'مثال: أبو محمد',
      autocomplete: 'nickname',
      value: store.local.get('tafa3l:name', '') || '',
    });

    const card = el('div', { class: 'card stack' }, [
      el('h1', { text: info.title || 'انضمام' }),
      el('p', {
        class: 'muted small',
        text: anonymous
          ? 'هذا استطلاع مجهول — لا حاجة لاسمك، إجابتك لن تُنسب إليك.'
          : 'اكتب اسمك أو كنيتك، وسنمنحك أفاتاراً عشوائياً.',
      }),
    ]);

    if (!anonymous) {
      card.append(
        el('div', { class: 'center stack', style: { justifyItems: 'center' } }, [
          preview,
          el(
            'button',
            {
              class: 'btn sm ghost',
              type: 'button',
              onclick: () => {
                state.avatar = window.Avatar.random();
                preview.innerHTML = window.Avatar.toSvg(state.avatar);
              },
            },
            '🎲 أفاتار آخر'
          ),
        ])
      );
      card.append(el('div', {}, [el('label', { for: 'name', text: 'اسمك أو كنيتك' }), nameInput]));
    }

    const joinBtn = el('button', { class: 'btn primary block', type: 'submit' }, anonymous ? 'ابدأ المشاركة' : 'انضمام');

    const form = el('form', { class: 'stack' }, [card, joinBtn]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = anonymous ? '' : nameInput.value.trim();
      if (!anonymous && name.length < 2) return toast('اكتب اسماً من حرفين على الأقل', 'bad');
      if (!anonymous) store.local.set('tafa3l:name', name);
      joinBtn.disabled = true;
      const sent = socket.send({ t: 'join', code, name, avatar: state.avatar });
      if (!sent) {
        joinBtn.disabled = false;
        toast('لا يوجد اتصال، حاول بعد لحظات', 'bad');
      }
      setTimeout(() => (joinBtn.disabled = false), 2500);
    });

    app.append(form);
    app.append(
      el('p', { class: 'footer' }, [
        'رمز الجلسة: ',
        el('strong', { text: code, style: { direction: 'ltr', display: 'inline-block' } }),
        ' · لا تُحفظ بياناتك — كل شيء مؤقت.',
      ])
    );
  }

  function renderMessage(emoji, title, body) {
    clearTick();
    app.innerHTML = '';
    app.append(
      el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: emoji }),
        el('div', { class: 'msg', text: title }),
        body ? el('p', { class: 'muted small', text: body }) : null,
        el('a', { class: 'btn ghost sm', href: '/' }, 'العودة للصفحة الرئيسية'),
      ])
    );
  }

  // ----------------------------------------------------------- العرض العام

  function render(force) {
    const s = state.last;
    if (!s) return;

    scoreBadge.classList.toggle('hidden', !(s.me && s.me.score > 0));
    if (s.me) scoreBadge.textContent = '⭐ ' + s.me.score;
    if (s.title) $('#quizTitle').textContent = s.title;

    // مفتاح لتفادي إعادة البناء غير الضرورية أثناء المؤقّت
    const key = [s.phase, s.index, s.locked, s.answered ? 1 : 0, s.participants, s.status].join('|');
    if (!force && key === state.renderedKey && s.phase !== 'lobby') return;
    state.renderedKey = key;
    clearTick();
    app.innerHTML = '';

    if (s.status === 'ended' || s.phase === 'final') return renderFinal(s);
    if (s.phase === 'lobby') return renderLobby(s);
    if (s.phase === 'leaderboard') return renderLeaderboard(s);
    if (s.phase === 'results') return renderResults(s);
    return renderQuestion(s);
  }

  function header(s) {
    return el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
      el('span', { class: 'badge' }, `سؤال ${s.index + 1} من ${s.total}`),
      el('span', { class: 'badge' }, `👥 ${s.participants}`),
    ]);
  }

  function renderLobby(s) {
    app.append(
      el('div', { class: 'card stack center' }, [
        avatarNode(s.me.avatar, 'lg'),
        el('h1', { text: s.me.name }),
        el('p', { class: 'muted', text: 'أنت في القاعة، انتظر بدء المدرب…' }),
        el('div', { class: 'spinner' }),
        el('span', { class: 'badge' }, `👥 ${s.participants} مشارك`),
      ])
    );
    app.append(
      el('div', { class: 'card small muted center' }, 'أبقِ هذه الصفحة مفتوحة. إن انقطع الاتصال سنعيد وصلك تلقائياً.')
    );
  }

  function renderQuestion(s) {
    const q = s.question;
    if (!q) return renderLobby(s);
    state.selection = [];

    app.append(header(s));

    const timerBox = el('div', { class: 'timer', style: { marginBottom: '12px' } }, [
      el('span', { class: 'num', id: 'tnum', text: q.timeLimit ? String(q.timeLimit) : '∞' }),
      el('div', { class: 'progress' }, el('i', { id: 'tbar', style: { width: '100%' } })),
    ]);
    if (q.timeLimit) app.append(timerBox);

    app.append(el('div', { class: 'card stack' }, [el('h2', { class: 'big-q', text: q.text })]));

    if (s.answered) {
      app.append(waitingCard(s, q));
      startTick(s);
      return;
    }

    app.append(answerControls(s, q));
    startTick(s);
  }

  function waitingCard(s, q) {
    const answered = s.answered;
    const scored = q.scored;
    let emoji = '⏳';
    let msg = 'تم استلام إجابتك';
    if (scored && answered.correct === true) {
      emoji = '🎉';
      msg = 'إجابة صحيحة!';
    } else if (scored && answered.correct === false) {
      emoji = '💡';
      msg = 'إجابة غير صحيحة';
    }
    return el('div', { class: 'card feedback' }, [
      el('div', { class: 'em', text: emoji }),
      el('div', { class: 'msg', text: msg }),
      scored && answered.points ? el('div', { class: 'badge ok' }, `+${answered.points} نقطة`) : null,
      el('p', { class: 'muted small', text: 'انتظر بقية المشاركين…' }),
    ]);
  }

  function answerControls(s, q) {
    const box = el('div', { class: 'stack' });

    if (q.type === 'mc' || q.type === 'poll' || q.type === 'truefalse') {
      const options = el('div', { class: 'options' });
      q.options.forEach((option, index) => {
        const button = el('button', { class: `opt c${index % 8}`, type: 'button' }, [
          el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
          el('span', { class: 'grow', text: option.text }),
        ]);
        button.addEventListener('click', () => {
          if (state.submitting) return;
          if (q.multi) {
            const at = state.selection.indexOf(option.id);
            if (at >= 0) state.selection.splice(at, 1);
            else state.selection.push(option.id);
            button.classList.toggle('selected');
            submitBtn.disabled = state.selection.length === 0;
          } else {
            state.selection = [option.id];
            submit(q, option.id);
          }
        });
        options.append(button);
      });
      box.append(options);

      const submitBtn = el('button', { class: 'btn primary block', disabled: true }, 'إرسال الإجابة');
      submitBtn.addEventListener('click', () => submit(q, state.selection));
      if (q.multi) {
        box.append(el('p', { class: 'muted small center', text: 'اختر كل الإجابات الصحيحة ثم أرسل' }));
        box.append(submitBtn);
      }
      return box;
    }

    if (q.type === 'scale') {
      const scale = q.scale || { min: 1, max: 5, minLabel: '', maxLabel: '' };
      const options = el('div', { class: 'options' });
      for (let i = scale.min; i <= scale.max; i++) {
        const button = el('button', { class: `opt c${(i - scale.min) % 8}`, type: 'button' }, [
          el('span', { class: 'tag', text: String(i) }),
          el('span', {
            class: 'grow',
            text: i === scale.min ? scale.minLabel : i === scale.max ? scale.maxLabel : '',
          }),
        ]);
        button.addEventListener('click', () => submit(q, i));
        options.append(button);
      }
      box.append(options);
      return box;
    }

    // word / open
    const isWord = q.type === 'word';
    const input = isWord
      ? el('input', { maxlength: 40, placeholder: 'كلمة واحدة…', autocomplete: 'off' })
      : el('textarea', { maxlength: 300, placeholder: 'اكتب إجابتك…' });
    const send = el('button', { class: 'btn primary block' }, 'إرسال');
    send.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return toast('اكتب إجابتك أولاً', 'bad');
      submit(q, value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && isWord) send.click();
    });
    box.append(el('div', { class: 'card stack' }, [input, send]));
    return box;
  }

  function submit(q, value) {
    if (state.submitting) return;
    state.submitting = true;
    const sent = socket.send({ t: 'answer', questionId: q.id, value });
    if (!sent) {
      state.submitting = false;
      toast('لا يوجد اتصال — حاول مجدداً', 'bad');
    }
  }

  function renderResults(s) {
    const q = s.question;
    const results = s.results;
    app.append(header(s));
    app.append(el('div', { class: 'card stack' }, [el('h2', { class: 'big-q', text: q.text })]));

    if (s.answered && q.scored) {
      app.append(waitingCard(s, q));
    }

    if (results?.options) {
      const options = el('div', { class: 'options' });
      const mine = s.answered ? [].concat(s.answered.value) : [];
      results.options.forEach((option, index) => {
        const isCorrect = option.correct;
        const chosen = mine.includes(option.id);
        const node = el(
          'div',
          {
            class:
              `opt c${index % 8}` +
              (q.scored && isCorrect ? ' correct' : '') +
              (q.scored && chosen && !isCorrect ? ' wrong' : '') +
              (!q.scored && chosen ? ' selected' : ''),
          },
          [
            el('i', { class: 'bar', style: { width: option.percent + '%' } }),
            el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
            el('span', { class: 'grow', text: option.text }),
            el('span', { class: 'count', text: `${option.percent}٪ (${option.count})` }),
          ]
        );
        options.append(node);
      });
      app.append(options);
    } else if (results?.words) {
      app.append(el('div', { class: 'card' }, wordCloud(results.words)));
    } else if (results?.buckets) {
      app.append(el('div', { class: 'card stack' }, [scaleChart(results), el('p', { class: 'center muted', text: `المتوسط: ${results.average}` })]));
    } else if (results?.responses) {
      app.append(
        el(
          'div',
          { class: 'card quotes' },
          results.responses.slice(-20).reverse().map((r) => el('div', { class: 'quote' }, [el('span', { text: r.text })]))
        )
      );
    }

    app.append(el('p', { class: 'footer', text: 'في انتظار المدرب للانتقال…' }));
  }

  function wordCloud(words) {
    const cloud = el('div', { class: 'cloud' });
    const max = Math.max(1, ...words.map((w) => w.count));
    const colors = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#22d3ee'];
    words.forEach((word, index) => {
      const size = 0.95 + (word.count / max) * 1.7;
      cloud.append(
        el('span', {
          text: word.text + (word.count > 1 ? ` ×${word.count}` : ''),
          style: { fontSize: size.toFixed(2) + 'rem', color: colors[index % colors.length] },
        })
      );
    });
    return words.length ? cloud : el('p', { class: 'muted center', text: 'لا توجد إجابات بعد' });
  }

  function scaleChart(results) {
    const wrap = el('div', { class: 'stack' });
    results.buckets.forEach((bucket) => {
      wrap.append(
        el('div', { class: 'row', style: { gap: '8px' } }, [
          el('span', { class: 'badge', text: String(bucket.value) }),
          el('div', { class: 'progress grow' }, el('i', { style: { width: bucket.percent + '%' } })),
          el('span', { class: 'small muted', text: `${bucket.percent}٪` }),
        ])
      );
    });
    return wrap;
  }

  function renderLeaderboard(s) {
    app.append(el('h1', { class: 'center', text: '🏆 الترتيب' }));
    if (s.rank) {
      app.append(
        el('div', { class: 'card center stack' }, [
          el('div', { class: 'stat' }, [
            el('div', { class: 'v', text: `#${s.rank.rank}` }),
            el('div', { class: 'k', text: `من ${s.rank.of} مشارك` }),
          ]),
          el('div', { class: 'badge ok' }, `⭐ ${s.me.score} نقطة`),
        ])
      );
    }
    if (s.leaderboard?.length) app.append(boardList(s.leaderboard, s.me.id));
    app.append(el('p', { class: 'footer', text: 'في انتظار السؤال التالي…' }));
  }

  function renderFinal(s) {
    app.append(
      el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: '🎊' }),
        el('div', { class: 'msg', text: 'انتهى النشاط' }),
        s.me ? avatarNode(s.me.avatar, 'lg') : null,
        s.me ? el('h2', { text: s.me.name }) : null,
        s.rank ? el('div', { class: 'badge' }, `المركز ${s.rank.rank} من ${s.rank.of}`) : null,
        s.me && s.me.score ? el('div', { class: 'badge ok' }, `⭐ ${s.me.score} نقطة`) : null,
      ])
    );
    if (s.leaderboard?.length) app.append(el('div', { class: 'card stack' }, [el('h2', { text: '🏆 الأوائل' }), boardList(s.leaderboard, s.me?.id)]));
    app.append(el('p', { class: 'footer', text: 'شكراً لمشاركتك! لم تُحفظ أي بيانات — كل شيء مؤقت.' }));
    store.del(SESSION_KEY);
  }

  function boardList(list, meId) {
    const board = el('div', { class: 'board' });
    list.forEach((entry) => {
      board.append(
        el('div', { class: 'item' + (entry.id === meId ? ' me' : '') }, [
          el('span', { class: 'rank', text: String(entry.rank) }),
          avatarNode(entry.avatar, 'sm'),
          el('span', { class: 'grow', text: entry.name }),
          el('span', { class: 'score', text: String(entry.score) }),
        ])
      );
    });
    return board;
  }

  // ------------------------------------------------------------- المؤقّت

  function startTick(s) {
    const q = s.question;
    if (!q?.timeLimit || !s.endsAt) return;
    const offset = s.serverNow ? Date.now() - s.serverNow : 0;
    const num = $('#tnum');
    const bar = $('#tbar');
    if (!num || !bar) return;
    const total = q.timeLimit * 1000;

    state.tickTimer = setInterval(() => {
      const left = Math.max(0, s.endsAt - (Date.now() - offset));
      num.textContent = String(Math.ceil(left / 1000));
      bar.style.width = Math.max(0, (left / total) * 100) + '%';
      if (left <= 0) clearTick();
    }, 200);
  }

  function clearTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.last) render(true);
  });

  boot();
})();
