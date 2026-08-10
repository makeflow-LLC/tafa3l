/* محرّر الأسئلة — يعمل بالكامل في المتصفح، ويحفظ مسودة محلية للمدرب */
(function (global) {
  'use strict';

  const { el, toast, store, TYPE_LABELS, TYPE_EMOJI } = global.T;

  const DRAFT_KEY = 'tafa3l:draft';
  const TYPES = ['mc', 'truefalse', 'poll', 'scale', 'word', 'open'];

  function uid() {
    return 'q_' + Math.random().toString(36).slice(2, 10);
  }

  function blankQuestion(type) {
    const q = { id: uid(), type: type || 'mc', text: '', explanation: '', timeLimit: 20, points: 1000, options: [], correct: [] };
    if (type === 'mc' || type === 'poll' || !type) {
      q.options = [
        { id: 'o0', text: '' },
        { id: 'o1', text: '' },
      ];
    }
    if (type === 'poll' || type === 'word' || type === 'open' || type === 'scale') q.timeLimit = 0;
    if (type === 'scale') q.scale = { min: 1, max: 5, minLabel: 'غير موافق', maxLabel: 'موافق تماماً' };
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
        pace: 'host',
        autoAdvanceSec: 6,
        scoring: 'speed',
        streakBonus: true,
        revealAnswer: true,
        autoStart: true,
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
    question.points = Number.isFinite(Number(raw.points)) ? Number(raw.points) : fresh.points;

    if (question.type === 'mc' || question.type === 'poll') {
      const options = (Array.isArray(raw.options) ? raw.options : [])
        .filter((option) => option && typeof option === 'object')
        .map((option, index) => ({ id: String(option.id || 'o' + index), text: String(option.text ?? '') }));
      question.options = options.length >= 2 ? options : fresh.options;
    } else {
      question.options = fresh.options;
    }

    question.correct = Array.isArray(raw.correct) ? raw.correct.map(String) : [];
    if (question.type === 'scale') question.scale = { ...fresh.scale, ...(raw.scale && typeof raw.scale === 'object' ? raw.scale : {}) };

    return question;
  }

  function saveDraft(draft) {
    store.local.set(DRAFT_KEY, draft);
  }

  // ------------------------------------------------------ استيراد من JSON

  /** أسماء بديلة شائعة تكتبها المساعدات الذكية لكل نوع */
  const TYPE_ALIASES = {
    mc: 'mc', choice: 'mc', multiplechoice: 'mc', multiple_choice: 'mc', mcq: 'mc', quiz: 'mc',
    truefalse: 'truefalse', true_false: 'truefalse', tf: 'truefalse', boolean: 'truefalse', bool: 'truefalse',
    poll: 'poll', survey: 'poll', vote: 'poll', opinion: 'poll',
    word: 'word', wordcloud: 'word', word_cloud: 'word', cloud: 'word', oneword: 'word',
    scale: 'scale', rating: 'scale', likert: 'scale', range: 'scale',
    open: 'open', text: 'open', essay: 'open', open_ended: 'open', openended: 'open', free: 'open',
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
    if (!raw) return { error: 'الصق JSON أولاً' };

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
      return { error: 'النص ليس JSON صالحاً — ' + err.message };
    }

    if (Array.isArray(data)) data = { questions: data };
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) {
      return { error: 'الشكل غير صحيح: المطلوب كائن فيه قائمة "questions" أو قائمة أسئلة مباشرة' };
    }
    if (data.questions.length === 0) return { error: 'قائمة الأسئلة فارغة' };

    const questions = [];
    data.questions.forEach((q, i) => {
      const norm = normalizeImported(q, i, warnings);
      if (norm) questions.push(norm);
    });
    if (!questions.length) return { error: 'لم يُعثر على أي سؤال صالح في القائمة' };

    const draft = sanitizeDraft({ title: data.title, settings: data.settings, questions });
    return { draft, warnings };
  }

  function normalizeImported(q, index, warnings) {
    if (typeof q === 'string') {
      // نص وحده = سؤال مفتوح
      return { ...blankQuestion('open'), text: q };
    }
    if (!q || typeof q !== 'object') {
      warnings.push(`سؤال ${index + 1}: ليس كائناً — تم تجاهله`);
      return null;
    }

    const rawType = String(q.type || (q.options || q.choices || q.answers ? 'mc' : 'open'))
      .toLowerCase()
      .replace(/[\s-]/g, '_');
    const type = TYPE_ALIASES[rawType] || TYPE_ALIASES[rawType.replace(/_/g, '')];
    if (!type) {
      warnings.push(`سؤال ${index + 1}: نوع غير معروف «${q.type}» — تم تجاهله`);
      return null;
    }

    const out = { ...blankQuestion(type) };
    out.text = String(q.text ?? q.question ?? q.title ?? '').trim();
    if (!out.text) {
      warnings.push(`سؤال ${index + 1}: بلا نص — تم تجاهله`);
      return null;
    }
    out.explanation = String(q.explanation ?? q.reason ?? q.why ?? '').trim();
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
        warnings.push(`سؤال ${index + 1}: أقل من خيارين — تم تجاهله`);
        return null;
      }
      if (type === 'mc') {
        out.correct = resolveCorrect(q.correct ?? q.answer ?? q.correctAnswer ?? q.correct_answers, out.options);
        if (!out.correct.length && out.points > 0) {
          warnings.push(`سؤال ${index + 1}: لم أتعرّف على الإجابة الصحيحة — سيُعامل كاستطلاع بلا نقاط`);
        }
      }
    }

    if (type === 'truefalse') {
      const c = Array.isArray(q.correct) ? q.correct[0] : q.correct ?? q.answer ?? q.correctAnswer;
      const s = String(c).trim().toLowerCase();
      if (c === true || ['true', 'صح', 'صحيح', 'نعم', '1'].includes(s)) out.correct = ['true'];
      else if (c === false || ['false', 'خطأ', 'خاطئ', 'لا', '0'].includes(s)) out.correct = ['false'];
      else warnings.push(`سؤال ${index + 1}: إجابة صح/خطأ غير واضحة «${c}»`);
    }

    if (type === 'scale' && q.scale && typeof q.scale === 'object') {
      out.scale = {
        min: Number(q.scale.min) || 1,
        max: Number(q.scale.max) || 5,
        minLabel: String(q.scale.minLabel ?? q.scale.min_label ?? '').trim() || 'غير موافق',
        maxLabel: String(q.scale.maxLabel ?? q.scale.max_label ?? '').trim() || 'موافق تماماً',
      };
    }

    return out;
  }

  /** الإجابة الصحيحة قد تأتي كنص الخيار أو فهرسه أو حرفه أو معرّفه */
  function resolveCorrect(list, options) {
    const arr = Array.isArray(list) ? list : list === null || list === undefined ? [] : [list];
    const out = [];
    const latin = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const arabic = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
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

  /** مثال جاهز يوضح الصيغة للمدرب وللمساعد الذكي */
  const IMPORT_EXAMPLE = {
    title: 'مراجعة الوحدة الأولى',
    settings: { pace: 'host', scoring: 'speed', streakBonus: true, revealAnswer: true },
    questions: [
      {
        type: 'mc',
        text: 'ما هي عاصمة الأردن؟',
        options: ['عمّان', 'دمشق', 'بيروت', 'القاهرة'],
        correct: ['عمّان'],
        points: 1000,
        timeLimit: 20,
        explanation: 'عمّان هي العاصمة منذ عام ١٩٢١.',
      },
      { type: 'truefalse', text: 'الماء يغلي عند ١٠٠°م عند سطح البحر.', correct: true, points: 500, timeLimit: 15 },
      { type: 'poll', text: 'أي موضوع تفضّل للمراجعة القادمة؟', options: ['الكسور', 'الهندسة', 'الجبر'] },
      { type: 'scale', text: 'ما مدى وضوح الدرس؟', scale: { min: 1, max: 5, minLabel: 'غير واضح', maxLabel: 'واضح جداً' } },
      { type: 'word', text: 'صف الدرس بكلمة واحدة' },
      { type: 'open', text: 'ما الذي تقترح تحسينه؟' },
    ],
  };

  /**
   * يرسم محرر الأسئلة داخل عنصر، ويعيد كائناً فيه المسودة الحالية.
   * @param {HTMLElement} root
   * @param {(draft:object)=>void} onLaunch
   */
  function mount(root, onLaunch) {
    const draft = loadDraft();
    let openIndex = 0;

    function update() {
      saveDraft(draft);
      draw();
    }

    function draw() {
      root.innerHTML = '';

      // ---- القوالب أولاً: اختيار قالب يستبدل الإعدادات، فيجب أن يسبقها
      const templatesBox = el('div', { class: 'card stack' }, [
        el('h2', { text: 'ابدأ من قالب جاهز (اختياري)' }),
        el('div', { class: 'row', id: 'tmplRow' }, el('span', { class: 'muted small', text: 'جارٍ التحميل…' })),
        el('div', { class: 'muted small', text: 'اختيار قالب يستبدل الإعدادات والأسئلة — اختره أولاً ثم عدّل ما تشاء.' }),
      ]);
      root.append(templatesBox);
      loadTemplates(templatesBox.querySelector('#tmplRow'));

      // ---- الاستيراد من JSON (مخرجات مساعد ذكي أو ملف جاهز)
      root.append(importCard());

      // ---- العنوان والإعدادات
      const titleInput = el('input', { maxlength: 120, placeholder: 'مثال: مراجعة الوحدة الثالثة', value: draft.title });
      titleInput.addEventListener('input', () => {
        draft.title = titleInput.value;
        saveDraft(draft);
      });

      root.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: '٢. معلومات النشاط' }),
          el('div', {}, [el('label', { text: 'عنوان النشاط' }), titleInput]),
          switchRow('طلب الاسم أو الكنية', 'requireName', 'أطفئه لاستطلاع مجهول بلا أسماء'),
          switchRow('السماح بالدخول المتأخر', 'allowLateJoin', 'يستطيع الطلاب الدخول بعد بدء النشاط'),
          switchRow('عرض لوحة الترتيب', 'showLeaderboard', 'يظهر ترتيب المشاركين بين الأسئلة'),
          switchRow('عدّاد «استعد ٣٢١»', 'countdown', 'ينطلق الجميع معاً في الأسئلة المؤقتة'),
        ])
      );

      // ---- وضع التقدّم ونظام التحفيز
      root.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: '٣. سير النشاط والتحفيز' }),
          el('label', { text: 'من ينقل إلى السؤال التالي؟' }),
          choiceGroup(
            'pace',
            [
              { value: 'host', emoji: '🎛️', title: 'المدرب', hint: 'أنت تنقل الشرائح وتتحكم بالإيقاع' },
              { value: 'auto', emoji: '⏱️', title: 'تلقائي', hint: 'الجميع معاً، وينتقل وحده بعد النتائج' },
              { value: 'self', emoji: '🏃', title: 'حر', hint: 'كل متدرب يتقدّم بسرعته الخاصة' },
            ],
            () => update()
          ),
          draft.settings.pace === 'auto' ? autoDelayRow() : null,
          draft.settings.pace === 'self'
            ? switchRow(
                'يبدأ المتدرب فور دخوله 🚀',
                'autoStart',
                'بلا انتظار المدرب — ينطلق كل متدرب بمجرد مسحه رمز QR'
              )
            : null,
          draft.settings.pace === 'self'
            ? el('p', { class: 'muted small', style: { margin: 0 }, text: 'في الوضع الحر تظهر لك لوحة تتابع فيها موقع كل متدرب ونتائجه أولاً بأول.' })
            : null,

          el('label', { text: 'احتساب النقاط', style: { marginTop: '6px' } }),
          choiceGroup(
            'scoring',
            [
              { value: 'speed', emoji: '⚡', title: 'بالسرعة', hint: 'كاملة للأسرع وتتناقص حتى النصف' },
              { value: 'flat', emoji: '🎯', title: 'ثابتة', hint: 'نفس النقاط لكل إجابة صحيحة' },
              { value: 'none', emoji: '🕊️', title: 'بلا نقاط', hint: 'تعلّم بلا منافسة ولا ترتيب' },
            ],
            () => update()
          ),
          draft.settings.scoring !== 'none'
            ? switchRow('مضاعف السلاسل 🔥', 'streakBonus', 'كل إجابة صحيحة متتالية تزيد النقاط ١٠٪ حتى ٥٠٪')
            : null,
          switchRow(
            'إظهار الإجابة الصحيحة 💡',
            'revealAnswer',
            'بعد إجابة المتدرب يرى الإجابة الصحيحة وشرحها إن كتبته'
          ),
        ])
      );

      // ---- الأسئلة
      const list = el('div', { class: 'stack' });
      draft.questions.forEach((question, index) => list.append(questionCard(question, index)));

      root.append(
        el('div', { class: 'card stack' }, [
          el('div', { class: 'row between' }, [
            el('h2', { text: `٤. الأسئلة (${draft.questions.length})`, style: { margin: 0 } }),
          ]),
          list,
          el('label', { text: 'إضافة سؤال جديد', style: { marginTop: '4px' } }),
          el('div', { class: 'types' }, TYPES.map((type) =>
            el(
              'button',
              {
                class: 'type-btn',
                type: 'button',
                onclick: () => {
                  draft.questions.push(blankQuestion(type));
                  openIndex = draft.questions.length - 1;
                  update();
                },
              },
              [el('span', { class: 'em', text: TYPE_EMOJI[type] }), el('span', { text: '+ ' + TYPE_LABELS[type] })]
            )
          )),
        ])
      );

      // ---- الإطلاق
      const launch = el('button', { class: 'btn accent block' }, '🚀 ابدأ الجلسة واعرض رمز QR');
      launch.addEventListener('click', () => {
        const problem = validate(draft);
        if (problem) return toast(problem, 'bad');
        launch.disabled = true;
        launch.textContent = 'جارٍ الإنشاء…';
        Promise.resolve(onLaunch(draft)).finally(() => {
          launch.disabled = false;
          launch.textContent = '🚀 ابدأ الجلسة واعرض رمز QR';
        });
      });

      root.append(
        el('div', { class: 'card stack' }, [
          launch,
          el('p', { class: 'muted small center', style: { margin: 0 }, text: 'التخزين مؤقت: تختفي الجلسة والنتائج تلقائياً بعد انتهائها.' }),
          el(
            'button',
            {
              class: 'btn ghost sm',
              type: 'button',
              onclick: () => {
                if (!confirm('مسح المسودة والبدء من جديد؟')) return;
                Object.assign(draft, defaultDraft());
                openIndex = 0;
                update();
              },
            },
            'مسح المسودة'
          ),
        ])
      );
    }

    /** بطاقة لصق JSON وتحويله إلى نشاط كامل */
    function importCard() {
      const textarea = el('textarea', {
        placeholder: '{ "title": "…", "questions": [ … ] }\n\nالصق هنا JSON من مساعدك الذكي أو من ملف — ثم اضغط «تحويل إلى تفاعلي».',
        style: {
          minHeight: '110px',
          direction: 'ltr',
          textAlign: 'left',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.78rem',
        },
      });
      const result = el('div', { class: 'small', style: { minHeight: '1em' } });

      const convert = el('button', { class: 'btn accent', type: 'button' }, '⚡ تحويل إلى تفاعلي');
      convert.addEventListener('click', () => {
        const parsed = parseImport(textarea.value);
        if (parsed.error) {
          result.textContent = '❌ ' + parsed.error;
          result.style.color = '#fca5a5';
          toast(parsed.error, 'bad');
          return;
        }
        const count = parsed.draft.questions.length;
        if (!confirm(`استبدال المسودة الحالية بـ ${count} سؤالاً من JSON؟`)) return;
        Object.assign(draft, parsed.draft);
        openIndex = 0;
        update();
        const note = parsed.warnings.length ? ` (${parsed.warnings.length} تنبيه)` : '';
        toast(`✅ تم استيراد ${count} سؤالاً${note}`, 'ok');
        if (parsed.warnings.length) console.warn('تنبيهات الاستيراد:', parsed.warnings);
      });

      const example = el('button', { class: 'btn sm ghost', type: 'button' }, '📋 مثال');
      example.addEventListener('click', () => {
        textarea.value = JSON.stringify(IMPORT_EXAMPLE, null, 2);
        result.textContent = 'هذا مثال يوضح الصيغة — عدّله أو الصق مكانه';
        result.style.color = '';
      });

      const copyPrompt = el('button', { class: 'btn sm ghost', type: 'button' }, '🤖 نسخ برومبت المساعد');
      copyPrompt.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(AI_PROMPT);
          toast('نُسخ البرومبت — الصقه في مساعدك الذكي', 'ok');
        } catch {
          textarea.value = AI_PROMPT;
          toast('تعذّر النسخ التلقائي — البرومبت الآن في الصندوق، انسخه يدوياً');
        }
      });

      return el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { text: 'أو حوّل JSON إلى نشاط ⚡', style: { margin: 0 } }),
          el('div', { class: 'row', style: { gap: '6px' } }, [example, copyPrompt]),
        ]),
        el('p', {
          class: 'muted small',
          style: { margin: 0 },
          text: 'اطلب من أي مساعد ذكي توليد الأسئلة (زر البرومبت يعطيه التعليمات الكاملة)، ثم الصق الناتج هنا.',
        }),
        textarea,
        convert,
        result,
      ]);
    }

    /** مجموعة خيارات على شكل بطاقات (وضع التقدّم، احتساب النقاط) */
    function choiceGroup(key, options, onPick) {
      const group = el('div', { class: 'types' });
      options.forEach((option) => {
        const on = (draft.settings[key] || options[0].value) === option.value;
        const button = el('button', { class: 'type-btn' + (on ? ' on' : ''), type: 'button', title: option.hint }, [
          el('span', { class: 'em', text: option.emoji }),
          el('span', { text: option.title }),
        ]);
        button.addEventListener('click', () => {
          draft.settings[key] = option.value;
          saveDraft(draft);
          onPick?.();
        });
        group.append(button);
      });
      const current = options.find((option) => option.value === (draft.settings[key] || options[0].value));
      return el('div', {}, [group, el('div', { class: 'muted small', style: { marginTop: '6px' }, text: current ? current.hint : '' })]);
    }

    function autoDelayRow() {
      const select = el('select', {}, [3, 5, 6, 8, 10, 15].map((sec) => el('option', { value: String(sec) }, sec + ' ثوانٍ')));
      select.value = String(draft.settings.autoAdvanceSec || 6);
      select.addEventListener('change', () => {
        draft.settings.autoAdvanceSec = Number(select.value);
        saveDraft(draft);
      });
      return el('div', {}, [el('label', { text: 'مدة عرض النتائج قبل الانتقال' }), select]);
    }

    function switchRow(label, key, hint) {
      const input = el('input', { type: 'checkbox' });
      input.checked = draft.settings[key] !== false;
      input.addEventListener('change', () => {
        draft.settings[key] = input.checked;
        saveDraft(draft);
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
      head.addEventListener('click', () => {
        openIndex = open ? -1 : index;
        draw();
      });
      card.append(head);
      if (!open) return card;

      const body = el('div', { class: 'qbody' });

      // نوع السؤال
      body.append(
        el('div', {}, [
          el('label', { text: 'نوع السؤال' }),
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
      const text = el('textarea', { maxlength: 300, placeholder: 'اكتب نص السؤال…' });
      text.value = question.text;
      text.addEventListener('input', () => {
        question.text = text.value;
        head.querySelector('.t').textContent = text.value || TYPE_LABELS[question.type];
        saveDraft(draft);
      });
      body.append(el('div', {}, [el('label', { text: 'نص السؤال' }), text]));

      // الخيارات
      if (question.type === 'mc' || question.type === 'poll') {
        const optionsBox = el('div', { class: 'stack' });
        question.options.forEach((option, oIndex) => {
          const input = el('input', { maxlength: 120, placeholder: `الخيار ${oIndex + 1}`, value: option.text });
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
                title: 'تحديد كإجابة صحيحة',
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
            const remove = el('button', { class: 'mark', type: 'button', title: 'حذف الخيار' }, '✕');
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
              '+ إضافة خيار'
            )
          );
        }

        body.append(
          el('div', {}, [
            el('label', {
              text: question.type === 'mc' ? 'الخيارات (اضغط ✓ للإجابة الصحيحة)' : 'الخيارات',
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
        const group = el('div', { class: 'row' }, [choiceBtn('صحيح', 'true'), choiceBtn('خطأ', 'false')]);
        body.append(el('div', {}, [el('label', { text: 'الإجابة الصحيحة' }), group]));
      }

      if (question.type === 'scale') {
        const min = el('input', { type: 'number', min: 0, max: 9, value: question.scale.min });
        const max = el('input', { type: 'number', min: 2, max: 10, value: question.scale.max });
        const minLabel = el('input', { maxlength: 40, value: question.scale.minLabel, placeholder: 'وصف الطرف الأدنى' });
        const maxLabel = el('input', { maxlength: 40, value: question.scale.maxLabel, placeholder: 'وصف الطرف الأعلى' });
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
            el('div', {}, [el('label', { text: 'من' }), min]),
            el('div', {}, [el('label', { text: 'إلى' }), max]),
            el('div', {}, [el('label', { text: 'وصف الأدنى' }), minLabel]),
            el('div', {}, [el('label', { text: 'وصف الأعلى' }), maxLabel]),
          ])
        );
      }

      // الوقت والنقاط
      const timeSelect = el('select', {}, [
        el('option', { value: '0' }, 'بلا مؤقّت'),
        ...[10, 15, 20, 30, 45, 60, 90, 120].map((seconds) => el('option', { value: String(seconds) }, seconds + ' ثانية')),
      ]);
      timeSelect.value = String(question.timeLimit || 0);
      timeSelect.addEventListener('change', () => {
        question.timeLimit = Number(timeSelect.value);
        saveDraft(draft);
      });

      const timeAndPoints = el('div', { class: 'grid two' }, [el('div', {}, [el('label', { text: 'مدة الإجابة' }), timeSelect])]);

      if (question.type === 'mc' || question.type === 'truefalse') {
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
              value === 0 ? 'بلا علامة' : String(value)
            )
          )
        );
        pointsInput.addEventListener('input', () => {
          const value = Number(pointsInput.value);
          question.points = Number.isFinite(value) ? Math.min(10000, Math.max(0, Math.round(value))) : 0;
          saveDraft(draft);
        });
        timeAndPoints.append(
          el('div', {}, [el('label', { text: 'علامة السؤال' }), pointsInput, presets])
        );
      }
      body.append(timeAndPoints);

      // شرح أو سبب الإجابة الصحيحة (اختياري)
      if (question.type === 'mc' || question.type === 'truefalse') {
        const explanation = el('textarea', {
          maxlength: 400,
          placeholder: 'مثال: عمّان هي العاصمة منذ عام ١٩٢١…',
          style: { minHeight: '64px' },
        });
        explanation.value = question.explanation || '';
        explanation.addEventListener('input', () => {
          question.explanation = explanation.value;
          saveDraft(draft);
        });
        body.append(
          el('div', {}, [
            el('label', { text: 'شرح الإجابة الصحيحة (اختياري)' }),
            explanation,
            el('div', {
              class: 'muted small',
              style: { marginTop: '4px' },
              text: 'يظهر للمتدرب مع الإجابة الصحيحة — يحتاج تفعيل «إظهار الإجابة الصحيحة» في إعدادات النشاط.',
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
              title: 'تحريك لأعلى',
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
              title: 'تحريك لأسفل',
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
              title: 'نسخ السؤال',
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
            'حذف السؤال'
          ),
        ])
      );

      card.append(body);
      return card;
    }

    /** القوالب محمّلة مع الصفحة (window.TEMPLATES) — لا تعتمد على الشبكة إطلاقاً */
    function loadTemplates(row) {
      const templates = global.TEMPLATES || [];
      row.innerHTML = '';
      if (!templates.length) {
        row.append(el('span', { class: 'muted small', text: 'لا توجد قوالب' }));
        return;
      }
      templates.forEach((template) => {
        const button = el('button', { class: 'btn sm ghost', type: 'button', title: template.description }, template.name);
        button.addEventListener('click', () => {
          if (!confirm(`استبدال المسودة الحالية بقالب «${template.name}»؟`)) return;
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
      if (!question.text.trim()) return `السؤال ${i + 1}: اكتب نص السؤال`;
      if (question.type === 'mc' || question.type === 'poll') {
        const filled = question.options.filter((option) => option.text.trim());
        if (filled.length < 2) return `السؤال ${i + 1}: أضف خيارين على الأقل`;
      }
      if (question.type === 'mc' && question.points > 0 && question.correct.length === 0) {
        return `السؤال ${i + 1}: حدّد الإجابة الصحيحة أو اجعل النقاط «بلا نقاط»`;
      }
      if (question.type === 'truefalse' && question.points > 0 && question.correct.length === 0) {
        return `السؤال ${i + 1}: حدّد الإجابة الصحيحة`;
      }
    }
    return null;
  }

  /** برومبت جاهز يعطيه المدرب لأي مساعد ذكي: يناقش أولاً ثم يولّد JSON بعد الموافقة */
  const AI_PROMPT = [
    'أنت مستشار تصميم أنشطة تفاعلية تعليمية لمنصة «تفاعل».',
    'لا تولّد JSON من أول رسالة أبداً — أنت تعمل على ثلاث مراحل بالترتيب، ولغتك هي لغة المعلم (العربية غالباً).',
    '',
    '## المرحلة ١ — الفهم والنقاش',
    'افهم السياق قبل أي اقتراح. اسأل المعلم — دفعةً واحدة وبإيجاز — عمّا ينقصك فقط مما يلي:',
    '- الهدف: تقييم مصحَّح بنقاط؟ مراجعة؟ استطلاع رأي؟ كسر جليد؟ تغذية راجعة؟ أم مزيج؟',
    '- الجمهور: المرحلة العمرية أو المستوى، وعدد المشاركين تقريباً.',
    '- المحتوى: الموضوع أو الدرس، وهل لديه مادة مصدر يلصقها لك.',
    '- الحجم والإيقاع: كم سؤالاً وكم دقيقة، ومن ينقل الأسئلة (المعلم / تلقائي / كل طالب بسرعته).',
    '- الأجواء: تنافسية بنقاط وترتيب، أم هادئة بلا نقاط، وهل الأسماء مطلوبة أم مجهول.',
    'إن كان طلبه واضحاً في نقطة فلا تسألها — اسأل عن الناقص فقط، وبثلاثة أسئلة أو أقل ما أمكن.',
    '',
    '## المرحلة ٢ — العرض وانتظار الموافقة',
    'اعرض خطة مقروءة (نصاً منسقاً، وليس JSON إطلاقاً في هذه المرحلة):',
    '- العنوان، والإعدادات المقترحة مع سبب كل اختيار في سطر.',
    '- قائمة الأسئلة مرقّمة: النوع، نص السؤال، الخيارات مع تمييز الصحيح، العلامة والوقت، والشرح إن وُجد.',
    '- نوّع الأنواع بحسب الهدف — لا تجعل النشاط كله نوعاً واحداً إلا إن طلب المعلم ذلك صراحة.',
    'ثم اختم بسؤال صريح: «هل أعتمد هذه الخطة وأولّد الملف، أم تريد تعديل شيء؟»',
    'إن طلب تعديلات: عدّل وأعد عرض الخطة، وابقَ في هذه المرحلة حتى يوافق.',
    '',
    '## المرحلة ٣ — التوليد (بعد موافقة صريحة فقط)',
    'أخرج JSON فقط داخل سور شيفرة واحد، بلا أي كلام قبله أو بعده، مطابقاً للخطة الموافَق عليها وللصيغة أدناه.',
    '- لا تخترع إجابات صحيحة لم تُذكر في الخطة؛ وما لست متأكداً منه اجعله استطلاعاً أو اسأل عنه في المرحلة ١.',
    '',
    '## الصيغة',
    '{',
    '  "title": "عنوان النشاط",',
    '  "settings": {',
    '    "pace": "host",            // host: المعلم ينقل الأسئلة | auto: انتقال تلقائي | self: كل طالب بسرعته',
    '    "scoring": "speed",        // speed: نقاط أكثر للأسرع | flat: نقاط ثابتة | none: بلا نقاط',
    '    "streakBonus": true,       // مضاعف للإجابات الصحيحة المتتالية',
    '    "revealAnswer": true,      // يرى الطالب الإجابة الصحيحة وشرحها بعد إجابته',
    '    "requireName": true,       // false = استطلاع مجهول بلا أسماء',
    '    "countdown": true          // عدّاد «استعد ٣٢١» قبل الأسئلة المؤقتة',
    '  },',
    '  "questions": [ ... ]',
    '}',
    '',
    '## أنواع الأسئلة (حقل type)',
    '1. "mc" — اختيار من متعدد (يُصحَّح ويُنقَّط):',
    '   { "type": "mc", "text": "نص السؤال", "options": ["خيار ١", "خيار ٢", "خيار ٣", "خيار ٤"],',
    '     "correct": ["خيار ١"], "points": 1000, "timeLimit": 20, "explanation": "لماذا هذه هي الإجابة" }',
    '   - options: من ٢ إلى ٨ خيارات نصية.',
    '   - correct: قائمة بنصوص الخيارات الصحيحة حرفياً كما كتبتها في options (يجوز أكثر من إجابة).',
    '   - points: من 0 إلى 10000 (الافتراضي 1000). timeLimit بالثواني من 5 إلى 600، أو 0 بلا مؤقّت.',
    '   - explanation اختياري: سبب الإجابة الصحيحة، يظهر للطالب بعد إجابته.',
    '2. "truefalse" — صح/خطأ: { "type": "truefalse", "text": "...", "correct": true, "points": 500, "timeLimit": 15, "explanation": "..." }',
    '3. "poll" — استطلاع رأي بلا تصحيح: { "type": "poll", "text": "...", "options": ["...", "..."] }',
    '4. "scale" — مقياس رقمي: { "type": "scale", "text": "...", "scale": { "min": 1, "max": 5, "minLabel": "غير موافق", "maxLabel": "موافق تماماً" } }',
    '5. "word" — سحابة كلمات (كلمة واحدة من كل طالب): { "type": "word", "text": "..." }',
    '6. "open" — إجابة نصية مفتوحة: { "type": "open", "text": "..." }',
    '',
    '## حدود وقواعد تصميم',
    '- حتى 60 سؤالاً. نص السؤال حتى 300 حرف، الخيار حتى 120، الشرح حتى 400.',
    '- طابق النوع مع الهدف: تقييم ← mc و truefalse مع points و explanation | رأي ← poll و scale |',
    '  عصف وأفكار ← word و open | كسر جليد ← poll خفيف | تغذية راجعة ← scale ثم word أو open.',
    '- في النشاط المختلط: افتح بكسر جليد، ورتّب الأسئلة المصحّحة بتدرّج الصعوبة، واختم بتغذية راجعة.',
    '- اجعل المشتتات في mc معقولة وليست هزلية إلا إن طُلب المرح، ووزّع العلامات بحسب الصعوبة.',
    '- للاستطلاع المجهول اجعل "requireName": false و "scoring": "none".',
    '',
    '## مثال كامل',
    JSON.stringify(IMPORT_EXAMPLE, null, 2),
  ].join('\n');

  global.Builder = { mount, loadDraft, saveDraft, defaultDraft, blankQuestion, validate, parseImport, AI_PROMPT, DRAFT_KEY };
})(window);
