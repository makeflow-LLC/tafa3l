(function (global) {
  'use strict';

  /**
   * استيراد بنك أسئلة من جدول (CSV / TSV يُصدَّر من Excel أو Google Sheets).
   *
   * أكبر حاجز أمام معلّم يفكّر في الانتقال إلينا هو بنك أسئلته الموجود أصلاً
   * في جدول. فالهدف هنا ليس صيغة مثالية، بل **قبول ما يكتبه المعلّمون فعلاً**:
   * فاصلة أو فاصلة منقوطة (تصدير Excel العربي) أو تبويب، بعناوين عربية أو
   * إنجليزية، وبإجابة صحيحة مكتوبة نصاً أو حرفاً (A/أ) أو رقماً (1).
   *
   * التحليل كله في المتصفح — لا يُرفع ملف المعلّم إلى أي خادم.
   */

  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);

  /** يفصل سطور CSV مع احترام علامات الاقتباس (فاصلة داخل نصّ سؤال) */
  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else quoted = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') quoted = true;
      else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch !== '\r') field += ch;
    }
    row.push(field);
    rows.push(row);
    return rows.filter((r) => r.some((c) => String(c).trim().length));
  }

  /**
   * الفاصل الأرجح. Excel العربي والأوروبي يصدّر بفاصلة منقوطة لا بفاصلة،
   * وتخمينه خطأً يجعل كل صفّ عموداً واحداً — فنختار الأكثر تكراراً في الترويسة.
   */
  function sniffDelimiter(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const counts = [
      [',', (first.match(/,/g) || []).length],
      [';', (first.match(/;/g) || []).length],
      ['\t', (first.match(/\t/g) || []).length],
    ].sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
  }

  const norm = (v) =>
    String(v ?? '')
      .replace(/^﻿/, '') // علامة ترتيب البايت من Excel
      .trim()
      .toLowerCase();

  /** مرادفات العناوين — عربية وإنجليزية، بصيغ يكتبها المعلّمون فعلاً */
  const HEADERS = {
    type: ['type', 'kind', 'النوع', 'نوع', 'نوع السؤال'],
    text: ['question', 'text', 'q', 'السؤال', 'نص السؤال', 'سؤال'],
    correct: ['correct', 'answer', 'right', 'key', 'الإجابة', 'الاجابة', 'الإجابة الصحيحة', 'الاجابة الصحيحة', 'الصحيحة', 'الجواب'],
    points: ['points', 'score', 'mark', 'marks', 'العلامة', 'الدرجة', 'النقاط', 'علامة'],
    time: ['time', 'seconds', 'timelimit', 'الوقت', 'المدة', 'الزمن', 'الثواني'],
    explanation: ['explanation', 'why', 'note', 'الشرح', 'التفسير', 'ملاحظة'],
    // وسم المهارة أو الهدف — عمودٌ اختياري في ورقة المعلّم
    skill: ['skill', 'objective', 'goal', 'tag', 'standard', 'المهارة', 'مهارة', 'الهدف', 'هدف', 'الوسم'],
  };

  const OPTION_RE = /^(?:option|choice|opt|answer)\s*([1-8])$|^([a-h])$|^خيار\s*([1-8])$|^(?:الخيار)\s*([1-8])$/i;
  const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];

  const TYPE_ALIASES = {
    mc: ['mc', 'multiple', 'multiple choice', 'multiple_choice', 'quiz', 'اختيار', 'اختيار من متعدد', 'متعدد'],
    truefalse: ['tf', 'truefalse', 'true/false', 'true_false', 'boolean', 'صح/خطأ', 'صح او خطا', 'صح أو خطأ', 'صواب وخطأ', 'صح'],
    poll: ['poll', 'survey', 'استطلاع', 'استطلاع رأي', 'رأي'],
    word: ['word', 'wordcloud', 'cloud', 'سحابة', 'سحابة كلمات', 'كلمة'],
    scale: ['scale', 'rating', 'slider', 'مقياس', 'تقييم'],
    open: ['open', 'text', 'essay', 'مفتوح', 'إجابة مفتوحة', 'اجابة مفتوحة', 'نصي', 'نصّي'],
    blank: ['blank', 'fill', 'fillblank', 'فراغ', 'أكمل الفراغ', 'اكمل الفراغ'],
  };

  function matchType(value) {
    const v = norm(value);
    if (!v) return null;
    for (const [type, names] of Object.entries(TYPE_ALIASES)) {
      if (names.some((n) => norm(n) === v)) return type;
    }
    return null;
  }

  /** يبني خريطة العمود → معناه من صفّ الترويسة */
  function mapHeader(header) {
    const map = { options: [] };
    header.forEach((raw, index) => {
      const cell = norm(raw);
      if (!cell) return;
      for (const [field, names] of Object.entries(HEADERS)) {
        if (names.some((n) => norm(n) === cell)) {
          if (map[field] === undefined) map[field] = index;
          return;
        }
      }
      const m = OPTION_RE.exec(cell);
      if (m) {
        const letter = m[2];
        const num = m[1] || m[3] || m[4];
        const at = letter ? letter.toLowerCase().charCodeAt(0) - 96 : Number(num);
        map.options.push({ index, at });
      }
    });
    map.options.sort((a, b) => a.at - b.at);
    return map;
  }

  /** هل يبدو هذا الصفّ ترويسةً؟ */
  function looksLikeHeader(row) {
    const map = mapHeader(row);
    return map.text !== undefined || map.options.length >= 2;
  }

  /**
   * يحوّل نصّ إجابة صحيحة إلى نصوص الخيارات المقصودة.
   * يقبل: نصّ الخيار حرفياً · حرفه (A/أ) · رقمه (1) · وعدّة إجابات مفصولة.
   */
  function resolveCorrect(raw, options) {
    const out = [];
    String(raw ?? '')
      .split(/[|,،؛;]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((token) => {
        const exact = options.find((o) => norm(o) === norm(token));
        if (exact) return out.push(exact);
        const num = Number(token);
        if (Number.isInteger(num) && options[num - 1]) return out.push(options[num - 1]);
        const en = /^[a-h]$/i.test(token) ? token.toLowerCase().charCodeAt(0) - 97 : -1;
        if (en >= 0 && options[en]) return out.push(options[en]);
        const ar = AR_LETTERS.indexOf(token);
        if (ar >= 0 && options[ar]) return out.push(options[ar]);
      });
    return [...new Set(out)];
  }

  const TRUE_WORDS = ['true', 'yes', 't', 'صح', 'صحيح', 'نعم', 'صواب'];
  const FALSE_WORDS = ['false', 'no', 'f', 'خطأ', 'خطا', 'غلط', 'لا'];

  /**
   * يحلّل نصّ جدول إلى أسئلة جاهزة للمحرّر.
   * @returns {{questions: Array, warnings: string[], skipped: number, delimiter: string}}
   */
  function parse(text) {
    const clean = String(text || '').replace(/^﻿/, '');
    const delimiter = sniffDelimiter(clean);
    const rows = parseDelimited(clean, delimiter);
    const warnings = [];
    if (!rows.length) return { questions: [], warnings: [t('iEmptyFile')], skipped: 0, delimiter };

    let header = rows[0];
    let start = 1;
    let map = mapHeader(header);
    if (!looksLikeHeader(header)) {
      // بلا ترويسة: نفترض الترتيب الشائع — سؤال، خيارات، الإجابة الصحيحة
      warnings.push(t('iNoHeader'));
      const width = Math.max(...rows.map((r) => r.length));
      map = { text: 0, options: [], correct: width - 1 };
      for (let i = 1; i < width - 1; i += 1) map.options.push({ index: i, at: i });
      start = 0;
    }
    if (map.text === undefined) return { questions: [], warnings: [t('iNoQuestionColumn')], skipped: 0, delimiter };

    const questions = [];
    let skipped = 0;
    for (let r = start; r < rows.length; r += 1) {
      const row = rows[r];
      const cell = (i) => (i === undefined || i < 0 ? '' : String(row[i] ?? '').trim());
      const textValue = cell(map.text);
      if (!textValue) {
        skipped += 1;
        continue;
      }

      const options = map.options.map((o) => cell(o.index)).filter((v) => v.length);
      const correctRaw = cell(map.correct);
      let type = matchType(cell(map.type));

      if (!type) {
        // بلا عمود نوع: نستنتجه من شكل الصفّ نفسه
        const isBool = correctRaw && [...TRUE_WORDS, ...FALSE_WORDS].some((w) => norm(w) === norm(correctRaw));
        if (options.length >= 2) type = correctRaw ? 'mc' : 'poll';
        else if (isBool) type = 'truefalse';
        else if (/_{3,}/.test(textValue)) type = 'blank';
        else type = correctRaw ? 'mc' : 'open';
      }

      const points = Number(cell(map.points));
      const time = Number(cell(map.time));
      const question = {
        type,
        text: textValue,
        explanation: cell(map.explanation) || undefined,
        skill: cell(map.skill) || undefined,
      };
      if (Number.isFinite(points) && cell(map.points)) question.points = Math.max(0, Math.round(points));
      if (Number.isFinite(time) && cell(map.time)) question.timeLimit = Math.max(0, Math.round(time));

      if (type === 'mc' || type === 'poll') {
        if (options.length < 2) {
          warnings.push(t('iRowNeedsOptions', { row: r + 1 }));
          skipped += 1;
          continue;
        }
        question.options = options;
        if (type === 'mc') {
          const correct = resolveCorrect(correctRaw, options);
          if (!correct.length) {
            // لا إجابة صحيحة مفهومة: نجعله استطلاعاً بدل أن نخترع جواباً
            question.type = 'poll';
            warnings.push(t('iRowNoCorrect', { row: r + 1 }));
          } else question.correct = correct;
        }
      } else if (type === 'truefalse') {
        const isTrue = TRUE_WORDS.some((w) => norm(w) === norm(correctRaw));
        const isFalse = FALSE_WORDS.some((w) => norm(w) === norm(correctRaw));
        if (!isTrue && !isFalse) {
          warnings.push(t('iRowNoCorrect', { row: r + 1 }));
          skipped += 1;
          continue;
        }
        question.correct = [isTrue ? 'true' : 'false'];
      } else if (type === 'blank') {
        question.blanks = correctRaw ? correctRaw.split(/[|،,؛;]+/).map((x) => x.trim()) : [];
      }

      questions.push(question);
      if (questions.length >= 60) {
        warnings.push(t('iTooMany'));
        break;
      }
    }

    return { questions, warnings, skipped, delimiter };
  }

  /** نموذج جدول جاهز ينزّله المعلّم ويملؤه */
  function templateCsv() {
    const rows = [
      ['النوع', 'السؤال', 'خيار 1', 'خيار 2', 'خيار 3', 'خيار 4', 'الإجابة الصحيحة', 'العلامة', 'الوقت', 'الشرح'],
      ['اختيار من متعدد', 'ما عاصمة الأردن؟', 'عمّان', 'إربد', 'الزرقاء', 'العقبة', 'عمّان', '1000', '20', 'عمّان هي العاصمة منذ 1921'],
      ['صح/خطأ', 'الماء يغلي عند 100 درجة مئوية', '', '', '', '', 'صح', '500', '15', ''],
      ['استطلاع', 'أي درس تفضّل؟', 'الجبر', 'الهندسة', 'الإحصاء', '', '', '', '', ''],
      ['أكمل الفراغ', 'عاصمة مصر ___ وعملتها ___', '', '', '', '', 'القاهرة | الجنيه', '4', '', ''],
      ['إجابة مفتوحة', 'اشرح دورة الماء بأسلوبك', '', '', '', '', '', '5', '', ''],
    ];
    // BOM كي يفتح Excel الملف بترميز UTF-8 فلا تظهر العربية رموزاً
    return '﻿' + rows.map((r) => r.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
  }

  global.SheetImport = { parse, templateCsv, parseDelimited, sniffDelimiter, resolveCorrect };
})(window);
