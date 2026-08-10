/* شاشة المشارك — خفيفة، جوال أولاً */
(function () {
  'use strict';

  const { $, el, avatarNode, toast, api, connect, store, vibrate } = window.T;
  const Fx = window.Fx;

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
    cancelCountdown: null,
    lastFeedback: '', // لمنع تكرار الصوت/القصاصات عند إعادة الرسم
    clockOffset: 0, // فرق ساعة المتصفح عن ساعة الخادم، يُلتقط عند وصول الرسالة
  };

  /** توقيت الخادم الآن كما نقدّره محلياً */
  function serverTime() {
    return Date.now() - state.clockOffset;
  }

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
        // يجب التقاط الفارق لحظة الوصول؛ حسابه لاحقاً يجعله دائماً صفراً
        if (msg.serverNow) state.clockOffset = Date.now() - msg.serverNow;
        state.last = msg;
        state.joined = true;
        render();
        break;
      case 'answer:accepted':
        vibrate(msg.correct === true ? [18, 60, 18] : 18);
        Fx.play(msg.correct === true ? 'correct' : msg.correct === false ? 'wrong' : 'sent');
        if (msg.correct === true) Fx.confetti(70);
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

    // عدّاد «استعد» متزامن مع الخادم قبل فتح السؤال المؤقّت
    const untilOpen = openIn(s);
    if (s.phase === 'question' && untilOpen > 250) {
      renderReady(s, untilOpen);
      return;
    }

    if (s.status === 'ended' || s.phase === 'final') return renderFinal(s);
    if (s.phase === 'lobby') return renderLobby(s);
    if (s.phase === 'leaderboard') return renderLeaderboard(s);
    // الوضع الحر: بعد الإجابة يرى نتيجته وزراً للانتقال بنفسه
    if (s.phase === 'feedback') return renderSelfFeedback(s);
    if (s.phase === 'results') return renderResults(s);
    return renderQuestion(s);
  }

  /** كم بقي على فتح السؤال (بتوقيت الخادم) */
  function openIn(s) {
    if (!s.opensAt) return 0;
    return s.opensAt - serverTime();
  }

  function renderReady(s, msLeft) {
    state.cancelCountdown?.();
    app.append(header(s));
    app.append(
      el('div', { class: 'card stack center' }, [
        el('span', { class: 'badge' }, `${s.question ? s.question.text : ''}`),
        el('p', { class: 'muted', text: 'استعد… ينطلق الجميع معاً' }),
      ])
    );
    state.cancelCountdown = Fx.countdown(msLeft, () => {
      state.cancelCountdown = null;
      render(true);
    });
  }

  function header(s) {
    return el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
      el('span', { class: 'badge' }, `سؤال ${s.index + 1} من ${s.total}`),
      el('span', { class: 'badge' }, `👥 ${s.participants}`),
    ]);
  }

  function renderLobby(s) {
    // نوضّح سبب الانتظار: في الوضع الحر لا ينتظر أحد إلا إذا أطفأ المدرب البدء التلقائي
    const pace = s.settings?.pace;
    const waitingReason =
      pace === 'self'
        ? 'وضع حر — لكن المدرب اختار أن يبدأ الجميع معاً'
        : pace === 'auto'
          ? 'سيبدأ النشاط وينتقل تلقائياً'
          : 'أنت في القاعة، انتظر بدء المدرب…';

    app.append(
      el('div', { class: 'card stack center' }, [
        avatarNode(s.me.avatar, 'lg'),
        el('h1', { text: s.me.name }),
        el('p', { class: 'muted', text: waitingReason }),
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
      const reveal = answerReveal(s, q);
      if (reveal) app.append(reveal);
      app.append(reactionBar());
      startTick(s);
      return;
    }

    app.append(answerControls(s, q));
    startTick(s);
  }

  /** شريط التفاعلات السريعة — يظهر على شاشة المدرب */
  function reactionBar() {
    const row = el('div', { class: 'reactions' });
    Fx.REACTIONS.forEach((emoji) => {
      const button = el('button', { class: 'react', type: 'button', 'aria-label': 'تفاعل ' + emoji }, emoji);
      button.addEventListener('click', () => {
        socket.send({ t: 'reaction', emoji });
        button.classList.remove('bump');
        void button.offsetWidth;
        button.classList.add('bump');
        vibrate(10);
      });
      row.append(button);
    });
    return el('div', { class: 'card stack center' }, [
      el('p', { class: 'muted small', style: { margin: 0 }, text: 'أرسل تفاعلك للشاشة 👇' }),
      row,
    ]);
  }

  function waitingCard(s, q, selfPaced) {
    const answered = s.answered;
    const scored = q.scored;
    let emoji = '⏳';
    let msg = 'تم استلام إجابتك';
    if (!answered) {
      emoji = '⌛';
      msg = 'انتهى وقتك على هذا السؤال';
    } else if (scored && answered.correct === true) {
      emoji = '🎉';
      msg = 'إجابة صحيحة!';
    } else if (scored && answered.correct === false) {
      emoji = '💡';
      msg = 'إجابة غير صحيحة';
    }
    return el('div', { class: 'card feedback' }, [
      el('div', { class: 'em', text: emoji }),
      el('div', { class: 'msg', text: msg }),
      scored && answered?.points ? el('div', { class: 'badge ok' }, `+${answered.points} نقطة`) : null,
      // مضاعف السلسلة إن كان مفعّلاً وأثّر فعلاً
      scored && answered?.multiplier > 1 ? el('div', { class: 'badge streak' }, `🔥 مضاعف ×${answered.multiplier}`) : null,
      scored && s.me.streak > 1 ? el('div', { class: 'badge streak' }, `${s.me.streak} إجابات متتالية!`) : null,
      selfPaced ? null : el('p', { class: 'muted small', text: 'انتظر بقية المشاركين…' }),
    ]);
  }

  /** الإجابة الصحيحة + شرحها — تظهر بعد إجابة المتدرب إن فعّل المدرب الخيار */
  function answerReveal(s, q) {
    if (!q?.scored) return null;
    const revealed = q.options?.some((option) => option.correct !== undefined);
    if (!revealed) return null;
    // لا نكرّر العرض إن كانت إجابته صحيحة وبلا شرح
    const wrong = s.answered && s.answered.correct === false;
    if (!wrong && !q.explanation) return null;

    const correctText = q.options
      .filter((option) => option.correct)
      .map((option) => option.text)
      .join(' + ');

    return el('div', { class: 'card stack reveal' }, [
      correctText
        ? el('div', { class: 'row', style: { gap: '8px' } }, [
            el('span', { class: 'badge ok', text: '✓ الإجابة الصحيحة' }),
            el('strong', { class: 'grow', text: correctText }),
          ])
        : null,
      q.explanation ? el('p', { style: { margin: 0 } }, [el('span', { text: '💡 ' }), q.explanation]) : null,
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
      // مقياس حقيقي: خط أفقي يُسحب عليه المؤشر، لا قائمة خيارات
      const scale = q.scale || { min: 1, max: 5, minLabel: '', maxLabel: '' };
      const start = Math.round((scale.min + scale.max) / 2);

      const valueBubble = el('div', { class: 'slider-value', text: String(start) });
      const range = el('input', {
        type: 'range',
        class: 'slider',
        min: scale.min,
        max: scale.max,
        step: 1,
        value: start,
        'aria-label': 'اسحب لاختيار قيمة بين ' + scale.min + ' و ' + scale.max,
      });
      // علامات القيم تحت الخط
      const ticks = el('div', { class: 'slider-ticks' });
      for (let i = scale.min; i <= scale.max; i++) {
        ticks.append(el('span', { class: i === start ? 'on' : '', 'data-v': i, text: String(i) }));
      }
      const paint = () => {
        valueBubble.textContent = range.value;
        const ratio = (Number(range.value) - scale.min) / Math.max(1, scale.max - scale.min);
        valueBubble.style.transform = `scale(${1 + ratio * 0.25})`;
        for (const tick of ticks.children) tick.className = tick.dataset.v === range.value ? 'on' : '';
      };
      range.addEventListener('input', paint);

      const send = el('button', { class: 'btn primary block' }, 'إرسال ✓');
      send.addEventListener('click', () => submit(q, Number(range.value)));

      box.append(
        el('div', { class: 'card stack slider-card' }, [
          valueBubble,
          range,
          ticks,
          el('div', { class: 'row between small muted', style: { marginTop: '2px' } }, [
            el('span', { text: scale.minLabel || String(scale.min) }),
            el('span', { text: scale.maxLabel || String(scale.max) }),
          ]),
          send,
        ])
      );
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

  /** انتهى وقت المتدرب في الوضع الحر دون إجابة */
  function renderSelfTimeout(s) {
    app.innerHTML = '';
    app.append(header(s));
    const last = s.index + 1 >= s.total;
    const nextBtn = el('button', { class: 'btn primary block' }, last ? '🏁 إنهاء' : 'السؤال التالي ⟨');
    nextBtn.addEventListener('click', () => {
      nextBtn.disabled = true;
      socket.send({ t: 'next' });
      setTimeout(() => (nextBtn.disabled = false), 1500);
    });
    app.append(
      el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: '⌛' }),
        el('div', { class: 'msg', text: 'انتهى وقتك على هذا السؤال' }),
        el('p', { class: 'muted small', text: 'لا بأس — تابع إلى التالي!' }),
      ])
    );
    app.append(nextBtn);
  }

  /** شاشة ما بعد الإجابة في الوضع الحر — النتيجة ثم زر «التالي» */
  function renderSelfFeedback(s) {
    const q = s.question;
    app.append(header(s));
    app.append(el('div', { class: 'card stack' }, [el('h2', { class: 'big-q', text: q.text })]));
    app.append(waitingCard(s, q, true));
    const revealSelf = answerReveal(s, q);
    if (revealSelf) app.append(revealSelf);

    if (q.options?.length) {
      const options = el('div', { class: 'options' });
      const mine = s.answered ? [].concat(s.answered.value) : [];
      q.options.forEach((option, index) => {
        const chosen = mine.includes(option.id);
        options.append(
          el(
            'div',
            {
              class:
                `opt c${index % 8}` +
                (q.scored && option.correct ? ' correct' : '') +
                (q.scored && chosen && !option.correct ? ' wrong' : '') +
                (!q.scored && chosen ? ' selected' : ''),
            },
            [
              el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
              el('span', { class: 'grow', text: option.text }),
              chosen ? el('span', { class: 'badge', text: 'إجابتك' }) : null,
            ]
          )
        );
      });
      app.append(options);
    }

    // في الوضع الحر أيضاً يرى المتدرب ما أجاب به الآخرون: سحابة الكلمات، المقياس، الآراء
    const results = s.results;
    if (results?.words) {
      app.append(el('div', { class: 'card' }, wordCloud(results.words)));
    } else if (results?.buckets) {
      app.append(el('div', { class: 'card stack' }, [scaleChart(results), el('p', { class: 'center muted', text: `المتوسط: ${results.average}` })]));
    } else if (results?.responses && !q.options?.length) {
      app.append(
        el(
          'div',
          { class: 'card quotes' },
          results.responses.slice(-12).reverse().map((r) => el('div', { class: 'quote' }, [el('span', { text: r.text })]))
        )
      );
    }

    const last = s.index + 1 >= s.total;
    const nextBtn = el('button', { class: 'btn primary block' }, last ? '🏁 إنهاء' : 'السؤال التالي ⟨');
    nextBtn.addEventListener('click', () => {
      nextBtn.disabled = true;
      socket.send({ t: 'next' });
      setTimeout(() => (nextBtn.disabled = false), 1500);
    });
    app.append(nextBtn);
  }

  function renderResults(s) {
    const q = s.question;
    const results = s.results;
    app.append(header(s));
    app.append(el('div', { class: 'card stack' }, [el('h2', { class: 'big-q', text: q.text })]));

    if (s.answered && q.scored) {
      app.append(waitingCard(s, q));
    }
    const revealCard = answerReveal(s, q);
    if (revealCard) app.append(revealCard);

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

    app.append(reactionBar());
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
          rankDeltaBadge(s.rankDelta),
          el('div', { class: 'badge ok' }, `⭐ ${s.me.score} نقطة`),
        ])
      );
    }
    if (s.leaderboard?.length) app.append(boardList(s.leaderboard, s.me.id));
    if (s.rank?.rank === 1) Fx.confetti(80);
    app.append(reactionBar());
    app.append(el('p', { class: 'footer', text: 'في انتظار السؤال التالي…' }));
  }

  function renderFinal(s) {
    if (state.lastFeedback !== 'final') {
      state.lastFeedback = 'final';
      Fx.play('finish');
      Fx.confetti(140);
    }
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
    const awards = badgeList(s.badges);
    if (awards) app.append(awards);
    if (s.leaderboard?.length) app.append(el('div', { class: 'card stack' }, [el('h2', { text: '🏆 الأوائل' }), boardList(s.leaderboard, s.me?.id)]));
    app.append(el('p', { class: 'footer', text: 'شكراً لمشاركتك! لم تُحفظ أي بيانات — كل شيء مؤقت.' }));
    store.del(SESSION_KEY);
  }

  /** شارة الصعود أو الهبوط في الترتيب منذ السؤال السابق */
  function rankDeltaBadge(delta) {
    if (!delta) return null;
    const up = delta > 0;
    return el('div', { class: 'badge ' + (up ? 'ok' : 'bad') }, `${up ? '⬆ صعدت' : '⬇ نزلت'} ${Math.abs(delta)} مركزاً`);
  }

  /** أوسمة نهاية النشاط */
  function badgeList(badges) {
    if (!badges?.length) return null;
    return el('div', { class: 'card stack' }, [
      el('h2', { class: 'center', text: '🏅 أوسمتك', style: { margin: 0 } }),
      el(
        'div',
        { class: 'badges' },
        badges.map((badge) =>
          el('div', { class: 'award' }, [
            el('span', { class: 'em', text: badge.emoji }),
            el('span', { class: 'lbl', text: badge.label }),
          ])
        )
      ),
    ]);
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
    const num = $('#tnum');
    const bar = $('#tbar');
    if (!num || !bar) return;
    const total = q.timeLimit * 1000;
    let lastSecond = null;

    state.tickTimer = setInterval(() => {
      const left = Math.max(0, s.endsAt - serverTime());
      const seconds = Math.ceil(left / 1000);
      num.textContent = String(seconds);
      bar.style.width = Math.max(0, (left / total) * 100) + '%';
      // نبضة صوتية في الثواني الأخيرة لرفع الحماس
      if (seconds !== lastSecond) {
        if (lastSecond !== null && seconds > 0 && seconds <= 5 && !s.answered) Fx.play('tick');
        lastSecond = seconds;
      }
      num.classList.toggle('hot', seconds <= 5);
      if (left <= 0) {
        clearTick();
        // الوضع الحر: انتهى وقته دون إجابة — نعرض له زر الانتقال بنفسه
        if (s.pace === 'self' && !s.answered) renderSelfTimeout(s);
      }
    }, 200);
  }

  function clearTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
    state.cancelCountdown?.();
    state.cancelCountdown = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.last) render(true);
  });

  // زر الخروج من النشاط
  const exitBtn = $('#exitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      const live = state.last && state.last.status !== 'ended';
      if (live && !confirm('هل تريد الخروج من النشاط؟ ستفقد نقاطك ولن تعود إلا بالدخول من جديد.')) return;
      // لا نرسل «مغادرة» قبل الانضمام أصلاً حتى لا تظهر رسالة خطأ
      if (state.joined) socket.send({ t: 'leave' });
      store.del(SESSION_KEY);
      socket.close();
      location.href = '/';
    });
  }

  // زر كتم الصوت
  const soundBtn = $('#soundBtn');
  if (soundBtn) {
    const paint = () => (soundBtn.textContent = Fx.soundOn() ? '🔊' : '🔇');
    paint();
    soundBtn.addEventListener('click', () => {
      Fx.setSound(!Fx.soundOn());
      paint();
    });
  }

  boot();
})();
