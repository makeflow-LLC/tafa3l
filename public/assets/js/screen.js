/* شاشة العرض المنفصلة — للبروجكتر، قراءة فقط بلا أي زر تحكم */
(function () {
  'use strict';

  const { $, el, avatarNode, toast, connect, TYPE_LABELS, TYPE_EMOJI, fmtMs } = window.T;
  const Fx = window.Fx;

  const app = $('#app');
  const connBadge = $('#conn');

  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').replace(/\D/g, '').slice(0, 6);
  const hostToken = params.get('hostToken') || '';

  const state = {
    live: null,
    dashboard: null, // لوحة الإحصاءات — نتائج كل سؤال في الوضع الحر تأتي منها
    clockOffset: 0,
    tickTimer: null,
    cancelCountdown: null,
    lastPhaseKey: '',
  };

  function serverTime() {
    return Date.now() - state.clockOffset;
  }

  if (!code || !hostToken) {
    app.innerHTML = '';
    app.append(
      el('div', { class: 'card stack center' }, [
        el('h2', { text: 'رابط شاشة غير صالح' }),
        el('p', { class: 'muted small', text: 'افتح هذه الشاشة من زر «🖥️ شاشة العرض» داخل لوحة المدرب.' }),
      ])
    );
  } else {
    boot();
  }

  function boot() {
    const socket = connect({
      onOpen: () => socket.send({ t: 'screen:hello', code, hostToken }),
      onStatus: (status) => {
        connBadge.textContent = status === 'online' ? '🟢 متصل' : status === 'connecting' ? '⏳' : '🔴 منقطع';
      },
      onMessage: (msg) => {
        if (msg.t === 'state') {
          if (msg.serverNow) state.clockOffset = Date.now() - msg.serverNow;
          state.live = msg;
          render();
        } else if (msg.t === 'dashboard') {
          state.dashboard = msg.data;
          // مسرح الوضع الحر يرسم نتائجه من هذه البيانات
          if (state.live?.pace === 'self') render();
        } else if (msg.t === 'reaction') {
          Fx.floatEmoji(msg.emoji);
        } else if (msg.t === 'error') {
          app.innerHTML = '';
          app.append(el('div', { class: 'card stack center' }, [el('h2', { text: '⚠️ ' + msg.message })]));
        } else if (msg.t === 'session:closed') {
          app.innerHTML = '';
          app.append(el('div', { class: 'card stack center' }, [el('h2', { text: '👋 انتهت الجلسة' })]));
        }
      },
    });
  }

  function render() {
    clearTick();
    const s = state.live;
    if (!s) return;
    if (s.title) $('#quizTitle').textContent = s.title;
    app.innerHTML = '';

    if (s.status === 'ended' || s.phase === 'final') return renderFinal(s);
    if (s.status === 'lobby') return renderLobby(s);
    if (s.pace === 'self') return renderSelfStage(s);
    if (s.phase === 'leaderboard') return renderLeaderboard(s);
    return renderQuestion(s);
  }

  // ------------------------------------------------------------- القاعة

  function renderLobby(s) {
    app.append(
      el('div', { class: 'card center stack' }, [
        el('h1', { text: 'امسح رمز QR للانضمام', style: { margin: 0 } }),
        qrBox(s.code),
        el('div', { class: 'bigcode', text: s.code }),
        el('p', { class: 'muted', style: { direction: 'ltr' }, text: location.host + '/j/' + s.code }),
      ])
    );
    app.append(peopleCard(s));
  }

  function qrBox(code) {
    const box = el('div', { class: 'qr' });
    fetch('/api/qr?text=' + encodeURIComponent(`${location.origin}/j/${code}`))
      .then((r) => r.text())
      .then((svg) => (box.innerHTML = svg))
      .catch(() => (box.textContent = 'تعذّر توليد QR'));
    return box;
  }

  function peopleCard(s) {
    const people = el('div', { class: 'people' });
    if (!s.participants.length) people.append(el('span', { class: 'muted', text: 'بانتظار انضمام المشاركين…' }));
    s.participants.forEach((p) => {
      const team = s.teams && p.teamId != null ? s.teams[p.teamId] : null;
      people.append(
        el('span', { class: 'chip' + (p.connected ? '' : ' off') }, [avatarNode(p.avatar, 'sm'), el('span', { text: (team ? team.emoji + ' ' : '') + p.name })])
      );
    });
    return el('div', { class: 'card stack' }, [el('h2', { text: `المشاركون (${s.participants.length})`, style: { margin: 0 } }), people]);
  }

  // ------------------------------------------------------------- السؤال

  function openIn(s) {
    if (!s.opensAt) return 0;
    return s.opensAt - serverTime();
  }

  function renderQuestion(s) {
    const q = s.question;
    if (!q) return renderLobby(s);
    const results = s.results;
    const total = s.participants.length;
    const answered = s.answeredCount || 0;

    const untilOpen = openIn(s);
    if (s.phase === 'question' && untilOpen > 250) {
      app.append(
        el('div', { class: 'card stack center' }, [
          el('span', { class: 'badge' }, `${TYPE_EMOJI[q.type]} سؤال ${s.index + 1} من ${s.total}`),
          q.imageUrl ? el('img', { class: 'q-image', src: q.imageUrl, alt: 'صورة السؤال' }) : null,
          el('h1', { class: 'big-q', text: q.text }),
          el('p', { class: 'muted', text: 'استعد… ينطلق الجميع معاً' }),
        ])
      );
      state.cancelCountdown = Fx.countdown(untilOpen, () => {
        state.cancelCountdown = null;
        render();
      });
      return;
    }

    const head = el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('span', { class: 'badge' }, `${TYPE_EMOJI[q.type]} ${TYPE_LABELS[q.type]} — سؤال ${s.index + 1} من ${s.total}`),
        el('span', { class: 'badge' + (answered === total && total > 0 ? ' ok' : '') }, `أجاب ${answered} من ${total}`),
      ]),
      q.imageUrl ? el('img', { class: 'q-image', src: q.imageUrl, alt: 'صورة السؤال' }) : null,
      el('h1', { class: 'big-q', text: q.text }),
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

    if (s.phase === 'question' && q.scored) {
      /**
       * سؤال مصحَّح أثناء الإجابة: لا نعرض الأعداد الحية (حتى لا يقلّد
       * المتأخرون إجابة الأغلبية) — نعرض الخيارات، وتحتها أسماء المشاركين
       * تضيء فور وصول إجابة كل منهم.
       */
      const options = el('div', { class: 'options' });
      q.options.forEach((option, index) => {
        options.append(
          el('div', { class: `opt c${index % 8}` }, [
            el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
            el('span', { class: 'grow', text: option.text }),
          ])
        );
      });
      app.append(options);
      app.append(answeredChips(s));
    } else {
      // استطلاع/كلمات/مقياس/مفتوح: النتائج تنمو حيّة أمام القاعة أثناء التصويت.
      // وبعد «عرض النتائج» (phase=results) تُكشف الإجابة الصحيحة للمصحَّح.
      app.append(resultsView(q, results, s.phase === 'results'));
      if (s.phase === 'results') {
        const top = topBoard(s);
        if (top) app.append(top);
      }
    }

    if (s.phase === 'question') startTick(s, q);
  }

  /** أسماء المشاركين تضيء فور إجابتهم — يرى الطالب وصول إجابته على الشاشة الكبيرة */
  function answeredChips(s) {
    if (!s.participants.length) return el('div');
    const people = el('div', { class: 'people', style: { justifyContent: 'center' } });
    s.participants.forEach((p) => {
      people.append(
        el('span', { class: 'chip' + (p.answeredCurrent ? ' answered' : '') + (p.connected ? '' : ' off') }, [
          avatarNode(p.avatar, 'sm'),
          el('span', { text: p.name }),
          p.answeredCurrent ? el('span', { text: '✓' }) : null,
        ])
      );
    });
    return el('div', { class: 'card stack' }, [people]);
  }

  /** الأوائل الخمسة بعد كشف النتائج — يبقي الحماس بين الأسئلة */
  function topBoard(s) {
    const board = (s.leaderboard || []).slice(0, 5);
    if (!board.length) return null;
    return el('div', { class: 'card stack' }, [el('h2', { text: '🏆 الأوائل', style: { margin: 0 } }), boardList(board)]);
  }

  function resultsView(q, results, reveal) {
    const card = el('div', { class: 'card stack' });
    if (!results || results.total === 0) {
      card.append(el('p', { class: 'muted center', text: 'لا توجد إجابات بعد…' }));
      return card;
    }
    if (results.options) {
      // التمييز (صحيح/باهت) للأسئلة المصحَّحة عند الكشف فقط — الاستطلاع أعمدة متساوية الوضوح
      const scored = !!q?.scored && reveal;
      const options = el('div', { class: 'options' });
      results.options.forEach((option, index) => {
        options.append(
          el('div', { class: `opt c${index % 8}` + (scored ? (option.correct ? ' correct' : ' dim') : '') }, [
            el('i', { class: 'bar', style: { width: option.percent + '%' } }),
            el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
            el('span', { class: 'grow', text: option.text }),
            scored && option.correct ? el('span', { class: 'badge ok', text: '✓' }) : null,
            el('span', { class: 'count', text: `${option.percent}٪ · ${option.count}` }),
          ])
        );
      });
      card.append(options);
      return card;
    }
    if (results.words) {
      const cloud = el('div', { class: 'cloud' });
      const max = Math.max(1, ...results.words.map((w) => w.count));
      const colors = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#22d3ee'];
      results.words.forEach((word, index) => {
        cloud.append(
          el('span', {
            text: word.text + (word.count > 1 ? ` ×${word.count}` : ''),
            style: { fontSize: (1.2 + (word.count / max) * 2.6).toFixed(2) + 'rem', color: colors[index % colors.length] },
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
        .slice(-10)
        .reverse()
        .forEach((r) => quotes.append(el('div', { class: 'quote' }, [el('div', { text: r.text })])));
      card.append(quotes);
      return card;
    }
    return card;
  }

  // ------------------------------------------------------------- الترتيب

  function renderLeaderboard(s) {
    app.append(el('h1', { class: 'center', text: '🏆 الترتيب' }));
    const board = s.leaderboard || [];
    if (board.length) {
      app.append(el('div', { class: 'card stack' }, [podium(board)]));
      if (board.length > 3) app.append(el('div', { class: 'card stack' }, [boardList(board.slice(3))]));
    } else {
      app.append(el('div', { class: 'card center' }, el('p', { class: 'muted', text: 'لا توجد نتائج بعد' })));
    }
    const teamCard = teamBoard(s.teamLeaderboard);
    if (teamCard) app.append(teamCard);
  }

  /** ترتيب الفرق */
  function teamBoard(list) {
    if (!list?.length) return null;
    const board = el('div', { class: 'board' });
    list.forEach((team) => {
      board.append(
        el('div', { class: 'item' }, [
          el('span', { class: 'rank', text: String(team.rank) }),
          el('span', { style: { fontSize: '1.3rem' }, text: team.emoji }),
          el('span', { class: 'grow', text: `${team.name} (${team.members})` }),
          el('span', { class: 'score', text: String(team.score) }),
        ])
      );
    });
    return el('div', { class: 'card stack' }, [el('h2', { text: '🏳️ ترتيب الفرق', style: { margin: 0 } }), board]);
  }

  function podium(board) {
    const order = [1, 0, 2];
    const medals = ['🥇', '🥈', '🥉'];
    const heights = ['86px', '120px', '64px'];
    const wrap = el('div', { class: 'podium' });
    order.forEach((index, slot) => {
      const entry = board[index];
      if (!entry) return;
      wrap.append(
        el('div', { class: 'pod' }, [
          el('div', { class: 'who' }, [avatarNode(entry.avatar, ''), el('div', { class: 'nm', text: entry.name }), el('div', { class: 'sc', text: String(entry.score) })]),
          el('div', { class: 'block', style: { height: heights[slot] } }, [el('span', { class: 'medal', text: medals[index] })]),
        ])
      );
    });
    return wrap;
  }

  function boardList(list) {
    const board = el('div', { class: 'board' });
    list.forEach((entry) => {
      board.append(
        el('div', { class: 'item' }, [
          el('span', { class: 'rank', text: String(entry.rank) }),
          avatarNode(entry.avatar, 'sm'),
          el('span', { class: 'grow', text: entry.name }),
          el('span', { class: 'score', text: String(entry.score) }),
        ])
      );
    });
    return board;
  }

  // ---------------------------------------------------------- الوضع الحر

  function renderSelfStage(s) {
    const total = s.participants.length;
    const done = s.finishedCount || 0;
    app.append(
      el('div', { class: 'card stack center' }, [
        el('span', { class: 'badge' }, '🏃 وضع حر — كل متدرب بسرعته'),
        el('h1', { style: { margin: 0 }, text: `أنهى ${done} من ${total}` }),
        el('div', { class: 'progress' }, el('i', { style: { width: (total ? (done / total) * 100 : 0) + '%' } })),
      ])
    );
    const people = el('div', { class: 'people' });
    if (!total) people.append(el('span', { class: 'muted', text: 'بانتظار انضمام المشاركين…' }));
    s.participants.forEach((p) => {
      people.append(
        el('span', { class: 'chip' + (p.done ? ' answered' : '') + (p.connected ? '' : ' off') }, [
          avatarNode(p.avatar, 'sm'),
          el('span', { text: p.name }),
          el('span', { class: 'badge', text: p.done ? '✓' : `${p.at}/${s.total}` }),
        ])
      );
    });
    app.append(el('div', { class: 'card stack' }, [el('h2', { text: 'من وصل إلى أين؟', style: { margin: 0 } }), people]));

    // نتائج السؤال الذي عنده أغلب المتدربين الآن — تتبع القاعة وحدها بلا أي نقرة
    const row = busiestQuestion(s);
    if (row) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('div', { class: 'row between' }, [
            el('h2', { text: `نتائج السؤال ${row.index + 1}`, style: { margin: 0 } }),
            el('span', { class: 'badge' }, `${TYPE_EMOJI[row.type]} أجاب ${row.responses} من ${row.reached}`),
          ]),
          el('h1', { class: 'big-q', text: row.text }),
          row.results && row.results.total > 0
            ? resultsView({ scored: row.correct !== null }, row.results, true)
            : el('p', { class: 'muted center', text: 'لا توجد إجابات على هذا السؤال بعد…' }),
        ])
      );
    }

    const board = (s.leaderboard || []).slice(0, 10);
    if (board.length) app.append(el('div', { class: 'card stack' }, [el('h2', { text: '🏆 الترتيب', style: { margin: 0 } }), boardList(board)]));
    const teamCard = teamBoard(s.teamLeaderboard);
    if (teamCard) app.append(teamCard);
  }

  /**
   * أي سؤال يُعرض في الوضع الحر؟ السؤال الذي عنده أكبر عدد من المتدربين الآن،
   * وعند انتهاء الجميع آخرُ سؤال أجاب عليه أحد.
   */
  function busiestQuestion(s) {
    const per = state.dashboard?.perQuestion;
    if (!per?.length) return null;
    const counts = new Array(per.length).fill(0);
    let anyActive = false;
    s.participants.forEach((p) => {
      if (p.done) return;
      const at = Math.min(per.length - 1, Math.max(0, p.at - 1));
      counts[at] += 1;
      anyActive = true;
    });
    if (anyActive) {
      let best = 0;
      for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
      return per[best];
    }
    const answeredRows = per.filter((row) => row.responses > 0);
    return answeredRows.length ? answeredRows[answeredRows.length - 1] : per[0];
  }

  // ------------------------------------------------------------- النهاية

  function renderFinal(s) {
    if (state.lastPhaseKey !== 'final') {
      state.lastPhaseKey = 'final';
      Fx.play('finish');
      Fx.confetti(160);
    }
    app.append(el('div', { class: 'card feedback' }, [el('div', { class: 'em', text: '🎊' }), el('div', { class: 'msg', text: 'انتهى النشاط' })]));
    const board = s.leaderboard || [];
    if (board.length) {
      app.append(el('div', { class: 'card stack' }, [el('h2', { text: '🏆 منصة التتويج', style: { margin: 0 } }), podium(board)]));
      if (board.length > 3) app.append(el('div', { class: 'card stack' }, [el('h2', { text: 'بقية الترتيب' }), boardList(board.slice(3))]));
    }
    const teamCard = teamBoard(s.teamLeaderboard);
    if (teamCard) app.append(teamCard);
    if (s.badgeList?.length) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: '🏅 الأوسمة', style: { margin: 0 } }),
          el(
            'div',
            { class: 'stack' },
            s.badgeList.map((entry) =>
              el('div', { class: 'row', style: { gap: '10px' } }, [
                avatarNode(entry.avatar, 'sm'),
                el('span', { style: { fontWeight: '700' }, text: entry.name }),
                el(
                  'span',
                  { class: 'badges grow' },
                  entry.badges.map((badge) => el('span', { class: 'award sm' }, [el('span', { class: 'em', text: badge.emoji }), el('span', { class: 'lbl', text: badge.label })]))
                ),
              ])
            )
          ),
        ])
      );
    }
  }

  // ------------------------------------------------------------- المؤقّت

  function startTick(s) {
    const q = s.question;
    if (!q?.timeLimit || !s.endsAt) return;
    const num = $('#tnum');
    const bar = $('#tbar');
    if (!num || !bar) return;
    const total = q.timeLimit * 1000;
    state.tickTimer = setInterval(() => {
      const left = Math.max(0, s.endsAt - serverTime());
      const seconds = Math.ceil(left / 1000);
      num.textContent = String(seconds);
      bar.style.width = Math.max(0, (left / total) * 100) + '%';
      num.classList.toggle('hot', seconds <= 5);
      if (left <= 0) clearTick();
    }, 200);
  }

  function clearTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
    state.cancelCountdown?.();
    state.cancelCountdown = null;
  }

  // ------------------------------------------------------------- ملء الشاشة

  $('#fullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast('تعذّر تفعيل ملء الشاشة', 'bad'));
  });
})();
