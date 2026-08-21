/**
 * مكوّنات شاشة إجابة المتدرب — تطبيق DESIGN.md §3.
 *
 * الملف بلا اعتمادات: يبني عُقَده بنفسه كي تستعمله صفحةُ المعاينة الساكنة
 * كما تستعمله صفحة اللعب الحيّة، فما تراه في المعاينة هو ما يراه الطالب.
 *
 * ولا نصَّ ثابتاً هنا: كل كلمة تصل من المتصل عبر مفاتيح الترجمة، حتى الحروف
 * (أ ب ج د / A B C D) تصل كسلسلةٍ من لغة الواجهة.
 */
(function (global) {
  'use strict';

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
  }

  /** حرف الخيار من تسلسل لغة الواجهة، ورقمٌ لاتيني إن نفدت الحروف */
  function letterAt(sequence, index) {
    const seq = [...String(sequence || '')];
    return seq[index] !== undefined ? seq[index] : String(index + 1);
  }

  /** الأرقام لا تنعكس مع الاتجاه: كل رقمٍ داخل مقطعٍ LTR */
  function ltr(props, children) {
    return el('span', Object.assign({ dir: 'ltr' }, props || {}), children);
  }

  // ------------------------------------------------------ 3.1 خيار الإجابة

  const SLOT_CLASS = ['tp-opt--a', 'tp-opt--b', 'tp-opt--c', 'tp-opt--d'];
  const STATE_CLASS = {
    idle: 'is-idle',
    selected: 'is-selected',
    faded: 'is-faded',
    correct: 'is-correct',
    wrong: 'is-wrong',
    neutral: 'is-neutral',
  };

  /**
   * خيار إجابة واحد.
   *
   * `palette` يفرّق بين الحالتين اللتين اتفقنا عليهما: أربعة خيارات فأقل
   * تأخذ الدرجات الأربع المنصوصة، وخمسة فأكثر تأخذ سطحاً محايداً وحرفاً
   * بلون العلامة — لا نخترع درجاتٍ ليست في التصميم.
   */
  function AnswerOption(opts) {
    const o = opts || {};
    const interactive = o.interactive !== false;
    const node = el(interactive ? 'button' : 'div', {
      class: 'tp-opt',
      type: interactive ? 'button' : null,
      role: interactive ? null : 'presentation',
    });

    const badge = el('span', { class: 'tp-opt__badge', 'aria-hidden': 'true', text: o.letter || '' });
    const label = el('span', { class: 'tp-opt__label', text: o.text || '' });
    node.append(badge, label);

    let trailing = null;

    function paint(state, extra) {
      const next = STATE_CLASS[state] ? state : 'idle';
      for (const cls of Object.values(STATE_CLASS)) node.classList.remove(cls);
      node.classList.add(STATE_CLASS[next]);
      node.dataset.state = next;

      if (trailing) {
        trailing.remove();
        trailing = null;
      }
      const chip = extra && extra.chip !== undefined ? extra.chip : o.chip;
      if (next === 'selected' && chip) {
        trailing = el('span', { class: 'tp-opt__chip', text: chip });
      } else if (next === 'correct' || next === 'wrong') {
        trailing = el('span', { class: 'tp-opt__mark', 'aria-hidden': 'true', text: next === 'correct' ? '✓' : '✕' });
      }
      if (trailing) node.append(trailing);

      if (interactive) node.setAttribute('aria-pressed', next === 'selected' ? 'true' : 'false');
      // قارئ الشاشة يحتاج ما يقوله اللون: «اختيارك»، «صحيحة»، «خاطئة»
      const spoken = (extra && extra.spoken) || o.spoken;
      const say = spoken && spoken[next];
      if (say) node.setAttribute('aria-label', `${o.letter ? o.letter + ' — ' : ''}${o.text} — ${say}`);
      else node.removeAttribute('aria-label');
    }

    node.classList.add(o.palette && o.slot < SLOT_CLASS.length ? SLOT_CLASS[o.slot] : 'tp-opt--plain');
    paint(o.state || 'idle');

    if (interactive && typeof o.onSelect === 'function') {
      node.addEventListener('click', () => {
        if (node.disabled) return;
        o.onSelect(o.value, node);
      });
    }

    node.setState = paint;
    node.lock = () => {
      if (interactive) node.disabled = true;
    };
    return node;
  }

  // ---------------------------------------------------------- 3.2 المؤقّت

  /**
   * الرقم + الشريط المتقلّص.
   *
   * يُحدَّث الرقم والعرض مرة واحدة في الثانية فقط، والانتقال الخطّي في CSS
   * يملأ ما بينهما — كتابة العرض كل جزءٍ من الثانية تُفسد الانتقال وتجعل
   * الشريط يتخلّف عن الرقم.
   */
  function Timer(opts) {
    const o = opts || {};
    const totalMs = Math.max(1, (o.total || 0) * 1000);
    const num = ltr({ class: 'tp-timer__num' }, o.infinite ? '∞' : String(o.total || 0));
    const fill = el('i', { class: 'tp-timer__fill', style: { width: '100%' } });
    const node = el('div', { class: 'tp-timer' }, [num, el('div', { class: 'tp-timer__track' }, fill)]);
    if (o.infinite) node.classList.add('is-infinite');

    let lastSecond = null;

    function set(msLeft) {
      if (o.infinite) return;
      const left = Math.max(0, msLeft);
      const seconds = Math.ceil(left / 1000);
      if (seconds === lastSecond) return;
      lastSecond = seconds;
      num.textContent = String(seconds);
      fill.style.width = Math.max(0, Math.min(100, (left / totalMs) * 100)) + '%';
      node.classList.toggle('is-hot', seconds <= 5 && seconds > 0);
      node.classList.toggle('is-done', seconds <= 0);
    }

    function expire() {
      if (o.infinite) return;
      lastSecond = 0;
      num.textContent = '0';
      fill.style.width = '0%';
      node.classList.remove('is-hot');
      node.classList.add('is-done');
    }

    return { node, set, expire, num, fill };
  }

  // ----------------------------------------------------- 3.3 إحصاءة الرأس

  /** عدّاد الأسئلة «3/10» أو النقاط «pts 120» — أرقامٌ لاتينية بمقاسٍ ثابت */
  function HeaderStat(opts) {
    const o = opts || {};
    if (o.kind === 'score') {
      return ltr({ class: 'tp-stat' }, [
        el('span', { class: 'tp-stat__muted', text: o.label || 'pts' }),
        ' ',
        String(o.value ?? 0),
      ]);
    }
    return ltr({ class: 'tp-stat' }, [
      String(o.value ?? 0),
      el('span', { class: 'tp-stat__slash', text: '/' }),
      el('span', { class: 'tp-stat__muted', text: String(o.total ?? 0) }),
    ]);
  }

  // -------------------------------------------------- 3.4 مؤشّر الانتظار

  function WaitingIndicator(opts) {
    const o = opts || {};
    const dots = el('span', { class: 'tp-waiting__dots', 'aria-hidden': 'true' }, [
      el('span', { class: 'tp-dot' }),
      el('span', { class: 'tp-dot' }),
      el('span', { class: 'tp-dot' }),
    ]);
    return el('div', { class: 'tp-waiting', role: 'status' }, [dots, el('span', { text: o.text || '' })]);
  }

  // --------------------------------------------------- 3.5 وسائط السؤال

  /**
   * الوسائط الحقيقية لا مربّع «IMAGE» الذي في المخطوطة: صورة السؤال أو
   * الفيديو كما هو، وإن لم يكن للسؤال وسائط فلا شيء — يتوسّط السؤال وحده.
   */
  function ImageSlot(opts) {
    const o = opts || {};
    if (o.node) return el('div', { class: 'tp-media-box' }, o.node);
    if (!o.src) return null;
    return el('img', { class: 'tp-media', src: o.src, alt: o.alt || '', loading: 'lazy' });
  }

  // ------------------------------------------------------- سطر الحالة

  /** «إجابة صحيحة +120» / «إجابة خاطئة +0 — الصحيح: ب …» */
  function StatusLine(opts) {
    const o = opts || {};
    const parts = [o.text || ''];
    if (o.delta) parts.push(' ', ltr({ text: o.delta }));
    if (o.right) parts.push(el('span', { class: 'tp-status__right', text: ' — ' + o.right }));
    return el('p', { class: 'tp-status ' + (o.tone === 'wrong' ? 'is-wrong' : 'is-correct'), role: 'status' }, parts);
  }

  // ---------------------------------------------------- لافتة الاتصال

  /** لافتة دائمة غير حاجبة — لا نافذة منبثقة تقطع على الطالب إجابته */
  function ConnectionBanner() {
    const dot = el('span', { class: 'tp-banner__dot', 'aria-hidden': 'true' });
    const text = el('span', {});
    const node = el('div', { class: 'tp-banner', role: 'status', hidden: true }, [dot, text]);
    return {
      node,
      /** message فارغة = الاتصال سليم، فتختفي اللافتة */
      set(message) {
        if (message) {
          text.textContent = message;
          node.hidden = false;
        } else {
          node.hidden = true;
        }
      },
    };
  }

  // ------------------------------------------- التفاعلات: زرّ يفتح ورقة

  /**
   * التفاعلات في ورقةٍ خلف زرٍّ واحد بدل شريطٍ يأكل ارتفاع الشاشة — شاشة
   * السؤال لا تحتمل صفّاً كاملاً من الوجوه.
   */
  function ReactionSheet(opts) {
    const o = opts || {};
    const button = el('button', {
      class: 'tp-react-btn',
      type: 'button',
      'aria-haspopup': 'dialog',
      text: o.buttonLabel || '☺',
    });
    const row = el('div', { class: 'tp-sheet__row' });
    (o.emojis || []).forEach((emoji) => {
      const item = el('button', {
        class: 'tp-sheet__react',
        type: 'button',
        'aria-label': (o.itemLabel || '') + ' ' + emoji,
        text: emoji,
      });
      item.addEventListener('click', () => {
        o.onPick?.(emoji, item);
      });
      row.append(item);
    });
    const close = el('button', { class: 'tp-sheet__close', type: 'button', text: o.closeLabel || '✕' });
    const panel = el('div', { class: 'tp-sheet__panel', role: 'dialog', 'aria-modal': 'false' }, [
      el('p', { class: 'tp-sheet__title', text: o.title || '' }),
      row,
      close,
    ]);
    const sheet = el('div', { class: 'tp-sheet', hidden: true }, panel);

    function open() {
      sheet.hidden = false;
    }
    function shut() {
      sheet.hidden = true;
    }
    button.addEventListener('click', () => (sheet.hidden ? open() : shut()));
    close.addEventListener('click', shut);
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) shut();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') shut();
    });

    return { button, sheet, open, close: shut };
  }

  // ------------------------------- قائمة الشريط العلوي (مشتركة)

  /**
   * رمزٌ تعبيريّ في أول النصّ يُفصل عنه: سطر القائمة كلمةٌ تُقرأ أولاً،
   * والرمز ثانويٌّ في آخره — ولا سطرَ برمزٍ عارٍ بلا كلمة.
   */
  function splitIcon(label) {
    const match = String(label || '').match(/^([\p{Extended_Pictographic}\u200d\ufe0f]+)\s*(.*)$/u);
    return match && match[2] ? { icon: match[1], text: match[2] } : { icon: '', text: String(label || '') };
  }

  /** سطرٌ كامل العرض: نصّ، ثم حالةٌ أو رمزٌ ثانويّ. لا يلتفّ ولا ينضغط */
  function MenuRow(opts) {
    const o = opts || {};
    const { icon, text } = splitIcon(o.label);
    const node = el(o.href ? 'a' : 'button', {
      class: 'tp-menu__item' + (o.danger ? ' tp-menu__item--danger' : ''),
      href: o.href,
      type: o.href ? null : 'button',
      role: 'menuitem',
      title: o.title || text,
    });
    node.append(el('span', { class: 'tp-menu__label', text }));
    if (o.state) node.append(el('span', { class: 'tp-menu__state', text: o.state }));
    else if (icon) node.append(el('span', { class: 'tp-menu__icon', 'aria-hidden': 'true', text: icon }));
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  /** مبدّلٌ نصّيّ: اسم الإعداد وحالته الظاهرة، لا رمزٌ يُخمَّن معناه */
  function MenuToggle(label, read, write) {
    const node = MenuRow({ label, state: read() });
    node.addEventListener('click', () => {
      write();
      node.querySelector('.tp-menu__state').textContent = read();
    });
    return node;
  }

  /**
   * تثبيت القائمة داخل الشاشة.
   *
   * مربوطةٌ بزرّها، فإن كان الزرّ قريباً من الحافة خرج طرفها عنها — نقيسها
   * بعد فتحها ونزيحها بالبكسل، فلا تُقصّ ولا تُخرج الصفحة عن عرضها.
   */
  function clampMenu(panel) {
    if (!panel) return;
    panel.style.transform = '';
    const pad = 8;
    const box = panel.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (box.right > vw - pad) dx = vw - pad - box.right;
    if (box.left + dx < pad) dx = pad - box.left;
    if (dx) panel.style.transform = `translateX(${Math.round(dx)}px)`;
  }

  function MenuSep() {
    return el('div', { class: 'tp-menu__sep', 'aria-hidden': 'true' });
  }

  /** تعريف الحساب في رأس القائمة: اسمٌ وبريد، مقصوصان، لا يُضغطان */
  function MenuAccount(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-menu__account' }, [
      el('span', { class: 'tp-menu__name', text: o.name || '', title: o.name || '' }),
      o.mail ? el('span', { class: 'tp-menu__mail', text: o.mail, title: o.mail }) : null,
    ]);
  }

  global.TapioUI = {
    el,
    ltr,
    letterAt,
    AnswerOption,
    Timer,
    HeaderStat,
    WaitingIndicator,
    ImageSlot,
    StatusLine,
    ConnectionBanner,
    ReactionSheet,
    splitIcon,
    clampMenu,
    MenuRow,
    MenuToggle,
    MenuSep,
    MenuAccount,
  };
})(window);
