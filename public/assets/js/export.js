(function (global) {
  'use strict';

  /**
   * تصدير نتائج الجلسة (ميزة بريميوم): ملف Excel حقيقي (.xlsx) وتقرير PDF.
   *
   * بلا أي مكتبة خارجية: نكتب حزمة xlsx بأنفسنا (zip بمدخلات غير مضغوطة)،
   * وتقرير PDF عبر نافذة طباعة مهيّأة يختار فيها المستخدم «حفظ كـ PDF».
   */

  const enc = new TextEncoder();

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

  const PACE_AR = { host: 'المدرب ينقل الأسئلة', auto: 'انتقال تلقائي', self: 'كل طالب بسرعته' };
  const SCORING_AR = { speed: 'نقاط حسب السرعة', flat: 'نقاط ثابتة', none: 'بلا نقاط' };

  const TYPE_AR = {
    mc: 'اختيار من متعدد',
    truefalse: 'صح/خطأ',
    poll: 'استطلاع',
    word: 'سحابة كلمات',
    scale: 'مقياس',
    open: 'سؤال مفتوح',
    blank: 'أكمل الفراغ',
  };

  /** يحوّل مخرجات /api/sessions/:code/export إلى أوراق جاهزة */
  function buildSheets(data) {
    const questions = data.questions || [];
    const participants = (data.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const analysis = global.Analytics ? global.Analytics.compute(data) : null;
    const started = new Date(data.startedAt || data.exportedAt);
    const ended = new Date(data.endedAt || data.exportedAt);

    // ورقة التعريف: كل ما يسأل عنه المعلّم قبل أن ينظر في الدرجات
    const info = [
      ['اسم النشاط', data.title],
      ...(data.teacher ? [['المعلّم', data.teacher]] : []),
      ['رمز الجلسة', data.code],
      ['التاريخ', started.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })],
      ['وقت البدء', started.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })],
      ['وقت الانتهاء', ended.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })],
      ['مدة النشاط (دقيقة)', data.durationMinutes || 1],
      ['عدد الطلاب', data.participantCount ?? participants.length],
      ['عدد الأسئلة', data.questionCount ?? questions.length],
      ['العلامة الكاملة', data.maxScore || 0],
      ['نمط العرض', PACE_AR[data.settings?.pace] || '—'],
      ['احتساب النقاط', SCORING_AR[data.settings?.scoring] || '—'],
      ['تاريخ التصدير', new Date(data.exportedAt).toLocaleString('ar')],
    ];
    if (analysis) {
      info.push([]);
      info.push(['متوسط الصف (٪)', analysis.avgPercent ?? '—']);
      info.push(['وسيط الدرجات (٪)', analysis.median ?? '—']);
      info.push(['نسبة المشاركة (٪)', analysis.participation]);
      info.push(['أصعب سؤال', analysis.hardest ? `${analysis.hardest.text} (${analysis.hardest.accuracy}٪)` : '—']);
      info.push(['أسهل سؤال', analysis.easiest ? `${analysis.easiest.text} (${analysis.easiest.accuracy}٪)` : '—']);
      info.push(['الأسرع إجابةً', analysis.fastest ? `${analysis.fastest.text} (${analysis.fastest.avgSeconds}ث)` : '—']);
      info.push(['الأبطأ إجابةً', analysis.slowest ? `${analysis.slowest.text} (${analysis.slowest.avgSeconds}ث)` : '—']);
      info.push(['إجابات تنتظر التصحيح', analysis.pendingTotal]);
      info.push([]);
      info.push(['التوصيات', '']);
      analysis.recommendations.forEach((rec, i) => info.push([`توصية ${i + 1}`, rec.text]));
    }

    const people = [
      ['الترتيب', 'الطالب', 'الفريق', 'الدرجة', 'العلامة الكاملة', 'النسبة ٪', 'أجاب', 'لم يجب', 'صحيحة', 'جزئية', 'خاطئة', 'بانتظار التصحيح', 'أطول سلسلة', 'متوسط الزمن (ث)'],
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

    const qRows = [
      ['#', 'النوع', 'السؤال', 'الخيارات', 'الإجابة الصحيحة', 'العلامة', 'عدد الإجابات', 'صحيحة', 'جزئية', 'خاطئة', 'الدقة ٪', 'متوسط الزمن (ث)'],
    ];
    questions.forEach((q) => {
      qRows.push([
        q.index,
        TYPE_AR[q.type] || q.type,
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
    const detail = [['الطالب', '#', 'السؤال', 'إجابته', 'صحيحة؟', 'النقاط', 'من', 'الزمن (ث)']];
    participants.forEach((p) => {
      (p.answers || []).forEach((a, i) => {
        if (!a) return;
        detail.push([
          p.name,
          i + 1,
          a.question,
          Array.isArray(a.answer) ? a.answer.join(' + ') : a.answer,
          a.pending
            ? 'بانتظار التصحيح'
            : a.correct === null || a.correct === undefined
              ? '—'
              : a.correct === 'partial'
                ? 'جزئي'
                : a.correct
                  ? 'نعم'
                  : 'لا',
          a.points || 0,
          a.maxPoints || 0,
          a.seconds || 0,
        ]);
      });
    });

    return [
      { name: 'بطاقة النشاط', rows: info },
      { name: 'الطلاب', rows: people },
      { name: 'الأسئلة', rows: qRows },
      { name: 'الإجابات', rows: detail },
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

  // ------------------------------------------------------------------ pdf

  /** أنماط التقرير المطبوع — مستقلة عن صفحة التطبيق لأن النافذة جديدة */
  const PRINT_CSS = `
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
  @media print { body { margin: 12mm; } }`;


  /**
   * تقرير المعلّم الكامل: بطاقة تعريف النشاط، ثم التحليل والرسوم والتوصيات
   * (من نفس محرّك لوحة التحليل)، ثم تفصيل كل سؤال وكل طالب.
   */
  function pdfHtml(data) {
    const questions = data.questions || [];
    const analysis = global.Analytics ? global.Analytics.compute(data) : null;
    const started = new Date(data.startedAt || data.exportedAt);
    const ended = new Date(data.endedAt || data.exportedAt);

    const questionBlocks = questions
      .map((q) => {
        const results = q.results || {};
        let body = '';
        if (results.options) {
          body = `<ul>${results.options
            .map((o) => `<li>${esc(o.text)} — ${o.percent}٪ (${o.count})${o.correct ? ' ✔' : ''}</li>`)
            .join('')}</ul>`;
        } else if (results.words) {
          body = `<p>${results.words.map((w) => `${esc(w.text)} (${w.count})`).join('، ')}</p>`;
        } else if (results.average !== undefined && results.average !== null) {
          body = `<p>المتوسط: ${results.average}</p>`;
        } else if (results.responses) {
          body = `<ul>${results.responses
            .map((r) => `<li>${esc(r.text)}${r.name ? ` — <strong>${esc(r.name)}</strong>` : ''}</li>`)
            .join('')}</ul>`;
        }
        const stats = [
          `أجاب ${q.responses}`,
          q.accuracy === null || q.accuracy === undefined ? null : `دقة ${q.accuracy}٪`,
          q.avgSeconds ? `${q.avgSeconds}ث وسطياً` : null,
          q.maxPoints ? `العلامة ${q.maxPoints}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div class="q"><h3>${q.index}. ${esc(q.text)} <small>(${esc(TYPE_AR[q.type] || q.type)})</small></h3>
          <p class="meta">${esc(stats)}</p>
          ${q.correct && q.correct.length ? `<p class="ok">الإجابة الصحيحة: ${esc(q.correct.join('، '))}</p>` : ''}
          ${q.blanks && q.blanks.filter(Boolean).length ? `<p class="ok">الإجابات المتوقعة: ${esc(q.blanks.filter(Boolean).join(' · '))}</p>` : ''}
          ${body}</div>`;
      })
      .join('');

    const metaGrid = `<div class="meta-grid">
      ${data.teacher ? `<div><strong>${esc(data.teacher)}</strong>المعلّم</div>` : ''}
      <div><strong>${esc(data.code)}</strong>رمز الجلسة</div>
      <div><strong>${esc(started.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }))}</strong>التاريخ</div>
      <div><strong>${esc(started.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }))} — ${esc(
        ended.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })
      )}</strong>وقت البدء والانتهاء</div>
      <div><strong>${data.durationMinutes || 1} دقيقة</strong>مدة النشاط</div>
      <div><strong>${data.participantCount ?? (data.participants || []).length}</strong>عدد الطلاب</div>
      <div><strong>${data.questionCount ?? questions.length}</strong>عدد الأسئلة</div>
      <div><strong>${data.maxScore || 0}</strong>العلامة الكاملة</div>
      <div><strong>${esc(PACE_AR[data.settings?.pace] || '—')}</strong>نمط العرض</div>
      <div><strong>${esc(SCORING_AR[data.settings?.scoring] || '—')}</strong>احتساب النقاط</div>
    </div>`;

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تقرير ${esc(data.title)} — Tapio</title>
<style>${PRINT_CSS}</style></head><body>
<h1>${esc(data.title)}</h1>
<p class="meta">${data.teacher ? `المعلّم: <strong>${esc(data.teacher)}</strong> · ` : ''}تقرير نتائج · منصة Tapio · صدر في ${esc(
      new Date(data.exportedAt).toLocaleString('ar')
    )}</p>
${metaGrid}
${analysis ? `<h2>تحليل النتائج والتوصيات</h2>${global.Analytics.reportHtml(analysis, { print: true })}` : ''}
<h2>تفصيل الأسئلة</h2>
${questionBlocks}
<p class="foot">Tapio — tapio.fun · بيانات الطلاب مؤقتة ولا تُحفظ على الخادم بعد انتهاء الجلسة.</p>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });<\/script>
</body></html>`;
  }

  function toPdf(data) {
    const win = window.open('', '_blank');
    if (!win) return false; // المتصفح منع النافذة المنبثقة
    win.document.write(pdfHtml(data));
    win.document.close();
    return true;
  }

  global.Exporter = { toExcel, toPdf, toXlsx, buildSheets, pdfHtml, crc32 };
})(window);
