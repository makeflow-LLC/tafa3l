/**
 * بطاقة الطالب لوليّ الأمر — صفحةٌ واحدة تُطبع وتُسلَّم.
 *
 * وهي ليست «ملفّ الطالب» مصغَّراً: ملفُّه شاشةُ معلّمٍ يقلّبها ويقرّر، أمّا
 * هذه فورقةٌ تخرج من المدرسة إلى البيت — فتُكتب بلغةٍ يقرؤها أبٌ لا يعرف
 * منصّتنا، وتُجيب عن ثلاثة أسئلةٍ يسألها: كيف مستواه؟ وهل يسلّم واجباته؟
 * وبمَ أساعده في البيت؟ ثم تترك للمعلّم سطراً يكتبه بخطّه ولوليّ الأمر
 * سطراً يوقّعه.
 *
 * وتخرج **ملفَّ PDF** لا نافذةَ طباعة: المعلّم لا يقف عند طابعة — يرسلها
 * في واتساب، أو يفتحها على لوحه في الاجتماع، أو يحفظها في ملفّ الطالب.
 * وPDF وحدها تُفتح على الجوّال واللوح والحاسوب بلا تطبيق، وتظهر معاينتُها
 * في المحادثة.
 *
 * وما لا يخرج فيها مقصودٌ كذلك: **لا رمزَ الطالب** — الورقة تُصوَّر وتُرسل
 * في مجموعات الصفّ، والرمزُ مفتاحُ سجلّه لا خبرٌ عنه. ومن أراد الرموز
 * فلها ورقتها («طباعة الرموز») تُقصّ وتُسلَّم لكلٍّ رمزُه وحده.
 */
