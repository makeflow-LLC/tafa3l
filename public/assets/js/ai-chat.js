(function (global) {
  'use strict';

  /**
   * «صمّم نشاطك بالذكاء الاصطناعي»: نافذة محادثة يفهم فيها المساعد ما يريده
   * المدرب، يصوغ الأسئلة، يعرضها عليه، وعند موافقته تُفتح في المحرّر جاهزة.
   *
   * المفتاح لا يمرّ من هنا إطلاقاً — الصفحة تنادي خادمنا فقط (/api/ai/design).
   */

  const { el, api, toast, store, TYPE_LABELS, TYPE_EMOJI } = global.T;
  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const CHAT_KEY = 'tapio:ai:chat';
  const MAX_KEPT = 30;

  /**
   * المحادثة لا تُحفظ: كل دخولٍ إلى المساعد يبدأ من الصفر.
   * كانت تُحفظ في التخزين المحلي فيعود المعلّم بعد أيام إلى حوارٍ انتهى،
   * فيبني المساعد على سياقٍ ميت ويردّ ردّاً لا علاقة له بما يريده الآن.
   */
  function forgetOldChat() {
    try {
      store.local.set(CHAT_KEY, null);
      localStorage.removeItem(CHAT_KEY);
    } catch {
      /* تخزين معطّل */
    }
  }

  const STARTERS = [
    t('cStarter1'),
    t('cStarter2'),
    t('cStarter3'),
    t('cStarter4'),
  ];

  /** المحادثة تعيش في الذاكرة وحدها ما دامت الصفحة مفتوحة */
  const trim = (messages) => messages.slice(-MAX_KEPT);

  /**
   * يرسم صفحة المحادثة داخل عنصر.
   * @param {HTMLElement} root
   * @param {{onApprove:(draft:object)=>void}} opts
   */
  function render(root, opts) {
    forgetOldChat();
    const state = { messages: [], draft: null, busy: false, allowManual: false };

    const thread = el('div', { class: 'chat-thread' });
    const preview = el('div');
    const input = el('textarea', {
      class: 'chat-input',
      rows: 2,
      placeholder: t('cPlaceholder'),
      maxlength: 4000,
    });
    const sendBtn = el('button', { class: 'btn primary', type: 'button' }, t('cSend'));
    const clearBtn = el('button', { class: 'btn ghost sm', type: 'button' }, t('cNewChat'));

    /**
     * الافتراضي: أسئلة تُصحَّح آلياً وحدها. أسئلة «الجواب الحرّ» و«أكمل
     * الفراغ» تُلقي على المعلّم عملَ تصحيحٍ يدويّ بعد كل جلسة، فلا تُفرض
     * عليه ضمناً — هذا هو الزرّ الذي يجيب به على سؤال المساعد.
     */
    const manualBox = el('input', { type: 'checkbox' });
    manualBox.addEventListener('change', () => {
      state.allowManual = manualBox.checked;
    });
    const manualRow = el('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
      manualBox,
      el('span', { class: 'small grow' }, [
        el('strong', { text: t('cAllowManual') }),
        el('span', { class: 'muted small', style: { display: 'block' }, text: t('cAllowManualHint') }),
      ]),
    ]);

    root.innerHTML = '';
    root.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { style: { margin: 0 }, text: t('cTitle') }),
          clearBtn,
        ]),
        el('p', {
          class: 'muted small',
          text: t('cIntro'),
        }),
        thread,
        manualRow,
        el('div', { class: 'chat-compose' }, [input, sendBtn]),
      ])
    );
    root.append(preview);

    function bubble(role, text) {
      return el('div', { class: 'bubble ' + (role === 'user' ? 'me' : 'ai') }, [
        el('span', { class: 'who', text: role === 'user' ? t('cYou') : t('cAssistant') }),
        el('div', { class: 'body', text }),
      ]);
    }

    function drawThread() {
      thread.innerHTML = '';
      if (!state.messages.length) {
        thread.append(
          el('div', { class: 'stack' }, [
            el('p', { class: 'muted small', text: t('cStartHint') }),
            el(
              'div',
              { class: 'row wrap' },
              STARTERS.map((s) =>
                el(
                  'button',
                  {
                    class: 'btn ghost sm',
                    type: 'button',
                    onclick: () => {
                      input.value = s;
                      input.focus();
                    },
                  },
                  s
                )
              )
            ),
          ])
        );
      }
      state.messages.forEach((m) => thread.append(bubble(m.role, m.content)));
      if (state.busy) {
        thread.append(
          el('div', { class: 'bubble ai' }, [
            el('span', { class: 'who', text: t('cAssistant') }),
            el('div', { class: 'row' }, [el('span', { class: 'spinner sm' }), el('span', { class: 'muted small', text: t('cThinking') })]),
          ])
        );
      }
      thread.scrollTop = thread.scrollHeight;
    }

    function questionLine(q, index) {
      const bits = [];
      if (q.options && q.options.length) {
        bits.push(q.options.map((o) => (o.text || o)).join(' · '));
      }
      if (q.correct && q.correct.length) {
        const labels = q.correct
          .map((id) => (q.options || []).find((o) => o.id === id)?.text || (id === 'true' ? t('cTrue') : id === 'false' ? t('cFalse') : id))
          .filter(Boolean);
        if (labels.length) bits.push('✅ ' + labels.join(t('listSep')));
      }
      if (q.scale) bits.push(`${q.scale.min}–${q.scale.max} · ${q.scale.minLabel} ← ${q.scale.maxLabel}`);
      return el('div', { class: 'q-preview' }, [
        el('span', { class: 'badge', text: `${TYPE_EMOJI[q.type] || '❓'} ${TYPE_LABELS[q.type] || q.type}` }),
        el('div', { class: 'grow stack tight' }, [
          el('strong', { text: `${index + 1}. ${q.text}` }),
          bits.length ? el('span', { class: 'muted small', text: bits.join('  |  ') }) : null,
        ]),
      ]);
    }

    function drawPreview() {
      preview.innerHTML = '';
      if (!state.draft) return;
      const { draft, warnings } = state.draft;

      const approve = el('button', { class: 'btn primary', type: 'button' }, t('cApprove'));
      approve.addEventListener('click', () => {
        opts.onApprove(draft);
      });
      const tweak = el('button', { class: 'btn ghost', type: 'button' }, t('cTweak'));
      tweak.addEventListener('click', () => {
        input.value = '';
        input.placeholder = t('cTweakHint');
        input.focus();
      });

      preview.append(
        el('div', { class: 'card stack' }, [
          el('div', { class: 'row between' }, [
            el('h2', { style: { margin: 0 }, text: t('cDraftTitle') }),
            el('span', { class: 'badge', text: t('hQuestionCount', { count: draft.questions.length }) }),
          ]),
          el('strong', { text: draft.title || t('cUntitled') }),
          el('div', { class: 'stack tight' }, draft.questions.map(questionLine)),
          warnings && warnings.length
            ? el('div', { class: 'note warn stack tight' }, [
                el('strong', { text: t('cDraftNotes') }),
                ...warnings.map((w) => el('span', { class: 'small', text: '• ' + w })),
              ])
            : null,
          el('div', { class: 'row' }, [approve, tweak]),
        ])
      );
    }

    async function send() {
      const text = input.value.trim();
      if (!text || state.busy) return;
      state.messages.push({ role: 'user', content: text });
      state.messages = trim(state.messages);
      input.value = '';
      state.busy = true;
      sendBtn.disabled = true;
      drawThread();

      try {
        const data = await api('/api/ai/design', { method: 'POST', body: { messages: state.messages, allowManual: state.allowManual } });
        state.messages.push({ role: 'assistant', content: data.reply });
        if (data.draft) {
          const parsed = global.Builder.parseImport(JSON.stringify(data.draft));
          if (parsed.error) {
            state.messages.push({ role: 'assistant', content: t('cBadDraft') });
          } else {
            state.draft = parsed;
          }
        }
      } catch (err) {
        toast(err.message || t('cNoConnection'), 'bad');
        state.messages.push({ role: 'assistant', content: '⚠️ ' + (err.message || t('cNoConnection')) });
      } finally {
        state.busy = false;
        sendBtn.disabled = false;
        state.messages = trim(state.messages);
        drawThread();
        drawPreview();
      }
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (event) => {
      // Enter يرسل، وShift+Enter سطر جديد
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    clearBtn.addEventListener('click', () => {
      state.messages = [];
      state.draft = null;
      drawThread();
      drawPreview();
    });

    drawThread();
    drawPreview();
    input.focus();
  }

  global.AiChat = { render, CHAT_KEY };
})(window);
