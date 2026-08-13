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
  async function toResultsPdfFile(data) {
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
  async function toPdfFile(data) {
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

  // ------------------------------------------------- تقرير مطبوع ملوّن
  //
  // أجمل مخرَج ممكن: صفحة HTML كاملة الأنماط تُفتح في نافذة طباعة، فيحفظها
  // المتصفح PDF متجهاً (نصّه قابل للتحديد، ورسومه SVG حادّة عند أي تكبير).
  // نفس محرّك الرسوم الذي يراه المعلّم في تبويب التحليل — لا نسخة باهتة منه.

  /** أنماط التقرير المطبوع — مستقلة عن صفحة التطبيق لأن النافذة جديدة */
  const PRINT_CSS = `
  /*
   * المتصفحات تحذف ألوان الخلفيات عند الطباعة افتراضاً، فتخرج الأشرطة
   * وبطاقات التوصيات بيضاء. هذا السطر يفرض طباعتها بألوانها الحقيقية.
   */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; color: #16162a; margin: 24px; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  h2 { font-size: 18px; margin: 22px 0 10px; }
  h3 { margin: 0 0 10px; font-size: 15px; }
  .meta { color: #61657d; margin: 0 0 6px; font-size: 13px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 12px 0 18px; }
  .meta-grid div { border: 1px solid #e3e6ef; border-radius: 10px; padding: 8px 10px; font-size: 13px; }
  .meta-grid strong { display: block; font-size: 15px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
  th, td { border: 1px solid #d7dae6; padding: 6px 8px; text-align: right; font-size: 13px; }
  th { background: #f1f3f9; }
  .q { break-inside: avoid; margin-bottom: 12px; border: 1px solid #e3e6ef; border-radius: 10px; padding: 10px 14px; }
  .q h3 { margin: 0 0 6px; font-size: 14px; }
  .ok { color: #128a4d; margin: 0 0 6px; font-size: 13px; }
  ul { margin: 4px 0; padding-inline-start: 20px; font-size: 13px; }
  .chart-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 14px; }
  .chart-stat { border: 1px solid #e3e6ef; border-radius: 10px; padding: 8px; text-align: center; }
  .chart-stat strong { display: block; font-size: 20px; font-weight: 800; }
  .chart-stat span { font-size: 11px; color: #61657d; }
  .chart-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: stretch; }
  .chart-card { flex: 1 1 260px; border: 1px solid #e3e6ef; border-radius: 10px; padding: 12px; margin-bottom: 12px; break-inside: avoid; }
  .chart-card.grow { flex: 3 1 320px; }
  .chart-donut { display: block; width: 150px; margin: 0 auto; color: #16162a; }
  .chart-bars { display: grid; gap: 6px; }
  .chart-bar { display: grid; grid-template-columns: minmax(90px, 36%) 1fr auto; gap: 8px; align-items: center; font-size: 12px; }
  .chart-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #61657d; }
  .chart-track { display: block; height: 12px; border-radius: 999px; background: #f1f3f9; overflow: hidden; }
  .chart-track i { display: block; height: 100%; border-radius: 999px; }
  .chart-value { font-weight: 700; }
  .chart-highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .chart-highlight { border: 1px solid #e3e6ef; border-radius: 10px; padding: 8px 10px; border-inline-start: 4px solid #5b45e0; display: grid; gap: 2px; break-inside: avoid; }
  .chart-highlight.bad { border-inline-start-color: #cc2f2f; }
  .chart-highlight.ok { border-inline-start-color: #128a4d; }
  .chart-highlight.warn { border-inline-start-color: #a45c00; }
  .chart-highlight .t, .chart-highlight .v { font-size: 11px; color: #61657d; }
  .chart-table { width: 100%; }
  .rec-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .rec { padding: 8px 10px; border-radius: 8px; background: #f6f7fb; border-inline-start: 4px solid #5b45e0; font-size: 13px; line-height: 1.7; break-inside: avoid; }
  .rec.ok { border-inline-start-color: #128a4d; background: rgba(18,138,77,0.08); }
  .rec.warn { border-inline-start-color: #a45c00; background: rgba(164,92,0,0.08); }
  .rec.bad { border-inline-start-color: #cc2f2f; background: rgba(204,47,47,0.08); }
  .muted { color: #61657d; }
  .small { font-size: 12px; }
  .foot { margin-top: 20px; font-size: 11px; color: #8a8ea3; text-align: center; }
  
  /* ترويسة ملوّنة تعطي التقرير هوية بصرية فور فتحه */
  .hero { background: linear-gradient(135deg, #5b45e0, #7c5cff); color: #fff; border-radius: 14px; padding: 18px 22px; margin-bottom: 16px; }
  .hero h1 { color: #fff; margin: 0 0 6px; }
  .hero .meta { color: rgba(255, 255, 255, 0.85); margin: 0; }
  .hero .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .hero .tag { background: rgba(255, 255, 255, 0.18); border-radius: 999px; padding: 4px 12px; font-size: 12px; }
  .sign-row { display: flex; gap: 60px; margin-top: 56px; break-inside: avoid; }
  .sign { flex: 1; text-align: center; font-size: 13px; color: #61657d; }
  .sign i { display: block; border-top: 1px solid #16162a; margin-bottom: 8px; }
  .rank-1 td { background: rgba(245, 183, 0, 0.16); font-weight: 700; }
  .rank-2 td { background: rgba(150, 150, 170, 0.14); }
  .rank-3 td { background: rgba(196, 120, 60, 0.14); }
  @media print { body { margin: 12mm; } .hero { break-inside: avoid; } }`;

  /** ترويسة التقرير الملوّنة */
  function heroHtml(data, subtitle) {
    const started = new Date(data.startedAt || data.exportedAt);
    const tags = [
      data.teacher ? `${t('xTeacher')}: ${data.teacher}` : null,
      `${t('xCode')}: ${data.code}`,
      started.toLocaleDateString(loc(), { year: 'numeric', month: 'long', day: 'numeric' }),
      t('hMinutes', { n: data.durationMinutes || 1 }),
      `${data.participantCount ?? (data.participants || []).length} ${t('xStudentCount')}`,
    ].filter(Boolean);
    return `<div class="hero">
      <h1>${esc(data.title)}</h1>
      <p class="meta">${esc(subtitle)}</p>
      <div class="tags">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>
    </div>`;
  }

  function metaGridHtml(data) {
    const started = new Date(data.startedAt || data.exportedAt);
    const ended = new Date(data.endedAt || data.exportedAt);
    return `<div class="meta-grid">
      <div><strong>${esc(started.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }))} — ${esc(
        ended.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })
      )}</strong>${t('xStartEnd')}</div>
      <div><strong>${data.questionCount ?? (data.questions || []).length}</strong>${t('xQuestionCount')}</div>
      <div><strong>${data.maxScore || 0}</strong>${t('xMaxScore')}</div>
      <div><strong>${esc(PACE_KEYS[data.settings?.pace] ? t(PACE_KEYS[data.settings?.pace]) : '—')}</strong>${t('xPaceLabel')}</div>
      <div><strong>${esc(SCORING_KEYS[data.settings?.scoring] ? t(SCORING_KEYS[data.settings?.scoring]) : '—')}</strong>${t('xScoringLabel')}</div>
      <div><strong>${esc(new Date(data.exportedAt).toLocaleString(loc()))}</strong>${t('xExportedAt')}</div>
    </div>`;
  }

  /** جدول العلامات — الأوائل الثلاثة بخلفية مميّزة */
  function marksTableHtml(data) {
    const participants = (data.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const hasTeams = participants.some((p) => p.team);
    const rows = participants
      .map((p, i) => {
        const rank = p.rank ?? i + 1;
        return `<tr class="${rank <= 3 ? 'rank-' + rank : ''}">
        <td>${rank}</td><td>${esc(p.name)}</td>${hasTeams ? `<td>${esc(p.team || '—')}</td>` : ''}
        <td>${p.score}</td><td>${p.maxScore ?? data.maxScore ?? 0}</td>
        <td>${p.percent === null || p.percent === undefined ? '—' : p.percent + t('pctSuffix')}</td>
        <td>${p.correctCount ?? 0}</td>
        <td>${p.answered ?? 0} / ${(p.answered ?? 0) + (p.unanswered ?? 0)}</td>
      </tr>`;
      })
      .join('');
    return `<table><thead><tr>
      <th>${t('xRank')}</th><th>${t('aStudent')}</th>${hasTeams ? `<th>${t('xTeam')}</th>` : ''}
      <th>${t('aScore')}</th><th>${t('xMaxScore')}</th><th>${t('xPctCol')}</th>
      <th>${t('aCorrect')}</th><th>${t('xAnswered')}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function page(data, title, inner) {
    return `<!doctype html><html lang="${loc()}" dir="${isRtl() ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PRINT_CSS}</style></head><body>
${inner}
<p class="foot">Tapio — tapio.fun · ${t('xFooterNote')}</p>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 500); });<\/script>
</body></html>`;
  }

  /**
   * تقرير التحليل الكامل: ترويسة ملوّنة، بطاقة النشاط، ثم التحليل بالرسوم
   * والتوصيات من محرّك لوحة التحليل نفسه، ثم تفصيل كل سؤال وجدول العلامات.
   */
  function pdfHtml(data) {
    const questions = data.questions || [];
    const analysis = global.Analytics ? global.Analytics.compute(data) : null;

    const questionBlocks = questions
      .map((q) => {
        const results = q.results || {};
        let body = '';
        if (results.options) {
          body = `<ul>${results.options
            .map((o) => `<li>${esc(o.text)} — ${o.percent}${t('pctSuffix')} (${o.count})${o.correct ? ' ✔' : ''}</li>`)
            .join('')}</ul>`;
        } else if (results.words) {
          body = `<p>${results.words.map((w) => `${esc(w.text)} (${w.count})`).join(t('listSep'))}</p>`;
        } else if (results.average !== undefined && results.average !== null) {
          body = `<p>${t('sAverage')}${results.average}</p>`;
        } else if (results.responses) {
          body = `<ul>${results.responses
            .map((r) => `<li>${esc(r.text)}${r.name ? ` — <strong>${esc(r.name)}</strong>` : ''}</li>`)
            .join('')}</ul>`;
        }
        const stats = [
          t('xAnsweredN', { n: q.responses }),
          q.accuracy === null || q.accuracy === undefined ? null : t('aAccuracyOnly', { pct: q.accuracy }),
          q.avgSeconds ? t('aAvgSeconds', { sec: q.avgSeconds }) : null,
          q.maxPoints ? t('xScoreN', { n: q.maxPoints }) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div class="q"><h3>${q.index}. ${esc(q.text)} <small>(${esc(TYPE_AR[q.type] ? t(TYPE_AR[q.type]) : q.type)})</small></h3>
          <p class="meta">${esc(stats)}</p>
          ${q.correct && q.correct.length ? `<p class="ok">${t('xCorrectAnswer')}: ${esc(q.correct.join(t('listSep')))}</p>` : ''}
          ${q.blanks && q.blanks.filter(Boolean).length ? `<p class="ok">${t('xExpectedAnswers')}: ${esc(q.blanks.filter(Boolean).join(' · '))}</p>` : ''}
          ${body}</div>`;
      })
      .join('');

    return page(
      data,
      `${t('xReportOf')} ${data.title} — Tapio`,
      `${heroHtml(data, t('xReportOf'))}
${metaGridHtml(data)}
${analysis ? `<h2>${t('xAnalysisSection')}</h2>${global.Analytics.reportHtml(analysis, { print: true })}` : ''}
<h2>${t('xQuestionDetail')}</h2>
${questionBlocks}
<h2>${t('xResultsRecord')}</h2>
${marksTableHtml(data)}`
    );
  }

  /** سجل علامات الطلاب: تعريف النشاط، جدول العلامات، ثم سطرا التوقيع */
  function resultsPdfHtml(data) {
    return page(
      data,
      `${t('xResultsRecord')} — ${data.title} — Tapio`,
      `${heroHtml(data, t('xResultsRecord'))}
${metaGridHtml(data)}
<h2>${t('xResultsRecord')}</h2>
${marksTableHtml(data)}
<div class="sign-row">
  <div class="sign"><i></i>${esc(t('xSigTeacher'))}${data.teacher ? `<br><strong>${esc(data.teacher)}</strong>` : ''}</div>
  <div class="sign"><i></i>${esc(t('xSigPrincipal'))}</div>
</div>`
    );
  }

  function openPrintWindow(html) {
    const win = window.open('', '_blank');
    if (!win) return false; // المتصفح منع النافذة المنبثقة
    win.document.write(html);
    win.document.close();
    return true;
  }

  function toPdf(data) {
    return openPrintWindow(pdfHtml(data));
  }

  function toResultsPdf(data) {
    return openPrintWindow(resultsPdfHtml(data));
  }

  global.Exporter = {
    toExcel, toResultsExcel,
    toPdf, toResultsPdf,          // تقرير ملوّن عبر نافذة الطباعة (الأجمل)
    toPdfFile, toResultsPdfFile,  // تنزيل مباشر بلا نافذة (أبسط)
    toXlsx, buildSheets, buildResultsSheets, pdfHtml, resultsPdfHtml, ensurePdfLibs, crc32,
  };
})(window);
