(function (global) {
  'use strict';

  /**
   * تحليل نتائج النشاط: أرقام تُقرأ بلمحة، رسوم بسيطة (SVG/CSS بلا مكتبات)،
   * وتوصيات مكتوبة بلغة المعلّم. مصدر البيانات واحد: مخرجات
   * /api/sessions/:code/export — فالشاشة والتقرير المطبوع يقولان الشيء نفسه.
   */

  const T = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
  const t = T;

  const TYPE_KEYS = {
    mc: 'typeMc',
    truefalse: 'typeTruefalse',
    poll: 'typePoll',
    word: 'typeWord',
    scale: 'typeScale',
    open: 'typeOpen',
    blank: 'typeBlank',
  };
  const TYPE_AR = {};
  for (const type of Object.keys(TYPE_KEYS)) {
    Object.defineProperty(TYPE_AR, type, { enumerable: true, get: () => T(TYPE_KEYS[type]) });
  }

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
      { label: '0–49' + T('pctSuffix'), min: 0, max: 49, count: 0, tone: 'bad' },
      { label: '50–64' + T('pctSuffix'), min: 50, max: 64, count: 0, tone: 'warn' },
      { label: '65–79' + T('pctSuffix'), min: 65, max: 79, count: 0, tone: 'brand' },
      { label: '80–89' + T('pctSuffix'), min: 80, max: 89, count: 0, tone: 'ok' },
      { label: '90–100' + T('pctSuffix'), min: 90, max: 100, count: 0, tone: 'ok' },
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

    /**
     * الأداء حسب المهارة — إن وسم المعلّم أسئلته.
     *
     * وهو أنفع ما في التقرير لمن يخطّط حصّته القادمة: «السؤال ٧ صعب» لا
     * يُبنى عليه درس، و«الصفّ ٤٠٪ في جمع الكسور» هو الدرس القادم نفسه.
     * والدقّة تُحسب من مجموع الإجابات لا من متوسّط نسب الأسئلة: سؤالٌ أجابه
     * ثلاثون لا يساوي سؤالاً أجابه ثلاثة.
     */
    const skillMap = new Map();
    scored.forEach((q) => {
      const skill = String(q.skill || '').trim();
      if (!skill) return;
      const row = skillMap.get(skill) || { skill, questions: 0, correct: 0, graded: 0, seconds: 0, responses: 0 };
      row.questions += 1;
      // المصحَّح = الصحيح + الجزئي + الخطأ؛ والمعلّق خارج الحساب حتى يُقرأ
      const graded = (q.correctCount || 0) + (q.partialCount || 0) + (q.wrongCount || 0);
      row.graded += graded;
      row.correct += (q.correctCount || 0) + (q.partialCount || 0) * 0.5;
      row.responses += q.responses || 0;
      row.seconds += (q.avgSeconds || 0) * (q.responses || 0);
      skillMap.set(skill, row);
    });
    const skills = [...skillMap.values()]
      .map((row) => ({
        skill: row.skill,
        questions: row.questions,
        responses: row.responses,
        accuracy: row.graded ? Math.round((row.correct / row.graded) * 100) : null,
        avgSeconds: row.responses ? Math.round((row.seconds / row.responses) * 10) / 10 : 0,
      }))
      .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));
    const weakSkills = skills.filter((s) => s.accuracy !== null && s.accuracy < 60);

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
      skills,
      weakSkills,
      strugglers,
      top,
      recommendations: recommend({
        questions,
        participants,
        avgPercent,
        participation,
        needsReview,
        weakSkills,
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
        text: t('aRecNoScored'),
      });
    }

    if (ctx.avgPercent !== null) {
      if (ctx.avgPercent >= 85) {
        out.push({
          tone: 'ok',
          text: t('aRecExcellent', { pct: ctx.avgPercent }),
        });
      } else if (ctx.avgPercent >= 65) {
        out.push({
          tone: 'ok',
          text: t('aRecGood', { pct: ctx.avgPercent }),
        });
      } else if (ctx.avgPercent >= 50) {
        out.push({
          tone: 'warn',
          text: t('aRecMid', { pct: ctx.avgPercent }),
        });
      } else {
        out.push({
          tone: 'bad',
          text: t('aRecLow', { pct: ctx.avgPercent }),
        });
      }
    }

    /*
     * المهارة قبل السؤال في التوصيات: «راجع جمع الكسور» عملٌ يُخطَّط له،
     * و«راجع السؤال الرابع» ملاحظةٌ تُقرأ ثم تُنسى.
     */
    if (ctx.weakSkills && ctx.weakSkills.length) {
      const list = ctx.weakSkills.slice(0, 3).map((s) => `«${s.skill}» (${s.accuracy}${t('pctSuffix')})`).join(T('listSep'));
      out.push({ tone: 'bad', text: t('aRecWeakSkills', { list }) });
    }

    if (ctx.needsReview.length) {
      const list = ctx.needsReview.slice(0, 3).map((q) => `«${q.text}» (${q.accuracy}${t('pctSuffix')})`).join(T('listSep'));
      out.push({
        tone: 'bad',
        text:
          ctx.needsReview.length === 1
            ? t('aRecReviewOne', { list })
            : t('aRecReviewMany', { n: ctx.needsReview.length, list }),
      });
    }

    if (ctx.hardest && ctx.hardest.accuracy !== null && ctx.hardest.accuracy < 40 && ctx.hardest.type === 'mc') {
      out.push({
        tone: 'info',
        text: t('aRecDistractors', { text: ctx.hardest.text }),
      });
    }

    if (ctx.easiest && ctx.easiest.accuracy !== null && ctx.easiest.accuracy >= 95 && ctx.scoredCount > 2) {
      out.push({
        tone: 'info',
        text: t('aRecTooEasy', { text: ctx.easiest.text, pct: ctx.easiest.accuracy }),
      });
    }

    if (ctx.participation < 80 && total > 1) {
      out.push({
        tone: 'warn',
        text: t('aRecParticipation', { pct: ctx.participation }),
      });
    }

    if (ctx.mostSkipped && ctx.mostSkipped.responses < total) {
      out.push({
        tone: 'warn',
        text: t('aRecSkipped', { text: ctx.mostSkipped.text, n: total - ctx.mostSkipped.responses, total }),
      });
    }

    if (ctx.strugglers.length) {
      const names = ctx.strugglers.slice(0, 5).map((p) => p.name).join(T('listSep'));
      out.push({
        tone: 'warn',
        text:
          ctx.strugglers.length === 1
            ? t('aRecOneStruggler', { names })
            : t('aRecStrugglers', { n: ctx.strugglers.length, names }),
      });
    }

    if (ctx.pendingTotal) {
      out.push({
        tone: 'bad',
        text: t('aRecPending', { n: ctx.pendingTotal }),
      });
    }

    if (ctx.slowest && ctx.slowest.avgSeconds > 45) {
      out.push({
        tone: 'info',
        text: t('aRecSlow', { text: ctx.slowest.text, sec: ctx.slowest.avgSeconds }),
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
    return `<svg viewBox="0 0 140 140" class="chart-donut" role="img" aria-label="${esc(label)}: ${value}${T('pctSuffix')}">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.14" stroke-width="14"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${(c * value) / 100} ${c}" transform="rotate(-90 70 70)"/>
      <text x="70" y="66" text-anchor="middle" font-size="30" font-weight="800" fill="currentColor">${value}${T('pctSuffix')}</text>
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
        display: q.accuracy + T('pctSuffix'),
        tone: q.accuracy >= 80 ? 'ok' : q.accuracy >= 50 ? 'warn' : 'bad',
      }));

    const timeRows = a.questions
      .filter((q) => q.responses > 0)
      .map((q) => ({ label: `${q.index}. ${q.text}`, value: q.avgSeconds, display: q.avgSeconds + T('aSecShort'), tone: 'brand2' }));

    /*
     * الأداء حسب المهارة: أضعفها أولاً — أول سطرٍ يقع عليه بصر المعلّم هو
     * ما يجب أن يفعله غداً. ولا يظهر القسم أصلاً إن لم يسم أسئلته.
     */
    const skillRows = (a.skills || [])
      .filter((s) => s.accuracy !== null)
      .map((s) => ({
        label: `${s.skill} · ${t('aSkillQuestions', { n: s.questions })}`,
        value: s.accuracy,
        display: s.accuracy + T('pctSuffix'),
        tone: s.accuracy >= 80 ? 'ok' : s.accuracy >= 50 ? 'warn' : 'bad',
      }));

    const bandRows = a.bands.map((b) => ({
      label: b.label,
      value: b.count,
      display: t('aStudentsCount', { n: b.count }),
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
      ${statHtml(a.participantCount, t('aParticipants'), 'brand')}
      ${statHtml(a.questionCount, t('aQuestions'), 'brand')}
      ${statHtml(t('aMinutesShort', { n: a.durationMinutes }), t('aDuration'), 'brand')}
      ${a.avgPercent !== null ? statHtml(a.avgPercent + t('pctSuffix'), t('aClassAverage'), a.avgPercent >= 65 ? 'ok' : a.avgPercent >= 50 ? 'warn' : 'bad') : ''}
      ${a.median !== null ? statHtml(a.median + t('pctSuffix'), t('aMedian'), 'brand2') : ''}
      ${statHtml(a.participation + t('pctSuffix'), t('aParticipation'), a.participation >= 80 ? 'ok' : 'warn')}
    </div>

    <div class="chart-row">
      ${a.avgPercent !== null ? `<div class="chart-card">${donutSvg(a.avgPercent, t('aAvgScore'), a.avgPercent >= 65 ? 'ok' : a.avgPercent >= 50 ? 'warn' : 'bad')}</div>` : ''}
      <div class="chart-card grow">
        <h3>${t('aDistribution')}</h3>
        ${bandRows.some((r) => r.value) ? barsHtml(bandRows) : `<p class="muted small">${t('aNoScores')}</p>`}
      </div>
    </div>

    <div class="chart-highlights">
      ${highlight(a.hardest, t('aHardest'), 'bad', a.hardest ? t('aAccuracyTime', { pct: a.hardest.accuracy, sec: a.hardest.avgSeconds }) : '')}
      ${highlight(a.easiest, t('aEasiest'), 'ok', a.easiest ? t('aAccuracyOnly', { pct: a.easiest.accuracy }) : '')}
      ${highlight(a.fastest, t('aFastest'), 'brand', a.fastest ? t('aAvgSeconds', { sec: a.fastest.avgSeconds }) : '')}
      ${highlight(a.slowest, t('aSlowest'), 'warn', a.slowest ? t('aAvgSeconds', { sec: a.slowest.avgSeconds }) : '')}
      ${highlight(a.mostSkipped, t('aMostSkipped'), 'warn', a.mostSkipped ? t('aAnsweredBy', { n: a.mostSkipped.responses, total: a.participantCount }) : '')}
    </div>

    ${
      skillRows.length
        ? `<div class="chart-card"><h3>${t('aBySkill')}</h3><p class="muted small">${t('aBySkillNote')}</p>${barsHtml(skillRows)}</div>`
        : ''
    }
    ${accuracyRows.length ? `<div class="chart-card"><h3>${t('aAccuracyPerQuestion')}</h3>${barsHtml(accuracyRows)}</div>` : ''}
    ${timeRows.length ? `<div class="chart-card"><h3>${t('aAvgAnswerTime')}</h3>${barsHtml(timeRows)}</div>` : ''}

    <div class="chart-card">
      <h3>${t('aStudents')}</h3>
      <table class="chart-table"><thead><tr><th>#</th><th>${t('aStudent')}</th><th>${t('aScore')}</th><th>${t('aPercent')}</th><th>${t('aCorrect')}</th><th>${t('aAvgTime')}</th></tr></thead><tbody>
      ${a.participants
        .map(
          (p) => `<tr><td>${p.rank ?? ''}</td><td>${esc(p.name)}</td><td>${p.score}${
            a.maxScore ? ' ' + t('aOutOf') + ' ' + a.maxScore : ''
          }</td><td>${p.percent === null ? '—' : p.percent + t('pctSuffix')}</td><td>${p.correctCount}${
            p.partialCount ? ` (+${p.partialCount} ${t('aPartial')})` : ''
          }</td><td>${p.avgSeconds}${t('aSecShort')}</td></tr>`
        )
        .join('')}
      </tbody></table>
    </div>

    <div class="chart-card">
      <h3>📌 ${t('aRecommendations')}</h3>
      ${
        a.recommendations.length
          ? `<ul class="rec-list">${a.recommendations
              .map((r) => `<li class="rec ${r.tone}">${esc(r.text)}</li>`)
              .join('')}</ul>`
          : `<p class="muted small">${t('aNoNotes')}</p>`
      }
    </div>
    ${forPrint ? '' : ''}`;
  }

  global.Analytics = { compute, reportHtml, donutSvg, barsHtml, TYPE_AR };
})(window);
