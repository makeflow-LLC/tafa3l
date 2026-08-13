(function (global) {
  'use strict';

  /**
   * تصدير نتائج الجلسة (ميزة بريميوم): ملف Excel حقيقي (.xlsx) وملف PDF
   * يُبنى في المتصفح ويُنزَّل مباشرة.
   *
   * Excel بلا أي مكتبة: نكتب حزمة xlsx بأنفسنا (zip بمدخلات غير مضغوطة).
   * PDF عبر jsPDF + autoTable وخط Amiri المضمّن (تُحمَّل كسولاً عند الطلب).
   */

  const enc = new TextEncoder();
  const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const loc = () => (global.I18n && global.I18n.getLang() === 'en' ? 'en' : 'ar');
  const isRtl = () => loc() === 'ar';

  // ------------------------------------------------------------------ zip

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** حزمة zip بمدخلات مخزّنة (بلا ضغط) — يقبلها Excel وGoogle Sheets */
  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = enc.encode(file.name);
      const data = enc.encode(file.content);
      const sum = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // النسخة المطلوبة
      local.setUint16(6, 0x0800, true); // العلم: الأسماء بترميز UTF-8
      local.setUint16(8, 0, true); // بلا ضغط
      local.setUint16(10, 0, true);
      local.setUint16(12, 0, true);
      local.setUint32(14, sum, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, 0, true);
      dir.setUint16(12, 0, true);
      dir.setUint16(14, 0, true);
      dir.setUint32(16, sum, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, nameBytes.length, true);
      dir.setUint16(30, 0, true);
      dir.setUint16(32, 0, true);
      dir.setUint16(34, 0, true);
      dir.setUint16(36, 0, true);
      dir.setUint32(38, 0, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    });

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  // ----------------------------------------------------------------- xlsx

  const esc = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Excel يرفض محارف التحكّم داخل XML
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function colName(index) {
    let name = '';
    let n = index;
    do {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return name;
  }

  function sheetXml(rows) {
    const body = rows
      .map((row, r) => {
        const cells = row
          .map((value, c) => {
            const ref = `${colName(c)}${r + 1}`;
            if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
            const text = esc(value);
            if (!text) return '';
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  /** يبني ملف xlsx من أوراق: [{ name, rows }] */
  function toXlsx(sheets) {
    const files = [
      {
        name: '[Content_Types].xml',
        content:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          sheets
            .map(
              (_s, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
            )
            .join('') +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        content:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      },
      {
        name: 'xl/workbook.xml',
        content:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
          '</sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets
            .map(
              (_s, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
            )
            .join('') +
          '</Relationships>',
      },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s.rows) })),
    ];
    return zip(files);
  }

  // -------------------------------------------------------- بناء الأوراق

  const PACE_KEYS = { host: 'xPaceHost', auto: 'xPaceAuto', self: 'xPaceSelf' };
  const SCORING_KEYS = { speed: 'xScoreSpeed', flat: 'xScoreFlat', none: 'xScoreNone' };

  const TYPE_AR = {
    mc: 'typeMc',
    truefalse: 'typeTruefalse',
    poll: 'typePoll',
    word: 'typeWord',
    scale: 'typeScale',
    open: 'typeOpen',
    blank: 'typeBlank',
  };

  /** ورقة التعريف الأساسية: كل ما يسأل عنه المعلّم قبل أن ينظر في الدرجات */
  function infoRows(data) {
    const started = new Date(data.startedAt || data.exportedAt);
    const ended = new Date(data.endedAt || data.exportedAt);
    return [
      [t('xActivityName'), data.title],
      ...(data.teacher ? [[t('xTeacher'), data.teacher]] : []),
      [t('xCode'), data.code],
      [t('xDate'), started.toLocaleDateString(loc(), { year: 'numeric', month: 'long', day: 'numeric' })],
      [t('xStartTime'), started.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })],
      [t('xEndTime'), ended.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })],
      [t('xDurationMin'), data.durationMinutes || 1],
      [t('xStudentCount'), data.participantCount ?? (data.participants || []).length],
      [t('xQuestionCount'), data.questionCount ?? (data.questions || []).length],
      [t('xMaxScore'), data.maxScore || 0],
      [t('xPaceLabel'), (PACE_KEYS[data.settings?.pace] ? t(PACE_KEYS[data.settings?.pace]) : '—')],
      [t('xScoringLabel'), (SCORING_KEYS[data.settings?.scoring] ? t(SCORING_KEYS[data.settings?.scoring]) : '—')],
      [t('xExportedAt'), new Date(data.exportedAt).toLocaleString(loc())],
    ];
  }

  /** جدول علامات الطلاب مرتبين تنازلياً — يُستخدم في الملفين الكامل والمختصر */
  function peopleRows(participants, data) {
    const people = [
      [t('xRank'), t('aStudent'), t('xTeam'), t('aScore'), t('xMaxScore'), t('xPctCol'), t('xAnswered'), t('xUnanswered'), t('aCorrect'), t('aPartial'), t('xWrong'), t('xPendingCol'), t('xBestStreak'), t('xAvgSecCol')],
    ];
    participants.forEach((p, i) => {
      people.push([
        p.rank ?? i + 1,
        p.name,
        p.team || '—',
        p.score,
        p.maxScore ?? data.maxScore ?? 0,
        p.percent === null || p.percent === undefined ? '—' : p.percent,
        p.answered ?? 0,
        p.unanswered ?? 0,
        p.correctCount ?? 0,
        p.partialCount ?? 0,
        p.wrongCount ?? 0,
        p.pendingCount ?? 0,
        p.bestStreak ?? 0,
        p.avgSeconds ?? 0,
      ]);
    });
    return people;
  }

  /** يحوّل مخرجات /api/sessions/:code/export إلى أوراق جاهزة */
  function buildSheets(data) {
    const questions = data.questions || [];
    const participants = (data.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const analysis = global.Analytics ? global.Analytics.compute(data) : null;

    const info = infoRows(data);
    if (analysis) {
      info.push([]);
      info.push([t('xAvgPct'), analysis.avgPercent ?? '—']);
      info.push([t('xMedianPct'), analysis.median ?? '—']);
      info.push([t('xParticipationPct'), analysis.participation]);
      info.push([t('xHardest'), analysis.hardest ? `${analysis.hardest.text} (${analysis.hardest.accuracy}${t('pctSuffix')})` : '—']);
      info.push([t('xEasiest'), analysis.easiest ? `${analysis.easiest.text} (${analysis.easiest.accuracy}${t('pctSuffix')})` : '—']);
      info.push([t('xFastest'), analysis.fastest ? `${analysis.fastest.text} (${analysis.fastest.avgSeconds}${t('aSecShort')})` : '—']);
      info.push([t('xSlowest'), analysis.slowest ? `${analysis.slowest.text} (${analysis.slowest.avgSeconds}${t('aSecShort')})` : '—']);
      info.push([t('xPending'), analysis.pendingTotal]);
      info.push([]);
      info.push([t('aRecommendations'), '']);
      analysis.recommendations.forEach((rec, i) => info.push([t('xRecN', { n: i + 1 }), rec.text]));
    }

    const people = peopleRows(participants, data);

    const qRows = [
      ['#', t('xType'), t('xQuestion'), t('xOptions'), t('xCorrectAnswer'), t('xScoreCol'), t('xResponses'), t('aCorrect'), t('aPartial'), t('xWrong'), t('xAccuracyCol'), t('xAvgSecCol')],
    ];
    questions.forEach((q) => {
      qRows.push([
        q.index,
        (TYPE_AR[q.type] ? t(TYPE_AR[q.type]) : q.type),
        q.text,
        (q.options || []).join(' | '),
        (q.correct || []).join(' | ') || (q.blanks || []).filter(Boolean).join(' | '),
        q.maxPoints || 0,
        q.responses ?? q.results?.total ?? 0,
        q.correctCount ?? 0,
        q.partialCount ?? 0,
        q.wrongCount ?? 0,
        q.accuracy === null || q.accuracy === undefined ? '—' : q.accuracy,
        q.avgSeconds ?? 0,
      ]);
    });

    // كل إجابة في سطر: هذا ما يريده المعلّم للتحليل في Excel
    const detail = [[t('aStudent'), '#', t('xQuestion'), t('xTheirAnswer'), t('xIsCorrect'), t('xPoints'), t('aOutOf'), t('xTimeSec')]];
    participants.forEach((p) => {
      (p.answers || []).forEach((a, i) => {
        if (!a) return;
        detail.push([
          p.name,
          i + 1,
          a.question,
          Array.isArray(a.answer) ? a.answer.join(' + ') : a.answer,
          a.pending
            ? t('xPendingCol')
            : a.correct === null || a.correct === undefined
              ? '—'
              : a.correct === 'partial'
                ? t('aPartial')
                : a.correct
                  ? t('xYes')
                  : t('xNo'),
          a.points || 0,
          a.maxPoints || 0,
          a.seconds || 0,
        ]);
      });
    });

    return [
      { name: t('xSheetInfo'), rows: info },
      { name: t('aStudents'), rows: people },
      { name: t('xSheetQuestions'), rows: qRows },
      { name: t('xSheetAnswers'), rows: detail },
    ];
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toExcel(data) {
    download(toXlsx(buildSheets(data)), `tapio-${data.code}.xlsx`);
  }

  /**
   * سجل العلامات فقط (من قسم تقدم المشاركين): ورقة تعريف وورقة علامات،
   * بلا تحليل ولا توصيات — مرجع رسمي لعلامات الطلاب أمام الإدارة.
   */
  function buildResultsSheets(data) {
    const participants = (data.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    return [
      { name: t('xSheetInfo'), rows: infoRows(data) },
      { name: t('aStudents'), rows: peopleRows(participants, data) },
    ];
  }

  function toResultsExcel(data) {
    download(toXlsx(buildResultsSheets(data)), `tapio-${data.code}-results.xlsx`);
  }

  // ------------------------------------------------------------------ pdf
  //
  // تنزيل مباشر لملف PDF حقيقي (لا نافذة طباعة): jsPDF + جدول autoTable
  // وخط Amiri المضمّن للعربية. تُحمَّل المكتبات كسولاً عند أول طلب تصدير
  // كي لا تثقل تحميل الصفحة (نحو ميغابايت للخط العربي).

  const PAGE = { w: 595.28, h: 841.89, m: 40 };
  let pdfLibs = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error(t('hpdfLibsFailed')));
      document.head.append(tag);
    });
  }

  function ensurePdfLibs() {
    if (global.jspdf?.jsPDF && global.TAPIO_FONTS) return Promise.resolve();
    if (!pdfLibs) {
      pdfLibs = (async () => {
        await loadScript('/assets/vendor/jspdf.umd.min.js');
        await Promise.all([
          loadScript('/assets/vendor/jspdf.plugin.autotable.min.js'),
          loadScript('/assets/vendor/amiri-font.js'),
        ]);
      })().catch((err) => {
        pdfLibs = null; // ليُعاد التحميل في المحاولة التالية
        throw err;
      });
    }
    return pdfLibs;
  }

  function makeDoc() {
    const doc = new global.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    doc.addFileToVFS('Amiri.ttf', global.TAPIO_FONTS.regular);
    doc.addFont('Amiri.ttf', 'Amiri', 'normal');
    doc.addFileToVFS('Amiri-Bold.ttf', global.TAPIO_FONTS.bold);
    doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold');
    doc.setFont('Amiri');
    doc.setTextColor(22, 22, 42);
    return doc;
  }

  /**
   * محرك jsPDF يرتّب العربية بذاته لكنه يتخبّط في الأقواس داخل سطر RTL،
   * فنحوّل «(كذا)» إلى «— كذا» في المستند العربي فقط.
   */
  function safeText(value) {
    // محارف الاتجاه الخفية (يدسّها toLocaleString العربي) تقلب السطر كله في jsPDF
    const text = String(value ?? '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    if (!isRtl() || !/[\u0600-\u06FF]/.test(text)) return text;
    return text
      .replace(/\s*\(([^)]{1,2})\)/g, ' $1') // «(٪)» → «٪»
      .replace(/\s*\(([^)]*)\)/g, ' — $1')
      .replace(/[()]/g, ' ');
  }

  /** سطر نص يراعي الاتجاه؛ يعيد y التالي */
  function writeLine(doc, text, y, opts = {}) {
    const { size = 11, bold = false, color = null, align = null, x = null } = opts;
    doc.setFontSize(size);
    doc.setFont('Amiri', bold ? 'bold' : 'normal');
    if (color) doc.setTextColor(color[0], color[1], color[2]);
    const rtl = isRtl();
    const ax = x !== null ? x : rtl ? PAGE.w - PAGE.m : PAGE.m;
    const aa = align || (rtl ? 'right' : 'left');
    const wrapped = doc.splitTextToSize(safeText(text), PAGE.w - PAGE.m * 2);
    doc.text(wrapped, ax, y, { align: aa });
    doc.setTextColor(22, 22, 42);
    return y + wrapped.length * (size * 1.6);
  }

  /** جدول يراعي الاتجاه (يعكس الأعمدة في العربية)؛ يعيد y أسفل الجدول */
  function table(doc, head, body, startY, opts = {}) {
    const rtl = isRtl();
    const clean = (row) => row.map((cell) => (typeof cell === 'number' ? cell : safeText(cell)));
    const H = rtl ? clean(head).reverse() : clean(head);
    const B = body.map((row) => (rtl ? clean(row).reverse() : clean(row)));
    doc.autoTable({
      startY,
      head: [H],
      body: B,
      styles: { font: 'Amiri', fontSize: 8.5, halign: rtl ? 'right' : 'left', textColor: [22, 22, 42], cellPadding: 4, lineColor: [215, 218, 230], lineWidth: 0.5 },
      headStyles: { fontStyle: 'bold', fillColor: [241, 243, 249], textColor: [22, 22, 42] },
      alternateRowStyles: { fillColor: [250, 251, 254] },
      margin: { left: PAGE.m, right: PAGE.m },
      theme: 'grid',
      ...opts,
    });
    return doc.lastAutoTable.finalY;
  }

  /** جدول تعريف النشاط (عمودا: البيان والقيمة) */
  function metaTable(doc, data, startY) {
    const rows = infoRows(data).filter((row) => row.length === 2);
    return table(doc, [t('xField'), t('xValue')], rows, startY, { styles: { font: 'Amiri', fontSize: 8.5, halign: isRtl() ? 'right' : 'left', textColor: [22, 22, 42], cellPadding: 3, lineColor: [215, 218, 230], lineWidth: 0.5 } });
  }

  /** ترقيم الصفحات وتذييلها — يُستدعى بعد اكتمال المحتوى */
  function stampFooters(doc) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i += 1) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('Amiri', 'normal');
      doc.setTextColor(138, 142, 163);
      doc.text(`Tapio — tapio.fun · ${safeText(t('xPageOf', { n: i, total }))}`, PAGE.w / 2, PAGE.h - 18, { align: 'center' });
      doc.setTextColor(22, 22, 42);
    }
  }

  /** رأس الطالبين المشترك لجدول العلامات */
  function marksHeadBody(data) {
    const participants = (data.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const hasTeams = participants.some((p) => p.team);
    const head = [t('xRank'), t('aStudent'), ...(hasTeams ? [t('xTeam')] : []), t('aScore'), t('xMaxScore'), t('xPctCol'), t('aCorrect'), t('xAnswered')];
    const body = participants.map((p, i) => [
      p.rank ?? i + 1,
      p.name,
      ...(hasTeams ? [p.team || '—'] : []),
      p.score,
      p.maxScore ?? data.maxScore ?? 0,
      p.percent === null || p.percent === undefined ? '—' : `${p.percent}${t('pctSuffix')}`,
      p.correctCount ?? 0,
      `${p.answered ?? 0} / ${(p.answered ?? 0) + (p.unanswered ?? 0)}`,
    ]);
    return { head, body };
  }

  /** يتأكد أن في الصفحة متسعاً؛ وإلا فيفتح صفحة جديدة ويعيد y البداية */
  function roomFor(doc, y, needed) {
    if (y + needed <= PAGE.h - 60) return y;
    doc.addPage();
    return 50;
  }

  /**
   * سجل علامات الطلاب (تنزيل مباشر): تعريف النشاط، جدول العلامات مرتباً،
   * وسطرا توقيع للمعلّم والمدير — بلا تحليل. مرجع رسمي أمام الإدارة.
   */
  async function toResultsPdf(data) {
    await ensurePdfLibs();
    const doc = makeDoc();
    let y = writeLine(doc, data.title, 52, { size: 17, bold: true });
    y = writeLine(doc, `${t('xResultsRecord')} · ${new Date(data.exportedAt).toLocaleString(loc())}`, y, { size: 9, color: [97, 101, 125] });
    y = metaTable(doc, data, y + 6) + 20;

    y = roomFor(doc, y, 120);
    y = writeLine(doc, t('xResultsRecord'), y, { size: 13, bold: true });
    const { head, body } = marksHeadBody(data);
    y = table(doc, head, body, y + 4) + 46;

    // توقيعان: المعلّم والمدير — لكلٍّ خطّ فوقه اسمه تحت
    y = roomFor(doc, y, 70);
    const half = (PAGE.w - PAGE.m * 2 - 60) / 2;
    const teacherX = isRtl() ? PAGE.w - PAGE.m - half : PAGE.m;
    const principalX = isRtl() ? PAGE.m : PAGE.w - PAGE.m - half;
    doc.setDrawColor(22, 22, 42);
    doc.line(teacherX, y, teacherX + half, y);
    doc.line(principalX, y, principalX + half, y);
    doc.setFontSize(9);
    doc.setTextColor(97, 101, 125);
    doc.text(safeText(t('xSigTeacher') + (data.teacher ? ` — ${data.teacher}` : '')), teacherX + half / 2, y + 14, { align: 'center' });
    doc.text(safeText(t('xSigPrincipal')), principalX + half / 2, y + 14, { align: 'center' });
    doc.setTextColor(22, 22, 42);

    stampFooters(doc);
    doc.save(`tapio-${data.code}-results.pdf`);
  }

  /**
   * تقرير المعلّم الكامل (تنزيل مباشر): تعريف النشاط، ملخص التحليل
   * وأبرز الأسئلة والتوصيات، ثم جدول الأسئلة وجدول العلامات.
   */
  async function toPdf(data) {
    await ensurePdfLibs();
    const doc = makeDoc();
    const analysis = global.Analytics ? global.Analytics.compute(data) : null;

    let y = writeLine(doc, data.title, 52, { size: 17, bold: true });
    const sub = [data.teacher ? `${t('xTeacher')}: ${data.teacher}` : null, t('xReportOf'), new Date(data.exportedAt).toLocaleString(loc())].filter(Boolean).join(' · ');
    y = writeLine(doc, sub, y, { size: 9, color: [97, 101, 125] });
    y = metaTable(doc, data, y + 6) + 20;

    if (analysis) {
      y = roomFor(doc, y, 140);
      y = writeLine(doc, t('xAnalysisSection'), y, { size: 13, bold: true });
      y = table(
        doc,
        [t('xAvgPct'), t('xMedianPct'), t('xParticipationPct'), t('xPending')],
        [[analysis.avgPercent ?? '—', analysis.median ?? '—', analysis.participation, analysis.pendingTotal]],
        y + 4
      ) + 14;

      const spot = [];
      if (analysis.hardest) spot.push([t('xHardest'), analysis.hardest.text, `${analysis.hardest.accuracy}${t('pctSuffix')}`]);
      if (analysis.easiest) spot.push([t('xEasiest'), analysis.easiest.text, `${analysis.easiest.accuracy}${t('pctSuffix')}`]);
      if (analysis.fastest) spot.push([t('xFastest'), analysis.fastest.text, `${analysis.fastest.avgSeconds}${t('aSecShort')}`]);
      if (analysis.slowest) spot.push([t('xSlowest'), analysis.slowest.text, `${analysis.slowest.avgSeconds}${t('aSecShort')}`]);
      if (spot.length) {
        y = roomFor(doc, y, 100);
        y = table(doc, ['', t('xQuestion'), ''], spot, y, { columnStyles: isRtl() ? { 2: { fontStyle: 'bold' } } : { 0: { fontStyle: 'bold' } } }) + 14;
      }

      // توزيع الدرجات: أشرطة مرسومة بالمستطيلات — الرسم البياني داخل الملف
      const bandMax = Math.max(1, ...analysis.bands.map((b) => b.count));
      y = roomFor(doc, y, 30 + analysis.bands.length * 16);
      y = writeLine(doc, t('aDistribution'), y, { size: 11, bold: true });
      const chartX = isRtl() ? PAGE.m + 60 : PAGE.m + 90;
      const chartW = PAGE.w - PAGE.m * 2 - 150;
      analysis.bands.forEach((band) => {
        doc.setFontSize(8.5);
        doc.setTextColor(97, 101, 125);
        const labelX = isRtl() ? PAGE.w - PAGE.m : PAGE.m;
        doc.text(safeText(band.label), labelX, y + 8, { align: isRtl() ? 'right' : 'left' });
        const w = Math.max(2, (band.count / bandMax) * chartW);
        const barX = isRtl() ? PAGE.w - PAGE.m - 80 - w : chartX;
        doc.setFillColor(91, 69, 224);
        doc.roundedRect(barX, y, w, 10, 2, 2, 'F');
        doc.setTextColor(22, 22, 42);
        doc.text(String(band.count), isRtl() ? barX - 8 : barX + w + 8, y + 8, { align: isRtl() ? 'right' : 'left' });
        y += 16;
      });
      y += 10;

      if (analysis.recommendations?.length) {
        y = roomFor(doc, y, 60);
        y = writeLine(doc, t('aRecommendations'), y, { size: 11, bold: true });
        analysis.recommendations.forEach((rec) => {
          y = roomFor(doc, y, 30);
          y = writeLine(doc, `• ${rec.text}`, y, { size: 9 });
        });
        y += 6;
      }
    }

    // جدول الأسئلة
    y = roomFor(doc, y, 100);
    y = writeLine(doc, t('xQuestionDetail'), y, { size: 13, bold: true });
    const qHead = ['#', t('xType'), t('xQuestion'), t('xCorrectAnswer'), t('xScoreCol'), t('xResponses'), t('xAccuracyCol'), t('xAvgSecCol')];
    const qBody = (data.questions || []).map((q) => [
      q.index,
      TYPE_AR[q.type] ? t(TYPE_AR[q.type]) : q.type,
      q.text,
      (q.correct || []).join(t('listSep')) || (q.blanks || []).filter(Boolean).join(t('listSep')) || '—',
      q.maxPoints || 0,
      q.responses ?? q.results?.total ?? 0,
      q.accuracy === null || q.accuracy === undefined ? '—' : `${q.accuracy}${t('pctSuffix')}`,
      q.avgSeconds ?? 0,
    ]);
    const qWidths = isRtl()
      ? { 5: { cellWidth: 150 }, 4: { cellWidth: 90 } }
      : { 2: { cellWidth: 150 }, 3: { cellWidth: 90 } };
    y = table(doc, qHead, qBody, y + 4, { columnStyles: qWidths }) + 20;

    // جدول العلامات
    y = roomFor(doc, y, 100);
    y = writeLine(doc, t('xResultsRecord'), y, { size: 13, bold: true });
    const marks = marksHeadBody(data);
    table(doc, marks.head, marks.body, y + 4);

    stampFooters(doc);
    doc.save(`tapio-${data.code}-report.pdf`);
  }

  global.Exporter = { toExcel, toResultsExcel, toPdf, toResultsPdf, toXlsx, buildSheets, buildResultsSheets, ensurePdfLibs, crc32 };
})(window);
