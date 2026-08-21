/* شاشة المشارك — خفيفة، جوال أولاً */
(function () {
  'use strict';

  const { $, el, avatarNode, toast, api, connect, store, vibrate, countdownTo } = window.T;
  // اختصار الترجمة — إن لم يُحمَّل المحرّك لأي سبب نعرض المفتاح بدل الانهيار
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  /** لغة التنسيق للتواريخ والأرقام */
  const loc = () => (window.I18n && window.I18n.getLang() === 'en' ? 'en' : 'ar');
  const Fx = window.Fx;
  const UI = window.TapioUI;

  // زرّ القائمة وحده نصٌّ في الصفحة؛ وسطورها تُبنى أدناه بنصوصها وحالاتها
  const exitBtn = $('#exitBtn');
  if (exitBtn) {
    exitBtn.title = t('pMenuAria');
    exitBtn.setAttribute('aria-label', t('pMenuAria'));
  }

  const app = $('#app');
  const connBadge = $('#conn');
  const scoreBadge = $('#scoreBadge');
  const teamBadge = $('#teamBadge');

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
    shareBlob: null, // بطاقة النتيجة المولّدة — تُرسم مرة واحدة
    review: null, // مراجعة الطالب لأدائه بعد النشاط
    autoNextTimer: null, // الانتقال التلقائي بعد الإجابة في الوضع الحرّ
    clockOffset: 0, // فرق ساعة المتصفح عن ساعة الخادم، يُلتقط عند وصول الرسالة
    timer: null, // مكوّن المؤقّت في شاشة الإجابة الجديدة
    optionNodes: [], // عُقَد الخيارات المعروضة الآن (للقفل الفوري)
    sendBtn: null, // زرّ الإرسال في السؤال متعدّد الاختيار
    pending: null, // إجابة محفوظة محلياً بانتظار عودة الاتصال
    online: false,
  };

  // لافتة الاتصال وورقة التفاعلات: نسخة واحدة تعيش بين الرسمات
  const banner = UI.ConnectionBanner();
  const PENDING_KEY = SESSION_KEY + ':pending';
  state.pending = store.get(PENDING_KEY, null);

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
      connBadge.textContent = status === 'online' ? t('pConnected') : status === 'offline' ? t('pDisconnected') : t('pConnecting');
      state.online = status === 'online';
      paintBanner();
      // الوصل يعود تلقائياً بتراجعٍ أسّي داخل connect()، وما إن يعود
      // حتى نُزامن مع حالة الصف ثم نرسل ما حُفظ محلياً
      if (state.online) flushPending();
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
        flushPending();
        break;
      case 'answer:accepted': {
        /*
         * الاحتفال يقول «صحيحة» بلا كلمات: القصاصات والنغمة والنبضة المزدوجة
         * تكشف الجواب قبل أن يكشفه المدرب. فإن أطفأ الكشف اكتفينا بنغمة
         * «وصلت» ونبضةٍ محايدة، وتبقى الشاشة على حالة الانتظار.
         */
        const reveals = !!state.last?.settings?.revealAnswer;
        vibrate(reveals && msg.correct === true ? [18, 60, 18] : 18);
        Fx.play(reveals ? (msg.correct === true ? 'correct' : msg.correct === false ? 'wrong' : 'sent') : 'sent');
        if (reveals && msg.correct === true) Fx.confetti(70);
        state.submitting = false;
        dropPending();
        break;
      }
      case 'review':
        state.review = Array.isArray(msg.items) ? msg.items : [];
        renderReview();
        break;
      case 'answer:rejected':
        state.submitting = false;
        dropPending();
        toast(msg.message, 'bad');
        render(true);
        break;
      case 'kicked':
        store.del(SESSION_KEY);
        state.joined = false;
        state.last = null;
        renderMessage('👋', t('pKicked'), t('pRejoinHint'));
        break;
      case 'session:closed':
        renderMessage('🔒', t('pSessionEnded'), t('pThanksShort'));
        socket.close();
        break;
      case 'error':
        if (msg.code === 'no_participant') {
          store.del(SESSION_KEY);
          state.joined = false;
          renderJoin();
        } else if (msg.code === 'no_session' || msg.code === 'ended') {
          renderMessage('🔒', msg.message, t('pCheckCode'));
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
      // لغة النشاط تسبق لغة المتصفح: يرى الطالب النشاط بلغة معلّمه
      applyActivityLang(state.info.lang);
      document.title = state.info.title + ' — Tapio';
      setQuizTitle(state.info.title);
      if (!store.get(SESSION_KEY, null)) renderJoin();
    } catch (err) {
      renderMessage('❓', t('pSessionNotFound'), err.message);
    }
  }

  /** يفرض لغة النشاط على هذه الصفحة (بلا حفظها كتفضيل للطالب) */
  function applyActivityLang(lang) {
    if (!window.I18n || (lang !== 'ar' && lang !== 'en')) return;
    if (window.I18n.getLang() === lang) return;
    window.I18n.setLang(lang, { remember: false });
    // الشريط العلوي رُسم قبل معرفة اللغة، فنعيد بناء سطوره بها
    buildExitMenu();
    const btn = $('#exitBtn');
    if (btn) {
      btn.title = t('pMenuAria');
      btn.setAttribute('aria-label', t('pMenuAria'));
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
      placeholder: t('pNamePlaceholder'),
      autocomplete: 'nickname',
      value: store.local.get('tafa3l:name', '') || '',
    });

    const card = el('div', { class: 'card stack' }, [
      el('h1', { text: info.title || t('pJoinBtn') }),
      /**
       * موعد التسليم على **شاشة الدخول** لا في قاعة الانتظار وحدها.
       * الواجب افتراضُه «الوضع الحرّ + بدء تلقائي»، فالطالب لا يمرّ بقاعة
       * انتظارٍ إطلاقاً: يكتب اسمه فيجد السؤال الأول. وشاشةُ الدخول هي
       * الموضع الوحيد الذي يمرّ به كلُّ طالبٍ قبل أن يبدأ.
       */
      info.dueAt
        ? el('span', { class: 'badge' }, t('pDueBadge', {
            when: new Date(info.dueAt).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }),
          }))
        : null,
      el('p', {
        class: 'muted small',
        text: anonymous
          ? t('pAnonHint')
          : t('pNameHint'),
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
            t('pAvatarBtn')
          ),
        ])
      );
      /**
       * كشف الأسماء إن أرفقه المعلّم: يختار الطالب اسمه بدل كتابته، فيتّحد
       * الاسم بين الحصص ويرى المعلّم من لم يدخل بعد.
       *
       * وهو **دليلٌ لا بوّابة**: «اسمي غير موجود» يفتح الكتابة الحرّة —
       * طالبٌ جديد أو زائرٌ لا يجوز أن يُمنع من الحصة لأن قائمةً لم تُحدَّث.
       */
      const roster = Array.isArray(info.roster) ? info.roster : [];
      if (roster.length) {
        const picked = el('input', { type: 'hidden' });
        const list = el('div', { class: 'roster' });
        const search = el('input', { type: 'search', placeholder: t('pRosterSearch'), autocomplete: 'off' });
        const free = el('button', { class: 'btn ghost sm', type: 'button' }, t('pRosterNotListed'));

        const select = (name) => {
          nameInput.value = name;
          picked.value = name;
          [...list.children].forEach((node) => node.classList.toggle('on', node.dataset.name === name));
        };
        const paint = (needle) => {
          list.innerHTML = '';
          const key = String(needle || '').trim().toLowerCase();
          const hits = roster.filter((name) => !key || name.toLowerCase().includes(key));
          if (!hits.length) return list.append(el('span', { class: 'muted small', text: t('pRosterNoHits') }));
          hits.forEach((name) => {
            const chip = el('button', { class: 'chip' + (picked.value === name ? ' on' : ''), type: 'button', text: name });
            chip.dataset.name = name;
            chip.addEventListener('click', () => select(name));
            list.append(chip);
          });
        };
        let timer = null;
        search.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => paint(search.value), 120);
        });
        paint('');

        const nameBox = el('div', { style: { display: 'none' } }, [el('label', { for: 'name', text: t('pNameLabel') }), nameInput]);
        const pickBox = el('div', { class: 'stack tight' }, [
          el('label', { text: t('pRosterLabel') }),
          // البحث يظهر عند الفصول الكبيرة وحدها: قائمةٌ من ستّة أسماء تُقرأ بنظرة
          roster.length > 12 ? search : null,
          list,
          el('div', { class: 'row', style: { marginTop: '4px' } }, [free]),
        ]);
        free.addEventListener('click', () => {
          pickBox.style.display = 'none';
          nameBox.style.display = '';
          nameInput.value = '';
          nameInput.focus();
        });

        card.append(pickBox, nameBox);
      } else {
        card.append(el('div', {}, [el('label', { for: 'name', text: t('pNameLabel') }), nameInput]));
      }
    }

    const joinBtn = el('button', { class: 'btn primary block', type: 'submit' }, anonymous ? t('pJoinTitle') : t('pJoinBtn'));

    const form = el('form', { class: 'stack' }, [card, joinBtn]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = anonymous ? '' : nameInput.value.trim();
      if (!anonymous && name.length < 2) return toast(t('pNameShort'), 'bad');
      if (!anonymous) store.local.set('tafa3l:name', name);
      joinBtn.disabled = true;
      const sent = socket.send({ t: 'join', code, name, avatar: state.avatar });
      if (!sent) {
        joinBtn.disabled = false;
        toast(t('pNoConnection'), 'bad');
      }
      setTimeout(() => (joinBtn.disabled = false), 2500);
    });

    app.append(form);
    app.append(
      el('p', { class: 'footer' }, [
        t('pCardCode'),
        el('strong', { text: code, style: { direction: 'ltr', display: 'inline-block' } }),
        t('pCardNoData'),
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
        el('a', { class: 'btn ghost sm', href: '/' }, t('pBackHome')),
      ])
    );
  }

  /** العنوان يُقصّ بسطر واحد في الشريط، فنضع كامله في التلميح لمن أراده */
  function setQuizTitle(title) {
    const node = $('#quizTitle');
    node.textContent = title;
    node.title = title;
  }

  // ----------------------------------------------------------- العرض العام


  /**
   * تضمين فيديو يوتيوب. الخادم خزّن المعرّف وحده بعد تحقّق صارم، فنبني
   * الرابط هنا لنطاق يوتيوب فقط — لا نمرّر شيئاً كتبه المعلّم كما هو.
   * ونستعمل نطاق nocookie فلا يُنشئ يوتيوب ملفّ تتبّع للطالب قبل التشغيل.
   */
  function videoNode(id) {
    return el('div', { class: 'video-wrap' }, [
      el('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1`,
        title: t('pQuestionVideo'),
        loading: 'lazy',
        allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture',
        referrerpolicy: 'strict-origin-when-cross-origin',
        allowfullscreen: '',
      }),
    ]);
  }

  /** وضع النقاط وحده يعرض النقاط؛ وضع العلامات يُخفيها كي لا يتنافس رقمان على معنى «نتيجتي» */
  function showsPoints(s) {
    return (s?.settings?.reward || 'points') === 'points';
  }

  function render(force) {
    const s = state.last;
    if (!s) return;

    scoreBadge.classList.toggle('hidden', !(showsPoints(s) && s.me && s.me.score > 0));
    if (s.me) scoreBadge.textContent = '⭐ ' + s.me.score;
    teamBadge.classList.toggle('hidden', !s.me?.team);
    if (s.me?.team) teamBadge.textContent = `${s.me.team.emoji} ${s.me.team.name}`;
    if (s.title) setQuizTitle(s.title);

    // مفتاح لتفادي إعادة البناء غير الضرورية أثناء المؤقّت
    // العلامة اليدوية تصل بعد الإجابة بلا تغيّر في المرحلة، فلا بد أن تدخل المفتاح
    const key = [
      s.phase,
      s.index,
      s.locked,
      s.answered ? 1 : 0,
      s.answered?.pending ? 'p' : s.answered?.points ?? '',
      s.pendingGrades ?? 0,
      s.participants,
      s.status,
    ].join('|');
    if (!force && key === state.renderedKey && s.phase !== 'lobby') return;
    state.renderedKey = key;
    clearTick();
    cancelAutoNext();
    app.innerHTML = '';
    // قفل الارتفاع خاصٌّ بشاشة السؤال وحدها؛ ما عداها يمرّر كالمعتاد
    document.body.classList.remove('tp-lock');

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

  /** يُبطل الانتقال التلقائي المعلّق — عند إعادة الرسم أو عند تقدّم الطالب بنفسه */
  function cancelAutoNext() {
    if (state.autoNextTimer) clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
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
        el('p', { class: 'muted', text: t('pGetReady') }),
      ])
    );
    state.cancelCountdown = Fx.countdown(msLeft, () => {
      state.cancelCountdown = null;
      render(true);
    });
  }

  function header(s) {
    return el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
      el('span', { class: 'badge' }, t('pQuestionOf', { index: s.index + 1, total: s.total })),
      el('span', { class: 'badge' }, `👥 ${s.participants}`),
    ]);
  }

  function renderLobby(s) {
    // نوضّح سبب الانتظار: في الوضع الحر لا ينتظر أحد إلا إذا أطفأ المدرب البدء التلقائي
    const pace = s.settings?.pace;
    const waitingReason =
      pace === 'self'
        ? t('pWaitSelf')
        : pace === 'auto'
          ? t('pWaitAuto')
          : t('pWaitHost');

    // اختبار مجدول: عدّاد حتى موعد الفتح بدل انتظار مفتوح
    const opensIn = s.scheduledAt && s.scheduledAt > serverTime() ? s.scheduledAt : null;
    const countdownNode = opensIn ? el('strong', { class: 'countdown-big' }) : null;

    app.append(
      el('div', { class: 'card stack center' }, [
        avatarNode(s.me.avatar, 'lg'),
        el('h1', { text: s.me.name }),
        opensIn
          ? el('div', { class: 'stack tight center' }, [
              el('p', { class: 'muted', style: { margin: 0 }, text: t('pStartsIn') }),
              countdownNode,
              el('span', {
                class: 'muted small',
                text: new Date(opensIn).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }),
              }),
            ])
          : el('p', { class: 'muted', text: waitingReason }),
        opensIn ? null : el('div', { class: 'spinner' }),
        el('span', { class: 'badge' }, t('pParticipants', { count: s.participants })),
        // موعد التسليم قبل أن يبدأ: الطالب يفتح رابط واجبٍ ليلاً ويريد أن
        // يعرف إن كان أمامه وقتٌ ليؤجّله إلى الغد أم عليه أن يبدأ الآن
        s.settings?.dueAt
          ? el('span', { class: 'badge' }, t('pDueBadge', {
              when: new Date(s.settings.dueAt).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }),
            }))
          : null,
      ])
    );
    if (opensIn) state.stopCountdown = countdownTo(countdownNode, opensIn);
    app.append(
      el('div', { class: 'card small muted center' }, t('pKeepOpen'))
    );
  }

  /** شريط الوقت المتبقي للاختبار كاملاً (حين يضع المدرب مدة له) */
  function deadlineBar(s) {
    if (!s.deadlineAt || s.deadlineAt <= serverTime()) return null;
    const value = el('strong', {});
    const box = el('div', { class: 'deadline-bar' }, [el('span', { text: t('pEndsIn') }), value]);
    state.stopDeadline = countdownTo(value, s.deadlineAt);
    return box;
  }

  function renderQuestion(s) {
    const q = s.question;
    if (!q) return renderLobby(s);
    state.selection = [];

    // أسئلة الاختيار لها شاشة الإجابة المصمَّمة (DESIGN.md)؛ ما عداها يبقى
    // على التخطيط القديم حتى يُهجَّر نوعاً نوعاً
    if (isChoiceQuestion(q)) return renderAnswerScreen(s);

    app.append(header(s));

    const timerBox = el('div', { class: 'timer', style: { marginBottom: '12px' } }, [
      el('span', { class: 'num', id: 'tnum', text: q.timeLimit ? String(q.timeLimit) : '∞' }),
      el('div', { class: 'progress' }, el('i', { id: 'tbar', style: { width: '100%' } })),
    ]);
    if (q.timeLimit) app.append(timerBox);

    const bar = deadlineBar(s);
    if (bar) app.append(bar);
    app.append(questionCard(q, { compact: !s.answered }));

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

  // ------------------------------------------- شاشة الإجابة (DESIGN.md)

  /** الأنواع التي تعمل بشاشة الإجابة الجديدة: قائمة خيارات يُختار منها */
  function isChoiceQuestion(q) {
    return (
      (q.type === 'mc' || q.type === 'poll' || q.type === 'truefalse') &&
      Array.isArray(q.options) &&
      q.options.length > 0
    );
  }

  /** حالة الخيار الواحد حسب مرحلة الشاشة — §3.1 */
  function optionState(option, mine, answered, revealed) {
    if (!answered) return 'idle';
    const chosen = mine.includes(option.id);
    if (!revealed) return chosen ? 'selected' : 'faded';
    if (option.correct) return 'correct';
    if (chosen) return 'wrong';
    return 'neutral';
  }

  /** سطر الحالة بعد الكشف: «إجابة صحيحة +120» أو «إجابة خاطئة +0 — الصحيح: …» */
  function revealStatus(s, q, letters) {
    const answered = s.answered;
    const delta = showsPoints(s) ? '+' + (answered?.points || 0) : '';
    if (answered?.correct === true) return UI.StatusLine({ tone: 'correct', text: t('pStatusCorrect'), delta });
    if (answered?.correct === 'partial') return UI.StatusLine({ tone: 'correct', text: t('pStatusPartial'), delta });
    const right = q.options
      .map((option, index) => (option.correct ? `${UI.letterAt(letters, index)} ${option.text}` : null))
      .filter(Boolean)
      .join(' + ');
    return UI.StatusLine({
      tone: 'wrong',
      text: t('pStatusWrong'),
      delta,
      right: right ? t('pStatusRight', { answer: right }) : '',
    });
  }

  /**
   * شاشة إجابة المتدرب بحالاتها الأربع: نشِطة، مختارة/بانتظار، ومكشوفة
   * صحيحةً أو خاطئة. لا تمرير فيها: الرأس والمؤقّت ثابتان، والسؤال يتوسّط ما
   * بينهما، والخيارات في منطقة الإبهام أسفل الشاشة.
   */
  function renderAnswerScreen(s) {
    const q = s.question;
    document.body.classList.add('tp-lock');

    const queued = pendingFor(q);
    const answered = !!s.answered || !!queued;
    // الكشف اختيار المدرب: إن لم يُفعّله لا تصل صحّة الخيارات أصلاً، فتبقى
    // الشاشة على حالة «وصلت إجابتك»
    const revealed = !!q.scored && q.options.some((option) => option.correct !== undefined);
    const mine = s.answered ? [].concat(s.answered.value) : queued ? [].concat(queued.value) : [];
    const letters = t('pOptionLetters');
    const palette = q.options.length <= 4;
    const spoken = { selected: t('pOptState'), correct: t('pOptStateCorrect'), wrong: t('pOptStateWrong') };

    const stage = el('div', { class: 'tp-stage' });
    const media = UI.ImageSlot({
      src: q.imageUrl,
      alt: t('pQuestionImage'),
      node: q.video ? videoNode(q.video) : null,
    });
    if (media) stage.append(media);
    stage.append(el('h1', { class: 'tp-q', text: q.text }));
    if (answered) {
      stage.append(revealed ? revealStatus(s, q, letters) : UI.WaitingIndicator({ text: t('pWaitingLine') }));
    } else if (q.multi) {
      stage.append(el('p', { class: 'tp-hint', text: t('pPickAll') }));
    }

    const list = el('div', { class: 'tp-options' });
    const nodes = [];
    q.options.forEach((option, index) => {
      const node = UI.AnswerOption({
        letter: UI.letterAt(letters, index),
        text: option.text,
        slot: index,
        palette,
        value: option.id,
        chip: t('pYourPick'),
        spoken,
        interactive: !answered,
        state: optionState(option, mine, answered, revealed),
        onSelect: () => pick(q, option, node, nodes),
      });
      nodes.push(node);
      list.append(node);
    });
    state.optionNodes = nodes;

    state.timer = UI.Timer({ total: q.timeLimit || 0, infinite: !q.timeLimit });
    if (answered && !q.timeLimit) state.timer.node.classList.add('is-done');

    state.sendBtn = null;
    if (q.multi && !answered) {
      state.sendBtn = el('button', { class: 'tp-send', type: 'button', disabled: true }, t('pSendAnswer'));
      // الاختيار المتعدّد يحتاج ضغطاتٍ عدّة، فالقفل عند الإرسال لا عند أول ضغطة
      state.sendBtn.addEventListener('click', () => {
        if (state.sendBtn.disabled || !state.selection.length) return;
        state.sendBtn.disabled = true;
        nodes.forEach((node) => node.lock());
        submitAnswer(q, state.selection.slice());
      });
    }

    app.append(
      el('div', { class: 'tp-screen' }, [
        el('div', { class: 'tp-head' }, [
          UI.HeaderStat({ kind: 'counter', value: s.index + 1, total: s.total }),
          showsPoints(s) ? UI.HeaderStat({ kind: 'score', value: s.me?.score || 0, label: t('pPtsLabel') }) : null,
        ]),
        state.timer.node,
        banner.node,
        stage,
        list,
        state.sendBtn,
        answered ? reactionButton() : null,
      ])
    );

    paintBanner();
    startTick(s);
  }

  /**
   * ضغطة على خيار.
   *
   * في الاختيار الأحادي تُقفل الشبكة كلها فور الضغطة الأولى وتُرسم النتيجة
   * تفاؤلياً قبل أن يردّ الخادم — لا إرسال مزدوج ولا انتظارَ شبكةٍ في لحظةٍ
   * يعدّ فيها الصفّ الثواني.
   */
  function pick(q, option, node, nodes) {
    if (state.submitting) return;
    vibrate(10);

    if (q.multi) {
      const at = state.selection.indexOf(option.id);
      if (at >= 0) {
        state.selection.splice(at, 1);
        node.setState('idle');
      } else {
        state.selection.push(option.id);
        node.setState('selected');
      }
      if (state.sendBtn) state.sendBtn.disabled = state.selection.length === 0;
      return;
    }

    state.selection = [option.id];
    nodes.forEach((other) => {
      other.lock();
      other.setState(other === node ? 'selected' : 'faded');
    });
    submitAnswer(q, option.id);
  }

  /** زرّ التفاعلات: ورقة تُفتح عند الحاجة بدل شريطٍ يأكل ارتفاع الشاشة */
  function reactionButton() {
    const sheet = UI.ReactionSheet({
      title: t('pReactionsTitle'),
      buttonLabel: t('pReactOpen'),
      closeLabel: t('pSheetClose'),
      itemLabel: t('pReactionAria', { emoji: '' }),
      emojis: Fx.REACTIONS,
      onPick: (emoji, item) => {
        socket.send({ t: 'reaction', emoji });
        item.classList.remove('bump');
        void item.offsetWidth;
        item.classList.add('bump');
        vibrate(10);
      },
    });
    const host = el('div', { class: 'tp' }, sheet.sheet);
    document.body.append(host);
    state.sheetHost = host;
    return sheet.button;
  }

  // ------------------------------------------- الإرسال وطابور الإجابات

  /** الإجابة المحفوظة إن كانت لهذا السؤال بعينه */
  function pendingFor(q) {
    return state.pending && q && state.pending.questionId === q.id ? state.pending : null;
  }

  function rememberPending(q, value) {
    state.pending = { questionId: q.id, value };
    store.set(PENDING_KEY, state.pending);
  }

  function dropPending() {
    if (!state.pending) return;
    state.pending = null;
    store.del(PENDING_KEY);
    paintBanner();
  }

  /**
   * إرسال إجابة شاشة الإجابة الجديدة.
   *
   * إن سقطت الشبكة حُفظت الإجابة محلياً وأُرسلت وحدها عند العودة، ما دام
   * السؤال نفسه ما زال مفتوحاً.
   */
  function submitAnswer(q, value) {
    if (state.submitting) return;
    state.submitting = true;
    // تُحفظ الإجابة **قبل** الإرسال دائماً: المقبس قد يبدو مفتوحاً وقد ماتت
    // الشبكة تحته، فتُبتلع الرسالة بلا خطأ. تُمحى عند وصول الإقرار.
    rememberPending(q, value);
    const sent = socket.send({ t: 'answer', questionId: q.id, value });
    if (sent) return;
    state.submitting = false;
    paintBanner();
  }

  /** إرسال ما حُفظ محلياً بعد عودة الاتصال ومزامنة الحالة مع الصف */
  function flushPending() {
    const saved = state.pending;
    if (!saved || !state.online) return;
    const s = state.last;
    if (!s) return;
    // الخادم سجّلها فعلاً (وصلت قبل الانقطاع) — نطويها بلا ضجّة
    if (s.answered) return dropPending();
    const open = s.phase === 'question' && s.question && s.question.id === saved.questionId && !s.locked;
    if (!open) {
      dropPending();
      toast(t('pQueuedLost'), 'bad');
      render(true);
      return;
    }
    if (socket.send({ t: 'answer', questionId: saved.questionId, value: saved.value })) {
      toast(t('pQueuedSent'));
    }
  }

  /**
   * ما تقوله اللافتة الآن: انقطاعٌ، أو إجابةٌ محفوظة تنتظر العودة.
   *
   * الإجابة المحفوظة لا تُذكر ما دام الاتصال قائماً — إقرار الخادم يصل بعد
   * أجزاءٍ من الثانية، فذكرها يومض بلا داعٍ في كل إجابة.
   */
  function paintBanner() {
    if (state.online) return banner.set('');
    banner.set(state.pending ? t('pQueuedBanner') : t('pOfflineBanner'));
  }

  /** بطاقة نص السؤال مع صورته إن وُجدت */
  function questionCard(q, opts) {
    const hideText = q.type === 'blank' && opts?.compact;
    return el('div', { class: 'card stack' }, [
      q.imageUrl ? el('img', { class: 'q-image', src: q.imageUrl, alt: t('pQuestionImage'), loading: 'lazy' }) : null,
      q.video ? videoNode(q.video) : null,
      hideText ? el('span', { class: 'badge', text: t('pFillBlank') }) : el('h2', { class: 'big-q', text: q.text }),
    ]);
  }

  /** شريط التفاعلات السريعة — يظهر على شاشة المدرب */
  function reactionBar() {
    const row = el('div', { class: 'reactions' });
    Fx.REACTIONS.forEach((emoji) => {
      const button = el('button', { class: 'react', type: 'button', 'aria-label': t('pReactionAria', { emoji }) }, emoji);
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
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('pReactionsTitle') }),
      row,
    ]);
  }

  function waitingCard(s, q, selfPaced) {
    const answered = s.answered;
    const scored = q.scored;
    let emoji = '⏳';
    let msg = t('pReceived');
    if (!answered) {
      emoji = '⌛';
      msg = t('pTimeUp');
    } else if (answered.pending) {
      // سؤال نصّي بعلامة: لا نتيجة قبل أن يقرأه المدرب
      return el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: '📝' }),
        el('div', { class: 'msg', text: t('pPendingGrade') }),
        el('p', { class: 'muted small', text: t('pPendingHint', { max: answered.maxPoints }) }),
      ]);
    } else if (q.manual) {
      const full = answered.points >= (answered.maxPoints || q.points);
      return el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: full ? '🎉' : answered.points > 0 ? '👍' : '💡' }),
        el('div', { class: 'msg', text: full ? t('pCorrectFull') : answered.points > 0 ? t('pPartial') : t('pWrong') }),
        el('div', { class: 'badge ok' }, t('pPointsOf', { points: answered.points, max: answered.maxPoints || q.points })),
        selfPaced ? null : el('p', { class: 'muted small', text: t('pGradedByHost') }),
      ]);
    } else if (scored && answered.correct === true) {
      emoji = '🎉';
      msg = t('pCorrect');
    } else if (scored && answered.correct === 'partial') {
      // «رتّب» و«طابِق» يُصحَّحان آلياً بعلامة جزئية — لا يصحّ أن يظهرا كإجابة مستلَمة فقط
      emoji = '👍';
      msg = t('pPartialAuto');
    } else if (scored && answered.correct === false) {
      emoji = '💡';
      msg = t('pWrong');
    }
    return el('div', { class: 'card feedback' }, [
      el('div', { class: 'em', text: emoji }),
      el('div', { class: 'msg', text: msg }),
      // النقاط والسلسلة لغةُ وضع النقاط وحده — في وضع العلامات يكفي «صحيحة»
      showsPoints(s) && scored && answered?.points ? el('div', { class: 'badge ok' }, t('pPlusPoints', { points: answered.points })) : null,
      showsPoints(s) && scored && s.me.streak > 1 ? el('div', { class: 'badge streak' }, t('pStreakRow', { n: s.me.streak })) : null,
      selfPaced ? null : el('p', { class: 'muted small', text: t('pWaitOthers') }),
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
            el('span', { class: 'badge ok', text: t('pCorrectAnswer') }),
            el('strong', { class: 'grow', text: correctText }),
          ])
        : null,
      q.explanation ? el('p', { style: { margin: 0 } }, [el('span', { text: '💡 ' }), q.explanation]) : null,
    ]);
  }

  function answerControls(s, q) {
    const box = el('div', { class: 'stack' });

    if (q.type === 'mc' || q.type === 'poll' || q.type === 'truefalse') {
      // «fill» هنا وحدها: شاشة الإجابة تملأ الطول، أما شاشتا النتيجة والمراجعة
      // فتتبعهما قوائم أخرى تحتهما، فتمدّدُ الخيارات فيهما يدفعها خارج النظر.
      const options = el('div', { class: 'options fill' });
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

      const submitBtn = el('button', { class: 'btn primary block', disabled: true }, t('pSendAnswer'));
      submitBtn.addEventListener('click', () => submit(q, state.selection));
      if (q.multi) {
        box.append(el('p', { class: 'muted small center', text: t('pPickAll') }));
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
        'aria-label': t('pSliderAria', { min: scale.min, max: scale.max }),
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

      const send = el('button', { class: 'btn primary block' }, t('pSendCheck'));
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

    if (q.content) {
      // شريحة عرض: يقرأها الطالب ولا يجيب. في الوضع الحر له زر «تابع»،
      // وفي وضع المدرب ينتظر انتقاله — فلا زر يوهمه بأن عليه فعل شيء.
      const card = el('div', { class: 'card stack slide-card' }, [
        q.body ? el('p', { class: 'slide-body', text: q.body }) : null,
      ]);
      box.append(card);
      if (s.settings?.pace === 'self') {
        const go = el('button', { class: 'btn primary block' }, t('pSlideNext'));
        go.addEventListener('click', () => {
          go.disabled = true;
          socket.send({ t: 'next' });
          setTimeout(() => (go.disabled = false), 1500);
        });
        box.append(go);
      } else {
        box.append(el('p', { class: 'muted small center', style: { margin: 0 }, text: t('pSlideWait') }));
      }
      return box;
    }

    if (q.type === 'order') {
      /*
       * الترتيب بالنقر لا بالسحب: السحب على الجوال هشّ (يتعارك مع تمرير
       * الصفحة ومع قارئ الشاشة)، أما النقر بالتسلسل فيعمل بإصبع واحدة
       * وبلوحة مفاتيح، والتراجع بنقرة ثانية.
       */
      const picked = [];
      const list = el('div', { class: 'order-list' });
      const hint = el('p', { class: 'muted small center', style: { margin: 0 } }, t('pOrderHint'));
      const send = el('button', { class: 'btn primary block', disabled: true }, t('pSend'));

      function draw() {
        list.innerHTML = '';
        (q.items || []).forEach((item) => {
          const at = picked.indexOf(item.id);
          const chosen = at >= 0;
          const btn = el(
            'button',
            { class: 'order-item' + (chosen ? ' on' : ''), type: 'button' },
            [
              el('span', { class: 'rank', text: chosen ? String(at + 1) : '' }),
              el('span', { class: 'grow', text: item.text }),
            ]
          );
          btn.addEventListener('click', () => {
            const idx = picked.indexOf(item.id);
            if (idx >= 0) picked.splice(idx, 1);
            else picked.push(item.id);
            draw();
          });
          list.append(btn);
        });
        send.disabled = picked.length !== (q.items || []).length;
        hint.textContent = picked.length
          ? t('pOrderPicked', { n: picked.length, total: (q.items || []).length })
          : t('pOrderHint');
      }

      send.addEventListener('click', () => submit(q, picked));
      draw();
      box.append(el('div', { class: 'card stack' }, [hint, list, send]));
      return box;
    }

    if (q.type === 'match') {
      // لكل طرف أيسر قائمة بالأطراف اليمنى مخلوطة — أوضح من السحب وأسرع
      const chosen = {};
      const rows = el('div', { class: 'match-list' });
      const send = el('button', { class: 'btn primary block', disabled: true }, t('pSend'));
      const pairs = q.pairs || [];

      pairs.forEach((pair) => {
        const select = el('select', { class: 'match-select' });
        select.append(el('option', { value: '' }, t('pMatchPick')));
        (q.rights || []).forEach((right) => select.append(el('option', { value: right }, right)));
        select.addEventListener('change', () => {
          if (select.value) chosen[pair.id] = select.value;
          else delete chosen[pair.id];
          send.disabled = Object.keys(chosen).length !== pairs.length;
        });
        rows.append(
          el('div', { class: 'match-row' }, [el('span', { class: 'match-left', text: pair.left }), select])
        );
      });

      send.addEventListener('click', () => submit(q, chosen));
      box.append(el('div', { class: 'card stack' }, [rows, send]));
      return box;
    }

    if (q.type === 'blank') {
      // أكمل الفراغ: الجملة نفسها وفيها حقول صغيرة مكان كل ___
      const count = Math.max(1, q.blankCount || 1);
      const parts = String(q.text).split(/_{3,}/);
      const line = el('div', { class: 'blank-line' });
      const inputs = [];
      parts.forEach((part, i) => {
        if (part) line.append(el('span', { text: part }));
        if (i < parts.length - 1 && inputs.length < count) {
          const field = el('input', {
            class: 'blank-input',
            maxlength: 60,
            autocomplete: 'off',
            'aria-label': t('pBlankAria', { n: inputs.length + 1 }),
          });
          inputs.push(field);
          line.append(field);
        }
      });
      // احتياط: نص بلا فراغ ظاهر — نعرض حقلاً واحداً على الأقل
      while (inputs.length < count) {
        const field = el('input', { class: 'blank-input', maxlength: 60, autocomplete: 'off' });
        inputs.push(field);
        line.append(field);
      }

      const sendBlanks = el('button', { class: 'btn primary block' }, t('pSend'));
      sendBlanks.addEventListener('click', () => {
        const values = inputs.map((field) => field.value.trim());
        if (!values.some((v) => v)) return toast(t('pFillFirst'), 'bad');
        submit(q, values);
      });
      inputs.forEach((field) =>
        field.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') sendBlanks.click();
        })
      );
      box.append(el('div', { class: 'card stack' }, [line, sendBlanks]));
      return box;
    }

    // word / open
    const isWord = q.type === 'word';
    const input = isWord
      ? el('input', { maxlength: 40, placeholder: t('pOneWord'), autocomplete: 'off' })
      : el('textarea', { maxlength: 300, placeholder: t('pWriteAnswer') });
    const send = el('button', { class: 'btn primary block' }, t('pSend'));
    send.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return toast(t('pWriteFirst'), 'bad');
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
      toast(t('pNoConnectionRetry'), 'bad');
    }
  }

  /**
   * شريط الانتقال في الوضع الحرّ — الفعل الوحيد المتاح للطالب بعد إجابته.
   *
   * كان زرّاً في أعلى الصفحة، فيقع **فوق** خبر «إجابة صحيحة» قبل أن يقرأه
   * الطالب، وتتساقط عليه قصاصات الاحتفال فيبهت لونه، ثم يغيب عن النظر بمجرّد
   * أن يمرّر ليرى الشرح. فصار شريطاً ملتصقاً بأسفل الشاشة: في متناول الإبهام
   * دائماً، وفوق طبقة القصاصات لا تحتها، ويقول إلى أين يذهب لا «التالي» وحدها.
   */
  function nextBar(s, onNext) {
    const lastQ = s.index + 1 >= s.total;
    const button = el(
      'button',
      { class: 'btn primary block', type: 'button' },
      lastQ ? t('pFinishBtn') : t('pGoToQuestion', { n: s.index + 2, total: s.total })
    );
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      onNext();
      setTimeout(() => (button.disabled = false), 1500);
    });
    const wrap = el('div', { class: 'nextbar' }, [button]);
    wrap.button = button;
    wrap.lastQ = lastQ;
    return wrap;
  }

  /** انتهى وقت المتدرب في الوضع الحر دون إجابة */
  function renderSelfTimeout(s) {
    app.innerHTML = '';
    app.append(header(s));
    app.append(
      el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: '⌛' }),
        el('div', { class: 'msg', text: t('pTimeUp') }),
        el('p', { class: 'muted small', text: t('pKeepGoing') }),
      ])
    );
    app.append(nextBar(s, () => socket.send({ t: 'next' })));
  }

  /** شاشة ما بعد الإجابة في الوضع الحر — النتيجة، وشريط الانتقال ملتصقٌ بالأسفل */
  function renderSelfFeedback(s) {
    const q = s.question;
    app.append(header(s));

    cancelAutoNext();
    const bar = nextBar(s, () => {
      cancelAutoNext();
      socket.send({ t: 'next' });
    });
    const goNext = () => bar.button.click();

    /**
     * الانتقال التلقائي: الطالب يجيب فينتقل، بلا ضغطة زرّ في كل سؤال.
     * والمهلة ليست تأخيراً بلا سبب: هي اللحظة التي يقرأ فيها «صحيحة» وشرحها.
     * فإن كان الكشف مطفأً لم يعد لها معنى، فتقصر. وأي نقرة على «التالي»
     * تُلغيها فوراً — الانتظار خيار لا فرض.
     *
     * وعدّاده داخل الشريط لا فوق الصفحة: أن يرى الطالب المهلة تنقضي بينما
     * الزرّ الذي يقطعها في مكانٍ آخر هو ما يجعل الانتقال يبدو مفروضاً.
     */
    if (s.settings?.autoNext !== false && !bar.lastQ) {
      const reveals = !!(s.settings?.revealAnswer && (q.scored || q.explanation));
      const wait = reveals ? 2600 : 700;
      const fill = el('i', { style: { animationDuration: wait + 'ms' } });
      bar.prepend(
        el('div', { class: 'autonext' }, [
          el('span', { class: 'small muted', text: t('pAutoNextHint') }),
          el('div', { class: 'autonext-bar' }, fill),
        ])
      );
      state.autoNextTimer = setTimeout(goNext, wait);
    }

    app.append(questionCard(q));
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
              chosen ? el('span', { class: 'badge', text: t('pYourAnswer') }) : null,
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
      app.append(el('div', { class: 'card stack' }, [scaleChart(results), el('p', { class: 'center muted', text: t('pAverage', { value: results.average }) })]));
    } else if (results?.responses && !q.options?.length) {
      app.append(
        el(
          'div',
          { class: 'card quotes' },
          results.responses.slice(-12).reverse().map((r) => el('div', { class: 'quote' }, [el('span', { text: r.text })]))
        )
      );
    }

    // آخر عنصر عمداً: `position: sticky; bottom` يلتصق بأسفل الشاشة ما دام
    // فوقه محتوى لم يُقرأ بعد، ثم يستقرّ في مكانه عند آخر الصفحة
    app.append(bar);
  }

  /**
   * شاشة المراجعة: بطاقات يقلبها الطالب بنفسه — سؤال، ثم إجابته والصحيحة
   * والشرح. القلب بالنقر لا بالكشف التلقائي: استرجاعُ الجواب من ذاكرته قبل
   * رؤيته هو ما يُثبّت التعلّم، لا قراءته جاهزاً.
   */
  function renderReview() {
    const items = state.review || [];
    app.innerHTML = '';
    const wrong = items.filter((x) => x.correct !== true);

    const back = el('button', { class: 'btn ghost sm', type: 'button' }, t('pReviewBack'));
    back.addEventListener('click', () => {
      state.review = null;
      state.renderedKey = '';
      render(true);
    });

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [el('h2', { style: { margin: 0 }, text: t('pReviewTitle') }), back]),
        el('p', {
          class: 'muted small',
          style: { margin: 0 },
          text: wrong.length ? t('pReviewIntro', { n: wrong.length }) : t('pReviewPerfect'),
        }),
      ])
    );

    if (!items.length) {
      app.append(el('p', { class: 'muted center', text: t('pReviewEmpty') }));
      return;
    }

    // الأخطاء أولاً: هي ما يحتاج مراجعةً فعلاً
    const ordered = [...wrong, ...items.filter((x) => x.correct === true)];
    ordered.forEach((item) => {
      const answer = el('div', { class: 'review-answer', hidden: true }, [
        el('p', { class: 'small', style: { margin: 0 } }, [
          el('strong', { text: t('pReviewYours') + ' ' }),
          el('span', { text: item.answered ? item.mine : t('pReviewNoAnswer') }),
        ]),
        item.right
          ? el('p', { class: 'small ok-text', style: { margin: 0 } }, [
              el('strong', { text: t('pReviewRight') + ' ' }),
              el('span', { text: item.right }),
            ])
          : null,
        item.explanation ? el('p', { class: 'muted small', style: { margin: 0 }, text: '💡 ' + item.explanation }) : null,
      ]);

      const flip = el('button', { class: 'btn ghost sm', type: 'button' }, t('pReviewShow'));
      flip.addEventListener('click', () => {
        answer.hidden = !answer.hidden;
        flip.textContent = answer.hidden ? t('pReviewShow') : t('pReviewHide');
      });

      const mark = item.pending
        ? el('span', { class: 'badge', text: '⏳' })
        : item.correct === true
          ? el('span', { class: 'badge ok', text: '✓' })
          : item.correct === 'partial'
            ? el('span', { class: 'badge', text: '½' })
            : el('span', { class: 'badge bad', text: '✕' });

      app.append(
        el('div', { class: 'card stack tight review-card' }, [
          el('div', { class: 'row between' }, [
            el('span', { class: 'row', style: { gap: '6px' } }, [mark, el('strong', { text: `${item.index}. ${item.text}` })]),
          ]),
          flip,
          answer,
        ])
      );
    });
  }

  function renderResults(s) {
    const q = s.question;
    const results = s.results;
    app.append(header(s));
    app.append(questionCard(q));

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
            el('span', { class: 'count', text: `${option.percent}${t('pctSuffix')} (${option.count})` }),
          ]
        );
        options.append(node);
      });
      app.append(options);
    } else if (results?.words) {
      app.append(el('div', { class: 'card' }, wordCloud(results.words)));
    } else if (results?.buckets) {
      app.append(el('div', { class: 'card stack' }, [scaleChart(results), el('p', { class: 'center muted', text: t('pAverage', { value: results.average }) })]));
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
    app.append(el('p', { class: 'footer', text: t('pWaitHostNext') }));
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
    return words.length ? cloud : el('p', { class: 'muted center', text: t('pNoAnswersYet') });
  }

  function scaleChart(results) {
    const wrap = el('div', { class: 'stack' });
    results.buckets.forEach((bucket) => {
      wrap.append(
        el('div', { class: 'row', style: { gap: '8px' } }, [
          el('span', { class: 'badge', text: String(bucket.value) }),
          el('div', { class: 'progress grow' }, el('i', { style: { width: bucket.percent + '%' } })),
          el('span', { class: 'small muted', text: `${bucket.percent}${t('pctSuffix')}` }),
        ])
      );
    });
    return wrap;
  }

  function renderLeaderboard(s) {
    app.append(el('h1', { class: 'center', text: t('pLeaderboard') }));
    if (s.rank) {
      app.append(
        el('div', { class: 'card center stack' }, [
          el('div', { class: 'stat' }, [
            el('div', { class: 'v', text: `#${s.rank.rank}` }),
            el('div', { class: 'k', text: t('pOfParticipants', { of: s.rank.of }) }),
          ]),
          rankDeltaBadge(s.rankDelta),
          showsPoints(s) ? el('div', { class: 'badge ok' }, t('pScoreBadge', { score: s.me.score })) : null,
        ])
      );
    }
    if (s.leaderboard?.length) app.append(boardList(s.leaderboard, s.me.id));
    const teamCard = teamBoard(s.teamLeaderboard, s.me?.team?.id);
    if (teamCard) app.append(teamCard);
    if (s.rank?.rank === 1) Fx.confetti(80);
    app.append(reactionBar());
    app.append(el('p', { class: 'footer', text: t('pWaitNextQuestion') }));
  }

  // تقدير كل نطاق: رمزه ومفتاح اسمه — النصّ من القاموس فيتبع لغة النشاط
  const BANDS = {
    excellent: { emoji: '🌟', key: 'mBandExcellent' },
    veryGood: { emoji: '🎯', key: 'mBandVeryGood' },
    good: { emoji: '👍', key: 'mBandGood' },
    fair: { emoji: '🙂', key: 'mBandFair' },
    weak: { emoji: '💪', key: 'mBandWeak' },
  };

  /**
   * بطاقة العلامة: «٢٤ من ٣٠» بخطّ ضخم، وشريط ممتلئ بقدرها، وتقدير.
   *
   * التقدير الأدنى «يحتاج مراجعة 💪» لا «ضعيف»: الطالب يقرأ هذا وحده على
   * هاتفه، وكلمةٌ تُحبطه لا تُصلح إجابةً واحدة. والرقم صريح على أي حال.
   */
  function markPanel(mark) {
    if (!mark) return null;
    const band = BANDS[mark.band] || BANDS.fair;
    return el('div', { class: 'card stack center mark-card' }, [
      el('span', { class: 'badge', text: t('mYourMark') }),
      el('div', { class: 'mark-value' }, [
        el('strong', { text: fmtNum(mark.mark) }),
        el('span', { class: 'of', text: ' / ' + fmtNum(mark.of) }),
      ]),
      el('div', { class: 'progress' }, el('i', { style: { width: Math.min(100, mark.percent) + '%' } })),
      el('div', { class: 'row center', style: { gap: '8px', justifyContent: 'center' } }, [
        el('span', { class: 'badge' + (mark.passed ? ' ok' : ''), text: `${band.emoji} ${t(band.key)}` }),
        el('span', { class: 'badge', text: fmtNum(mark.percent) + t('pctSuffix') }),
      ]),
      mark.pending
        ? el('p', { class: 'muted small', style: { margin: 0 }, text: t('mPendingNote', { n: mark.pending }) })
        : null,
    ]);
  }

  /** رقم بلا كسر زائد: «٢٤» لا «٢٤٫٠» */
  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function renderFinal(s) {
    // إجابة نصّية لم يصحّحها المدرب بعد: لا نُظهر نتيجة ناقصة ولا ترتيباً مضلّلاً
    if (s.pendingGrades > 0) {
      app.append(
        el('div', { class: 'card feedback' }, [
          el('div', { class: 'em', text: '📝' }),
          el('div', { class: 'msg', text: t('pGradingNow') }),
          s.me ? avatarNode(s.me.avatar, 'lg') : null,
          s.me ? el('h2', { text: s.me.name }) : null,
          el('p', {
            class: 'muted small',
            text:
              s.pendingGrades === 1
                ? t('pGradingOne')
                : t('pGradingMany', { n: s.pendingGrades }),
          }),
          el('div', { class: 'spinner' }),
        ])
      );
      app.append(el('p', { class: 'footer', text: t('pKeepOpenLive') }));
      return;
    }

    if (state.lastFeedback !== 'final') {
      state.lastFeedback = 'final';
      Fx.play('finish');
      Fx.confetti(140);
    }
    app.append(
      el('div', { class: 'card feedback' }, [
        el('div', { class: 'em', text: '🎊' }),
        el('div', { class: 'msg', text: t('pActivityEnded') }),
        s.me ? avatarNode(s.me.avatar, 'lg') : null,
        s.me ? el('h2', { text: s.me.name }) : null,
        s.rank ? el('div', { class: 'badge' }, t('pRankBadge', { rank: s.rank.rank, of: s.rank.of })) : null,
        showsPoints(s) && s.me && s.me.score ? el('div', { class: 'badge ok' }, t('pScoreBadge', { score: s.me.score })) : null,
      ])
    );
    // العلامة قبل الأوسمة والترتيب: هي ما يسأل عنه الطالب أولاً وما يحمله لبيته
    const markCard = markPanel(s.mark);
    if (markCard) app.append(markCard);

    const awards = badgeList(s.badges);
    if (awards) app.append(awards);

    // أهم ما في الاختبار تربوياً يأتي بعده: مراجعة ما أخطأ فيه وقراءة الشرح
    const reviewBtn = el('button', { class: 'btn ghost block', type: 'button' }, t('pReviewBtn'));
    reviewBtn.addEventListener('click', () => {
      reviewBtn.disabled = true;
      socket.send({ t: 'review' });
      setTimeout(() => (reviewBtn.disabled = false), 2000);
    });
    app.append(reviewBtn);

    // بطاقة النتيجة القابلة للمشاركة — صورة فيها كل الإنجاز
    if (s.me) {
      const shareBox = el('div', { class: 'card stack center' }, [
        el('h2', { text: t('pCardTitle'), style: { margin: 0 } }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('pCardHint') }),
        el('div', { class: 'spinner' }),
      ]);
      app.append(shareBox);
      buildShareCard(s, shareBox);
    }

    if (s.leaderboard?.length) app.append(el('div', { class: 'card stack' }, [el('h2', { text: t('pTopBoard') }), boardList(s.leaderboard, s.me?.id)]));
    const teamCard = teamBoard(s.teamLeaderboard, s.me?.team?.id);
    if (teamCard) app.append(teamCard);
    app.append(el('p', { class: 'footer', text: t('pThanks') }));
    store.del(SESSION_KEY);
  }

  // ------------------------------------------------- بطاقة النتيجة للمشاركة

  /** مستوى تحفيزي من الترتيب — دائماً إيجابي حتى لآخر مركز */
  function levelOf(s) {
    if (!s.rank || !s.me?.score) return { emoji: '🎉', label: t('pLevelActive') };
    const { rank, of } = s.rank;
    if (rank === 1) return { emoji: '🏆', label: t('pLevelChampion') };
    const pct = rank / Math.max(1, of);
    if (pct <= 0.1) return { emoji: '🚀', label: t('pLevelLegend') };
    if (pct <= 0.25) return { emoji: '🥇', label: t('pLevelPro') };
    if (pct <= 0.5) return { emoji: '💪', label: t('pLevelSkilled') };
    return { emoji: '🌱', label: t('pLevelPromising') };
  }

  function shareText(s, level) {
    const title = s.title || state.info?.title || t('pDefaultTitle');
    const theme = cardTheme(s);
    const bits = [];
    // العلامة أولاً في نصّ المشاركة: هي المفهومة خارج المنصة
    if (s.mark) bits.push(`${s.mark.mark}/${s.mark.of}`);
    if (showsPoints(s) && s.me?.score) bits.push(t('pScoreBadge', { score: s.me.score }));
    if (s.rank) bits.push(theme.banner ? t('pAmongParticipants', { of: s.rank.of }) : t('pRankBadge', { rank: s.rank.rank, of: s.rank.of }));
    const perf = bits.length ? ' — ' + bits.join(' · ') : '';
    // أصحاب المنصة يتصدّر مركزهم النص؛ والبقية بلقب تحفيزي
    const lead = theme.banner ? t('pWonBanner', { emblem: theme.emblem, banner: theme.banner }) : t('pWonLevel', { emoji: level.emoji, label: level.label });
    return t('pShareLine', { lead, title, perf });
  }

  /** هوية البطاقة بحسب الترتيب — ذهبية للأول، فضية للثاني، برونزية للثالث */
  function cardTheme(s) {
    const rank = s.me?.score ? s.rank?.rank : null;
    if (rank === 1)
      return { emblem: '🏆', crown: true, banner: t('pFirst'), colors: ['#ffe9a3', '#f59e0b'], ray: 'rgba(245,158,11,0.13)', halo: 'rgba(255,215,0,0.35)', spark: 'rgba(255,224,130,0.9)' };
    if (rank === 2)
      return { emblem: '🥈', banner: t('pSecond'), colors: ['#f8fafc', '#94a3b8'], ray: 'rgba(148,163,184,0.12)', halo: 'rgba(226,232,240,0.3)', spark: 'rgba(241,245,249,0.9)' };
    if (rank === 3)
      return { emblem: '🥉', banner: t('pThird'), colors: ['#fed7aa', '#ea580c'], ray: 'rgba(234,88,12,0.12)', halo: 'rgba(251,146,60,0.3)', spark: 'rgba(254,215,170,0.9)' };
    return { emblem: '🌟', banner: null, colors: ['#8de3f5', '#8b73ff'], ray: 'rgba(139,115,255,0.12)', halo: 'rgba(139,115,255,0.35)', spark: 'rgba(165,180,252,0.9)' };
  }

  /** أشعة احتفالية تنطلق من مركز الشعار */
  function sunburst(ctx, cx, cy, inner, outer, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(-16, -inner);
      ctx.lineTo(16, -inner);
      ctx.lineTo(52, -outer);
      ctx.lineTo(-52, -outer);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** نجمة خماسية */
  function starPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? r : r * 0.45;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** بريق رباعي الرؤوس حول الشعار */
  function sparkle(ctx, cx, cy, r, color) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** مستطيل بزوايا دائرية */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** كبسولة نص وتعيد عرضها لرصّها بجانب أخرى */
  function pill(ctx, text, cx, y, font, fill, stroke) {
    ctx.font = font;
    const w = ctx.measureText(text).width + 56;
    const h = 76;
    rr(ctx, cx - w / 2, y, w, h, h / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = '#f5f4ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + h / 2 + 2);
    return w;
  }

  /**
   * يحمّل ملف SVG كصورة صالحة للرسم على Canvas.
   * نمرّ عبر blob (لا عبر الرابط مباشرة) لأنه المسار المضمون ألا يلوّث الـ canvas
   * فيمنع toBlob لاحقاً — نفس أسلوب الأفاتار في هذا الملف.
   */
  async function loadSvg(url) {
    let objectUrl = null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      objectUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = objectUrl;
      });
      return img;
    } catch {
      return null;
    } finally {
      // الصورة محمّلة في الذاكرة، فلا حاجة لإبقاء الرابط
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }

  /**
   * يرسم بطاقة النتيجة على Canvas ويعيدها (1080×1350 — مناسبة للمنصات والواتس).
   * وجود علامة يضيف سطراً بارزاً، فنزيد الطول بدله بدل أن نزحم التذييل.
   */
  async function drawShareCard(s) {
    const W = 1080;
    const H = s.mark ? 1460 : 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const FONT = '"Segoe UI", system-ui, "Noto Sans Arabic", sans-serif';
    ctx.direction = 'rtl';

    // الخلفية بنفس هوية التطبيق: ليل داكن مع توهجين
    ctx.fillStyle = '#12102e';
    ctx.fillRect(0, 0, W, H);
    let glow = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 700);
    glow.addColorStop(0, 'rgba(139,115,255,0.32)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    glow = ctx.createRadialGradient(0, H, 0, 0, H, 700);
    glow.addColorStop(0, 'rgba(53,214,239,0.2)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // إطار البطاقة
    rr(ctx, 40, 40, W - 80, H - 80, 48);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // العلامة: الشعار الحقيقي (النسخة البيضاء — خلفية البطاقة داكنة)
    const logo = await loadSvg('/assets/logo-white.svg');
    if (logo) {
      // الشعار مركّب رأسياً؛ عرض 175 يعطي ارتفاع ~112 فينتهي فوق عنوان النشاط (y=195) بفسحة
      const lw = 175;
      const lh = (logo.naturalHeight / logo.naturalWidth) * lw;
      ctx.drawImage(logo, W / 2 - lw / 2, 46, lw, lh);
    } else {
      // تعذّر تحميل الشعار: الاسم نصاً بدل بطاقة بلا علامة
      ctx.fillStyle = '#f5f4ff';
      ctx.font = `800 56px ${FONT}`;
      ctx.fillText('Tapio', W / 2, 130);
    }
    ctx.fillStyle = '#a9a5cc';
    ctx.font = `600 38px ${FONT}`;
    const title = s.title || state.info?.title || t('pDefaultTitle');
    ctx.fillText(title.length > 40 ? title.slice(0, 39) + '…' : title, W / 2, 195);

    // شعار الإنجاز — كأس ذهبي بتاج للأول، ميداليات للثاني والثالث، نجمة متوهجة للبقية
    const theme = cardTheme(s);
    const cy = 470;

    sunburst(ctx, W / 2, cy, 190, 430, theme.ray);

    const halo = ctx.createRadialGradient(W / 2, cy, 60, W / 2, cy, 280);
    halo.addColorStop(0, theme.halo);
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(W / 2 - 290, cy - 290, 580, 580);

    // قرص معدني متدرج بإطار مزدوج
    const disc = ctx.createLinearGradient(W / 2, cy - 170, W / 2, cy + 170);
    disc.addColorStop(0, theme.colors[0]);
    disc.addColorStop(1, theme.colors[1]);
    ctx.beginPath();
    ctx.arc(W / 2, cy, 165, 0, Math.PI * 2);
    ctx.fillStyle = disc;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, cy, 138, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(18,16,46,0.22)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // الرمز الكبير + تاج المركز الأول
    ctx.font = `190px ${FONT}`;
    ctx.fillText(theme.emblem, W / 2, cy + 12);
    if (theme.crown) {
      ctx.font = `90px ${FONT}`;
      ctx.fillText('👑', W / 2, cy - 212);
    }

    // بريق حول الشعار
    for (const [dx, dy, r] of [[-310, -110, 15], [305, -70, 11], [-265, 150, 10], [285, 165, 14], [-190, -235, 9], [215, -245, 12]]) {
      sparkle(ctx, W / 2 + dx, cy + dy, r, theme.spark);
    }

    // الاسم
    ctx.fillStyle = '#f5f4ff';
    ctx.font = `800 76px ${FONT}`;
    ctx.fillText(s.me.name, W / 2, 735);

    // المراكز الثلاثة الأولى: إعلان المركز بخط معدني كبير متوهج — تشجيع صريح
    const level = levelOf(s);
    if (theme.banner) {
      ctx.save();
      const bg = ctx.createLinearGradient(W / 2 - 280, 0, W / 2 + 280, 0);
      bg.addColorStop(0, theme.colors[1]);
      bg.addColorStop(0.5, theme.colors[0]);
      bg.addColorStop(1, theme.colors[1]);
      ctx.shadowColor = theme.halo;
      ctx.shadowBlur = 35;
      ctx.fillStyle = bg;
      ctx.font = `900 88px ${FONT}`;
      ctx.fillText(theme.banner, W / 2, 845);
      ctx.restore();
    } else {
      // البقية: لقب تحفيزي في كبسولة متدرجة
      const levelText = `${level.emoji} ${level.label}`;
      ctx.font = `800 52px ${FONT}`;
      const lw = ctx.measureText(levelText).width + 90;
      const lg = ctx.createLinearGradient(W / 2 - lw / 2, 0, W / 2 + lw / 2, 0);
      lg.addColorStop(0, '#35d6ef');
      lg.addColorStop(1, '#8b73ff');
      rr(ctx, W / 2 - lw / 2, 795, lw, 96, 48);
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.fillStyle = '#12102e';
      ctx.fillText(levelText, W / 2, 847);
    }

    // صف النجوم — الامتلاء بحسب الأداء (٥ للأول، ولا يقل عن واحدة)
    let starCount = 3;
    if (s.rank && s.me.score) {
      const pct = s.rank.of > 1 ? (s.rank.rank - 1) / (s.rank.of - 1) : 0;
      starCount = Math.max(1, Math.round(5 - pct * 4));
    }
    const starY = 965;
    for (let i = 0; i < 5; i++) {
      const scx = W / 2 + (i - 2) * 100;
      const filled = i < starCount;
      starPath(ctx, scx, starY, filled ? 36 : 30);
      ctx.fillStyle = filled ? '#fbbf24' : 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.strokeStyle = filled ? '#b45309' : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // النقاط والمركز
    const y = 1050;
    const pills = [];
    if (showsPoints(s) && s.me.score) pills.push(t('pScoreBadge', { score: s.me.score }));
    if (s.rank) pills.push(theme.banner ? t('pAmongParticipants', { of: s.rank.of }) : t('pRankBadge', { rank: s.rank.rank, of: s.rank.of }));
    if (pills.length === 2) {
      ctx.font = `700 42px ${FONT}`;
      const w1 = ctx.measureText(pills[0]).width + 56;
      const w2 = ctx.measureText(pills[1]).width + 56;
      const gap = 24;
      const totalW = w1 + w2 + gap;
      pill(ctx, pills[0], W / 2 + totalW / 2 - w1 / 2, y, `700 42px ${FONT}`, 'rgba(34,197,94,0.18)', 'rgba(34,197,94,0.5)');
      pill(ctx, pills[1], W / 2 - totalW / 2 + w2 / 2, y, `700 42px ${FONT}`, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.2)');
    } else if (pills.length === 1) {
      pill(ctx, pills[0], W / 2, y, `700 42px ${FONT}`, 'rgba(34,197,94,0.18)', 'rgba(34,197,94,0.5)');
    }

    /**
     * العلامة على البطاقة: هي ما يُري الطالبُ أهلَه فعلاً، لا نقاطَ لعبةٍ لا
     * يعرفون معناها. تُرسم بارزةً تحت النقاط حين يكون للنشاط علامة.
     */
    if (s.mark) {
      const band = BANDS[s.mark.band] || BANDS.fair;
      pill(
        ctx,
        `${s.mark.mark} / ${s.mark.of}  ·  ${band.emoji} ${t(band.key)}`,
        W / 2,
        1140,
        `800 46px ${FONT}`,
        'rgba(139,115,255,0.22)',
        'rgba(139,115,255,0.55)'
      );
    }

    // الأوسمة في سطر واحد
    const badges = (s.badges || []).slice(0, 2);
    if (badges.length) {
      ctx.fillStyle = '#f5f4ff';
      ctx.font = `600 40px ${FONT}`;
      ctx.fillText(badges.map((b) => `${b.emoji} ${b.label}`).join('   ·   '), W / 2, s.mark ? 1250 : 1185);
    }

    // التذييل
    ctx.fillStyle = '#a9a5cc';
    ctx.font = `600 30px ${FONT}`;
    const when = new Date().toLocaleDateString(loc(), { year: 'numeric', month: 'long', day: 'numeric' });
    ctx.fillText(when, W / 2, H - 115);
    ctx.fillStyle = '#8f8ab5';
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(t('pCardMadeWith'), W / 2, H - 68);

    return canvas;
  }

  /** يبني البطاقة ويعرضها مع أزرار المشاركة والحفظ */
  async function buildShareCard(s, box) {
    // إعادة رسم الشاشة النهائية (مثلاً عند خروج مشارك) لا تعيد توليد الصورة
    let blob = state.shareBlob || null;
    if (!blob) {
      try {
        const canvas = await drawShareCard(s);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('toBlob');
        state.shareBlob = blob;
      } catch {
        box.remove();
        return;
      }
    }

    const level = levelOf(s);
    const text = shareText(s, level);
    const url = URL.createObjectURL(blob);
    const img = el('img', { class: 'share-card-img', src: url, alt: t('pCardCaption') });

    const buttons = el('div', { class: 'row', style: { justifyContent: 'center', gap: '8px', flexWrap: 'wrap' } });

    // المشاركة الأصلية (الجوال): تفتح واتساب وكل التطبيقات مع الصورة نفسها
    const file = new File([blob], 'tapio-result.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      const share = el('button', { class: 'btn primary', type: 'button' }, t('pCardShare'));
      share.addEventListener('click', async () => {
        try {
          await navigator.share({ files: [file], text, title: t('pCardShareTitle') });
        } catch {
          /* أُلغيت المشاركة */
        }
      });
      buttons.append(share);
    } else {
      // سطح المكتب: واتساب نصي على الأقل
      buttons.append(
        el('a', { class: 'btn primary', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(text) }, t('pCardWhatsapp'))
      );
    }

    buttons.append(el('a', { class: 'btn ghost', href: url, download: t('pCardFile') }, t('pCardSave')));

    const copyBtn = el('button', { class: 'btn ghost', type: 'button' }, t('pCardCopy'));
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast(t('pCopied'), 'ok');
      } catch {
        toast(t('pCopyFailed'), 'bad');
      }
    });
    buttons.append(copyBtn);

    box.querySelector('.spinner')?.remove();
    box.append(img, buttons);
  }

  /** شارة الصعود أو الهبوط في الترتيب منذ السؤال السابق */
  function rankDeltaBadge(delta) {
    if (!delta) return null;
    const up = delta > 0;
    return el('div', { class: 'badge ' + (up ? 'ok' : 'bad') }, t('pRankDelta', { dir: up ? t('pRankUp') : t('pRankDown'), n: Math.abs(delta) }));
  }

  /** أوسمة نهاية النشاط */
  function badgeList(badges) {
    if (!badges?.length) return null;
    return el('div', { class: 'card stack' }, [
      el('h2', { class: 'center', text: t('pBadges'), style: { margin: 0 } }),
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
          // العلامة إن كان النشاط بعلامة، وإلا فالنقاط — لا الاثنان معاً
          el('span', { class: 'score', text: entry.mark ? `${entry.mark.mark} / ${entry.mark.of}` : String(entry.score) }),
        ])
      );
    });
    return board;
  }

  /** ترتيب الفرق — يظهر بجانب ترتيب الأفراد عندما يكون وضع الفرق مفعّلاً */
  function teamBoard(list, myTeamId) {
    if (!list?.length) return null;
    const board = el('div', { class: 'board' });
    list.forEach((team) => {
      board.append(
        el('div', { class: 'item' + (team.id === myTeamId ? ' me' : '') }, [
          el('span', { class: 'rank', text: String(team.rank) }),
          el('span', { style: { fontSize: '1.3rem' }, text: team.emoji }),
          el('span', { class: 'grow', text: team.name }),
          el('span', { class: 'score', text: String(team.score) }),
        ])
      );
    });
    return el('div', { class: 'card stack' }, [el('h2', { text: t('pTeamBoard'), style: { margin: 0 } }), board]);
  }

  // ------------------------------------------------------------- المؤقّت

  function startTick(s) {
    const q = s.question;
    if (!q?.timeLimit || !s.endsAt) return;
    const timer = state.timer;
    const num = timer ? null : $('#tnum');
    const bar = timer ? null : $('#tbar');
    if (!timer && (!num || !bar)) return;
    const total = q.timeLimit * 1000;
    let lastSecond = null;

    state.tickTimer = setInterval(() => {
      const left = Math.max(0, s.endsAt - serverTime());
      const seconds = Math.ceil(left / 1000);
      if (timer) {
        timer.set(left);
      } else {
        num.textContent = String(seconds);
        bar.style.width = Math.max(0, (left / total) * 100) + '%';
      }
      // نبضة صوتية في الثواني الأخيرة لرفع الحماس
      if (seconds !== lastSecond) {
        if (lastSecond !== null && seconds > 0 && seconds <= 5 && !s.answered) Fx.play('tick');
        lastSecond = seconds;
      }
      if (num) num.classList.toggle('hot', seconds <= 5);
      if (left <= 0) {
        timer?.expire();
        clearTick();
        // الوضع الحر: انتهى وقته دون إجابة — نعرض له زر الانتقال بنفسه
        if (s.pace === 'self' && !s.answered) renderSelfTimeout(s);
      }
    }, 200);
  }

  function clearTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
    state.timer = null;
    state.optionNodes = [];
    state.sendBtn = null;
    state.sheetHost?.remove();
    state.sheetHost = null;
    state.cancelCountdown?.();
    state.cancelCountdown = null;
    // عدّادا الجدولة والمدة يعيشان بين الرسمات، فنوقفهما مع كل إعادة رسم
    state.stopCountdown?.();
    state.stopCountdown = null;
    state.stopDeadline?.();
    state.stopDeadline = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.last) render(true);
  });

  /*
   * قائمة النشاط: الصوت واللغة والسِمَة والمغادرة خلف زرٍّ واحد. شاشة السؤال
   * تُقاس بالارتفاع، وصفٌّ من الأزرار في أعلاها يزاحم السؤال نفسه.
   *
   * سطورها كاملة العرض بنصوصها وحالاتها — لا رموز عارية تُخمَّن.
   */
  const exitMenu = $('#exitMenu');

  /** يعيد بناء سطور القائمة بلغة الواجهة الحالية */
  function buildExitMenu() {
    if (!exitMenu || !UI) return;
    exitMenu.replaceChildren();
    exitMenu.append(
      UI.MenuToggle(
        t('pSoundTitle'),
        () => (Fx.soundOn() ? t('pSoundStateOn') : t('pSoundStateOff')),
        () => Fx.setSound(!Fx.soundOn())
      )
    );
    exitMenu.append(
      UI.MenuRow({
        label: t('pMenuLang'),
        state: window.I18n?.getLang() === 'en' ? 'English' : 'العربية',
        onClick: () => {
          window.I18n?.setLang(window.I18n.getLang() === 'en' ? 'ar' : 'en');
          location.reload();
        },
      })
    );
    exitMenu.append(
      UI.MenuToggle(
        t('pMenuTheme'),
        () => (window.Theme?.effective() === 'dark' ? t('pThemeDark') : t('pThemeLight')),
        () => window.Theme?.set(window.Theme.effective() === 'dark' ? 'light' : 'dark')
      )
    );
    exitMenu.append(UI.MenuSep());
    exitMenu.append(
      UI.MenuRow({
        label: t('pLeaveAction'),
        danger: true,
        onClick: () => {
          const live = state.last && state.last.status !== 'ended';
          if (live && !confirm(t('pLeaveConfirm'))) return;
          // لا نرسل «مغادرة» قبل الانضمام أصلاً حتى لا تظهر رسالة خطأ
          if (state.joined) socket.send({ t: 'leave' });
          store.del(SESSION_KEY);
          store.del(PENDING_KEY);
          socket.close();
          location.href = '/';
        },
      })
    );
  }
  buildExitMenu();

  if (exitBtn && exitMenu) {
    const setOpen = (open) => {
      exitMenu.hidden = !open;
      if (open) window.TapioUI?.clampMenu(exitMenu);
      exitBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    exitBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(exitMenu.hidden);
    });
    document.addEventListener('click', (event) => {
      if (!exitMenu.hidden && !exitMenu.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
  }

  boot();
})();
