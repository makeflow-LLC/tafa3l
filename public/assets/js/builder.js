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
    const q = { id: uid(), type: type || 'mc', text: '', timeLimit: 20, points: 1000, options: [], correct: [] };
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
      settings: { requireName: true, allowLateJoin: true, showLeaderboard: true, countdown: true },
      questions: [blankQuestion('mc')],
    };
  }

  function loadDraft() {
    const draft = store.local.get(DRAFT_KEY, null);
    if (!draft || !Array.isArray(draft.questions) || draft.questions.length === 0) return defaultDraft();
    return draft;
  }

  function saveDraft(draft) {
    store.local.set(DRAFT_KEY, draft);
  }

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

      // ---- العنوان والإعدادات
      const titleInput = el('input', { maxlength: 120, placeholder: 'مثال: مراجعة الوحدة الثالثة', value: draft.title });
      titleInput.addEventListener('input', () => {
        draft.title = titleInput.value;
        saveDraft(draft);
      });

      root.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: '١. معلومات النشاط' }),
          el('div', {}, [el('label', { text: 'عنوان النشاط' }), titleInput]),
          switchRow('طلب الاسم أو الكنية', 'requireName', 'أطفئه لاستطلاع مجهول بلا أسماء'),
          switchRow('السماح بالدخول المتأخر', 'allowLateJoin', 'يستطيع الطلاب الدخول بعد بدء النشاط'),
          switchRow('عرض لوحة الترتيب', 'showLeaderboard', 'يظهر ترتيب المشاركين بين الأسئلة'),
          switchRow('عدّاد «استعد ٣٢١»', 'countdown', 'ينطلق الجميع معاً في الأسئلة المؤقتة'),
        ])
      );

      // ---- القوالب
      const templatesBox = el('div', { class: 'card stack' }, [
        el('h2', { text: 'ابدأ من قالب جاهز' }),
        el('div', { class: 'row', id: 'tmplRow' }, el('span', { class: 'muted small', text: 'جارٍ التحميل…' })),
      ]);
      root.append(templatesBox);
      loadTemplates(templatesBox.querySelector('#tmplRow'));

      // ---- الأسئلة
      const list = el('div', { class: 'stack' });
      draft.questions.forEach((question, index) => list.append(questionCard(question, index)));

      root.append(
        el('div', { class: 'card stack' }, [
          el('div', { class: 'row between' }, [
            el('h2', { text: `٢. الأسئلة (${draft.questions.length})`, style: { margin: 0 } }),
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
        const pointsSelect = el('select', {}, [
          el('option', { value: '0' }, 'بلا نقاط'),
          el('option', { value: '500' }, 'عادي (٥٠٠)'),
          el('option', { value: '1000' }, 'قياسي (١٠٠٠)'),
          el('option', { value: '2000' }, 'مضاعف (٢٠٠٠)'),
        ]);
        pointsSelect.value = String(question.points ?? 1000);
        pointsSelect.addEventListener('change', () => {
          question.points = Number(pointsSelect.value);
          saveDraft(draft);
        });
        timeAndPoints.append(el('div', {}, [el('label', { text: 'النقاط' }), pointsSelect]));
      }
      body.append(timeAndPoints);

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
      draft.settings = { ...template.settings };
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

  global.Builder = { mount, loadDraft, saveDraft, defaultDraft, blankQuestion, validate, DRAFT_KEY };
})(window);
