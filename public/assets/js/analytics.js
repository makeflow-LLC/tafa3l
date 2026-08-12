(function (global) {
  'use strict';

  /**
   * تحليل نتائج النشاط: أرقام تُقرأ بلمحة، رسوم بسيطة (SVG/CSS بلا مكتبات)،
   * وتوصيات مكتوبة بلغة المعلّم. مصدر البيانات واحد: مخرجات
   * /api/sessions/:code/export — فالشاشة والتقرير المطبوع يقولان الشيء نفسه.
   */

  const TYPE_AR = {
    mc: 'اختيار من متعدد',
    truefalse: 'صح / خطأ',
    poll: 'استطلاع',
    word: 'سحابة كلمات',
    scale: 'مقياس',
    open: 'سؤال مفتوح',
    blank: 'أكمل الفراغ',
  };

  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

  /** يحسب كل ما يحتاجه المعلّم من ملف التصدير */
  function compute(data) {
    const questions = data.questions || [];
    const participants = (data.participants || []).slice().sort((a, b) => b.score - a.score);
    const scored = questions.filter((q) => q.scored);
    const answeredAny = participants.filter((p) => p.answered > 0);

    // متوسط النسبة المئوية للصف — المؤشر الأول على مستوى الفهم
    const percents = participants.map((p) => (p.percent === null ? null : p.percent)).filter((v) => v !== null);
    const avgPercent = percents.length ? Math.round(percents.reduce((s, v) => s + v, 0) / percents.length) : null;
    const sortedPercents = percents.slice().sort((a, b) => a - b);
    const median = sortedPercents.length
      ? sortedPercents.length % 2
        ? sortedPercents[(sortedPercents.length - 1) / 2]
        : Math.round((sortedPercents[sortedPercents.length / 2 - 1] + sortedPercents[sortedPercents.length / 2]) / 2)
      : null;

    // توزيع الدرجات على شرائح — يكشف هل الصف متجانس أم منقسم
    const bands = [
      { label: '٠–٤٩٪', min: 0, max: 49, count: 0, tone: 'bad' },
      { label: '٥٠–٦٤٪', min: 50, max: 64, count: 0, tone: 'warn' },
      { label: '٦٥–٧٩٪', min: 65, max: 79, count: 0, tone: 'brand' },
      { label: '٨٠–٨٩٪', min: 80, max: 89, count: 0, tone: 'ok' },
      { label: '٩٠–١٠٠٪', min: 90, max: 100, count: 0, tone: 'ok' },
    ];
    percents.forEach((value) => {
      // مضاعف السلسلة قد يرفع النسبة فوق ١٠٠٪، فنضعها في الشريحة العليا لا نُسقطها
      const capped = Math.min(100, Math.max(0, value));
      const band = bands.find((b) => capped >= b.min && capped <= b.max);
      if (band) band.count += 1;
    });

    const withAccuracy = scored.filter((q) => q.accuracy !== null);
    const hardest = withAccuracy.slice().sort((a, b) => a.accuracy - b.accuracy || b.avgSeconds - a.avgSeconds)[0] || null;
    const easiest = withAccuracy.slice().sort((a, b) => b.accuracy - a.accuracy || a.avgSeconds - b.avgSeconds)[0] || null;
    const answeredQuestions = questions.filter((q) => q.responses > 0);
    const fastest = answeredQuestions.slice().sort((a, b) => a.avgSeconds - b.avgSeconds)[0] || null;
    const slowest = answeredQuestions.slice().sort((a, b) => b.avgSeconds - a.avgSeconds)[0] || null;
    // سؤال تركه كثيرون بلا إجابة: مؤشر على غموض الصياغة أو ضيق الوقت
    const mostSkipped = questions
      .slice()
      .sort((a, b) => a.responses - b.responses)
      .filter((q) => q.responses < participants.length)[0] || null;

    const needsReview = withAccuracy.filter((q) => q.accuracy < 50).sort((a, b) => a.accuracy - b.accuracy);
    const strugglers = participants.filter((p) => p.percent !== null && p.percent < 50);
    const top = participants.slice(0, 3);
    const pendingTotal = questions.reduce((sum, q) => sum + (q.pending || 0), 0);
    const participation = participants.length
      ? Math.round(
          participants.reduce((sum, p) => sum + pct(p.answered, questions.length), 0) / participants.length
        )
      : 0;

    return {
      title: data.title,
      code: data.code,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      durationMinutes: data.durationMinutes,
      settings: data.settings || {},
      questions,
      participants,
      questionCount: questions.length,
      scoredCount: scored.length,
      participantCount: participants.length,
      activeCount: answeredAny.length,
      maxScore: data.maxScore || 0,
      avgPercent,
      median,
      bands,
      participation,
      pendingTotal,
      hardest,
      easiest,
      fastest,
      slowest,
      mostSkipped,
      needsReview,
      strugglers,
      top,
      recommendations: recommend({
        questions,
        participants,
        avgPercent,
        participation,
        needsReview,
        strugglers,
        hardest,
        easiest,
        mostSkipped,
        pendingTotal,
        scoredCount: scored.length,
      }),
    };
  }

  /** توصيات مكتوبة — كل واحدة مبنية على رقم في هذا النشاط لا نصيحة عامة */
  function recommend(ctx) {
    const out = [];
    const total = ctx.participants.length;

    if (!ctx.scoredCount) {
      out.push({
        tone: 'info',
        text: 'هذا النشاط بلا أسئلة مصحَّحة (استطلاع/آراء) — استخدم نتائجه لقياس الاتجاه العام لا لتقييم المستوى.',
      });
    }

    if (ctx.avgPercent !== null) {
      if (ctx.avgPercent >= 85) {
        out.push({
          tone: 'ok',
          text: `متوسط الصف ${ctx.avgPercent}٪ — المستوى ممتاز. ارفع سقف التحدي في النشاط القادم: أسئلة تطبيقية أعلى من مستوى التذكّر، أو قلّل الوقت قليلاً.`,
        });
      } else if (ctx.avgPercent >= 65) {
        out.push({
          tone: 'ok',
          text: `متوسط الصف ${ctx.avgPercent}٪ — مستوى جيد. ركّز مراجعتك على الأسئلة الأقل دقة أدناه بدل إعادة الدرس كاملاً.`,
        });
      } else if (ctx.avgPercent >= 50) {
        out.push({
          tone: 'warn',
          text: `متوسط الصف ${ctx.avgPercent}٪ — الفهم متوسط. أعد شرح المفاهيم التي ظهرت في الأسئلة الصعبة، ثم أعد اختباراً قصيراً بعد يومين.`,
        });
      } else {
        out.push({
          tone: 'bad',
          text: `متوسط الصف ${ctx.avgPercent}٪ — أقل من النصف. غالباً المشكلة في الشرح لا في الطلاب: أعد المفهوم بمثال محسوس ثم اختبر مفهوماً واحداً في كل سؤال.`,
        });
      }
    }

    if (ctx.needsReview.length) {
      const list = ctx.needsReview.slice(0, 3).map((q) => `«${q.text}» (${q.accuracy}٪)`).join('، ');
      out.push({
        tone: 'bad',
        text:
          ctx.needsReview.length === 1
            ? `سؤال واحد يحتاج إعادة شرح — ${list}.`
            : `${ctx.needsReview.length} أسئلة تحتاج إعادة شرح — أقلّها دقة: ${list}.`,
      });
    }

    if (ctx.hardest && ctx.hardest.accuracy !== null && ctx.hardest.accuracy < 40 && ctx.hardest.type === 'mc') {
      out.push({
        tone: 'info',
        text: `في «${ctx.hardest.text}» راجع الخيارات نفسها: حين تهبط الدقة تحت ٤٠٪ يكون أحد الخيارات المضلِّلة قريباً جداً من الصحيح أو الصياغة ملتبسة.`,
      });
    }

    if (ctx.easiest && ctx.easiest.accuracy !== null && ctx.easiest.accuracy >= 95 && ctx.scoredCount > 2) {
      out.push({
        tone: 'info',
        text: `«${ctx.easiest.text}» أجاب عنه الجميع تقريباً (${ctx.easiest.accuracy}٪) — مناسب كسؤال تهيئة، لكن لا يقيس فرقاً بين الطلاب.`,
      });
    }

    if (ctx.participation < 80 && total > 1) {
      out.push({
        tone: 'warn',
        text: `نسبة المشاركة ${ctx.participation}٪ فقط — أعطِ وقتاً أطول للأسئلة الطويلة، أو فعّل الوضع الحر ليجيب كل طالب بسرعته.`,
      });
    }

    if (ctx.mostSkipped && ctx.mostSkipped.responses < total) {
      out.push({
        tone: 'warn',
        text: `«${ctx.mostSkipped.text}» تركه ${total - ctx.mostSkipped.responses} من ${total} بلا إجابة — راجع وضوح صياغته أو الوقت المخصّص له.`,
      });
    }

    if (ctx.strugglers.length) {
      const names = ctx.strugglers.slice(0, 5).map((p) => p.name).join('، ');
      out.push({
        tone: 'warn',
        text:
          ctx.strugglers.length === 1
            ? `طالب واحد تحت ٥٠٪ (${names}) — يحتاج متابعة فردية قصيرة قبل الدرس القادم.`
            : `${ctx.strugglers.length} طلاب تحت ٥٠٪ (${names}) — يحتاجون متابعة فردية قصيرة قبل الدرس القادم.`,
      });
    }

    if (ctx.pendingTotal) {
      out.push({
        tone: 'bad',
        text: `${ctx.pendingTotal} إجابة نصّية لم تُصحَّح بعد — نتائج أصحابها ناقصة حتى تكمل التصحيح من لوحة التحكم.`,
      });
    }

    if (ctx.slowest && ctx.slowest.avgSeconds > 45) {
      out.push({
        tone: 'info',
        text: `«${ctx.slowest.text}» استغرق ${ctx.slowest.avgSeconds} ثانية وسطياً — إن لم يكن سؤال تفكير عميق فاختصر صياغته.`,
      });
    }

    return out;
  }

  // ------------------------------------------------------------- رسوم SVG

  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const TONE = { ok: '#128a4d', warn: '#a45c00', bad: '#cc2f2f', brand: '#5b45e0', brand2: '#0b7f96' };

  /** حلقة نسبة مئوية — رقم واحد كبير يُقرأ من بعيد */
  function donutSvg(percent, label, tone) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    const r = 52;
    const c = 2 * Math.PI * r;
    const color = TONE[tone] || TONE.brand;
    return `<svg viewBox="0 0 140 140" class="chart-donut" role="img" aria-label="${esc(label)}: ${value}٪">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.14" stroke-width="14"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${(c * value) / 100} ${c}" transform="rotate(-90 70 70)"/>
      <text x="70" y="66" text-anchor="middle" font-size="30" font-weight="800" fill="currentColor">${value}٪</text>
      <text x="70" y="90" text-anchor="middle" font-size="13" fill="currentColor" opacity="0.7">${esc(label)}</text>
    </svg>`;
  }

  /** أعمدة أفقية: تعمل مع العربية بلا انقلاب ولا حاجة لمكتبة */
  function barsHtml(rows) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return `<div class="chart-bars">${rows
      .map(
        (row) => `<div class="chart-bar">
          <span class="chart-label" title="${esc(row.label)}">${esc(row.label)}</span>
          <span class="chart-track"><i style="width:${Math.max(2, (row.value / max) * 100)}%;background:${
            TONE[row.tone] || TONE.brand
          }"></i></span>
          <span class="chart-value">${esc(row.display ?? row.value)}</span>
        </div>`
      )
      .join('')}</div>`;
  }

  /** بطاقة رقم واحد */
  function statHtml(value, label, tone) {
    return `<div class="chart-stat"><strong style="color:${TONE[tone] || 'inherit'}">${esc(value)}</strong><span>${esc(
      label
    )}</span></div>`;
  }

  /** التحليل كاملاً بصيغة HTML — تستعمله لوحة المعلّم وتقرير PDF معاً */
  function reportHtml(a, opts) {
    const forPrint = opts?.print;
    const accuracyRows = a.questions
      .filter((q) => q.scored && q.accuracy !== null)
      .map((q) => ({
        label: `${q.index}. ${q.text}`,
        value: q.accuracy,
        display: q.accuracy + '٪',
        tone: q.accuracy >= 80 ? 'ok' : q.accuracy >= 50 ? 'warn' : 'bad',
      }));

    const timeRows = a.questions
      .filter((q) => q.responses > 0)
      .map((q) => ({ label: `${q.index}. ${q.text}`, value: q.avgSeconds, display: q.avgSeconds + 'ث', tone: 'brand2' }));

    const bandRows = a.bands.map((b) => ({
      label: b.label,
      value: b.count,
      display: `${b.count} ${b.count === 1 ? 'طالب' : 'طلاب'}`,
      tone: b.tone,
    }));

    const highlight = (item, title, tone, extra) =>
      item
        ? `<div class="chart-highlight ${tone}"><span class="t">${esc(title)}</span><strong>${esc(
            item.text
          )}</strong><span class="v">${esc(extra)}</span></div>`
        : '';

    return `
    <div class="chart-stats">
      ${statHtml(a.participantCount, 'مشارك', 'brand')}
      ${statHtml(a.questionCount, 'سؤال', 'brand')}
      ${statHtml(a.durationMinutes + ' د', 'مدة النشاط', 'brand')}
      ${a.avgPercent !== null ? statHtml(a.avgPercent + '٪', 'متوسط الصف', a.avgPercent >= 65 ? 'ok' : a.avgPercent >= 50 ? 'warn' : 'bad') : ''}
      ${a.median !== null ? statHtml(a.median + '٪', 'الوسيط', 'brand2') : ''}
      ${statHtml(a.participation + '٪', 'نسبة المشاركة', a.participation >= 80 ? 'ok' : 'warn')}
    </div>

    <div class="chart-row">
      ${a.avgPercent !== null ? `<div class="chart-card">${donutSvg(a.avgPercent, 'متوسط الدرجات', a.avgPercent >= 65 ? 'ok' : a.avgPercent >= 50 ? 'warn' : 'bad')}</div>` : ''}
      <div class="chart-card grow">
        <h3>توزيع الدرجات على الصف</h3>
        ${bandRows.some((r) => r.value) ? barsHtml(bandRows) : '<p class="muted small">لا توجد درجات بعد</p>'}
      </div>
    </div>

    <div class="chart-highlights">
      ${highlight(a.hardest, '🔴 أصعب سؤال', 'bad', a.hardest ? `دقة ${a.hardest.accuracy}٪ · ${a.hardest.avgSeconds}ث وسطياً` : '')}
      ${highlight(a.easiest, '🟢 أسهل سؤال', 'ok', a.easiest ? `دقة ${a.easiest.accuracy}٪` : '')}
      ${highlight(a.fastest, '⚡ الأسرع إجابةً', 'brand', a.fastest ? `${a.fastest.avgSeconds}ث وسطياً` : '')}
      ${highlight(a.slowest, '🐢 الأبطأ إجابةً', 'warn', a.slowest ? `${a.slowest.avgSeconds}ث وسطياً` : '')}
      ${highlight(a.mostSkipped, '⏭ الأكثر تخطّياً', 'warn', a.mostSkipped ? `أجاب عنه ${a.mostSkipped.responses} من ${a.participantCount}` : '')}
    </div>

    ${accuracyRows.length ? `<div class="chart-card"><h3>دقة الإجابة لكل سؤال</h3>${barsHtml(accuracyRows)}</div>` : ''}
    ${timeRows.length ? `<div class="chart-card"><h3>متوسط زمن الإجابة</h3>${barsHtml(timeRows)}</div>` : ''}

    <div class="chart-card">
      <h3>الطلاب</h3>
      <table class="chart-table"><thead><tr><th>#</th><th>الطالب</th><th>الدرجة</th><th>النسبة</th><th>صحيحة</th><th>متوسط الزمن</th></tr></thead><tbody>
      ${a.participants
        .map(
          (p) => `<tr><td>${p.rank ?? ''}</td><td>${esc(p.name)}</td><td>${p.score}${
            a.maxScore ? ' من ' + a.maxScore : ''
          }</td><td>${p.percent === null ? '—' : p.percent + '٪'}</td><td>${p.correctCount}${
            p.partialCount ? ` (+${p.partialCount} جزئي)` : ''
          }</td><td>${p.avgSeconds}ث</td></tr>`
        )
        .join('')}
      </tbody></table>
    </div>

    <div class="chart-card">
      <h3>📌 التوصيات</h3>
      ${
        a.recommendations.length
          ? `<ul class="rec-list">${a.recommendations
              .map((r) => `<li class="rec ${r.tone}">${esc(r.text)}</li>`)
              .join('')}</ul>`
          : '<p class="muted small">لا توجد ملاحظات — النتائج متوازنة.</p>'
      }
    </div>
    ${forPrint ? '' : ''}`;
  }

  global.Analytics = { compute, reportHtml, donutSvg, barsHtml, TYPE_AR };
})(window);
