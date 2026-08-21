/**
 * مكوّنات مصمّم النشاط — تبويب الأسئلة (DESIGN.md §3.12–3.16).
 *
 * على نسق `participant-ui.js` و`teacher-ui.js`: دوالّ تُرجع عُقَداً، بلا
 * اعتمادات، ولا نصَّ ثابتاً — كل كلمة تصل من المتصل عبر مفاتيح الترجمة.
 */
(function (global) {
  'use strict';

  const el =
    (global.TapioUI && global.TapioUI.el) ||
    function el(tag, props, children) {
      const node = document.createElement(tag);
      if (props) {
        for (const [key, value] of Object.entries(props)) {
          if (value === null || value === undefined || value === false) continue;
          if (key === 'class') node.className = value;
          else if (key === 'text') node.textContent = value;
          else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
          else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
          else node.setAttribute(key, value === true ? '' : value);
        }
      }
      for (const child of [].concat(children || [])) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child.nodeType ? child : document.createTextNode(String(child)));
      }
      return node;
    };

  const ltr = (global.TapioUI && global.TapioUI.ltr) || ((props, kids) => el('span', Object.assign({ dir: 'ltr' }, props || {}), kids));

  // ------------------------------------------------- 3.12 خطوة التبويب

  /** خطوة من ثلاث: رقمها في دائرة، واسمها بجانبه، والنشطة بإطار العلامة */
  function TabStep(opts) {
    const o = opts || {};
    const node = el('button', {
      class: 'tp-d-tab' + (o.active ? ' is-on' : ''),
      type: 'button',
      'aria-current': o.active ? 'step' : null,
    }, [
      ltr({ class: 'tp-d-tab__num', text: String(o.number || 1) }),
      el('span', { text: o.label || '' }),
    ]);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  // ------------------------------------------- 3.13 حبّة رقم السؤال

  /** الرقم 34px داخل هدف ضغطٍ 44px — المظهر من التصميم، والهدف من قاعدة اللمس */
  function QuestionPill(opts) {
    const o = opts || {};
    const node = el('button', {
      class: 'tp-d-pill' + (o.active ? ' is-on' : '') + (o.done ? ' is-done' : ''),
      type: 'button',
      title: o.title || '',
      'aria-current': o.active ? 'true' : null,
    }, [ltr({ class: 'tp-d-pill__box', text: String(o.number || 1) })]);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  // ------------------------------------------ 3.14 بلاطة نوع السؤال

  function TypeTile(opts) {
    const o = opts || {};
    const node = el('button', {
      class: 'tp-d-type' + (o.active ? ' is-on' : ''),
      type: 'button',
      title: o.label || '',
      'aria-pressed': o.active ? 'true' : 'false',
    }, [o.icon ? el('span', { 'aria-hidden': 'true', text: o.icon }) : null, el('span', { text: o.label || '' })]);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  /** شبكة الأنواع العشرة بعمودين — واحدة لسطح المكتب وأخرى داخل الورقة */
  function TypeGrid(items, opts) {
    const o = opts || {};
    return el(
      'div',
      { class: o.sheet ? 'tp-d-sheet-types' : 'tp-d-types' },
      (items || []).map((item) => TypeTile(item))
    );
  }

  // ------------------------------------------- 3.15 صفّ تحرير الخيار

  /**
   * صفّ خيار: مفتاح «صحيحة» ثم الحقل ثم الحذف — وكلا الطرفين 44×44.
   * الحقل يصل جاهزاً من المتصل لأن ربطه بالمسودة شأن الباني لا المكوّن.
   */
  function OptionRow(opts) {
    const o = opts || {};
    const row = el('div', { class: 'tp-d-opt' + (o.correct ? ' is-correct' : '') });
    if (o.onToggle) {
      const mark = el('button', {
        class: 'tp-d-mark' + (o.correct ? ' is-on' : ''),
        type: 'button',
        title: o.correctLabel || '',
        'aria-label': o.correctLabel || '',
        'aria-pressed': o.correct ? 'true' : 'false',
        text: '✓',
      });
      mark.addEventListener('click', () => o.onToggle(mark, row));
      row.append(mark);
    }
    row.append(o.field);
    if (o.onRemove) {
      const remove = el('button', {
        class: 'tp-d-mark tp-d-mark--remove',
        type: 'button',
        title: o.removeLabel || '',
        'aria-label': o.removeLabel || '',
        text: '✕',
      });
      remove.addEventListener('click', () => o.onRemove());
      row.append(remove);
    }
    return row;
  }

  // ---------------------------------------------------- 3.16 الحقول

  /** حقلٌ بعنوانه: العنوان فوقه دائماً، والتلميح تحته إن وُجد */
  function Field(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-d-field' }, [
      o.label ? el('label', { text: o.label }) : null,
      o.control,
      o.hint ? el('p', { class: 'tp-d-note', text: o.hint }) : null,
    ]);
  }

  function HintBox(text) {
    return el('p', { class: 'tp-d-hint', text: text || '' });
  }

  // ------------------------------------------- ورقة سفلية عامّة

  /**
   * ورقة تُفتح من أسفل الشاشة — نفس ورقة تفاعلات المتدرب شكلاً وسلوكاً:
   * تُغلق بالضغط خارجها أو بـ Escape أو بزرّ الإغلاق.
   */
  function Sheet(opts) {
    const o = opts || {};
    const body = el('div', { class: 'tp-sheet__row' }, o.content || null);
    const close = el('button', { class: 'tp-sheet__close', type: 'button', text: o.closeLabel || '✕' });
    const panel = el('div', { class: 'tp-sheet__panel', role: 'dialog', 'aria-modal': 'false' }, [
      o.title ? el('p', { class: 'tp-sheet__title', text: o.title }) : null,
      body,
      close,
    ]);
    const sheet = el('div', { class: 'tp-sheet', hidden: true }, panel);
    const shut = () => {
      sheet.hidden = true;
    };
    close.addEventListener('click', shut);
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) shut();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') shut();
    });
    return {
      node: sheet,
      open() {
        sheet.hidden = false;
      },
      close: shut,
    };
  }

  global.DesignerUI = { el, ltr, TabStep, QuestionPill, TypeTile, TypeGrid, OptionRow, Field, HintBox, Sheet };
})(window);
