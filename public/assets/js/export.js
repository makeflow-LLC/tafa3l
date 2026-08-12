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

  const TYPE_AR = {
    mc: 'اختيار من متعدد',
    truefalse: 'صح/خطأ',
    poll: 'استطلاع',
    word: 'سحابة كلمات',
    scale: 'مقياس',
    open: 'سؤال مفتوح',
  };

  /** يحوّل مخرجات /api/sessions/:code/export إلى أوراق جاهزة */
  function buildSheets(data) {
    const questions = data.questions || [];
    const participants = (data.participants || []).slice().sort((a, b) => b.score - a.score);

    const summary = [
      ['نشاط', data.title],
      ['رمز الجلسة', data.code],
      ['تاريخ التصدير', new Date(data.exportedAt).toLocaleString('ar')],
      ['عدد الأسئلة', questions.length],
      ['عدد المشاركين', participants.length],
    ];

    const people = [['الترتيب', 'المشارك', 'النقاط', 'عدد الإجابات', 'إجابات صحيحة', 'متوسط الزمن (ث)']];
    participants.forEach((p, i) => {
      const answers = (p.answers || []).filter(Boolean);
      const correct = answers.filter((a) => a.correct === true).length;
      const seconds = answers.length ? answers.reduce((sum, a) => sum + (a.seconds || 0), 0) / answers.length : 0;
      people.push([i + 1, p.name, p.score, answers.length, correct, Math.round(seconds * 10) / 10]);
    });

    const qRows = [['#', 'النوع', 'السؤال', 'الخيارات', 'الإجابة الصحيحة', 'عدد الإجابات']];
    questions.forEach((q) => {
      qRows.push([
        q.index,
        TYPE_AR[q.type] || q.type,
        q.text,
        (q.options || []).join(' | '),
        (q.correct || []).join(' | '),
        q.results?.total || 0,
      ]);
    });

    // كل إجابة في سطر: هذا ما يريده المعلّم للتحليل في Excel
    const detail = [['المشارك', '#', 'السؤال', 'إجابته', 'صحيحة؟', 'النقاط', 'الزمن (ث)']];
    participants.forEach((p) => {
      (p.answers || []).forEach((a, i) => {
        if (!a) return;
        detail.push([
          p.name,
          i + 1,
          a.question,
          Array.isArray(a.answer) ? a.answer.join(' + ') : a.answer,
          a.correct === null || a.correct === undefined
            ? '—'
            : a.correct === 'partial'
              ? 'جزئي'
              : a.correct
                ? 'نعم'
                : 'لا',
          a.points || 0,
          a.seconds || 0,
        ]);
      });
    });

    return [
      { name: 'ملخّص', rows: summary },
      { name: 'المشاركون', rows: people },
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

  function pdfHtml(data) {
    const questions = data.questions || [];
    const participants = (data.participants || []).slice().sort((a, b) => b.score - a.score);
    const row = (cells, tag = 'td') => `<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;

    const peopleRows = participants
      .map((p, i) => {
        const answers = (p.answers || []).filter(Boolean);
        const correct = answers.filter((a) => a.correct === true).length;
        return row([i + 1, p.name, p.score, `${correct}/${answers.length}`]);
      })
      .join('');

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
          // الإجابات النصّية: نص كل مشارك مع اسمه إن كان النشاط بأسماء
          body = `<ul>${results.responses
            .map((r) => `<li>${esc(r.text)}${r.name ? ` — <strong>${esc(r.name)}</strong>` : ''}</li>`)
            .join('')}</ul>`;
        }
        return `<div class="q"><h3>${q.index}. ${esc(q.text)} <small>(${esc(TYPE_AR[q.type] || q.type)})</small></h3>${
          q.correct && q.correct.length ? `<p class="ok">الإجابة الصحيحة: ${esc(q.correct.join('، '))}</p>` : ''
        }${body}</div>`;
      })
      .join('');

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تقرير ${esc(data.title)} — Tapio</title>
<style>
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; color: #16162a; margin: 28px; }
  h1 { margin: 0 0 4px; }
  .meta { color: #61657d; margin-bottom: 18px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 22px; }
  th, td { border: 1px solid #d7dae6; padding: 7px 9px; text-align: right; font-size: 14px; }
  th { background: #f1f3f9; }
  .q { break-inside: avoid; margin-bottom: 14px; border: 1px solid #e3e6ef; border-radius: 10px; padding: 10px 14px; }
  .q h3 { margin: 0 0 6px; font-size: 15px; }
  .ok { color: #128a4d; margin: 0 0 6px; font-size: 13px; }
  ul { margin: 4px 0; padding-inline-start: 20px; font-size: 14px; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<h1>${esc(data.title)}</h1>
<p class="meta">رمز الجلسة ${esc(data.code)} · ${participants.length} مشاركاً · ${questions.length} سؤالاً · ${esc(
      new Date(data.exportedAt).toLocaleString('ar')
    )}</p>
<h2>ترتيب المشاركين</h2>
<table><thead>${row(['الترتيب', 'المشارك', 'النقاط', 'إجابات صحيحة'], 'th')}</thead><tbody>${peopleRows}</tbody></table>
<h2>نتائج الأسئلة</h2>
${questionBlocks}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });<\/script>
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
