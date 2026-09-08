/**
 * تقرير تحليل الفصل — صفحةٌ مستقلّة تُقرأ وتُطبع.
 *
 * ليست لوحةً تُتصفَّح بل ورقةٌ تُسلَّم: لمديرٍ يسأل «أين يقف الصفّ؟»، أو
 * لوليّ أمرٍ يسأل عن ابنه، أو للمعلّم نفسه يخطّط أسبوعه. فهي صفحةٌ بعرضها
 * كلّه، بلا قائمةٍ جانبيّة، وبزرّ طباعةٍ يُخفي كلّ ما ليس من الورقة.
 *
 * والأرقام هنا من الخادم محسوبةً من السجل؛ والقراءة (الملخّص، الفجوات،
 * الخطّة، وملاحظة كل طالب) من النموذج — والفرق بينهما مكتوبٌ في ذيل الورقة.
 */
(function () {
  'use strict';

  const { $, el, api, toast } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const app = $('#app');
  const params = new URLSearchParams(location.search);
  const classId = params.get('class') || '';
  const group = (params.get('group') || '').trim();

  window.SiteTopbar?.mount({});

  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  const fmtStamp = (ms) => (ms ? new Date(ms).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
  const url = (q) => `/api/classes/${encodeURIComponent(classId)}/analysis${q ? '?group=' + encodeURIComponent(group) : ''}`;
  const backHref = `/host.html#/class/${encodeURIComponent(classId)}/record`;

  function pctBadge(n) {
    if (n === null || n === undefined) return el('span', { class: 'muted', text: '—' });
    const tone = n >= 70 ? 'ok' : n >= 50 ? 'warn' : 'bad';
    return el('span', { class: 'badge ' + tone, style: { direction: 'ltr' }, text: n + '%' });
  }

  const LEVEL = {
    strong: { tone: 'ok', key: 'rpLevelStrong' },
    steady: { tone: 'warn', key: 'rpLevelSteady' },
    support: { tone: 'bad', key: 'rpLevelSupport' },
  };
  const levelBadge = (level) => el('span', { class: 'badge ' + (LEVEL[level] || LEVEL.steady).tone, text: t((LEVEL[level] || LEVEL.steady).key) });

  function fail(message) {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.4rem' }, text: '🧭' }),
        el('p', { class: 'muted', style: { margin: 0 }, text: message }),
        el('a', { class: 'btn ghost sm', href: backHref }, t('rpBack')),
      ])
    );
  }

  /** الميزة في الاحترافية: نقولها بصدق ونفتح الطريق إليها، لا نخفي الزرّ */
  function locked(err) {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.4rem' }, text: '⭐' }),
        el('h2', { style: { margin: 0 }, text: t('rpLocked') }),
        el('p', { class: 'muted', style: { margin: 0 }, text: t('rpLockedBody') }),
        el('p', { class: 'small muted', style: { margin: 0 }, text: err?.message || '' }),
        el('div', { class: 'row', style: { gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, [
          el('a', { class: 'btn primary', href: '/host.html#/upgrade' }, t('rpUpgrade')),
          el('a', { class: 'btn ghost', href: backHref }, t('rpBack')),
        ]),
      ])
    );
  }

  function building() {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { class: 'spinner' }),
        el('p', { style: { margin: 0, fontWeight: 700 }, text: t('rpBuilding') }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('rpBuildingHint') }),
      ])
    );
  }

  async function build() {
    building();
    let data;
    try {
      data = await api(url(false), { method: 'POST', body: { group } });
    } catch (err) {
      if (err.status === 402) return locked(err);
      return fail(err.message);
    }
    render(data);
  }

  const list = (items, tag = 'ul') => el(tag, {}, items.map((line) => el('li', { text: line })));
  const section = (title, body) => el('div', { class: 'card stack tight' }, [el('h2', { style: { margin: 0 }, text: title }), body]);

  function render(data) {
    const entry = data.report;
    const r = entry.report;
    const s = entry.stats;
    const scopeLine = s.group ? t('rpScopeGroup', { group: s.group, name: s.className }) : t('rpScopeClass', { name: s.className });

    const refresh = el('button', { class: 'btn ghost sm', type: 'button' }, t('rpRefresh'));
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      refresh.textContent = t('rpRefreshing');
      await build();
    });

    const head = el('div', { class: 'card stack tight' }, [
      el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        el('div', { class: 'stack tight' }, [
          el('h1', { text: t('rpTitle') }),
          el('div', { style: { fontWeight: 700 }, text: scopeLine }),
          el('div', { class: 'muted small', text: t('rpMeta', { students: s.students, sessions: s.sessions, results: s.results }) }),
          s.from ? el('div', { class: 'muted small', text: t('rpSpan', { from: fmtDate(s.from), to: fmtDate(s.to) }) }) : null,
          el('div', { class: 'muted small', text: t('rpMadeAt', { at: fmtStamp(entry.at) }) }),
        ]),
        el('div', { class: 'row no-print', style: { gap: '6px', flexWrap: 'wrap' } }, [
          el('button', { class: 'btn primary sm', type: 'button', onclick: () => window.print() }, t('rpPrint')),
          refresh,
          el('a', { class: 'btn ghost sm', href: backHref }, t('rpBack')),
        ]),
      ]),
      data.stale ? el('p', { class: 'note warn small no-print', style: { margin: 0 }, text: t('rpStale') }) : null,
      el('p', { class: 'headline', style: { margin: 0 }, text: r.headline }),
      el('p', { style: { margin: 0, lineHeight: 1.8 }, text: r.summary }),
    ]);

    const stat = (value, label) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: String(value) }), el('div', { class: 'k', text: label })]);
    const stats = el('div', { class: 'stats' }, [
      stat(pct(s.avg), t('rpAvg')),
      stat(s.distribution.strong, t('rpStrong')),
      stat(s.distribution.steady, t('rpSteady')),
      stat(s.distribution.support, t('rpSupport')),
      s.distribution.silent ? stat(s.distribution.silent, t('rpSilent')) : null,
      s.homework.count ? stat(pct(s.homework.completion), t('rpHwCompletion')) : null,
    ]);

    const cols = el('div', { class: 'report-cols' }, [
      r.strengths.length ? section(t('rpStrengths'), list(r.strengths)) : null,
      r.gaps.length ? section(t('rpGaps'), list(r.gaps)) : null,
      r.patterns.length ? section(t('rpPatterns'), list(r.patterns)) : null,
    ]);

    const evidence = el('div', { class: 'report-cols' }, [
      s.skills.length
        ? section(t('rpSkills'), el('ul', {}, s.skills.map((k) => el('li', {}, [el('strong', { text: k.skill }), ' — ', t('rpSkillMisses', { n: k.misses })]))))
        : null,
      s.missed.length
        ? section(t('rpMissed'), el('ul', {}, s.missed.map((m) =>
            el('li', {}, [
              el('span', { text: '«' + m.text + '»' }),
              m.skill ? el('span', { class: 'muted small', text: ' [' + m.skill + ']' }) : null,
              el('span', { class: 'muted small', text: ' — ' + (m.rate === null ? t('rpSkillMisses', { n: m.misses }) : t('rpMissedRate', { rate: m.rate })) }),
            ])
          )))
        : null,
    ]);

    const hwCell = (h) => (h && h.assigned ? `${h.done}/${h.assigned}${h.late ? ` (${h.late} ⏰)` : ''}` : '—');
    const table = el('div', { class: 'table-wrap' }, [
      el('table', { class: 'report-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, t('rpColName')),
          el('th', {}, t('rpColLevel')),
          el('th', {}, t('rpColAvg')),
          el('th', {}, t('rpColTrend')),
          el('th', {}, t('rpColHw')),
          el('th', {}, t('rpColNote')),
          el('th', {}, t('rpColNext')),
        ])),
        el('tbody', {}, r.students.map((st) =>
          el('tr', {}, [
            el('td', {}, [el('strong', { text: st.name }), st.group && !s.group ? el('div', { class: 'muted small', text: st.group }) : null]),
            el('td', { 'data-label': t('rpColLevel') }, levelBadge(st.level)),
            el('td', { 'data-label': t('rpColAvg') }, pctBadge(st.avg)),
            el('td', { class: 'trend', 'data-label': t('rpColTrend') }, st.trend.length ? st.trend.join(' → ') : t('rpNoAttempts')),
            el('td', { class: 'trend', 'data-label': t('rpColHw') }, hwCell(st.homework)),
            st.note ? el('td', { 'data-label': t('rpColNote'), text: st.note }) : el('td', {}),
            st.next ? el('td', { 'data-label': t('rpColNext'), text: st.next }) : el('td', {}),
          ])
        )),
      ]),
    ]);

    app.replaceChildren(
      el('div', { class: 'report' }, [
        head,
        stats,
        cols,
        evidence,
        section(t('rpStudents'), table),
        r.plan.length ? section(t('rpPlan'), list(r.plan, 'ol')) : null,
        r.homework ? section(t('rpHomework'), el('p', { style: { margin: 0, lineHeight: 1.8 }, text: r.homework })) : null,
        el('p', { class: 'report-foot', text: t('rpFooter', { results: s.results }) }),
      ])
    );
    document.title = `${t('rpTitle')} — ${s.group || s.className} · Tapio`;
  }

  async function boot() {
    if (!classId) return fail(t('rpNone'));
    let data;
    try {
      data = await api(url(true));
    } catch (err) {
      if (err.status === 402) return locked(err);
      return fail(err.message);
    }
    if (data.report) return render(data);
    if (!data.ai) return fail(t('rpNoAi'));
    if (!data.results) return fail(t('rpNone'));
    // لا تقرير بعد: نبنيه فوراً — فتحُ الصفحة هو الطلب
    await build();
  }

  boot().catch((err) => {
    toast(err.message, 'bad');
    fail(err.message);
  });
})();
