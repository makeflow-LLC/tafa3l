/**
 * «سجلّي» — صفحة الطالب: نتائجه في أنشطة فصله كما يراها معلّمه.
 *
 * بلا حساب: الرمز الذي يفتح السجل أُعطي لجهازه حين دخل نشاطاً باسمه ورمزه
 * الشخصي (play.js يحفظه في `tafa3l:records` مفتاحاً بمعرّف الفصل). طالبٌ عند
 * معلّمَين له سجلّان، فتظهر شرائح للتبديل. وما يراه هنا محدودٌ بما سمح به
 * معلّمه في كل نشاط: لا نسبة حين أُخفيت النتيجة، ولا أخطاء حين لم تُكشف
 * الإجابة الصحيحة.
 */
(function () {
  'use strict';

  const { $, el, api, toast, store } = window.T;
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const app = $('#app');
  const RECORDS_KEY = 'tafa3l:records';

  document.title = t('brand') + ' — ' + t('meTitle');
  window.SiteTopbar?.mount({ links: [{ label: t('meJoin'), href: '/join.html' }] });

  const readAll = () => store.local.get(RECORDS_KEY, {}) || {};

  /**
   * معاينةٌ برمزٍ في العنوان: يفتحها المعلّم من الفصل التجريبي ليرى الصفحة
   * كما يراها طالبه. ولا تُحفظ في الجهاز — معاينةٌ تمرّ ولا تصير سجلّاً
   * لصاحب الجهاز، وسجلّه هو (إن كان له) يبقى كما هو.
   */
  const previewToken = new URLSearchParams(location.search).get('token');

  function when(at) {
    return new Date(at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function pctBadge(pct) {
    if (pct === null || pct === undefined) return el('span', { class: 'muted', text: '—' });
    const tone = pct >= 70 ? 'ok' : pct >= 50 ? 'warn' : 'bad';
    return el('span', { class: 'badge ' + tone, style: { direction: 'ltr' }, text: pct + '%' });
  }

  function stat(value, label) {
    return el('div', { class: 'stat' }, [el('div', { class: 'v', text: String(value) }), el('div', { class: 'k', text: label })]);
  }

  function attemptCard(r) {
    const items = (r.items || []).map((it) =>
      el('div', { class: 'stack tight', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-start' } }, [
          el('span', { class: 'badge ' + (it.ok === 'partial' ? 'warn' : it.ok === false ? 'bad' : ''), text: it.ok === 'partial' ? t('hRecPartial') : it.ok === false ? '✕' : t('hRecUnanswered') }),
          el('span', { class: 'grow', text: it.text }),
        ]),
        it.mine ? el('span', { class: 'muted small', text: t('hRecMine', { mine: it.mine }) }) : null,
        it.right ? el('span', { class: 'small', style: { color: 'var(--ok)' }, text: t('hRecRight', { right: it.right }) }) : null,
      ])
    );
    const kids = [
      el('div', { class: 'row between', style: { gap: '8px', flexWrap: 'wrap' } }, [
        el('div', { class: 'stack tight grow' }, [el('strong', { text: r.title }), el('span', { class: 'muted small', text: when(r.at) })]),
        el('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, [
          r.mark ? el('span', { class: 'badge', style: { direction: 'ltr' }, text: `${r.mark.mark} / ${r.mark.of}` }) : null,
          el('span', { class: 'muted small', style: { direction: 'ltr' }, text: t('hRecOf', { correct: r.correct + (r.partial ? '½' : ''), total: r.total }) }),
          pctBadge(r.percent),
        ]),
      ]),
      el('div', { class: 'progress thin' }, el('i', { style: { width: (r.percent || 0) + '%' } })),
    ];
    if (r.pending) kids.push(el('span', { class: 'badge warn', text: t('hRecPending', { n: r.pending }) }));
    if (items.length) kids.push(el('details', {}, [el('summary', { class: 'muted small', style: { cursor: 'pointer' }, text: t('meMistakes') }), ...items]));
    else kids.push(el('span', { class: 'muted small', text: r.total - r.correct > 0 ? t('meHidden') : t('meAllRight') }));
    return el('div', { class: 'card stack tight' }, kids);
  }

  function renderEmpty() {
    app.replaceChildren(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '3rem' }, text: '📒' }),
        el('h1', { style: { margin: 0 }, text: t('meTitle') }),
        el('p', { class: 'muted', style: { margin: 0 }, text: t('meNoToken') }),
        el('a', { class: 'btn primary', href: '/join.html' }, t('meJoin')),
      ])
    );
  }

  async function render(classId) {
    const all = readAll();
    const ids = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
    if (!ids.length && !previewToken) return renderEmpty();
    const current = ids.includes(classId) ? classId : ids[0];

    app.replaceChildren(el('div', { class: 'card center' }, el('div', { class: 'spinner' })));
    let data;
    try {
      data = await api('/api/record/me?token=' + encodeURIComponent(previewToken || all[current].token));
    } catch (err) {
      if (previewToken) {
        app.replaceChildren(
          el('div', { class: 'card stack center' }, [
            el('div', { style: { fontSize: '2.4rem' }, text: '⚠️' }),
            el('p', { class: 'muted', style: { margin: 0 }, text: err.message }),
          ])
        );
        return;
      }
      // رمزٌ لم يعد يفتح شيئاً (جدّد المعلّم الرمز، أو أطفأ السجل، أو حذف الفصل): نُسقطه من الجهاز
      if (err.status === 404) {
        delete all[current];
        store.local.set(RECORDS_KEY, all);
        return render();
      }
      app.replaceChildren(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.4rem' }, text: '⚠️' }),
          el('p', { class: 'muted', style: { margin: 0 }, text: err.message }),
          el('button', { class: 'btn ghost sm', type: 'button', onclick: () => render(current) }, t('hRetry')),
        ])
      );
      return;
    }

    const rows = data.records || [];
    const scored = rows.filter((r) => r.percent !== null && r.percent !== undefined);
    const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.percent, 0) / scored.length) : null;

    app.innerHTML = '';
    app.append(
      el('div', { class: 'card stack' }, [
        el('h1', { style: { margin: 0 }, text: t('meTitle') }),
        previewToken ? el('span', { class: 'badge warn', text: t('mePreview') }) : null,
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
          el('strong', { text: data.name }),
          el('span', { class: 'muted small', text: t('meIntro', { className: data.className }) }),
        ]),
        // أكثر من فصلٍ على هذا الجهاز: شرائح للتبديل
        !previewToken && ids.length > 1
          ? el('div', { class: 'chips' }, ids.map((id) => {
              const chip = el('button', { class: 'chip' + (id === current ? ' on' : ''), type: 'button', text: id === current ? data.className : all[id].title || '…' });
              chip.addEventListener('click', () => render(id));
              return chip;
            }))
          : null,
      ])
    );

    if (!rows.length) {
      app.append(el('div', { class: 'card' }, el('p', { class: 'muted', style: { margin: 0 }, text: t('meEmpty') })));
    } else {
      app.append(
        el('div', { class: 'stats' }, [
          stat(rows.length, t('meCount')),
          stat(avg === null ? '—' : avg + '%', t('meAvg')),
          stat(scored.length ? Math.max(...scored.map((r) => r.percent)) + '%' : '—', t('meBest')),
        ])
      );
      rows.forEach((r) => app.append(attemptCard(r)));
    }

    // المعاينة لا تُزال من جهازٍ لم تُحفظ فيه أصلاً
    if (previewToken) return;

    const forget = el('button', { class: 'btn ghost sm', type: 'button' }, t('meForget'));
    forget.addEventListener('click', () => {
      if (!confirm(t('meForgetAsk'))) return;
      const rest = readAll();
      delete rest[current];
      store.local.set(RECORDS_KEY, rest);
      toast(t('meForgotten'), 'ok');
      render();
    });
    app.append(el('div', { class: 'center', style: { marginTop: '12px' } }, forget));
  }

  render();
})();