(function () {
  'use strict';

  const { $, el, api, toast } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const app = $('#app');
  const params = new URLSearchParams(location.search);
  const classId = params.get('class') || '';
  const studentId = params.get('student') || '';
  const backHref = `/host.html#/class/${encodeURIComponent(classId)}/record/${encodeURIComponent(studentId)}`;

  window.SiteTopbar?.mount({});

  // صفحةٌ واحدة تُطبع: ستّةُ أنشطةٍ وأربعُ مهاراتٍ تكفي وليَّ الأمر ولا تفيض
  const MAX_ROWS = 6;
  const MAX_HELP = 4;
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
  /** «مرّةً واحدة» و«مرّتين» و«ثلاث مرّات» — ورقةٌ تذهب إلى البيت تُقرأ بعربيّةٍ سليمة */
  const times = (n) => (n === 1 ? t('cdMisses1') : n === 2 ? t('cdMisses2') : t('cdMisses', { n }));

  function pctBadge(n) {
    if (n === null || n === undefined) return el('span', { class: 'muted', text: '—' });
    const tone = n >= 70 ? 'ok' : n >= 50 ? 'warn' : 'bad';
    return el('span', { class: 'badge ' + tone, style: { direction: 'ltr' }, text: n + '%' });
  }

  /** تقديرٌ بكلمةٍ لا برقمٍ وحده: وليّ الأمر يقرأ «جيّد جداً» أسرع من «٨٤٪» */
  function band(avg) {
    if (avg === null || avg === undefined) return { key: 'cdBandNone', tone: '' };
    if (avg >= 85) return { key: 'cdBandExcellent', tone: 'ok' };
    if (avg >= 70) return { key: 'cdBandVeryGood', tone: 'ok' };
    if (avg >= 60) return { key: 'cdBandGood', tone: 'warn' };
    if (avg >= 50) return { key: 'cdBandFair', tone: 'warn' };
    return { key: 'cdBandWeak', tone: 'bad' };
  }

  function fail(message) {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '2.4rem' }, text: '🧭' }),
        el('p', { class: 'muted', style: { margin: 0 }, text: message }),
        el('a', { class: 'btn ghost sm', href: backHref }, t('cdBack')),
      ])
    );
  }

  function render(data, teacherName) {
    const s = data.student;
    const rows = (data.records || []).slice().sort((a, b) => b.at - a.at);
    const scored = rows.filter((r) => r.percent !== null && r.percent !== undefined);
    const avg = scored.length ? Math.round(scored.reduce((sum, r) => sum + r.percent, 0) / scored.length) : null;
    const hw = data.homework || { assigned: 0, done: 0, late: 0, missing: 0 };
    const level = band(avg);

    document.title = t('cdTitle') + ' — ' + s.name;

    const stat = (value, label) => el('div', { class: 'stat' }, [el('div', { class: 'v', text: String(value) }), el('div', { class: 'k', text: label })]);

    /*
     * ملاحظةُ المعلّم تُكتب في الصفحة قبل الطباعة ولا تُحفظ في حسابه: هي
     * جملةٌ لهذا الأب في هذا اليوم، لا سجلٌّ ثانٍ عن الطالب يُخزَّن عندنا.
     */
    const note = el('div', {
      class: 'cd-note',
      contenteditable: 'true',
      role: 'textbox',
      'aria-label': t('cdNote'),
      'data-placeholder': t('cdNotePh'),
    });

    /*
     * التنزيل يبني الملفّ من الأرقام نفسها المعروضة أمام المعلّم — ومعها
     * ملاحظتُه إن كتبها قبل الضغط، فما يراه هو ما يصل وليَّ الأمر.
     */
    const download = el('button', { class: 'btn primary sm', type: 'button' }, t('cdPdf'));
    download.addEventListener('click', async () => {
      if (!window.Exporter) return toast(t('cdPdfFailed'), 'bad');
      download.disabled = true;
      const label = download.textContent;
      download.textContent = t('cdPdfWorking');
      try {
        await window.Exporter.toStudentCardPdf({
          name: s.name,
          meta: [data.class?.name, s.group, teacherName ? t('cdTeacher', { name: teacherName }) : '', t('cdMadeAt', { at: fmtDate(Date.now()) })]
            .filter(Boolean)
            .join(' · '),
          avg: pct(avg),
          attempts: String(rows.length),
          last: pct(scored[0]?.percent ?? null),
          homework: hw.assigned ? `${hw.done}/${hw.assigned}` : '',
          level: t(level.key),
          rows: recent.map((r) => [r.title || '—', fmtDate(r.at), pct(r.percent ?? null)]),
          help: (skills.length ? skills.map((w) => `${w.skill} — ${times(w.misses)}`) : spots.map((w) => `«${w.text}» — ${times(w.times)}`)),
          note: note.textContent.trim(),
        });
        toast(t('cdPdfDone'), 'ok');
      } catch (err) {
        toast(err.message || t('cdPdfFailed'), 'bad');
      }
      download.disabled = false;
      download.textContent = label;
    });

    const head = el('div', { class: 'card stack tight' }, [
      el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        /*
         * سطرٌ واحد لما دون الاسم: الفصلُ والمجموعةُ والمعلّمُ والتاريخ خبرٌ
         * واحد عن هذه الورقة، وأربعةُ أسطرٍ لها تدفع التوقيعَ إلى صفحةٍ ثانية.
         */
        el('div', { class: 'stack tight' }, [
          el('h1', { style: { margin: 0 }, text: t('cdTitle') }),
          el('div', { style: { fontWeight: 700, fontSize: '1.15rem' }, text: s.name }),
          el('div', {
            class: 'muted small',
            text: [data.class?.name, s.group, teacherName ? t('cdTeacher', { name: teacherName }) : '', t('cdMadeAt', { at: fmtDate(Date.now()) })]
              .filter(Boolean)
              .join(' · '),
          }),
        ]),
        el('div', { class: 'row no-print', style: { gap: '6px', flexWrap: 'wrap' } }, [
          download,
          el('a', { class: 'btn ghost sm', href: backHref }, t('cdBack')),
        ]),
      ]),
      data.demo ? el('p', { class: 'note warn small', style: { margin: 0 }, text: t('cdDemo') }) : null,
    ]);

    /*
     * الخلاصةُ بطاقةٌ واحدة لا ثلاث.
     *
     * الورقة تُطبع، وكلُّ بطاقةٍ إطارٌ وهوامشُ تُضاف إلى طولها — وثلاثُ بطاقاتٍ
     * لسطرين ونصفٍ تدفع التوقيعَ إلى صفحةٍ ثانية شبهِ فارغة. فالأرقامُ
     * والتقديرُ وحالُ الواجبات في بطاقةٍ واحدة تُقرأ بنظرة.
     */
    const summary = el('div', { class: 'card stack tight' }, [
      el('div', { class: 'stats' }, [
        stat(pct(avg), t('cdAvg')),
        stat(rows.length, t('cdAttempts')),
        stat(pct(scored[0]?.percent ?? null), t('cdLast')),
        hw.assigned ? stat(`${hw.done}/${hw.assigned}`, t('cdHomework')) : null,
      ]),
      el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, [
        el('strong', { class: 'small', text: t('cdLevel') }),
        el('span', { class: 'badge ' + level.tone, text: t(level.key) }),
        hw.missing ? el('span', { class: 'badge bad', text: t('cdHwMissing', { n: hw.missing }) }) : null,
        hw.late ? el('span', { class: 'badge warn', text: t('cdHwLate', { n: hw.late }) }) : null,
        hw.assigned && !hw.missing && !hw.late ? el('span', { class: 'badge ok', text: t('cdHwAll') }) : null,
      ]),
    ]);

    // آخرُ الأنشطة: ما شارك فيه وكيف كانت نتيجته — بلا أسئلةٍ ولا إجابات
    const recent = rows.slice(0, MAX_ROWS);
    const table = el('div', { class: 'card stack tight' }, [
      el('h2', { style: { margin: 0 }, text: t('cdRecent') }),
      recent.length
        ? el('div', { class: 'table-wrap' }, [
            el('table', { class: 'report-table' }, [
              el('thead', {}, el('tr', {}, [
                el('th', {}, t('cdColActivity')),
                el('th', {}, t('cdColDate')),
                el('th', {}, t('cdColResult')),
              ])),
              el('tbody', {}, recent.map((r) =>
                el('tr', {}, [
                  el('td', {}, [
                    el('strong', { text: r.title || '—' }),
                    r.mark ? el('div', { class: 'muted small', style: { direction: 'ltr' }, text: `${r.mark.mark} / ${r.mark.of}` }) : null,
                  ]),
                  el('td', { 'data-label': t('cdColDate'), class: 'trend' }, fmtDate(r.at)),
                  el('td', { 'data-label': t('cdColResult') }, pctBadge(r.percent ?? null)),
                ])
              )),
            ]),
          ])
        : el('p', { class: 'muted small', style: { margin: 0 }, text: t('cdNoAttempts') }),
    ]);

    // ما يُراجَع في البيت — المهارة أنفع من نصّ سؤالٍ لن يتكرّر
    const skills = (data.weakSkills || []).slice(0, MAX_HELP);
    const spots = (data.weak || []).slice(0, MAX_HELP);
    const help = skills.length || spots.length
      ? el('div', { class: 'card stack tight' }, [
          el('h2', { style: { margin: 0 }, text: t('cdHelp') }),
          el('p', { class: 'muted small', style: { margin: 0 }, text: t('cdHelpIntro') }),
          skills.length
            ? el('ul', {}, skills.map((w) => el('li', {}, [el('strong', { text: w.skill }), el('span', { class: 'muted small', text: ' — ' + times(w.misses) })])))
            : null,
          !skills.length && spots.length
            ? el('ul', {}, spots.map((w) => el('li', {}, [el('span', { text: '«' + w.text + '»' }), el('span', { class: 'muted small', text: ' — ' + times(w.times) })])))
            : null,
        ])
      : null;

    const signature = el('div', { class: 'card stack tight' }, [
      el('h2', { style: { margin: 0 }, text: t('cdNote') }),
      note,
      el('div', { class: 'cd-sign' }, [
        el('div', {}, [el('span', { class: 'muted small', text: t('cdSignTeacher') }), el('div', { class: 'cd-line' })]),
        el('div', {}, [el('span', { class: 'muted small', text: t('cdSignParent') }), el('div', { class: 'cd-line' })]),
      ]),
    ]);

    app.replaceChildren(
      el('div', { class: 'report' }, [head, summary, table, help, signature, el('p', { class: 'report-foot', text: t('cdFoot') })])
    );
  }

  async function boot() {
    if (!classId || !studentId) return fail(t('cdMissing'));
    let data;
    let teacherName = '';
    try {
      [data, teacherName] = await Promise.all([
        api(`/api/classes/${encodeURIComponent(classId)}/record/${encodeURIComponent(studentId)}`),
        api('/api/auth/me').then((d) => (d.user ? window.T.userName(d.user) : '')).catch(() => ''),
      ]);
    } catch (err) {
      return fail(err.message);
    }
    render(data, teacherName);
  }

  boot().catch((err) => {
    toast(err.message, 'bad');
    fail(err.message);
  });
})();
