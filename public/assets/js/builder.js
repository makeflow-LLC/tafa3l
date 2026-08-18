/* محرّر الأسئلة — يعمل بالكامل في المتصفح، ويحفظ مسودة محلية للمدرب */
(function (global) {
  'use strict';

  const { el, toast, store, api, TYPE_LABELS, TYPE_EMOJI } = global.T;
  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const locale = () => (global.I18n && global.I18n.getLang() === 'en' ? 'en' : 'ar');
  /** نص القالب بلغة الواجهة — القوالب تحمل نسخة إنجليزية بجانب العربية */
  const tplText = (template, field) => (locale() === 'en' && template[field + 'En'] ? template[field + 'En'] : template[field]);

  const DRAFT_KEY = 'tafa3l:draft';
  const TYPES = ['mc', 'truefalse', 'poll', 'scale', 'word', 'open', 'blank', 'order', 'match', 'slide'];
  /** علامة الفراغ في نص السؤال */
  const BLANK_MARK = '___';

  // حالة اشتراك المدرب — يضبطها host.js بعد جلب الحساب (الصور ميزة بريميوم)
  let premiumState = null;
  function setPremium(value) {
    premiumState = value || null;
  }

  function uid() {
    return 'q_' + Math.random().toString(36).slice(2, 10);
  }

  function blankQuestion(type) {
    // timeLimit صفر دائماً: الوقت — إن وُضع — واحدٌ لكل الأسئلة في الإعدادات،
    // ورقمٌ تحت السؤال لا يقرؤه أحد إلا مُستنتِج الأنشطة القديمة فيوهمه بمؤقّت
    const q = { id: uid(), type: type || 'mc', text: '', explanation: '', timeLimit: 0, points: 1000, mark: 0, options: [], correct: [], image: null, video: '', blanks: [], items: [], pairs: [], body: '' };
    if (type === 'mc' || type === 'poll' || !type) {
      q.options = [
        { id: 'o0', text: '' },
        { id: 'o1', text: '' },
      ];
    }
    if (['poll', 'word', 'open', 'scale', 'blank'].includes(type)) q.timeLimit = 0;
    // السؤال المفتوح: صفر يعني رأياً حرّاً، وأي علامة أكبر تعني تصحيحاً يدوياً من المدرب
    if (['poll', 'word', 'open', 'scale'].includes(type)) q.points = 0;
    if (type === 'blank') {
      // أكمل الفراغ: يبدأ بفراغ واحد وعلامة واحدة، والتصحيح يدوي دائماً
      q.text = t('bBlankSample', { mark: BLANK_MARK });
      q.blanks = [''];
      q.points = 1;
    }
    if (type === 'order') {
      // الترتيب الذي تكتبه هنا هو الصحيح؛ يُخلط تلقائياً على شاشة كل طالب
      q.items = [
        { id: 'i0', text: '' },
        { id: 'i1', text: '' },
        { id: 'i2', text: '' },
      ];
      q.timeLimit = 0;
    }
    if (type === 'match') {
      q.pairs = [
        { id: 'p0', left: '', right: '' },
        { id: 'p1', left: '', right: '' },
        { id: 'p2', left: '', right: '' },
      ];
      q.timeLimit = 0;
    }
    if (type === 'slide') {
      // شريحة شرح: بلا علامة ولا مؤقّت، المدرب ينتقل حين ينتهي من الشرح
      q.points = 0;
      q.timeLimit = 0;
    }
    if (type === 'scale') q.scale = { min: 1, max: 5, minLabel: t('bdisagree'), maxLabel: t('bstronglyAgree') };
    return q;
  }

  function defaultDraft() {
    return {
      title: '',
      settings: {
        requireName: true,
        allowLateJoin: true,
        showLeaderboard: true,
        countdown: true,
        // الافتراضي حرّ: الطالب يدخل فيبدأ، ويجيب فينتقل
        pace: 'self',
        autoAdvanceSec: 6,
        // الجدولة: موعد الفتح (نص محلي من حقل datetime-local) ومدة الاختبار بالدقائق
        opensAt: '',
        dueAt: '',
        durationMinutes: 0,
        // نظام التقييم: نقاط (لعبة) أو علامات (تقييم) أو بلا تقييم
        reward: 'points',
        markMode: 'equal',
        timeMode: 'none',
        timeLimit: 30,
        scoring: 'speed',
        totalMark: 20,
        passPercent: 50,
        revealAnswer: true,
        shuffleQuestions: false,
        shuffleOptions: false,
        autoStart: true,
        autoNext: true,
        teamMode: false,
        teamCount: 4,
      },
      questions: [blankQuestion('mc')],
    };
  }

  /**
   * قراءة المسودة المحفوظة مع تنظيفها بالكامل.
   * مسودة قديمة أو ناقصة يجب ألا تُسقط المحرّر — نُكمل الناقص من الافتراضيات.
   */
  function loadDraft() {
    return sanitizeDraft(store.local.get(DRAFT_KEY, null));
  }

  function sanitizeDraft(raw) {
    const base = defaultDraft();
    if (!raw || typeof raw !== 'object') return base;

    const questions = (Array.isArray(raw.questions) ? raw.questions : [])
      .filter((question) => question && typeof question === 'object')
      .map(sanitizeQuestion);

    return {
      title: typeof raw.title === 'string' ? raw.title : '',
      settings: { ...base.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
      questions: questions.length ? questions : base.questions,
    };
  }

  function sanitizeQuestion(raw) {
    const fresh = blankQuestion(TYPES.includes(raw.type) ? raw.type : 'mc');
    const question = { ...fresh, ...raw, type: fresh.type, id: typeof raw.id === 'string' && raw.id ? raw.id : fresh.id };

    question.text = typeof raw.text === 'string' ? raw.text : '';
    question.explanation = typeof raw.explanation === 'string' ? raw.explanation : '';
    question.timeLimit = Number.isFinite(Number(raw.timeLimit)) ? Number(raw.timeLimit) : fresh.timeLimit;
    // علامة السؤال بوحدات العلامة — تُستعمل في التوزيع المخصّص
    question.mark = Number.isFinite(Number(raw.mark)) ? Math.max(0, Number(raw.mark)) : 0;
    question.points = Number.isFinite(Number(raw.points)) ? Number(raw.points) : fresh.points;
    question.pointsSet = raw.pointsSet === true;

    if (question.type === 'mc' || question.type === 'poll') {
      const options = (Array.isArray(raw.options) ? raw.options : [])
        .filter((option) => option && typeof option === 'object')
        .map((option, index) => ({ id: String(option.id || 'o' + index), text: String(option.text ?? '') }));
      question.options = options.length >= 2 ? options : fresh.options;
    } else {
      question.options = fresh.options;
    }

    question.correct = Array.isArray(raw.correct) ? raw.correct.map(String) : [];
    question.image = typeof raw.image === 'string' && raw.image.startsWith('data:image/') ? raw.image : null;
    if (question.type === 'blank') {
      const count = countBlanks(question.text);
      const saved = Array.isArray(raw.blanks) ? raw.blanks.map((b) => String(b ?? '')) : [];
      question.blanks = Array.from({ length: count }, (_, i) => saved[i] || '');
    } else {
      question.blanks = [];
    }
    question.body = question.type === 'slide' ? String(raw.body ?? '') : '';
    question.video = typeof raw.video === 'string' ? raw.video : '';
    question.items =
      question.type === 'order' && Array.isArray(raw.items)
        ? raw.items.map((it, i) => ({ id: String(it?.id || 'i' + i), text: String(it?.text ?? it ?? '') }))
        : question.type === 'order'
          ? fresh.items
          : [];
    question.pairs =
      question.type === 'match' && Array.isArray(raw.pairs)
        ? raw.pairs.map((pr, i) => ({ id: String(pr?.id || 'p' + i), left: String(pr?.left ?? ''), right: String(pr?.right ?? '') }))
        : question.type === 'match'
          ? fresh.pairs
          : [];
    if (question.type === 'scale') question.scale = { ...fresh.scale, ...(raw.scale && typeof raw.scale === 'object' ? raw.scale : {}) };

    return question;
  }

  let quotaWarned = false;

  /** كم فراغاً في نص السؤال */
  function countBlanks(text) {
    return (String(text || '').match(/_{3,}/g) || []).length;
  }

  function saveDraft(draft) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      quotaWarned = false;
    } catch {
      // صور كثيرة تتجاوز سعة المتصفح — نُخبر المدرب بدل أن تضيع مسودته صامتة
      if (!quotaWarned) {
        quotaWarned = true;
        toast(t('bbrowserStorageIsFull'), 'bad');
      }
    }
  }

  // ------------------------------------------------------ استيراد من JSON

  // ------------------------------------------------------- صورة السؤال

  const IMAGE_MAX_SIDE = 1280;
  const IMAGE_MAX_BYTES = 600 * 1024;

  /**
   * يقرأ ملف صورة ويصغّره داخل المتصفح قبل الرفع: أقصى ضلع 1280 بكسل،
   * ثم يخفض الجودة تدريجياً حتى ينزل الحجم تحت 600 كيلوبايت.
   * يعيد data URL جاهزاً للحفظ داخل السؤال.
   */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('اختر ملف صورة'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(t('bcouldNotReadThe')));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error(t('bcouldNotOpenThe')));
        img.onload = () => {
          const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          // الشفافية تضيع مع jpeg، لكنها الصيغة الوحيدة التي تضمن حجماً صغيراً للصور الفوتوغرافية
          let quality = 0.82;
          let out = canvas.toDataURL('image/jpeg', quality);
          while (out.length * 0.75 > IMAGE_MAX_BYTES && quality > 0.4) {
            quality -= 0.12;
            out = canvas.toDataURL('image/jpeg', quality);
          }
          if (out.length * 0.75 > IMAGE_MAX_BYTES) return reject(new Error(t('btheImageIsToo')));
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** أسماء بديلة شائعة تكتبها المساعدات الذكية لكل نوع */
  const TYPE_ALIASES = {
    mc: 'mc', choice: 'mc', multiplechoice: 'mc', multiple_choice: 'mc', mcq: 'mc', quiz: 'mc',
    truefalse: 'truefalse', true_false: 'truefalse', tf: 'truefalse', boolean: 'truefalse', bool: 'truefalse',
    poll: 'poll', survey: 'poll', vote: 'poll', opinion: 'poll',
    word: 'word', wordcloud: 'word', word_cloud: 'word', cloud: 'word', oneword: 'word',
    scale: 'scale', rating: 'scale', likert: 'scale', range: 'scale',
    open: 'open', text: 'open', essay: 'open', open_ended: 'open', openended: 'open', free: 'open',
    blank: 'blank', fill: 'blank', fillblank: 'blank', fill_blank: 'blank', fill_in_the_blank: 'blank', cloze: 'blank', gap: 'blank',
  };

  /**
   * تحويل JSON ملصوق إلى مسودة نشاط.
   * متسامح مع مخرجات المساعدات الذكية: أسوار ```json، خيارات كنصوص،
   * إجابة صحيحة بالنص أو الفهرس أو الحرف، وأسماء أنواع بديلة.
   * يعيد { draft, warnings } أو { error }.
   */
  function parseImport(text) {
    const warnings = [];
    let raw = String(text || '').trim();
    if (!raw) return { error: t('bpasteTheJsonFirst') };

    // إزالة أسوار الشيفرة وأي كلام قبل/بعد الكائن
    raw = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/m, '').trim();
    const start = raw.search(/[{[]/);
    if (start > 0) raw = raw.slice(start);
    const lastBrace = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (lastBrace >= 0) raw = raw.slice(0, lastBrace + 1);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return { error: t('bthatTextIsNot') + err.message };
    }

    if (Array.isArray(data)) data = { questions: data };
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) {
      return { error: t('bwrongShapeExpectedAn') };
    }
    if (data.questions.length === 0) return { error: t('btheQuestionListIs') };

    const questions = [];
    data.questions.forEach((q, i) => {
      const norm = normalizeImported(q, i, warnings);
      if (norm) questions.push(norm);
    });
    if (!questions.length) return { error: t('bnoValidQuestionWas') };

    const draft = sanitizeDraft({ title: data.title, settings: data.settings, questions });
    return { draft, warnings };
  }

  function normalizeImported(q, index, warnings) {
    if (typeof q === 'string') {
      // نص وحده = سؤال مفتوح
      return { ...blankQuestion('open'), text: q };
    }
    if (!q || typeof q !== 'object') {
      warnings.push(t('bWarnNotObject', { n: index + 1 }));
      return null;
    }

    const rawType = String(q.type || (q.options || q.choices || q.answers ? 'mc' : 'open'))
      .toLowerCase()
      .replace(/[\s-]/g, '_');
    const type = TYPE_ALIASES[rawType] || TYPE_ALIASES[rawType.replace(/_/g, '')];
    if (!type) {
      warnings.push(t('bWarnType', { n: index + 1, type: q.type }));
      return null;
    }

    const out = { ...blankQuestion(type) };
    out.text = String(q.text ?? q.question ?? q.title ?? '').trim();
    if (!out.text) {
      warnings.push(t('bWarnNoText', { n: index + 1 }));
      return null;
    }
    out.explanation = String(q.explanation ?? q.reason ?? q.why ?? '').trim();
    if (typeof q.image === 'string' && q.image.startsWith('data:image/')) out.image = q.image;
    if (type === 'blank') {
      const count = countBlanks(out.text);
      const given = Array.isArray(q.blanks) ? q.blanks.map((b) => String(b ?? '')) : [];
      out.blanks = Array.from({ length: count }, (_, i) => given[i] || '');
      if (!count) warnings.push(t('bWarnNoBlank', { n: index + 1 }));
    }
    if (Number.isFinite(Number(q.mark))) out.mark = Math.max(0, Number(q.mark));
    if (q.timeLimit != null || q.time != null || q.seconds != null) {
      const t = Number(q.timeLimit ?? q.time ?? q.seconds);
      out.timeLimit = Number.isFinite(t) ? Math.max(0, Math.round(t)) : out.timeLimit;
    }
    if (q.points != null || q.score != null || q.marks != null) {
      const p = Number(q.points ?? q.score ?? q.marks);
      out.points = Number.isFinite(p) ? Math.min(10000, Math.max(0, Math.round(p))) : out.points;
    }

    if (type === 'mc' || type === 'poll') {
      const rawOptions = q.options ?? q.choices ?? q.answers ?? [];
      out.options = (Array.isArray(rawOptions) ? rawOptions : [])
        .map((option, i) => ({
          id: 'o' + i,
          text: String(typeof option === 'object' && option !== null ? option.text ?? option.label ?? '' : option ?? '').trim(),
        }))
        .filter((option) => option.text);
      if (out.options.length < 2) {
        warnings.push(t('bWarnFewOptions', { n: index + 1 }));
        return null;
      }
      if (type === 'mc') {
        out.correct = resolveCorrect(q.correct ?? q.answer ?? q.correctAnswer ?? q.correct_answers, out.options);
        if (!out.correct.length && out.points > 0) {
          warnings.push(t('bWarnNoCorrect', { n: index + 1 }));
        }
      }
    }

    if (type === 'truefalse') {
      const c = Array.isArray(q.correct) ? q.correct[0] : q.correct ?? q.answer ?? q.correctAnswer;
      const s = String(c).trim().toLowerCase();
      if (c === true || ['true', t('btrue'), t('btrue2'), t('byes'), '1'].includes(s)) out.correct = ['true'];
      else if (c === false || ['false', t('bwrong'), t('bfalse'), t('bno'), '0'].includes(s)) out.correct = ['false'];
      else warnings.push(t('bWarnTF', { n: index + 1, value: c }));
    }

    if (type === 'scale' && q.scale && typeof q.scale === 'object') {
      out.scale = {
        min: Number(q.scale.min) || 1,
        max: Number(q.scale.max) || 5,
        minLabel: String(q.scale.minLabel ?? q.scale.min_label ?? '').trim() || t('bdisagree'),
        maxLabel: String(q.scale.maxLabel ?? q.scale.max_label ?? '').trim() || t('bstronglyAgree'),
      };
    }

    return out;
  }

  /** الإجابة الصحيحة قد تأتي كنص الخيار أو فهرسه أو حرفه أو معرّفه */
  function resolveCorrect(list, options) {
    const arr = Array.isArray(list) ? list : list === null || list === undefined ? [] : [list];
    const out = [];
    const latin = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const arabic = [t('ba'), t('bb'), t('bc'), t('be'), t('bf'), t('bh'), t('bg'), t('bd')];
    for (const item of arr) {
      if (typeof item === 'number' && options[item]) {
        out.push(options[item].id);
        continue;
      }
      const s = String(item).trim();
      const byId = options.find((o) => o.id === s);
      const byText = options.find((o) => o.text === s || o.text.trim() === s);
      let idx = latin.indexOf(s.toLowerCase());
      if (idx < 0) idx = arabic.indexOf(s);
      if (byId) out.push(byId.id);
      else if (byText) out.push(byText.id);
      else if (idx >= 0 && options[idx]) out.push(options[idx].id);
      else if (/^\d+$/.test(s) && options[Number(s)]) out.push(options[Number(s)].id);
    }
    return [...new Set(out)];
  }

  /**
   * يرسم محرر الأسئلة داخل عنصر، ويعيد كائناً فيه المسودة الحالية.
   * @param {HTMLElement} root
   * @param {(draft:object)=>void} onLaunch
   */
  /**
   * @param {{startStage?:'settings'|'questions'|'review'}} [opts]
   *   مسودةٌ صاغها المساعد الذكي جاهزةٌ للمراجعة، فلا معنى لأن يمرّ صاحبها
   *   على الإعدادات ثم على كل سؤالٍ ضغطةً ضغطة ليصل إلى زرّ الإطلاق.
   */
  /** فصول المعلّم تُجلب مرة واحدة لكل صفحة — تنقّله بين مراحل المعالج لا يعيد النداء */
  let classCache = null;

  function mount(root, onLaunch, extraActions, opts) {
    const draft = loadDraft();
    let openIndex = 0;
    // هل لوحة أنواع الأسئلة مفتوحة لإضافة سؤال جديد؟
    let adding = false;
    /** مرحلة المعالج: الإعدادات ← الأسئلة ← المراجعة */
    let stage = opts && opts.startStage && draft.questions.length ? opts.startStage : 'settings';

    function update() {
      saveDraft(draft);
      draw();
    }

    /**
     * المحرّر معالجٌ من ثلاث مراحل: الإعدادات، ثم الأسئلة سؤالاً سؤالاً، ثم
     * مراجعةٌ وإطلاق. الغرض واحد: ألّا يرى المعلّم في الشاشة إلا ما يقرّره
     * الآن. كانت الصفحة تعرض كل شيء دفعةً واحدة فتصير جداراً يُربك لا يُعين.
     */
    function draw() {
      root.innerHTML = '';
      root.append(stageBar());
      if (stage === 'settings') return drawSettings();
      if (stage === 'review') return drawReview();
      return drawQuestions();
    }

    /** شريط المراحل الثلاث — يبيّن أين هو، ويسمح بالرجوع لما أنجزه */
    function stageBar() {
      const bar2 = el('div', { class: 'wizbar' });
      const stages = [
        { id: 'settings', label: t('bStageSettings') },
        { id: 'questions', label: t('bStageQuestions') },
        { id: 'review', label: t('bStageReview') },
      ];
      stages.forEach((sg, i) => {
        const btn = el('button', { class: 'wizstep' + (sg.id === stage ? ' on' : ''), type: 'button' }, [
          el('span', { class: 'num', text: String(i + 1) }),
          el('span', { text: sg.label }),
        ]);
        btn.addEventListener('click', () => {
          // لا مراجعةَ ولا أسئلةَ بلا سؤال واحد على الأقل
          if (sg.id !== 'settings' && !draft.questions.length) return toast(t('bStageNeedQuestion'), 'bad');
          stage = sg.id;
          draw();
        });
        bar2.append(btn);
      });
      return bar2;
    }

    function drawSettings() {

      // ---- القوالب أولاً: اختيار قالب يستبدل الإعدادات، فيجب أن يسبقها
      const templatesBox = el('div', { class: 'card stack' }, [
        el('h2', { text: t('bstartFromAReady') }),
        el('div', { class: 'row', id: 'tmplRow' }, el('span', { class: 'muted small', text: t('bloading') })),
        el('div', { class: 'muted small', text: t('bchoosingATemplateReplaces') }),
      ]);
      root.append(templatesBox);
      loadTemplates(templatesBox.querySelector('#tmplRow'));

      // ---- استيراد بنك أسئلة من جدول: أسرع طريق لمعلّم أسئلته في Excel
      root.append(sheetImportCard());

      // ---- العنوان والإعدادات
      const titleInput = el('input', { maxlength: 120, placeholder: t('beGUnit3'), value: draft.title });
      titleInput.addEventListener('input', () => {
        draft.title = titleInput.value;
        saveDraft(draft);
      });

      root.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: t('bSectionInfo') }),
          el('div', {}, [el('label', { text: t('bactivityTitle') }), titleInput]),
          switchRow(t('baskForAName'), 'requireName', t('bturnItOffFor')),
          switchRow(t('ballowLateJoining'), 'allowLateJoin', t('bstudentsCanJoinAfter')),
          switchRow(t('bshowTheLeaderboard'), 'showLeaderboard', t('bparticipantRankingAppearsBetween')),
          switchRow(t('ba321'), 'countdown', t('beveryoneStartsTogetherOn')),
        ])
      );

      // ---- وضع التقدّم ونظام التحفيز
      // نشاطٌ قديم حُفظ بـ pace='auto' يعود الآن «مدرّباً + انتقال تلقائي»،
      // فنُوفّق المفتاح مع القيمة المخزّنة قبل الرسم كي لا يظهر مطفأً وهو عامل
      const hostPaced = draft.settings.pace === 'host' || draft.settings.pace === 'auto';
      if (draft.settings.pace === 'auto') draft.settings.autoAdvance = true;
      root.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: t('bSectionFlow') }),
          el('label', { text: t('bwhoMovesToThe') }),
          /**
           * خياران لا ثلاثة. كان «⏱️ تلقائي» وضعاً ثالثاً بجوار «المدرّب»
           * بينما هو في حقيقته **المدرّب نفسه** وقد سلّم زرّ الانتقال إلى
           * مؤقّت: كل ما عداه متطابق. وثلاثةُ خيارات على أول شاشة يقرؤها
           * المعلّم أثقل من اثنين ومفتاحٍ يظهر عند الحاجة.
           */
          choiceGroup(
            'pace',
            [
              { value: 'self', emoji: '🏃', title: t('bselfPaced'), hint: t('beveryLearnerAdvancesAt') },
              { value: 'host', emoji: '🎛️', title: t('bteacher'), hint: t('byouMoveBetweenQuestions') },
            ],
            () => update(),
            {
              read: () => (draft.settings.pace === 'auto' ? 'host' : draft.settings.pace),
              write: (value) => {
                // من ينتقل إلى «الحرّ» يترك التلقائي خلفه، والعائد إلى «المدرّب» يستعيده
                draft.settings.pace = value === 'host' && draft.settings.autoAdvance ? 'auto' : value;
              },
            }
          ),
          hostPaced
            ? switchRow(t('bAutoAdvance'), 'autoAdvance', t('bAutoAdvanceHint'), {
                defaultOn: false,
                onChange: () => {
                  draft.settings.pace = draft.settings.autoAdvance ? 'auto' : 'host';
                  update();
                },
              })
            : null,
          draft.settings.pace === 'auto' ? autoDelayRow() : null,
          draft.settings.pace === 'self'
            ? switchRow(
                t('btheLearnerStartsAs'),
                'autoStart',
                t('bnoWaitingForThe')
              )
            : null,
          draft.settings.pace === 'self'
            ? switchRow(t('bAutoNext'), 'autoNext', t('bAutoNextHint'))
            : null,
          draft.settings.pace === 'self'
            ? el('p', { class: 'muted small', style: { margin: 0 }, text: t('binSelfPacedMode') })
            : null,

          /*
           * اختيار واحد لا نظامان متوازيان. طالبٌ يرى «٤٦٠٠ نقطة» و«٢٤ من ٣٠»
           * معاً لا يعرف أيّهما نتيجته، ومعلّمٌ يرى العمودين لا يعرف أيّهما
           * ينقل إلى دفتره. فيختار المعلّم غرضه، وتُعرض له لغةُ ذلك الغرض وحدها.
           */
          el('label', { text: t('bRewardTitle'), style: { marginTop: '6px' } }),
          choiceGroup(
            'reward',
            [
              { value: 'points', emoji: '🎮', title: t('bRewardPoints'), hint: t('bRewardPointsHint') },
              { value: 'marks', emoji: '📝', title: t('bRewardMarks'), hint: t('bRewardMarksHint') },
              { value: 'none', emoji: '🕊️', title: t('bRewardNone'), hint: t('bRewardNoneHint') },
            ],
            () => update()
          ),

          // ---- تفاصيل الوضع المختار وحده
          draft.settings.reward === 'points'
            ? el('div', { class: 'stack tight' }, [
                el('label', { text: t('bscoring') }),
                choiceGroup(
                  'scoring',
                  [
                    { value: 'speed', emoji: '⚡', title: t('bbySpeed'), hint: t('bfullPointsForThe') },
                    { value: 'flat', emoji: '🎯', title: t('bflat'), hint: t('btheSamePointsFor') },
                  ],
                  () => update()
                ),
              ])
            : null,
          draft.settings.reward === 'marks' ? markRow() : null,

          // ---- النافذة الزمنية: اختيارية، ولكل الأسئلة معاً أو لكل سؤال
          el('label', { text: t('bTimeTitle'), style: { marginTop: '6px' } }),
          choiceGroup(
            'timeMode',
            [
              { value: 'none', emoji: '∞', title: t('bTimeNone'), hint: t('bTimeNoneHint') },
              { value: 'all', emoji: '⏱️', title: t('bTimeAll'), hint: t('bTimeAllHint') },
            ],
            () => update()
          ),
          draft.settings.timeMode === 'all' ? sharedTimeRow() : null,
          switchRow(
            t('bshowTheCorrectAnswer'),
            'revealAnswer',
            t('bafterAnsweringTheLearner')
          ),

          el('label', { text: t('bIntegrity'), style: { marginTop: '6px' } }),
          switchRow(t('bShuffleQuestions'), 'shuffleQuestions', t('bShuffleQuestionsHint')),
          switchRow(t('bShuffleOptions'), 'shuffleOptions', t('bShuffleOptionsHint')),

          el('label', { text: t('bteamMode'), style: { marginTop: '6px' } }),
          switchRow(t('bsplitAutomaticallyIntoTeams'), 'teamMode', t('beachParticipantIsAssigned')),
          draft.settings.teamMode ? teamCountRow() : null,

          el('label', { text: t('bscheduleAndDuration'), style: { marginTop: '6px' } }),
          scheduleRow(),

          el('label', { text: t('hClassAttach'), style: { marginTop: '6px' } }),
          rosterRow(),
        ])
      );


      root.append(
        el('div', { class: 'card row', style: { gap: '8px' } }, [
          el('span', { class: 'grow' }),
          el('button', {
            class: 'btn primary', type: 'button',
            onclick: () => {
              if (!draft.questions.length) draft.questions.push(blankQuestion('mc'));
              openIndex = 0;
              stage = 'questions';
              update();
            },
          }, t('bStageToQuestions')),
        ])
      );
    }

    function drawQuestions() {
      /**
       * الأسئلة كمعالج: سؤالٌ واحد على الشاشة، وتنقّلٌ بين الأسئلة.
       *
       * كانت كل الأسئلة تُعرض معاً (مطويّةً إلا واحدة)، فصفحةٌ فيها عشرون
       * سؤالاً تصير جداراً من البطاقات يضيع فيه المعلّم. صار كل سؤال بمنزلة
       * صفحة: يكتبه، ثم «التالي»، ثم الذي بعده.
       */
      const total = draft.questions.length;
      if (openIndex < 0 || openIndex >= total) openIndex = Math.max(0, Math.min(openIndex, total - 1));

      const page = el('div', { class: 'stack' });

      // شريط التقدّم: أرقام تُنقر للقفز مباشرةً إلى سؤال بعينه
      const steps = el('div', { class: 'qsteps' });
      draft.questions.forEach((q, i) => {
        const dot = el('button', {
          class: 'qstep' + (i === openIndex ? ' on' : '') + (q.text && q.text.trim() ? ' done' : ''),
          type: 'button',
          title: q.text || TYPE_LABELS[q.type],
        }, String(i + 1));
        dot.addEventListener('click', () => {
          openIndex = i;
          draw();
        });
        steps.append(dot);
      });

      if (total) {
        page.append(
          el('div', { class: 'row between' }, [
            el('strong', { text: t('bStepOf', { i: openIndex + 1, n: total }) }),
            el('span', { class: 'muted small', text: TYPE_EMOJI[draft.questions[openIndex].type] + ' ' + TYPE_LABELS[draft.questions[openIndex].type] }),
          ])
        );
        page.append(steps);
        page.append(questionCard(draft.questions[openIndex], openIndex));

        // التنقّل: السابق والتالي، وعلى آخر سؤال يصير «التالي» إضافةَ سؤال
        // «السابق» من أول سؤال يرجع إلى الإعدادات لا إلى فراغ
        const prev = el('button', { class: 'btn ghost', type: 'button' }, openIndex === 0 ? t('bStageBackSettings') : t('bStepPrev'));
        prev.addEventListener('click', () => {
          if (openIndex === 0) {
            stage = 'settings';
            draw();
            return;
          }
          openIndex -= 1;
          draw();
        });

        const addBtn = el('button', { class: 'btn ghost', type: 'button' }, t('bStepAdd'));
        addBtn.addEventListener('click', () => {
          adding = true;
          draw();
        });

        // على آخر سؤال: إمّا سؤالٌ جديد وإمّا المراجعة والإطلاق
        const next = el('button', { class: 'btn primary', type: 'button' }, openIndex + 1 < total ? t('bStepNext') : t('bStageToReview'));
        next.addEventListener('click', () => {
          if (openIndex + 1 < total) {
            openIndex += 1;
            draw();
            return;
          }
          stage = 'review';
          draw();
        });
        page.append(
          el('div', { class: 'row', style: { gap: '8px', marginTop: '4px' } }, [
            prev,
            el('span', { class: 'grow' }),
            openIndex + 1 === total ? addBtn : null,
            next,
          ].filter(Boolean))
        );
      }

      // لوحة الأنواع: تظهر عند طلب سؤال جديد أو حين لا سؤال بعد
      if (adding || !total) {
        page.append(el('label', { text: t('baddANewQuestion'), style: { marginTop: '4px' } }));
        page.append(
          el('div', { class: 'types' }, TYPES.map((type) =>
            el(
              'button',
              {
                class: 'type-btn',
                type: 'button',
                onclick: () => {
                  draft.questions.push(blankQuestion(type));
                  openIndex = draft.questions.length - 1;
                  adding = false;
                  update();
                },
              },
              [el('span', { class: 'em', text: TYPE_EMOJI[type] }), el('span', { text: '+ ' + TYPE_LABELS[type] })]
            )
          ))
        );
        if (total) {
          page.append(
            el('button', {
              class: 'btn ghost sm', type: 'button',
              onclick: () => {
                adding = false;
                draw();
              },
            }, t('bStepCancelAdd'))
          );
        }
        page.append(el('label', { text: t('bReuseTitle'), style: { marginTop: '10px' } }));
        page.append(el('div', { id: 'reuseRow' }));
      }

      root.append(
        el('div', { class: 'card stack' }, [
          el('div', { class: 'row between' }, [
            el('h2', { text: t('bQuestionsSection'), style: { margin: 0 } }),
            total ? el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { adding = true; draw(); } }, t('bStepAdd')) : null,
          ]),
          page,
        ])
      );
      if (root.querySelector('#reuseRow')) reuseRow(root.querySelector('#reuseRow'));

    }

    /**
     * المراجعة: كل الأسئلة في نظرة واحدة قبل الإطلاق — والنقر على أيٍّ منها
     * يعيد المعلّم إلى صفحته لتعديله.
     */
    /** ورقة أسئلة للطلاب ومفتاح إجابات للمعلّم، من المسودة نفسها لا من نسخةٍ ثانية */
    function printPaper() {
      if (!draft.questions.length) return toast(t('bPaperEmpty'), 'bad');
      if (!global.Exporter.toPaper(draft, { teacher: (opts && opts.teacherName) || '' })) toast(t('bPaperBlocked'), 'warn');
    }

    function drawReview() {
      const rows = el('div', { class: 'stack tight' });
      draft.questions.forEach((q, i) => {
        const row = el('button', { class: 'review-row', type: 'button' }, [
          el('span', { class: 'n', text: String(i + 1) }),
          el('span', { class: 'grow stack tight', style: { textAlign: 'start' } }, [
            el('strong', { text: q.text || t('bStageEmptyQuestion') }),
            el('span', { class: 'muted small', text: TYPE_EMOJI[q.type] + ' ' + TYPE_LABELS[q.type] }),
          ]),
          el('span', { class: 'badge', text: t('bStageEdit') }),
        ]);
        if (!q.text || !q.text.trim()) row.classList.add('warn');
        row.addEventListener('click', () => {
          openIndex = i;
          stage = 'questions';
          draw();
        });
        rows.append(row);
      });

      const counted = countedQuestions(draft);
      const sum = Math.round(markSum(draft) * 100) / 100;
      const total = Number(draft.settings.totalMark) || 0;
      const markOff =
        draft.settings.reward === 'marks' && (draft.settings.markMode || 'equal') === 'custom' && counted.length && Math.abs(sum - total) >= 0.01;

      root.append(
        el('div', { class: 'card stack' }, [
          el('div', { class: 'row between' }, [
            el('h2', { text: t('bStageReviewTitle', { n: draft.questions.length }), style: { margin: 0 } }),
            el('button', { class: 'btn ghost sm', type: 'button', onclick: () => { stage = 'settings'; draw(); } }, t('bStageBackSettings')),
          ]),
          rows,
          markOff ? el('div', { class: 'note warn small', style: { margin: 0 } }, t('bMarkSumOff', { sum, total })) : null,
          el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => {
              openIndex = Math.max(0, draft.questions.length - 1);
              adding = true;
              stage = 'questions';
              draw();
            },
          }, t('bStepAdd')),
          /**
           * النسخة الورقية هنا لا في مكانٍ آخر: هذه لحظةُ «أسئلتي جاهزة»
           * بالضبط، وهي نفسها لحظةُ من يريد ورقةً لصفٍّ بلا جوالات أو
           * لطالبٍ غاب. ووضعُها بعد الإطلاق يعني أنه لن يجدها.
           */
          el('div', { class: 'row between', style: { gap: '10px', marginTop: '4px' } }, [
            el('span', { class: 'muted small grow', text: t('bPaperHint') }),
            el('button', { class: 'btn ghost sm', type: 'button', onclick: printPaper }, t('bPaperPrint')),
          ]),
        ])
      );

      // ---- الإطلاق
      const launch = el('button', { class: 'btn accent block' }, t('bstartTheSessionAnd'));
      launch.addEventListener('click', () => {
        const problem = validate(draft);
        if (problem) return toast(problem, 'bad');
        launch.disabled = true;
        launch.textContent = t('bcreating');
        Promise.resolve(onLaunch(draft)).finally(() => {
          launch.disabled = false;
          launch.textContent = t('bstartTheSessionAnd');
        });
      });

      root.append(
        el('div', { class: 'card stack' }, [
          launch,
          // أزرار إضافية من صفحة المدرب (مثل الحفظ في الحساب)
          ...(typeof extraActions === 'function' ? [extraActions(draft, validate)] : []).filter(Boolean),
          // لغة النشاط تُثبَّت وقت الإطلاق على لغة اللوحة، فليعرف المعلّم ذلك قبل الضغط
          el('p', { class: 'muted small center', style: { margin: 0 }, text: t('blangNote') }),
          el('p', { class: 'muted small center', style: { margin: 0 }, text: t('bstorageIsTemporaryThe') }),
          el(
            'button',
            {
              class: 'btn ghost sm',
              type: 'button',
              onclick: () => {
                if (!confirm(t('bclearTheDraftAnd'))) return;
                Object.assign(draft, defaultDraft());
                openIndex = 0;
                update();
              },
            },
            t('bclearTheDraft')
          ),
        ])
      );
    }

    /**
     * استيراد من جدول. المعلّم الذي يملك بنك أسئلة في Excel لن يعيد كتابته
     * يدوياً — إما ننقله له في دقيقة أو يبقى حيث هو. يقبل ملفاً أو لصقاً
     * مباشراً من الجدول (اللصق من Excel يصل مفصولاً بتبويب).
     */
    function sheetImportCard() {
      const card = el('div', { class: 'card stack' });
      const panel = el('div', { class: 'stack', hidden: true });
      const result = el('div', { class: 'stack tight' });

      const toggle = el('button', { class: 'btn ghost sm', type: 'button' }, t('iOpen'));
      toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        toggle.textContent = panel.hidden ? t('iOpen') : t('iClose');
      });

      const file = el('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values' });
      const area = el('textarea', {
        rows: 4,
        placeholder: t('iPastePlaceholder'),
        style: { fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' },
      });

      const sample = el('button', { class: 'btn ghost sm', type: 'button' }, t('iTemplate'));
      sample.addEventListener('click', () => {
        const blob = new Blob([global.SheetImport.templateCsv()], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: 'tapio-template.csv' });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      });

      /** يعرض ما فُهم من الجدول قبل أي تغيير على المسودة */
      function preview(text) {
        result.innerHTML = '';
        const parsed = global.SheetImport.parse(text);
        if (!parsed.questions.length) {
          result.append(el('div', { class: 'note warn small', text: parsed.warnings[0] || t('iNothingFound') }));
          return;
        }
        result.append(
          el('p', { class: 'small', style: { margin: 0 }, text: t('iFound', { n: parsed.questions.length }) })
        );
        result.append(
          el(
            'div',
            { class: 'stack tight' },
            parsed.questions.slice(0, 6).map((q, i) =>
              el('div', { class: 'q-preview' }, [
                el('span', { class: 'badge', text: `${TYPE_EMOJI[q.type] || '❓'} ${TYPE_LABELS[q.type] || q.type}` }),
                el('div', { class: 'grow stack tight' }, [
                  el('strong', { text: `${i + 1}. ${q.text}` }),
                  (q.options || []).length
                    ? el('span', { class: 'muted small', text: (q.options || []).join(' · ') + (q.correct?.length ? '  ✅ ' + q.correct.join(t('listSep')) : '') })
                    : null,
                ]),
              ])
            )
          )
        );
        if (parsed.questions.length > 6) {
          result.append(el('p', { class: 'muted small', style: { margin: 0 }, text: t('iAndMore', { n: parsed.questions.length - 6 }) }));
        }
        if (parsed.warnings.length) {
          result.append(
            el('div', { class: 'note warn stack tight' }, [
              el('strong', { text: t('iNotes') }),
              ...[...new Set(parsed.warnings)].slice(0, 4).map((w) => el('span', { class: 'small', text: '• ' + w })),
            ])
          );
        }

        const add = el('button', { class: 'btn accent', type: 'button' }, t('iAppend', { n: parsed.questions.length }));
        add.addEventListener('click', () => {
          const imported = parsed.questions.map((raw) => {
            const q = blankQuestion(raw.type);
            q.text = raw.text;
            if (raw.explanation) q.explanation = raw.explanation;
            if (raw.points !== undefined) {
              q.points = raw.points;
              q.pointsSet = true;
            }
            if (raw.timeLimit !== undefined) q.timeLimit = raw.timeLimit;
            if (raw.options) {
              q.options = raw.options.map((text, i) => ({ id: 'o' + i, text }));
              q.correct = (raw.correct || []).map((textValue) => q.options.find((o) => o.text === textValue)?.id).filter(Boolean);
            } else if (raw.correct) {
              q.correct = raw.correct.slice();
            }
            if (raw.blanks) q.blanks = raw.blanks.slice();
            return q;
          });
          // نُلحق ولا نستبدل: المعلّم قد يستورد دفعتين من ملفين
          draft.questions = draft.questions.filter((q) => String(q.text || '').trim()).concat(imported);
          openIndex = draft.questions.length - imported.length;
          update();
          toast(t('iImported', { n: imported.length }), 'ok');
        });
        result.append(add);
      }

      file.addEventListener('change', () => {
        const chosen = file.files && file.files[0];
        if (!chosen) return;
        const reader = new FileReader();
        reader.onload = () => preview(String(reader.result || ''));
        reader.onerror = () => toast(t('iReadFailed'), 'bad');
        reader.readAsText(chosen, 'utf-8');
      });
      area.addEventListener('input', () => {
        if (area.value.trim().length > 20) preview(area.value);
      });

      panel.append(
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('iHint') }),
        file,
        el('p', { class: 'muted small center', style: { margin: 0 }, text: t('iOrPaste') }),
        area,
        el('div', { class: 'row', style: { gap: '6px' } }, [sample]),
        result
      );

      card.append(
        el('div', { class: 'row between' }, [el('h2', { style: { margin: 0 }, text: t('iTitle') }), toggle]),
        panel
      );
      return card;
    }

    /** مجموعة خيارات على شكل بطاقات (وضع التقدّم، احتساب النقاط) */
    /**
     * @param {{read?:() => string, write?:(v:string) => void}} [io]
     *   لفصل ما يراه المعلّم عمّا يُخزَّن: «تلقائي» مثلاً قيمةُ `pace` عند
     *   الخادم لكنه عند المعلّم مفتاحٌ داخل وضع المدرّب لا خياراً ثالثاً.
     */
    function choiceGroup(key, options, onPick, io) {
      const read = io?.read || (() => draft.settings[key]);
      const write = io?.write || ((value) => { draft.settings[key] = value; });
      const group = el('div', { class: 'types' });
      options.forEach((option) => {
        const on = (read() || options[0].value) === option.value;
        const button = el('button', { class: 'type-btn' + (on ? ' on' : ''), type: 'button', title: option.hint }, [
          el('span', { class: 'em', text: option.emoji }),
          el('span', { text: option.title }),
        ]);
        button.addEventListener('click', () => {
          write(option.value);
          saveDraft(draft);
          onPick?.();
        });
        group.append(button);
      });
      const current = options.find((option) => option.value === (read() || options[0].value));
      return el('div', {}, [group, el('div', { class: 'muted small', style: { marginTop: '6px' }, text: current ? current.hint : '' })]);
    }

    function autoDelayRow() {
      const select = el('select', {}, [3, 5, 6, 8, 10, 15].map((sec) => el('option', { value: String(sec) }, sec + t('bseconds'))));
      select.value = String(draft.settings.autoAdvanceSec || 6);
      select.addEventListener('change', () => {
        draft.settings.autoAdvanceSec = Number(select.value);
        saveDraft(draft);
      });
      return el('div', {}, [el('label', { text: t('bhowLongResultsStay') }), select]);
    }

    function teamCountRow() {
      const select = el('select', {}, [2, 3, 4, 5, 6, 7, 8].map((n) => el('option', { value: String(n) }, n + t('bteams'))));
      select.value = String(draft.settings.teamCount || 4);
      select.addEventListener('change', () => {
        draft.settings.teamCount = Number(select.value);
        saveDraft(draft);
      });
      return el('div', {}, [el('label', { text: t('bnumberOfTeams') }), select]);
    }

    /**
     * العلامة الكاملة: «هذا الاختبار من ٣٠».
     *
     * أزرار سريعة للقيم الشائعة لأن المعلّم يختار واحدة منها في ٩٥٪ من
     * الحالات، وحقل حرّ لمن أراد غيرها. ونعرض له فوراً كم سؤالاً يدخل في
     * العلامة — فسؤالٌ علامته صفر أو استطلاعٌ لا يُحاسَب عليه أحد.
     */
    /** مجموع علامات الأسئلة المحتسبة — يقارنه المعلّم بالعلامة الكاملة */
    function markSum(d) {
      return countedQuestions(d).reduce((n, q) => n + (Number(q.mark) || 0), 0);
    }

    /** الأسئلة التي تدخل في العلامة — استطلاعٌ أو شريحةٌ لا يُحاسَب عليها أحد */
    function countedQuestions(d) {
      return d.questions.filter(
        (q) => Number(q.points) > 0 && q.type !== 'poll' && q.type !== 'word' && q.type !== 'scale' && q.type !== 'slide'
      );
    }

    /** ثوانٍ واحدة لكل الأسئلة */
    function sharedTimeRow() {
      const box = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
      [15, 20, 30, 45, 60, 90].forEach((secs) => {
        const on = Number(draft.settings.timeLimit) === secs;
        const chip = el('button', { class: 'chip' + (on ? ' on' : ''), type: 'button' }, t('bSeconds', { n: secs }));
        chip.addEventListener('click', () => {
          draft.settings.timeLimit = secs;
          saveDraft(draft);
          update();
        });
        box.append(chip);
      });
      const free = el('input', {
        type: 'number', min: 5, max: 600, step: 5, inputmode: 'numeric',
        value: String(draft.settings.timeLimit || 30), style: { maxWidth: '110px' },
      });
      free.addEventListener('input', () => {
        const v = Number(free.value);
        draft.settings.timeLimit = Number.isFinite(v) ? Math.min(600, Math.max(5, Math.round(v))) : 30;
        saveDraft(draft);
      });
      box.append(free);
      return box;
    }

    function markRow() {
      const box = el('div', { class: 'stack tight' });

      const draw = () => {
        box.innerHTML = '';
        const total = Number(draft.settings.totalMark) || 0;
        const counted = draft.questions.filter(
          (q) => Number(q.points) > 0 && q.type !== 'poll' && q.type !== 'word' && q.type !== 'scale' && q.type !== 'slide'
        ).length;

        const chips = el('div', { class: 'row', style: { gap: '6px' } });
        [5, 10, 20, 30, 50, 100].forEach((value) => {
          const btn = el('button', { class: 'btn sm' + (total === value ? ' primary' : ' ghost'), type: 'button' }, String(value));
          btn.addEventListener('click', () => {
            draft.settings.totalMark = value;
            saveDraft(draft);
            draw();
          });
          chips.append(btn);
        });

        const custom = el('input', {
          type: 'number',
          min: 1,
          max: 1000,
          step: 1,
          inputmode: 'numeric',
          value: String(total),
          style: { maxWidth: '110px' },
        });
        custom.addEventListener('input', () => {
          const value = Number(custom.value);
          draft.settings.totalMark = Number.isFinite(value) ? Math.min(1000, Math.max(1, Math.round(value))) : 20;
          saveDraft(draft);
        });
        custom.addEventListener('change', draw);

        const pass = el('input', {
          type: 'number',
          min: 1,
          max: 100,
          step: 5,
          inputmode: 'numeric',
          value: String(draft.settings.passPercent ?? 50),
          style: { maxWidth: '110px' },
        });
        pass.addEventListener('input', () => {
          const value = Number(pass.value);
          draft.settings.passPercent = Number.isFinite(value) ? Math.min(100, Math.max(1, Math.round(value))) : 50;
          saveDraft(draft);
        });

        box.append(chips);
        box.append(
          el('div', { class: 'row', style: { gap: '10px' } }, [
            el('label', {}, [el('span', { class: 'small', text: t('bMarkCustom') }), custom]),
            el('label', {}, [el('span', { class: 'small', text: t('bMarkPass') }), pass]),
          ])
        );

        /**
         * كيف تتوزّع العلامة: بالتساوي على الأسئلة، أو رقمٌ لكل سؤال يكتبه
         * المعلّم ومجموعه يجب أن يساوي العلامة الكاملة قبل الإطلاق.
         */
        const modeRow = el('div', { class: 'chips' });
        [
          { value: 'equal', label: t('bMarkEqual') },
          { value: 'custom', label: t('bMarkPerQuestion') },
        ].forEach((opt) => {
          const on = (draft.settings.markMode || 'equal') === opt.value;
          const chip = el('button', { class: 'chip' + (on ? ' on' : ''), type: 'button' }, opt.label);
          chip.addEventListener('click', () => {
            draft.settings.markMode = opt.value;
            saveDraft(draft);
            update();
          });
          modeRow.append(chip);
        });
        box.append(el('span', { class: 'small', text: t('bMarkSplit') }));
        box.append(modeRow);

        if ((draft.settings.markMode || 'equal') === 'custom') {
          const sum = Math.round(markSum(draft) * 100) / 100;
          const okSum = counted > 0 && Math.abs(sum - total) < 0.01;
          box.append(
            el('div', { class: 'note ' + (okSum ? 'ok' : 'warn') + ' small', style: { margin: 0 } }, [
              okSum ? t('bMarkSumOk', { sum, total }) : t('bMarkSumOff', { sum, total }),
            ])
          );
        } else {
          box.append(
            el('div', { class: 'muted small' }, [
              counted ? t('bMarkEach', { each: Math.round((total / counted) * 100) / 100, n: counted }) : t('bMarkNoQuestions'),
            ])
          );
        }

        box.append(
          el('div', { class: 'muted small' }, [
            counted
              ? t('bMarkHint', { total, n: counted, pass: Math.round(((total * (draft.settings.passPercent ?? 50)) / 100) * 10) / 10 })
              : t('bMarkNoQuestions'),
          ])
        );
      };

      draw();
      return box;
    }

    /**
     * إرفاق فصل: تُنسخ أسماؤه في `settings.roster` **نسخاً** لا إشارةً.
     * ولو أشرنا إليه بمعرّفه لتغيّر كشف نشاطٍ أُطلق الأسبوع الماضي بمجرّد
     * أن يعدّل المعلّم فصله اليوم — والنشاط سجلٌّ لما كان لا لما صار.
     */
    function rosterRow() {
      const select = el('select', {});
      const hint = el('div', { class: 'muted small', style: { marginTop: '4px' } });
      const attached = draft.settings.roster || [];
      select.append(el('option', { value: '' }, t('hClassNone')));

      const paint = () => {
        hint.textContent = attached.length ? t('hClassCount', { n: attached.length }) + ' · ' + attached.slice(0, 4).join('، ') + (attached.length > 4 ? '…' : '') : '';
      };
      paint();

      select.addEventListener('change', () => {
        const found = (classCache || []).find((c) => c.id === select.value);
        draft.settings.roster = found ? found.students.slice() : [];
        saveDraft(draft);
        update();
      });

      // القائمة تُجلب مرة واحدة وتُخزَّن، فتنقُّلُ المعلّم بين المراحل لا يعيد النداء
      const fill = (items) => {
        items.forEach((item) => select.append(el('option', { value: item.id }, `${item.name} (${item.students.length})`)));
        // المرفق حالياً: نطابق بالأسماء لأن المحفوظ نسخةٌ لا معرّف
        const same = items.find((item) => item.students.length === attached.length && item.students.every((n, i) => n === attached[i]));
        if (same) select.value = same.id;
      };
      if (classCache) fill(classCache);
      else {
        api('/api/classes')
          .then((data) => {
            classCache = data.classes || [];
            if (select.isConnected) fill(classCache);
          })
          .catch(() => { classCache = []; });
      }

      return el('div', {}, [select, hint]);
    }

    /**
     * جدولة الاختبار: موعد الفتح ومدته. الموعد يُكتب بتوقيت جهاز المدرب
     * (datetime-local) ويُحوَّل إلى طابع زمني عند الإطلاق.
     */
    function scheduleRow() {
      const when = el('input', { type: 'datetime-local', value: draft.settings.opensAt || '' });
      /**
       * موعد التسليم — وهو ما يحوّل الرابط من جلسةٍ حيّة إلى **واجب**.
       * غيرُ «مدة الاختبار»: تلك تبدأ من لحظة انطلاق الجلسة فتصلح لحصةٍ في
       * قاعة، وهذا موعدٌ مطلق لا علاقة له بمتى فتح أولُ طالبٍ الرابط.
       */
      const due = el('input', { type: 'datetime-local', value: draft.settings.dueAt || '' });
      const minutes = el('input', {
        type: 'number',
        min: 0,
        max: 720,
        step: 5,
        inputmode: 'numeric',
        value: String(draft.settings.durationMinutes || 0),
      });
      const hint = el('div', { class: 'muted small', style: { marginTop: '4px' } });

      const paint = () => {
        const parts = [];
        if (draft.settings.opensAt) {
          const stamp = Date.parse(draft.settings.opensAt);
          parts.push(
            Number.isFinite(stamp)
              ? t('bOpensOn', { when: new Date(stamp).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) })
              : t('bdateNotUnderstood')
          );
        } else {
          parts.push(t('bnoScheduleItStarts'));
        }
        parts.push(
          draft.settings.durationMinutes > 0
            ? t('bClosesAfter', { n: draft.settings.durationMinutes })
            : t('bandNoOverallTime')
        );
        if (draft.settings.dueAt) {
          const stamp = Date.parse(draft.settings.dueAt);
          parts.push(
            Number.isFinite(stamp)
              ? t('bDueOn', { when: new Date(stamp).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) })
              : t('bdateNotUnderstood')
          );
        }
        hint.textContent = parts.join(' · ');
      };

      when.addEventListener('input', () => {
        draft.settings.opensAt = when.value;
        paint();
        saveDraft(draft);
      });
      due.addEventListener('input', () => {
        draft.settings.dueAt = due.value;
        paint();
        saveDraft(draft);
      });
      minutes.addEventListener('input', () => {
        const value = Number(minutes.value);
        draft.settings.durationMinutes = Number.isFinite(value) ? Math.min(720, Math.max(0, Math.round(value))) : 0;
        paint();
        saveDraft(draft);
      });
      paint();

      const presets = el('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } },
        [0, 10, 20, 30, 45, 60].map((value) =>
          el(
            'button',
            {
              class: 'btn sm ghost',
              type: 'button',
              onclick: () => {
                draft.settings.durationMinutes = value;
                minutes.value = String(value);
                paint();
                saveDraft(draft);
              },
            },
            value === 0 ? t('bnoLimit') : value + t('bmin')
          )
        )
      );

      const clear = el(
        'button',
        {
          class: 'btn sm ghost',
          type: 'button',
          onclick: () => {
            draft.settings.opensAt = '';
            when.value = '';
            paint();
            saveDraft(draft);
          },
        },
        t('bclearTheSchedule')
      );

      const dueClear = el('button', { class: 'btn sm ghost', type: 'button' }, t('bDueClear'));
      dueClear.addEventListener('click', () => {
        draft.settings.dueAt = '';
        due.value = '';
        paint();
        saveDraft(draft);
      });

      // اختصارات: أكثر الواجبات «غداً» أو «آخر الأسبوع»، وكتابتها بالتقويم كل مرة عناء
      const dueSoon = el('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } },
        [
          { key: 'bDueTomorrow', days: 1 },
          { key: 'bDue3Days', days: 3 },
          { key: 'bDueWeek', days: 7 },
        ].map(({ key, days }) =>
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
            const at = new Date();
            at.setDate(at.getDate() + days);
            at.setHours(23, 59, 0, 0);
            // datetime-local يقرأ التوقيت المحلي بلا منطقة، فنطرح الإزاحة قبل القصّ
            draft.settings.dueAt = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            due.value = draft.settings.dueAt;
            paint();
            saveDraft(draft);
          } }, t(key))
        )
      );

      return el('div', { class: 'stack tight' }, [
        el('div', { class: 'grid two' }, [
          el('div', {}, [el('label', { text: t('bquizOpeningTimeOptional') }), when, el('div', { class: 'row', style: { marginTop: '6px' } }, [clear])]),
          el('div', {}, [el('label', { text: t('bquizDurationInMinutes') }), minutes, presets]),
        ]),
        el('div', {}, [
          el('label', { text: t('bDueLabel') }),
          due,
          el('div', { class: 'muted small', style: { marginTop: '4px' }, text: t('bDueHint') }),
          el('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, [dueSoon, dueClear]),
        ]),
        hint,
      ]);
    }

    /**
     * @param {{defaultOn?:boolean, onChange?:() => void}} [opts]
     *   `defaultOn:false` لمفتاحٍ الأصل فيه الإطفاء — وأكثر المفاتيح هنا
     *   عكسه، فلو تُرك على الافتراض العام لظهر مُشغّلاً بلا أن يطلبه أحد.
     */
    function switchRow(label, key, hint, opts) {
      const input = el('input', { type: 'checkbox' });
      input.checked = opts?.defaultOn === false ? draft.settings[key] === true : draft.settings[key] !== false;
      input.addEventListener('change', () => {
        draft.settings[key] = input.checked;
        if (opts?.onChange) return opts.onChange();
        // بعض المفاتيح تُظهر أو تُخفي عناصر إعداد أخرى (مثل عدد الفرق) فيجب إعادة الرسم
        update();
      });
      return el('label', { class: 'switch' }, [
        el('span', { class: 'grow' }, [el('span', { text: label }), el('div', { class: 'muted small', text: hint })]),
        input,
      ]);
    }

    function questionCard(question, index) {
      const open = index === openIndex;
      const card = el('div', { class: 'qitem' });

      const head = el('div', { class: 'qhead' }, [
        el('span', { class: 'n', text: String(index + 1) }),
        el('span', { class: 't', text: question.text || TYPE_LABELS[question.type] }),
        el('span', { class: 'badge', text: TYPE_EMOJI[question.type] }),
      ]);
      // في وضع المعالج السؤال المعروض مفتوح دائماً — لا طيّ ولا فراغ
      head.style.cursor = 'default';
      card.append(head);
      if (!open) return card;

      const body = el('div', { class: 'qbody' });

      // نوع السؤال
      body.append(
        el('div', {}, [
          el('label', { text: t('bquestionType') }),
          el('div', { class: 'types' }, TYPES.map((type) =>
            el(
              'button',
              {
                class: 'type-btn' + (type === question.type ? ' on' : ''),
                type: 'button',
                onclick: () => {
                  if (type === question.type) return;
                  const fresh = blankQuestion(type);
                  fresh.id = question.id;
                  fresh.text = question.text;
                  draft.questions[index] = fresh;
                  update();
                },
              },
              [el('span', { class: 'em', text: TYPE_EMOJI[type] }), el('span', { text: TYPE_LABELS[type] })]
            )
          )),
        ])
      );

      // نص السؤال
      const text = el('textarea', { maxlength: 300, placeholder: t('bwriteTheQuestionText') });
      text.value = question.text;
      text.addEventListener('input', () => {
        question.text = text.value;
        head.querySelector('.t').textContent = text.value || TYPE_LABELS[question.type];
        saveDraft(draft);
      });
      body.append(
        el('div', {}, [
          el('label', { text: question.type === 'blank' ? t('bsentenceTextPutWhere') : t('bquestionText') }),
          text,
        ])
      );

      // ---- أكمل الفراغ: الإجابات المتوقعة تساعدك أثناء التصحيح اليدوي
      const blanksBox = el('div', { class: 'stack tight' });
      // العلامة تتبع عدد الفراغات تلقائياً ما لم يضبطها المدرب بنفسه
      let syncMarks = null;
      const drawBlanks = () => {
        if (question.type !== 'blank') return;
        blanksBox.innerHTML = '';
        const count = countBlanks(question.text);
        question.blanks = Array.from({ length: count }, (_, i) => question.blanks[i] || '');
        if (!question.pointsSet) {
          question.points = Math.max(1, count);
          if (syncMarks) syncMarks();
        }
        blanksBox.append(el('label', { text: t('bExpectedTitle', { count, word: count === 1 ? t('bBlankOne') : t('bBlankMany') }) }));
        if (!count) {
          blanksBox.append(
            el('div', { class: 'note warn small', text: t('bnoBlankInThe') })
          );
          return;
        }
        question.blanks.forEach((value, i) => {
          const input = el('input', { maxlength: 60, placeholder: t('bExpectedBlank', { n: i + 1 }), value });
          input.addEventListener('input', () => {
            question.blanks[i] = input.value;
            saveDraft(draft);
          });
          blanksBox.append(input);
        });
        blanksBox.append(
          el('div', { class: 'muted small', text: t('bshownToYouOnly') })
        );
      };
      text.addEventListener('input', drawBlanks);
      drawBlanks();
      if (question.type === 'blank') body.append(blanksBox);

      // ---- شريحة عرض: عنوان ونصّ شرح، بلا إجابة
      if (question.type === 'slide') {
        const bodyBox = el('div', { class: 'stack tight' });
        const area = el('textarea', {
          maxlength: 1200,
          rows: 5,
          placeholder: t('bSlideBodyPlaceholder'),
          value: question.body || '',
        });
        area.addEventListener('input', () => {
          question.body = area.value;
          saveDraft(draft);
        });
        bodyBox.append(el('label', { text: t('bSlideBody') }), area, el('p', { class: 'muted small', style: { margin: 0 }, text: t('bSlideHint') }));
        body.append(bodyBox);
      }

      // ---- رتّب: العناصر بترتيبها الصحيح، وتُخلط تلقائياً لكل طالب
      if (question.type === 'order') {
        const itemsBox = el('div', { class: 'stack tight' });
        const drawItems = () => {
          itemsBox.innerHTML = '';
          itemsBox.append(el('label', { text: t('bOrderTitle') }));
          itemsBox.append(el('p', { class: 'muted small', style: { margin: 0 }, text: t('bOrderHint') }));
          question.items.forEach((item, i) => {
            const input = el('input', { maxlength: 100, placeholder: t('bOrderItem', { n: i + 1 }), value: item.text });
            input.addEventListener('input', () => {
              item.text = input.value;
              saveDraft(draft);
            });
            const up = el('button', { class: 'icon-btn', type: 'button', title: t('bMoveUp'), disabled: i === 0 }, '↑');
            up.addEventListener('click', () => {
              [question.items[i - 1], question.items[i]] = [question.items[i], question.items[i - 1]];
              update();
            });
            const del = el('button', { class: 'icon-btn', type: 'button', title: t('bRemove'), disabled: question.items.length <= 2 }, '✕');
            del.addEventListener('click', () => {
              question.items.splice(i, 1);
              update();
            });
            itemsBox.append(el('div', { class: 'row', style: { gap: '6px' } }, [el('span', { class: 'badge', text: String(i + 1) }), input, up, del]));
          });
          if (question.items.length < 8) {
            const add = el('button', { class: 'btn ghost sm', type: 'button' }, t('bOrderAdd'));
            add.addEventListener('click', () => {
              question.items.push({ id: 'i' + Date.now().toString(36), text: '' });
              update();
            });
            itemsBox.append(add);
          }
        };
        drawItems();
        body.append(itemsBox);
      }

      // ---- طابِق: أزواج، واليمنى تُخلط فتصير خيارات لكل طرف أيسر
      if (question.type === 'match') {
        const pairsBox = el('div', { class: 'stack tight' });
        const drawPairs = () => {
          pairsBox.innerHTML = '';
          pairsBox.append(el('label', { text: t('bMatchTitle') }));
          pairsBox.append(el('p', { class: 'muted small', style: { margin: 0 }, text: t('bMatchHint') }));
          question.pairs.forEach((pair, i) => {
            const left = el('input', { maxlength: 100, placeholder: t('bMatchLeft', { n: i + 1 }), value: pair.left });
            const right = el('input', { maxlength: 100, placeholder: t('bMatchRight', { n: i + 1 }), value: pair.right });
            left.addEventListener('input', () => {
              pair.left = left.value;
              saveDraft(draft);
            });
            right.addEventListener('input', () => {
              pair.right = right.value;
              saveDraft(draft);
            });
            const del = el('button', { class: 'icon-btn', type: 'button', title: t('bRemove'), disabled: question.pairs.length <= 2 }, '✕');
            del.addEventListener('click', () => {
              question.pairs.splice(i, 1);
              update();
            });
            pairsBox.append(el('div', { class: 'row', style: { gap: '6px' } }, [left, el('span', { class: 'muted', text: '⟷' }), right, del]));
          });
          if (question.pairs.length < 8) {
            const add = el('button', { class: 'btn ghost sm', type: 'button' }, t('bMatchAdd'));
            add.addEventListener('click', () => {
              question.pairs.push({ id: 'p' + Date.now().toString(36), left: '', right: '' });
              update();
            });
            pairsBox.append(add);
          }
        };
        drawPairs();
        body.append(pairsBox);
      }

      // ---- فيديو يوتيوب: سطر واحد لا يزحم السؤال، ومعاينة فورية للتأكد
      const videoBox = el('div', { class: 'stack tight' });
      const drawVideo = () => {
        videoBox.innerHTML = '';
        const input = el('input', { maxlength: 300, placeholder: t('bVideoPlaceholder'), value: question.video || '' });
        const preview = el('div', { class: 'small muted' });
        const check = () => {
          const raw = String(input.value || '').trim();
          const m = /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/.exec(raw);
          const vid = m ? m[1] || m[2] : null;
          preview.textContent = !raw ? '' : vid ? t('bVideoOk') : t('bVideoBad');
          preview.style.color = !raw || vid ? '' : '#fca5a5';
        };
        input.addEventListener('input', () => {
          question.video = input.value;
          check();
          saveDraft(draft);
        });
        check();
        videoBox.append(el('label', { text: t('bVideo') }), input, preview);
      };
      drawVideo();
      body.append(videoBox);

      // ---- صورة السؤال: ميزة بريميوم، وزر واحد صغير لا يزحم كل سؤال
      const imageBox = el('div', { class: 'stack tight' });
      const drawImage = () => {
        imageBox.innerHTML = '';
        if (!premiumState?.isPremium && !question.image) {
          imageBox.append(
            el('div', { class: 'row' }, [
              el(
                'button',
                {
                  class: 'btn ghost sm',
                  type: 'button',
                  onclick: () =>
                    toast(
                      t('bImagePremium', { phone: premiumState?.plan?.whatsapp || '970597034066', price: premiumState?.plan?.priceUsd || 5 }),
                      'warn'
                    ),
                },
                t('baddAnImage')
              ),
            ])
          );
          return;
        }
        if (question.image) {
          imageBox.append(
            el('div', { class: 'img-edit' }, [
              el('img', { src: question.image, alt: t('pQuestionImage') }),
              el(
                'button',
                {
                  class: 'btn sm danger',
                  type: 'button',
                  onclick: () => {
                    question.image = null;
                    saveDraft(draft);
                    drawImage();
                  },
                },
                t('bremoveTheImage')
              ),
            ])
          );
          return;
        }
        const picker = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
        const pick = el('button', { class: 'btn ghost sm', type: 'button', onclick: () => picker.click() }, t('baddAnImage2'));
        picker.addEventListener('change', async () => {
          const file = picker.files && picker.files[0];
          if (!file) return;
          pick.disabled = true;
          pick.textContent = t('bpreparingTheImage');
          try {
            question.image = await compressImage(file);
            saveDraft(draft);
            drawImage();
          } catch (err) {
            alert(err.message || t('bcouldNotPrepareThe'));
            pick.disabled = false;
            pick.textContent = t('baddAnImage2');
          }
          picker.value = '';
        });
        imageBox.append(
          el('div', { class: 'row' }, [pick, picker, el('span', { class: 'muted small', text: t('bautomaticallyResizedSoIt') })])
        );
      };
      drawImage();
      body.append(imageBox);

      // الخيارات
      if (question.type === 'mc' || question.type === 'poll') {
        const optionsBox = el('div', { class: 'stack' });
        question.options.forEach((option, oIndex) => {
          const input = el('input', { maxlength: 120, placeholder: t('bOptionN', { n: oIndex + 1 }), value: option.text });
          input.addEventListener('input', () => {
            option.text = input.value;
            saveDraft(draft);
          });
          const row = el('div', { class: 'opt-edit' }, [input]);

          if (question.type === 'mc') {
            const mark = el(
              'button',
              {
                class: 'mark' + (question.correct.includes(option.id) ? ' on' : ''),
                type: 'button',
                title: t('bmarkAsTheCorrect'),
              },
              '✓'
            );
            mark.addEventListener('click', () => {
              const at = question.correct.indexOf(option.id);
              if (at >= 0) question.correct.splice(at, 1);
              else question.correct.push(option.id);
              mark.classList.toggle('on');
              saveDraft(draft);
            });
            row.append(mark);
          }

          if (question.options.length > 2) {
            const remove = el('button', { class: 'mark', type: 'button', title: t('bdeleteOption') }, '✕');
            remove.addEventListener('click', () => {
              question.options.splice(oIndex, 1);
              question.correct = question.correct.filter((c) => c !== option.id);
              update();
            });
            row.append(remove);
          }
          optionsBox.append(row);
        });

        if (question.options.length < 8) {
          optionsBox.append(
            el(
              'button',
              {
                class: 'btn ghost sm',
                type: 'button',
                onclick: () => {
                  question.options.push({ id: 'o' + Math.random().toString(36).slice(2, 7), text: '' });
                  update();
                },
              },
              t('baddOption')
            )
          );
        }

        body.append(
          el('div', {}, [
            el('label', {
              text: question.type === 'mc' ? t('boptionsPressForThe') : t('boptions'),
            }),
            optionsBox,
          ])
        );
      }

      if (question.type === 'truefalse') {
        const choiceBtn = (label, value) => {
          const button = el(
            'button',
            { class: 'btn sm' + (question.correct[0] === value ? ' primary' : ' ghost'), type: 'button' },
            label
          );
          button.addEventListener('click', () => {
            question.correct = [value];
            update();
          });
          return button;
        };
        const group = el('div', { class: 'row' }, [choiceBtn(t('btrue2'), 'true'), choiceBtn(t('bwrong'), 'false')]);
        body.append(el('div', {}, [el('label', { text: t('bcorrectAnswer') }), group]));
      }

      if (question.type === 'scale') {
        const min = el('input', { type: 'number', min: 0, max: 9, value: question.scale.min });
        const max = el('input', { type: 'number', min: 2, max: 10, value: question.scale.max });
        const minLabel = el('input', { maxlength: 40, value: question.scale.minLabel, placeholder: t('blabelForTheLow') });
        const maxLabel = el('input', { maxlength: 40, value: question.scale.maxLabel, placeholder: t('blabelForTheHigh') });
        [min, max, minLabel, maxLabel].forEach((input) =>
          input.addEventListener('input', () => {
            question.scale = {
              min: Number(min.value) || 1,
              max: Number(max.value) || 5,
              minLabel: minLabel.value,
              maxLabel: maxLabel.value,
            };
            saveDraft(draft);
          })
        );
        body.append(
          el('div', { class: 'grid two' }, [
            el('div', {}, [el('label', { text: t('bfrom') }), min]),
            el('div', {}, [el('label', { text: t('bto') }), max]),
            el('div', {}, [el('label', { text: t('blowLabel') }), minLabel]),
            el('div', {}, [el('label', { text: t('bhighLabel') }), maxLabel]),
          ])
        );
      }

      /**
       * لا مؤقّت تحت كل سؤال بعد اليوم: الوقت قرارٌ واحد للنشاط كلّه يُتّخذ
       * في الإعدادات. نكتفي هنا بسطرٍ يذكّر المعلّم بما اختاره.
       */
      const timeMode = draft.settings.timeMode === 'all' ? 'all' : 'none';
      const reward = draft.settings.reward || 'points';
      const timeAndPoints = el('div', { class: 'grid two' }, [
        el('div', {}, [
          el('label', { text: t('banswerTime') }),
          el('p', { class: 'muted small', style: { margin: 0 },
            text: timeMode === 'all' ? t('bTimeAllNote', { n: draft.settings.timeLimit || 30 }) : t('bTimeNoneNote') }),
        ]),
      ]);

      /**
       * علامة السؤال في وضع العلامات بتوزيعٍ مخصّص. بوحدات العلامة لا النقاط:
       * «هذا السؤال من ٣» لا «١٠٠٠ نقطة» — والمعلّم يرى المجموع في الإعدادات.
       */
      if (reward === 'marks' && (draft.settings.markMode || 'equal') === 'custom' && question.points > 0 && !['poll', 'word', 'scale', 'slide'].includes(question.type)) {
        const markInput = el('input', {
          type: 'number', min: 0, max: 1000, step: 0.5, inputmode: 'decimal',
          value: String(question.mark ?? 0),
        });
        markInput.addEventListener('input', () => {
          const v = Number(markInput.value);
          question.mark = Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : 0;
          saveDraft(draft);
          // المجموع في الإعدادات يجب أن يتحرّك مع كل رقم يكتبه
          update();
        });
        timeAndPoints.append(
          el('div', {}, [el('label', { text: t('bQuestionMark') }), markInput, el('div', { class: 'muted small', text: t('bQuestionMarkHint') })]),
        );
      }

      if (question.type === 'open' || question.type === 'blank') {
        // علامة السؤال النصّي: صفر = رأي حرّ بلا تصحيح، وأكبر من صفر = يصحّحه المدرب بنفسه
        const marks = el('input', {
          type: 'number',
          min: 0,
          max: 100,
          step: 1,
          inputmode: 'numeric',
          value: String(question.points ?? 0),
        });
        const hint = el('div', { class: 'muted small', style: { marginTop: '4px' } });
        const paintHint = () => {
          hint.textContent = question.points > 0
            ? t('bManualHint', { max: question.points })
            : t('bzeroAFreeOpinion');
        };
        marks.addEventListener('input', () => {
          const value = Number(marks.value);
          question.points = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
          question.pointsSet = true;
          paintHint();
          saveDraft(draft);
        });
        // يستدعيها محرّر الفراغات حين يتغيّر عددها
        syncMarks = () => {
          marks.value = String(question.points);
          paintHint();
        };
        paintHint();
        timeAndPoints.append(
          el('div', {}, [
            el('label', { text: t('bquestionScoreForManual') }),
            marks,
            el('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } },
              [0, 3, 5, 10].map((value) =>
                el(
                  'button',
                  {
                    class: 'btn sm ghost',
                    type: 'button',
                    onclick: () => {
                      question.points = value;
                      question.pointsSet = true;
                      marks.value = String(value);
                      paintHint();
                      saveDraft(draft);
                    },
                  },
                  value === 0 ? t('bnoScore') : String(value)
                )
              )
            ),
            hint,
          ])
        );
      }

      // النقاط لغةُ وضع النقاط وحده — وفي وضع العلامات تبقى داخلية لا تُعرض
      if (reward === 'points' && (question.type === 'mc' || question.type === 'truefalse')) {
        // علامة حرة لكل سؤال — يضع المدرب ما يشاء
        const pointsInput = el('input', {
          type: 'number',
          min: 0,
          max: 10000,
          step: 10,
          inputmode: 'numeric',
          value: String(question.points ?? 1000),
        });
        const presets = el('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } },
          [0, 500, 1000, 2000].map((value) =>
            el(
              'button',
              {
                class: 'btn sm ghost',
                type: 'button',
                onclick: () => {
                  question.points = value;
                  pointsInput.value = String(value);
                  saveDraft(draft);
                },
              },
              value === 0 ? t('bnoScore') : String(value)
            )
          )
        );
        pointsInput.addEventListener('input', () => {
          const value = Number(pointsInput.value);
          question.points = Number.isFinite(value) ? Math.min(10000, Math.max(0, Math.round(value))) : 0;
          saveDraft(draft);
        });
        timeAndPoints.append(
          el('div', {}, [el('label', { text: t('bquestionScore') }), pointsInput, presets])
        );
      }
      body.append(timeAndPoints);

      // شرح أو سبب الإجابة الصحيحة (اختياري)
      if (question.type === 'mc' || question.type === 'truefalse') {
        const explanation = el('textarea', {
          maxlength: 400,
          placeholder: t('beGAmmanHas'),
          style: { minHeight: '64px' },
        });
        explanation.value = question.explanation || '';
        explanation.addEventListener('input', () => {
          question.explanation = explanation.value;
          saveDraft(draft);
        });
        body.append(
          el('div', {}, [
            el('label', { text: t('bexplanationOfTheCorrect') }),
            explanation,
            el('div', {
              class: 'muted small',
              style: { marginTop: '4px' },
              text: t('bshownToTheLearner'),
            }),
          ])
        );
      }

      // أدوات السؤال
      body.append(
        el('div', { class: 'row' }, [
          el(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: t('bmoveUp'),
              disabled: index === 0,
              onclick: () => {
                if (index === 0) return;
                [draft.questions[index - 1], draft.questions[index]] = [draft.questions[index], draft.questions[index - 1]];
                openIndex = index - 1;
                update();
              },
            },
            '↑'
          ),
          el(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: t('bmoveDown'),
              disabled: index === draft.questions.length - 1,
              onclick: () => {
                if (index === draft.questions.length - 1) return;
                [draft.questions[index + 1], draft.questions[index]] = [draft.questions[index], draft.questions[index + 1]];
                openIndex = index + 1;
                update();
              },
            },
            '↓'
          ),
          el(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: t('bduplicateQuestion'),
              onclick: () => {
                const copy = JSON.parse(JSON.stringify(question));
                copy.id = uid();
                draft.questions.splice(index + 1, 0, copy);
                openIndex = index + 1;
                update();
              },
            },
            '⧉'
          ),
          el('span', { class: 'grow' }),
          el(
            'button',
            {
              class: 'btn danger sm',
              type: 'button',
              disabled: draft.questions.length <= 1,
              onclick: () => {
                draft.questions.splice(index, 1);
                openIndex = Math.max(0, index - 1);
                update();
              },
            },
            t('bdeleteQuestion')
          ),
        ])
      );

      card.append(body);
      return card;
    }

    /**
     * «أسئلتي السابقة»: بحثٌ في كل ما كتبه المعلّم — في أنشطته المحفوظة وفي
     * بنكه القديم معاً. حلّ محلّ قائمة البنك المسطّحة، لأن القائمة تُطيل
     * الصفحة بلا فائدة عند من له مئة سؤال، ولأن أكثر ما يبحث عنه المعلّم
     * كتبه في نشاطٍ سابق ولم يحفظه في بنكٍ لم يكن يعلم أنه سيحتاجه.
     */
    let myQuestions = null;

    function reuseRow(row) {
      row.innerHTML = '';
      const input = el('input', { type: 'search', placeholder: t('bReuseSearch'), autocomplete: 'off' });
      const results = el('div', { class: 'stack tight', style: { marginTop: '8px' } });
      row.append(input, results);

      const paint = (needle) => {
        results.innerHTML = '';
        if (myQuestions === 'anon') {
          results.append(el('a', { class: 'btn ghost sm', href: '/login.html?next=' + encodeURIComponent('/host.html#/') }, t('bsignInToUse')));
          return;
        }
        if (!myQuestions) return results.append(el('span', { class: 'muted small', text: t('bloading') }));
        if (!myQuestions.length) return results.append(el('span', { class: 'muted small', text: t('bReuseEmpty') }));
        const key = needle.trim().toLowerCase();
        const hits = (key ? myQuestions.filter((item) => String(item.question.text).toLowerCase().includes(key)) : myQuestions).slice(0, 12);
        if (!hits.length) return results.append(el('span', { class: 'muted small', text: t('bReuseNoHits') }));
        hits.forEach((item) => {
          const q = item.question;
          const add = el('button', { class: 'btn sm ghost', type: 'button', title: t('baddToThisActivity') }, t('badd'));
          add.addEventListener('click', () => {
            const copy = sanitizeQuestion({ ...q, id: uid() });
            // مسودةٌ جديدة تبدأ بسؤالٍ فارغ. لو أضفنا فوقه لخرج المعلّم بسؤالٍ
            // بلا نصّ عليه أن يحذفه بنفسه — فنحلّ محلّه ما دام لم يُكتب فيه شيء
            const only = draft.questions.length === 1 ? draft.questions[0] : null;
            const untouched = only && !String(only.text).trim() && !(only.options || []).some((o) => String(o.text).trim());
            if (untouched) draft.questions[0] = copy;
            else draft.questions.push(copy);
            openIndex = draft.questions.length - 1;
            adding = false;
            update();
          });
          results.append(
            el('div', { class: 'row between', style: { padding: '8px 0', borderBottom: '1px solid var(--border)' } }, [
              el('span', { text: TYPE_EMOJI[q.type] }),
              el('span', { class: 'grow stack tight', style: { margin: '0 8px', textAlign: 'start' } }, [
                el('span', { text: q.text || TYPE_LABELS[q.type] }),
                // من أي نشاط جاء: نصّان متشابهان يفترقان بمصدرهما
                item.from ? el('span', { class: 'muted small', text: item.from }) : null,
              ]),
              add,
            ])
          );
        });
        // البحث يقتصر على ١٢ نتيجة: قول ذلك أصدق من إيهامه بأن هذا كل ما لديه
        if (!key && myQuestions.length > 12) results.append(el('span', { class: 'muted small', text: t('bReuseMore', { n: myQuestions.length }) }));
      };

      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => paint(input.value), 150);
      });

      paint('');
      if (myQuestions === null) {
        api('/api/my-questions')
          .then((data) => { myQuestions = data.questions || []; })
          .catch(() => { myQuestions = 'anon'; })
          .then(() => row.isConnected && paint(input.value));
      }
    }

    /** القوالب محمّلة مع الصفحة (window.TEMPLATES) — لا تعتمد على الشبكة إطلاقاً */
    function loadTemplates(row) {
      const templates = global.TEMPLATES || [];
      row.innerHTML = '';
      if (!templates.length) {
        row.append(el('span', { class: 'muted small', text: t('bnoTemplates') }));
        return;
      }
      templates.forEach((template) => {
        const button = el('button', { class: 'btn sm ghost', type: 'button', title: tplText(template, 'description') }, tplText(template, 'name'));
        button.addEventListener('click', () => {
          if (!confirm(t('bReplaceTemplate', { name: tplText(template, 'name') }))) return;
          applyTemplate(template);
        });
        row.append(button);
      });
    }

    function applyTemplate(template) {
      draft.title = template.title;
      // ندمج مع الافتراضيات حتى لا ينقص القالب أي إعداد جديد
      draft.settings = { ...defaultDraft().settings, ...template.settings };
      draft.questions = template.questions.map((question) => ({
        ...blankQuestion(question.type),
        ...JSON.parse(JSON.stringify(question)),
        id: uid(),
      }));
      openIndex = 0;
      update();
    }

    draw();
    return { draft };
  }

  function validate(draft) {
    for (let i = 0; i < draft.questions.length; i++) {
      const question = draft.questions[i];
      if (!question.text.trim()) return t('bValText', { n: i + 1 });
      if (question.type === 'mc' || question.type === 'poll') {
        const filled = question.options.filter((option) => option.text.trim());
        if (filled.length < 2) return t('bValOptions', { n: i + 1 });
      }
      if (question.type === 'mc' && question.points > 0 && question.correct.length === 0) {
        return t('bValCorrect', { n: i + 1 });
      }
      if (question.type === 'truefalse' && question.points > 0 && question.correct.length === 0) {
        return t('bValCorrect2', { n: i + 1 });
      }
      if (question.type === 'order') {
        const filled = question.items.filter((it) => String(it.text || '').trim());
        if (filled.length < 2) return t('bValOrder', { n: i + 1 });
      }
      if (question.type === 'match') {
        const filled = question.pairs.filter((pr) => String(pr.left || '').trim() && String(pr.right || '').trim());
        if (filled.length < 2) return t('bValMatch', { n: i + 1 });
      }
      if (question.type === 'blank' && countBlanks(question.text) === 0) {
        return t('bValBlank', { n: i + 1 });
      }
    }
    return null;
  }

  global.Builder = { mount, loadDraft, saveDraft, defaultDraft, blankQuestion, validate, parseImport, setPremium, countBlanks, DRAFT_KEY };
})(window);
