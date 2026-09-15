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
   *  ٣) **النشر ضغطةٌ واحدة بلا أسئلة.** الصفُّ سُئل عنه قبل البناء، والاسمُ
   *     والمادّةُ والوصفُ وكلماتُ البحث كتبها المساعد في رأس الملفّ. فبعد أن
   *     تعجبه: «انشر» — تُرسم الصورة المصغّرة وتُنشر ويظهر رابطها ومنشورُها.
   *
   * والمفتاح لا يمرّ من هنا إطلاقاً — الصفحة تنادي خادمنا وحده.
   */

  const { el, api, toast, fitCover } = global.T;
  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (global.I18n ? global.I18n.tagLabel(kind, id) : id);

  const SETTINGS_KEY = 'tapio:gameAi:config';
  /**
   * نسخة الإعدادات المحفوظة.
   *
   * تغييرُ مبدأٍ لا يبلغ من حفظ إعداداته قبله: من فتح الشاشة يوماً كُتب في
   * متصفّحه `timer: true` لأنه كان المبدأ، فيبقى مؤقّته يعمل ولو غيّرنا
   * المبدأ عشر مرّات. فترقيةٌ واحدة تُنزل عليه المبدأ الجديد مرّةً، ثم يبقى
   * اختياره بعدها اختياره.
   */
  const SETTINGS_VERSION = 2;
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
    // صفرٌ خيارٌ لا خطأ: لعبةٌ بلا ضغطٍ إطلاقاً
    { name: 'tensionSystems', label: 'gbKnobTension', min: 0, max: 3, def: 1 },
  ];

  /**
   * الميزات التي تُطفأ كليّاً — وإطفاؤها يغيّر تعليمات النموذج نفسها لا
   * سطراً في إعداداته (انظر `server/game-builder.js`).
   *
   * `needs` يربط رقماً بمفتاحه: خصمُ التلميح لا معنى له وقد أُطفئت
   * التلميحات، فيختفي حقله بدل أن يبقى رقماً لا أثر له.
   */
  const SWITCHES = [
    { name: 'hints', label: 'gbSwitchHints', hint: 'gbSwitchHintsHint' },
    // المؤقّت وحده مطفأٌ ابتداءً — انظر `server/game-builder.js` لسببه
    { name: 'timer', label: 'gbSwitchTimer', hint: 'gbSwitchTimerHint', def: false },
    { name: 'sound', label: 'gbSwitchSound', hint: 'gbSwitchSoundHint' },
    { name: 'character', label: 'gbSwitchCharacter', hint: 'gbSwitchCharacterHint' },
    { name: 'celebrations', label: 'gbSwitchCelebrations', hint: 'gbSwitchCelebrationsHint' },
    { name: 'surprises', label: 'gbSwitchSurprises', hint: 'gbSwitchSurprisesHint' },
    { name: 'resultCard', label: 'gbSwitchResultCard', hint: 'gbSwitchResultCardHint' },
  ];

  /** رقمٌ لا يظهر إلا وميزتُه مُشغَّلة */
  const KNOB_NEEDS = { hintPenalty: 'hints' };

  const defaults = () => ({
    ...Object.fromEntries(KNOBS.map((k) => [k.name, k.def])),
    // الميزات مُشغَّلة ابتداءً إلا ما نُصّ على خلافه: من لم يمسّ الإعدادات
    // يجد اللعبة كاملة، وبلا مؤقّت
    ...Object.fromEntries(SWITCHES.map((sw) => [sw.name, sw.def !== false])),
  });

  function readSettings() {
    const out = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      KNOBS.forEach((k) => {
        const value = Math.round(Number(saved[k.name]));
        if (Number.isFinite(value)) out[k.name] = Math.min(k.max, Math.max(k.min, value));
      });
      SWITCHES.forEach((sw) => {
        if (typeof saved[sw.name] === 'boolean') out[sw.name] = saved[sw.name];
      });
      /*
       * إعداداتٌ حُفظت قبل أن يصير المؤقّت مطفأً: تأخذ المبدأ الجديد مرّةً
       * واحدة، وتحتفظ بكل ما ضبطه المعلّم من أرقامٍ وميزاتٍ أخرى.
       *
       * و`|| 0` ليست زينة: النسخة غائبةٌ في كل إعدادٍ قديم، و`Number(undefined)`
       * هي `NaN`، و`NaN < 2` **خطأ** — فكانت الترقية لا تعمل على أحدٍ إطلاقاً،
       * وهم كلُّ من تعنيهم.
       */
      const savedVersion = Number(saved.v) || 0;
      if (savedVersion < SETTINGS_VERSION) out.timer = false;
    } catch {
      /* تخزين معطّل — الافتراضات تكفي */
    }
    return out;
  }

  function writeSettings(config) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...config, v: SETTINGS_VERSION }));
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
      // بطاقةُ اللعبة كما كتبها المساعد: الاسم والوصف والمادّة والصفوف والكلمات
      meta: null,
      cover: '', // الصورة المصغّرة بعد رسمها — لا تُرسم مرّتين للعبةٍ واحدة
      published: null,
      config: readSettings(),
      quota: quota || null,
    };

    const thread = el('div', { class: 'chat-thread' });
    const stage = el('div', { class: 'stack' }); // المعاينة ثم النشر
    // `enterkeyhint` صريحة: بعض لوحات الجوال تكتب «إرسال» على المفتاح من تلقائها،
    // فيضغطه المعلّم ظانّاً أنه يرسل ثم يجده نزل سطراً — أو العكس
    const input = el('textarea', { class: 'chat-input', rows: 2, placeholder: t('gbPlaceholder'), maxlength: 6000, enterkeyhint: 'enter' });
    const sendBtn = el('button', { class: 'btn primary', type: 'button' }, t('gbSend'));
    const resetBtn = el('button', { class: 'btn ghost sm', type: 'button' }, t('gbNewChat'));

    // ------------------------------------------------------------ الإعدادات

    function settingsCard() {
      const knobRows = {};

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
        const row = el('label', { class: 'stack tight knob' }, [
          el('span', { class: 'small', text: t(knob.label) }),
          box,
          el('span', { class: 'muted tiny', text: t('gbKnobRange', { min: knob.min, max: knob.max }) }),
        ]);
        knobRows[knob.name] = { row, box, knob };
        return row;
      });

      /** رقمٌ تابعٌ لميزةٍ مطفأة يختفي: خصمُ تلميحٍ لا تلميح فيه رقمٌ لا أثر له */
      function paintDependants() {
        for (const [name, needs] of Object.entries(KNOB_NEEDS)) {
          const entry = knobRows[name];
          if (entry) entry.row.hidden = !state.config[needs];
        }
      }

      const boxes = {};
      const switchRows = SWITCHES.map((sw) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = state.config[sw.name] !== false;
        box.addEventListener('change', () => {
          state.config[sw.name] = box.checked;
          writeSettings(state.config);
          paintDependants();
        });
        boxes[sw.name] = box;
        return el('label', { class: 'switch-row' }, [
          box,
          el('span', { class: 'grow' }, [
            el('strong', { class: 'small', text: t(sw.label) }),
            el('span', { class: 'muted tiny', style: { display: 'block' }, text: t(sw.hint) }),
          ]),
        ]);
      });

      const restore = el('button', { class: 'btn ghost sm', type: 'button' }, t('gbKnobReset'));
      restore.addEventListener('click', () => {
        state.config = defaults();
        writeSettings(state.config);
        KNOBS.forEach((knob) => (knobRows[knob.name].box.value = String(state.config[knob.name])));
        // من الحال لا من `true`: ليست كل الميزات مُشغَّلةً افتراضاً، وزرّ
        // «استعادة الافتراضي» الذي يُشعل ما مبدؤه الإطفاء يكذب على المعلّم
        SWITCHES.forEach((sw) => (boxes[sw.name].checked = state.config[sw.name] !== false));
        paintDependants();
        toast(t('gbKnobResetDone'), 'ok');
      });

      const body = el('div', { class: 'stack' }, [
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gbKnobsIntro') }),
        el('div', { class: 'knob-grid' }, fields),
        el('div', { class: 'stack tight' }, [
          el('strong', { class: 'small' }, [t('gbSwitchesTitle'), ' ', global.T.hintDot(t('gbSwitchesHint'))]),
          el('div', { class: 'switch-grid' }, switchRows),
        ]),
        el('div', { class: 'row' }, [restore]),
      ]);

      paintDependants();

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

      /*
       * زرٌّ واحد: «انشر». لا استمارة بعده ولا بطاقةَ اعتماد — الاسمُ والمادّة
       * والصفُّ والوصفُ والكلمات كلُّها في رأس الملفّ كتبها المساعد، والصفُّ
       * سُئل عنه المعلّم قبل البناء. فما يبقى للمعلّم قرارٌ واحد: أعجبتني أم لا.
       */
      const publish = el('button', { class: 'btn accent grow', type: 'button' }, t('gbPublishNow'));
      const tweak = el('button', { class: 'btn ghost', type: 'button' }, t('gbTweak'));
      const actions = el('div', { class: 'row', style: { gap: '6px' } }, [publish, tweak]);
      const progress = el('div', { class: 'stack tight' });
      const done = el('div', { class: 'stack' });

      publish.addEventListener('click', () => publishNow({ publish, tweak, actions, progress, done }));
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
        actions,
        progress,
        done,
      ]);
    }

    // -------------------------------------------------------------- النشر

    /**
     * النشر بضغطةٍ واحدة: تُرسم الصورة المصغّرة، ثم تُنشر اللعبة، ثم يظهر
     * صندوقُ المشاركة. لا سؤالَ في الطريق.
     *
     * ما يُرسل مع اللعبة كلُّه من بطاقتها (`state.meta`) التي كتبها المساعد في
     * رأس الملفّ. وإن نسي الاسم أخذناه من `<title>` ثم ممّا استنتجه راسمُ
     * الغلاف — فالخادم لا يقبل لعبةً بلا اسم، والمعلّم لا يُسأل عنه.
     *
     * والفشل يوقف عند خطوته ويعرض زرَّ إعادة: صورةٌ لم تُرسم لا تُعيد البناء،
     * ونشرٌ رُدّ لا يُعيد الرسم.
     */
    async function publishNow(ui) {
      const { publish, tweak, progress, actions, done } = ui;
      const meta = state.meta || {};
      publish.disabled = true;
      tweak.disabled = true;

      const say = (text) => progress.replaceChildren(el('div', { class: 'row', style: { gap: '8px' } }, [el('span', { class: 'spinner sm' }), el('span', { class: 'muted small', text })]));
      const fail = (message, again) => {
        const retry = el('button', { class: 'btn ghost sm', type: 'button' }, t('gbRetry'));
        retry.addEventListener('click', again);
        progress.replaceChildren(el('div', { class: 'note warn stack tight' }, [el('span', { class: 'small', text: message }), retry]));
        publish.disabled = false;
        tweak.disabled = false;
      };

      let title = String(meta.name || titleFromHtml(state.html) || '').trim();
      const subject = meta.subject || '';
      const grades = Array.isArray(meta.grades) ? meta.grades : [];

      // ١) الصورة — رسمٌ قد يبلغ دقيقتين، وعدّادٌ يقول إنه يجري
      if (!state.cover) {
        const startedAt = Date.now();
        say(t('gbCoverWorking'));
        const ticker = setInterval(() => say(t('gFormShotElapsed', { n: Math.round((Date.now() - startedAt) / 1000) })), 1000);
        try {
          const drawn = await api('/api/games/cover', { method: 'POST', body: { html: state.html, title, subject, grades } });
          const image = await fitCover(drawn.image);
          if (!alive()) return;
          state.cover = image;
          if (!title && drawn.name) title = drawn.name;
        } catch (err) {
          clearInterval(ticker);
          if (!alive()) return;
          return fail(err.message, () => publishNow(ui));
        }
        clearInterval(ticker);
      }
      if (!title) title = t('gbUntitled');

      // ٢) النشر
      say(t('gbPublishing'));
      let game;
      try {
        const res = await api('/api/games', {
          method: 'POST',
          body: {
            title,
            subject,
            grades,
            description: meta.description || '',
            keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
            cover: state.cover,
            offlineOk: true,
            html: state.html,
          },
        });
        game = res.game;
      } catch (err) {
        if (!alive()) return;
        return fail(err.message, () => publishNow(ui));
      }
      if (!alive()) return;

      // ٣) الصندوق
      state.published = game;
      progress.replaceChildren();
      actions.remove();
      done.append(publishedBox(game));
      done.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(t('gUploaded', { title: game.title }), 'ok');
    }

    /**
     * نصُّ المنشور — جاهزٌ لفيسبوك والمجموعات: ما اللعبة، لمن، من أعدّها،
     * وأين تُلعب. الرابط في آخره لأن فيسبوك وواتساب يُظهران له الصورةَ
     * المصغّرة والاسم (صفحة المشاركة `/g/:id` تحمل وسوم OG).
     */
    function postText(game, link) {
      const subject = game.subject ? tagLabel('subj', game.subject) : '';
      const grades = (game.grades || []).map((g) => tagLabel('grade', g)).join('، ');
      const lines = [
        t('gbPostHead', { title: game.title }),
        game.description ? game.description : null,
        subject || grades ? t('gbPostTags', { subject: subject || t('gbCardNoSubject'), grades: grades || t('gAllStages') }) : null,
        game.author ? t('gbPostBy', { name: game.author }) : null,
        '',
        t('gbPostPlay'),
        link,
      ];
      return lines.filter((line) => line !== null).join('\n');
    }

    /**
     * ما بعد النشر: الصورة، والرابطان (اللعبة وصفحة ألعاب المعلّم)، ونصُّ
     * المنشور مع أزرار مشاركته.
     *
     * هذه اللحظة هي أعلى ما يكون حماسُ المعلّم للعبته: بناها للتوّ ورآها
     * تعمل. فإن لم يجد طريق المشاركة هنا لم يبحث عنه لاحقاً.
     */
    function publishedBox(game) {
      const link = window.T.gameShareUrl(game.id);
      const shelf = location.origin + '/games.html#/t/' + game.authorId;
      const text = postText(game, link);

      const post = el('textarea', { class: 'chat-input', rows: 7, readonly: true, 'aria-label': t('gbPostTitle') });
      post.value = text;
      const copyPost = el('button', { class: 'btn primary sm', type: 'button' }, t('gbPostCopy'));
      copyPost.addEventListener('click', async () => {
        const ok = await window.T.copyLink(text);
        toast(ok ? t('gbPostCopied') : t('gbPostCopyFail'), ok ? 'ok' : 'bad');
      });

      return el('div', { class: 'note ok stack' }, [
        el('strong', { text: t('gbPublishedTitle', { title: game.title }) }),
        state.cover ? el('div', { class: 'cover-preview' }, [el('img', { src: state.cover, alt: game.title })]) : null,
        el('div', { class: 'stack tight' }, [
          el('span', { class: 'small', text: t('gbLinkGame') }),
          el('div', { class: 'row', style: { gap: '6px' } }, [
            el('code', { class: 'grow link-box', text: link }),
            el('a', { class: 'btn primary sm', href: '/games.html#/g/' + game.id, target: '_blank', rel: 'noopener' }, t('gOpen')),
          ]),
        ]),
        el('div', { class: 'stack tight' }, [
          el('span', { class: 'small', text: t('gbLinkShelf') }),
          el('div', { class: 'row', style: { gap: '6px' } }, [
            el('code', { class: 'grow link-box', text: shelf }),
            el('a', { class: 'btn ghost sm', href: shelf, target: '_blank', rel: 'noopener' }, t('gMine')),
          ]),
        ]),
        el('div', { class: 'stack tight' }, [
          el('strong', { class: 'small', text: t('gbPostTitle') }),
          el('span', { class: 'muted small', text: t('gbPostNote') }),
          post,
          el('div', { class: 'row', style: { gap: '6px' } }, [copyPost]),
          window.T.shareBox(link, text.replace('\n' + link, '')),
        ]),
      ]);
    }

    // ------------------------------------------------------------- الإرسال

    async function poll(jobId) {
      let misses = 0;
      while (alive()) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!alive()) return null;
        let data;
        try {
          data = await api('/api/game-ai/chat/' + jobId);
          misses = 0;
        } catch (err) {
          /*
           * انقطاعٌ عابر لا ينهي مهمّةً تجري على الخادم: نُعاود الاستطلاع —
           * إلا أن يكون الخادم قد نسي المهمّة أصلاً (٤٠٤ بعد إعادة نشرٍ أو
           * انتهاء مهلة). وكان الفحص على **نصّ** الخطأ لا حالته، ونصُّ
           * الخادم عربيٌّ بلا رقم، فكان الاستطلاع يدور إلى الأبد والزرّ مقفلاً.
           * وانقطاعٌ يطول دقيقتين يُنهى أيضاً — الدوران الصامت أسوأ من خطأ.
           */
          if (err.status === 404) throw err;
          misses += 1;
          if (misses >= 48) throw new Error(t('gbLostServer'));
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
          state.meta = data.meta || null;
          state.cover = '';
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

    /*
     * الإرسال بالزرّ وحده.
     *
     * كان Enter يرسل وShift+Enter ينزل سطراً — وهي عادة الحواسيب لا الهواتف:
     * لوحةُ الجوال ليس فيها Shift+Enter أصلاً، فمن أراد سطراً ثانياً في وصف
     * درسه أرسل رسالةً ناقصة. ووصف اللعبة نصٌّ طويل يُكتب على أسطر، لا سطرٌ
     * واحد يُرسل بضغطة. فـEnter ينزل سطراً كما في أي محرّر نصّ، والإرسال
     * بالزرّ — وهو ظاهرٌ دائماً إلى جانب الحقل.
     */
    sendBtn.addEventListener('click', send);
    resetBtn.addEventListener('click', () => {
      if (state.busy) return;
      if (state.chatId) api('/api/game-ai/chat/' + state.chatId, { method: 'DELETE' }).catch(() => {});
      state.chatId = '';
      state.messages = [];
      state.gameJob = '';
      state.html = '';
      state.truncated = false;
      state.meta = null;
      state.cover = '';
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
    /*
     * التركيز على الحقل للحاسوب وحده. على الجوال يقفز التركيزُ بالصفحة إلى
     * أسفلها ويفتح لوحة المفاتيح قبل أن يقرأ المعلّم سطراً: يهبط على حقلٍ
     * فارغ ولا يرى الإعدادات ولا الحصّة ولا الأمثلة التي فوقه.
     */
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
  }

  global.GameBuilder = { render, KNOBS, defaults, readSettings, titleFromHtml };
})(window);
