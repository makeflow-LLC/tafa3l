(function (global) {
  'use strict';

  /**
   * «منشئ الألعاب التفاعلية»: نافذة محادثة يصف فيها المعلّم درسه أو فكرته،
   * فيبني له النموذج لعبةً كاملة — ملفَّ HTML واحداً مكتفياً بذاته — ثم
   * يجرّبها هنا، وإن أعجبته نشرها في قسم ألعابه بصورةٍ مصغّرة ورابط.
   *
   * ثلاث قواعد تحكم هذه الشاشة:
   *
   *  ١) **الشيفرة لا تُعرض.** المعلّم ليس مبرمجاً، وسطرٌ من HTML على شاشته
   *     إرباكٌ لا فائدة فيه. ما يراه: «جارٍ إنشاء اللعبة»، ثم اللعبة تعمل.
   *
   *  ٢) **اللعبة تُجرَّب قبل أن تُنشر.** المعاينة إطارٌ معزول بلا
   *     `allow-same-origin` — أصلُها مبهم فلا تمسّ حساب المعلّم ولا تخزينه —
   *     وهو العزلُ نفسه الذي تُقدَّم به الألعاب المنشورة.
   *
   *  ٣) **النشر خطوةٌ يقرّرها هو.** بعد أن تعجبه: «هل تدرجها في قسم ألعابك؟»
   *     فإن أراد، وُلّدت الصورة المصغّرة ونُشرت اللعبة وظهر رابطها.
   *
   * والمفتاح لا يمرّ من هنا إطلاقاً — الصفحة تنادي خادمنا وحده.
   */

  const { el, api, toast, copyLink, fitCover, gradeChips } = global.T;
  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (global.I18n ? global.I18n.tagLabel(kind, id) : id);
  const SUBJECTS = (global.I18n && global.I18n.SUBJECTS) || [];

  const SETTINGS_KEY = 'tapio:gameAi:config';
  const POLL_MS = 2500;
  /** بعدها لم يعد الأمر تفكيراً بل بناءً — فيتغيّر ما يقرأه المعلّم */
  const BUILDING_AFTER_S = 20;

  /**
   * إعدادات المعلّم — الأسماء والحدود مطابقةٌ لما يحرسه الخادم في
   * `game-builder.js`. تُحفظ في المتصفّح فلا يضبطها في كل زيارة.
   */
  const KNOBS = [
    { name: 'suggestionsCount', label: 'gbKnobSuggestions', min: 2, max: 8, def: 4 },
    { name: 'wildcardCount', label: 'gbKnobWildcard', min: 0, max: 4, def: 1 },
    { name: 'correctPoints', label: 'gbKnobPoints', min: 1, max: 100, def: 10 },
    { name: 'hintPenalty', label: 'gbKnobPenalty', min: 0, max: 100, def: 5 },
    { name: 'difficultyLevels', label: 'gbKnobLevels', min: 1, max: 6, def: 3 },
    { name: 'itemsPerRun', label: 'gbKnobItems', min: 4, max: 40, def: 12 },
    { name: 'bankSize', label: 'gbKnobBank', min: 6, max: 80, def: 20 },
    { name: 'playMinutes', label: 'gbKnobMinutes', min: 2, max: 45, def: 7 },
    { name: 'tensionSystems', label: 'gbKnobTension', min: 1, max: 3, def: 1 },
  ];

  const defaults = () => Object.fromEntries(KNOBS.map((k) => [k.name, k.def]));

  function readSettings() {
    const out = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      KNOBS.forEach((k) => {
        const value = Math.round(Number(saved[k.name]));
        if (Number.isFinite(value)) out[k.name] = Math.min(k.max, Math.max(k.min, value));
      });
    } catch {
      /* تخزين معطّل — الافتراضات تكفي */
    }
    return out;
  }

  function writeSettings(config) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
    } catch {
      /* تخزين معطّل */
    }
  }

  /** عنوان اللعبة كما سمّاها النموذج داخل ملفّها — أفضل تعبئةٍ لحقل الاسم */
  function titleFromHtml(html) {
    const match = /<title[^>]*>([\s\S]{1,120}?)<\/title>/i.exec(String(html || ''));
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
  }

  /** حجمُ الملفّ بالبايت — الحدّ على الخادم بالبايت لا بالمحارف */
  const byteLen = (text) => new TextEncoder().encode(String(text || '')).length;

  /** كل رسمٍ يبطل ما قبله: استطلاعُ مهمّةٍ من شاشةٍ غادرها المعلّم لا يُكمل */
  let generation = 0;

  /**
   * يرسم الشاشة داخل عنصر.
   * @param {HTMLElement} root
   * @param {object|null} quota حصّة البناء الباقية — تُحدَّث بعد كل لعبة
   */
  function render(root, quota) {
    const mine = (generation += 1);
    const alive = () => generation === mine && root.isConnected;

    const state = {
      chatId: '',
      gameJob: '', // مهمّةُ آخر لعبةٍ بُنيت — عليها يعلَّق مسار المعاينة
      messages: [], // { role, text }
      busy: false,
      elapsed: 0,
      html: '',
      truncated: false,
      published: null,
      config: readSettings(),
      quota: quota || null,
    };

    const thread = el('div', { class: 'chat-thread' });
    const stage = el('div', { class: 'stack' }); // المعاينة ثم النشر
    const input = el('textarea', { class: 'chat-input', rows: 2, placeholder: t('gbPlaceholder'), maxlength: 6000 });
    const sendBtn = el('button', { class: 'btn primary', type: 'button' }, t('gbSend'));
    const resetBtn = el('button', { class: 'btn ghost sm', type: 'button' }, t('gbNewChat'));

    // ------------------------------------------------------------ الإعدادات

    function settingsCard() {
      const fields = KNOBS.map((knob) => {
        const box = el('input', {
          type: 'number',
          min: String(knob.min),
          max: String(knob.max),
          step: '1',
          value: String(state.config[knob.name]),
          inputmode: 'numeric',
        });
        box.addEventListener('change', () => {
          const value = Math.round(Number(box.value));
          state.config[knob.name] = Number.isFinite(value) ? Math.min(knob.max, Math.max(knob.min, value)) : knob.def;
          box.value = String(state.config[knob.name]);
          writeSettings(state.config);
        });
        return el('label', { class: 'stack tight knob' }, [
          el('span', { class: 'small', text: t(knob.label) }),
          box,
          el('span', { class: 'muted tiny', text: t('gbKnobRange', { min: knob.min, max: knob.max }) }),
        ]);
      });

      const restore = el('button', { class: 'btn ghost sm', type: 'button' }, t('gbKnobReset'));
      restore.addEventListener('click', () => {
        state.config = defaults();
        writeSettings(state.config);
        KNOBS.forEach((knob, i) => {
          fields[i].querySelector('input').value = String(state.config[knob.name]);
        });
        toast(t('gbKnobResetDone'), 'ok');
      });

      const body = el('div', { class: 'stack' }, [
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gbKnobsIntro') }),
        el('div', { class: 'knob-grid' }, fields),
        el('div', { class: 'row' }, [restore]),
      ]);

      const details = el('details', { class: 'card stack' });
      details.append(el('summary', {}, [el('strong', { text: t('gbKnobsTitle') })]), body);
      return details;
    }

    // -------------------------------------------------------------- المحادثة

    const STARTERS = [t('gbStarter1'), t('gbStarter2'), t('gbStarter3'), t('gbStarter4')];

    function bubble(role, text) {
      // كما في مساعد الأنشطة: تنسيقٌ للنموذج، وحرفيّةٌ لما كتبه المعلّم
      const body = el('div', { class: 'body' + (role === 'user' ? '' : ' rich') });
      if (role === 'user') body.textContent = text;
      else body.append(global.T.richText(text));
      return el('div', { class: 'bubble ' + (role === 'user' ? 'me' : 'ai') }, [
        el('span', { class: 'who', text: role === 'user' ? t('gbYou') : t('gbAssistant') }),
        body,
      ]);
    }

    function drawThread() {
      thread.innerHTML = '';
      if (!state.messages.length && !state.busy) {
        thread.append(
          el('div', { class: 'stack' }, [
            el('p', { class: 'muted small', text: t('gbStartHint') }),
            el(
              'div',
              { class: 'row wrap' },
              STARTERS.map((line) =>
                el(
                  'button',
                  {
                    class: 'btn ghost sm',
                    type: 'button',
                    onclick: () => {
                      input.value = line;
                      input.focus();
                    },
                  },
                  line
                )
              )
            ),
          ])
        );
      }
      state.messages.forEach((m) => thread.append(bubble(m.role, m.text)));
      if (state.busy) {
        const building = state.elapsed >= BUILDING_AFTER_S;
        thread.append(
          el('div', { class: 'bubble ai' }, [
            el('span', { class: 'who', text: t('gbAssistant') }),
            el('div', { class: 'row', style: { gap: '8px' } }, [
              el('span', { class: 'spinner sm' }),
              el('span', {
                class: 'muted small',
                text: building ? t('gbBuilding', { n: state.elapsed }) : t('gbThinking'),
              }),
            ]),
            building ? el('span', { class: 'muted tiny', text: t('gbBuildingNote') }) : null,
          ])
        );
      }
      thread.scrollTop = thread.scrollHeight;
    }

    // ------------------------------------------------------- معاينة اللعبة

    /**
     * إطارُ اللعبة — تُقدَّم من الخادم لا من `srcdoc`.
     *
     * السبب أن `srcdoc` مع `sandbox` يُبهم الأصل ولا يفرض سياسة محتوى، فتصير
     * المعاينة أوسع صلاحيةً من اللعبة بعد نشرها: تعمل عند المعلّم وتنكسر عند
     * طالبه. مسارُ المعاينة يرسل ترويسات العزل نفسها — فما يُعاين هو ما يُنشر.
     */
    function gameFrame() {
      return el('iframe', {
        class: 'game-frame',
        src: '/api/game-ai/chat/' + state.gameJob + '/frame',
        title: t('gbPreviewTitle'),
        sandbox: 'allow-scripts allow-forms allow-modals allow-pointer-lock',
        allow: 'fullscreen; gamepad; accelerometer; gyroscope',
        referrerpolicy: 'no-referrer',
      });
    }

    function previewCard() {
      const box = el('div', { class: 'game-stage' });
      const hud = el('div', { class: 'game-hud' }, [
        el(
          'button',
          {
            class: 'hud-btn',
            type: 'button',
            title: t('gbFullscreen'),
            'aria-label': t('gbFullscreen'),
            onclick: () => (document.fullscreenElement ? document.exitFullscreen?.() : box.requestFullscreen?.().catch(() => {})),
          },
          '⛶'
        ),
        el(
          'button',
          {
            class: 'hud-btn',
            type: 'button',
            title: t('gbRestart'),
            'aria-label': t('gbRestart'),
            onclick: () => {
              box.replaceChildren(gameFrame(), hud);
            },
          },
          '↻'
        ),
      ]);
      box.append(gameFrame(), hud);

      const approve = el('button', { class: 'btn accent grow', type: 'button' }, t('gbApprove'));
      approve.addEventListener('click', () => {
        // ضغطةٌ ثانية تنزل إلى البطاقة القائمة ولا تبني ثانيةً فوقها:
        // بطاقتا نشرٍ للعبةٍ واحدة تعني رفعها مرّتين
        const open = stage.querySelector('[data-publish]');
        const card = open || stage.appendChild(publishCard());
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const tweak = el('button', { class: 'btn ghost', type: 'button' }, t('gbTweak'));
      tweak.addEventListener('click', () => {
        input.placeholder = t('gbTweakHint');
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      return el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { style: { margin: 0 }, text: t('gbReadyTitle') }),
          el('span', { class: 'badge', text: t('gbSize', { kb: Math.max(1, Math.round(byteLen(state.html) / 1024)) }) }),
        ]),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gbReadyBody') }),
        state.truncated ? el('div', { class: 'note warn small' }, t('gbTruncated')) : null,
        box,
        el('div', { class: 'row', style: { gap: '6px' } }, [approve, tweak]),
      ]);
    }

    // ---------------------------------------------------------- نشر اللعبة

    function publishCard() {
      const title = el('input', { maxlength: 120, placeholder: t('gFormTitlePlaceholder'), value: titleFromHtml(state.html) });
      const subject = el('select', {}, [
        el('option', { value: '', text: t('gFormPickSubject') }),
        ...SUBJECTS.map((id) => el('option', { value: id, text: tagLabel('subj', id) })),
      ]);
      const grades = gradeChips();
      const description = el('input', { maxlength: 300, placeholder: t('gFormDescPlaceholder') });
      const offlineOk = el('input', { type: 'checkbox' });
      offlineOk.checked = true;

      const note = el('div', { class: 'muted small' });
      const cover = el('div', { class: 'cover-preview', hidden: true });
      const done = el('div', { class: 'stack' });
      const publish = el('button', { class: 'btn accent grow', type: 'button' }, t('gbPublishYes'));
      const later = el('button', { class: 'btn ghost', type: 'button' }, t('gbPublishLater'));
      const actions = el('div', { class: 'row', style: { gap: '6px' } }, [publish, later]);

      later.addEventListener('click', () => card.remove());

      publish.addEventListener('click', async () => {
        if (!title.value.trim()) {
          title.focus();
          return toast(t('gbNeedTitle'), 'bad');
        }
        publish.disabled = true;
        later.disabled = true;

        // الرسم مهمّةٌ قد تبلغ دقيقتين — عدّادٌ يقول إنّها تجري ولم تتعطّل
        const startedAt = Date.now();
        note.textContent = t('gbCoverWorking');
        const ticker = setInterval(() => {
          note.textContent = t('gFormShotElapsed', { n: Math.round((Date.now() - startedAt) / 1000) });
        }, 1000);

        let image = '';
        try {
          const drawn = await api('/api/games/cover', {
            method: 'POST',
            body: { html: state.html, title: title.value, subject: subject.value, grades: grades.value() },
          });
          image = await fitCover(drawn.image);
          if (!title.value.trim() && drawn.name) title.value = drawn.name;
        } catch (err) {
          clearInterval(ticker);
          note.textContent = err.message;
          publish.disabled = false;
          later.disabled = false;
          return;
        }
        clearInterval(ticker);
        if (!alive()) return;

        cover.replaceChildren(el('img', { src: image, alt: t('gFormShot') }));
        cover.hidden = false;
        note.textContent = t('gbPublishing');

        try {
          const res = await api('/api/games', {
            method: 'POST',
            body: {
              title: title.value,
              subject: subject.value,
              description: description.value,
              grades: grades.value(),
              cover: image,
              offlineOk: offlineOk.checked,
              html: state.html,
            },
          });
          if (!alive()) return;
          state.published = res.game;
          note.textContent = '';
          actions.remove();
          done.append(publishedBox(res.game));
          toast(t('gUploaded', { title: res.game.title }), 'ok');
        } catch (err) {
          note.textContent = err.message;
          publish.disabled = false;
          later.disabled = false;
        }
      });

      const card = el('div', { class: 'card stack', 'data-publish': '1' }, [
        el('h2', { style: { margin: 0 }, text: t('gbPublishTitle') }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gbPublishBody') }),
        el('label', {}, [el('span', { class: 'small', text: t('gFormName') }), title]),
        el('label', {}, [el('span', { class: 'small', text: t('gFormSubject') }), subject]),
        el('div', { class: 'stack tight' }, [
          el('span', { class: 'small' }, [t('gFormGrades'), ' ', global.T.hintDot(t('gFormGradesHint'))]),
          grades.node,
        ]),
        el('label', {}, [el('span', { class: 'small', text: t('gFormDesc') }), description]),
        el('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
          offlineOk,
          el('span', { class: 'small grow' }, [el('strong', {}, [t('gFormOffline'), ' ', global.T.hintDot(t('gFormOfflineHint'))])]),
        ]),
        actions,
        note,
        cover,
        done,
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gFormSafety') }),
      ]);
      return card;
    }

    /** ما بعد النشر: الرابط، ونسخُه، وفتحُه — لا شيء غيره */
    function publishedBox(game) {
      const link = location.origin + '/games.html#/g/' + game.id;
      const copy = el('button', { class: 'btn ghost sm', type: 'button' }, t('gCopyLink'));
      copy.addEventListener('click', async () => {
        await copyLink(link);
        toast(t('gLinkCopied'), 'ok');
      });
      return el('div', { class: 'note ok stack tight' }, [
        el('strong', { text: t('gbPublishedTitle', { title: game.title }) }),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('code', { class: 'grow link-box', text: link }),
          copy,
          el('a', { class: 'btn primary sm', href: link, target: '_blank', rel: 'noopener' }, t('gOpen')),
        ]),
        el('a', { class: 'btn ghost sm', href: '#/games' }, t('gMine')),
      ]);
    }

    // ------------------------------------------------------------- الإرسال

    async function poll(jobId) {
      while (alive()) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!alive()) return null;
        let data;
        try {
          data = await api('/api/game-ai/chat/' + jobId);
        } catch (err) {
          // انقطاعٌ عابر لا ينهي مهمّةً تجري على الخادم: نُعاود الاستطلاع،
          // إلا أن يكون الخادم قد نسي المهمّة أصلاً
          if (/404/.test(String(err.message))) throw err;
          continue;
        }
        if (data.status === 'working') {
          state.elapsed = data.elapsed || 0;
          drawThread();
          continue;
        }
        return data;
      }
      return null;
    }

    async function send() {
      const text = input.value.trim();
      if (!text || state.busy) return;

      state.messages.push({ role: 'user', text });
      input.value = '';
      input.placeholder = t('gbPlaceholder');
      state.busy = true;
      state.elapsed = 0;
      sendBtn.disabled = true;
      drawThread();

      try {
        const started = await api('/api/game-ai/chat', {
          method: 'POST',
          body: { chatId: state.chatId, message: text, config: state.config },
        });
        state.chatId = started.chatId;
        const data = await poll(started.jobId);
        if (!data) return; // غادر المعلّم الشاشة

        if (data.status === 'error') throw new Error(data.error);

        state.messages.push({ role: 'assistant', text: data.reply || (data.html ? t('gbBuiltLine') : t('gbEmptyReply')) });
        if (data.quota) {
          state.quota = data.quota;
          paintQuota();
        }
        if (data.html) {
          state.gameJob = started.jobId;
          state.html = data.html;
          state.truncated = Boolean(data.truncated);
          // لعبةٌ جديدة تُبطل معاينةً سابقة وبطاقةَ نشرٍ لم تُستعمل
          stage.replaceChildren(previewCard());
        }
      } catch (err) {
        toast(err.message || t('gbFailed'), 'bad');
        state.messages.push({ role: 'assistant', text: '⚠️ ' + (err.message || t('gbFailed')) });
      } finally {
        if (alive()) {
          state.busy = false;
          drawThread();
          // `paintQuota` هي التي تفتح الزرّ أو تُبقيه مقفلاً: آخر لعبةٍ في
          // الحصّة تُبنى ثم يُقفل الباب خلفها في اللحظة نفسها
          paintQuota();
        }
      }
    }

    /**
     * الحصّة على الشاشة دائماً.
     *
     * الشارة يرسمها host.js فوق هذه الشاشة، ونحدّثها هنا بعد كل بناء —
     * فالمعلّم يرى الرقم ينقص لحظة نقصانه لا في زيارته التالية. وحين تنفد
     * يُقفل الإرسال: زرٌّ يُضغط ثم يُردّ بعد نداءٍ أسوأ من زرٍّ مقفل يقول لماذا.
     */
    function paintQuota() {
      const q = state.quota;
      const badge = document.querySelector('[data-quota]');
      if (badge && q && !q.unlimited) {
        badge.textContent =
          q.plan === 'premium'
            ? t('gbQuotaPremium', { left: q.remaining, limit: q.limit })
            : t('gbQuotaFree', { left: q.remaining, limit: q.limit, premium: q.premiumMonthly });
        badge.classList.toggle('warn', q.remaining <= 1);
      }
      const spent = Boolean(q) && !q.unlimited && q.remaining <= 0;
      sendBtn.disabled = spent || state.busy;
      input.disabled = spent;
      if (spent) {
        input.placeholder =
          q.plan === 'premium' ? t('gbQuotaSpentPremium', { n: q.limit }) : t('gbQuotaSpentFree', { n: q.limit, premium: q.premiumMonthly });
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
    resetBtn.addEventListener('click', () => {
      if (state.busy) return;
      if (state.chatId) api('/api/game-ai/chat/' + state.chatId, { method: 'DELETE' }).catch(() => {});
      state.chatId = '';
      state.messages = [];
      state.gameJob = '';
      state.html = '';
      state.truncated = false;
      state.published = null;
      stage.replaceChildren();
      drawThread();
    });

    // --------------------------------------------------------------- الرسم

    root.innerHTML = '';
    root.append(settingsCard());
    root.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [el('h2', { style: { margin: 0 }, text: t('gbChatTitle') }), resetBtn]),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gbChatIntro') }),
        thread,
        el('div', { class: 'chat-compose' }, [input, sendBtn]),
      ])
    );
    root.append(stage);

    drawThread();
    paintQuota();
    input.focus();
  }

  global.GameBuilder = { render, KNOBS, defaults, readSettings, titleFromHtml };
})(window);
