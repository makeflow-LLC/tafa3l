/**
 * مكوّنات رئيسية المعلّم — تطبيق DESIGN.md §3.6–3.11.
 *
 * على نسق `participant-ui.js` نفسه: دوالٌّ تُرجع عُقَداً، بلا اعتمادات، كي
 * تستعملها صفحة المعاينة الساكنة كما تستعملها لوحة المعلّم الحيّة.
 *
 * ولا نصَّ ثابتاً هنا: كل كلمة تصل من المتصل عبر مفاتيح الترجمة.
 */
(function (global) {
  'use strict';

  // نستعمل بنّاء العُقَد نفسه إن كان محمّلاً، وإلا بنينا واحداً مطابقاً
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

  // ---------------------------------------------------------- 3.6 الأزرار

  /**
   * زرّ أو رابطٌ بهيئة زرّ.
   *
   * `kind`: cyan (فعل المعلّم الرئيسي) · purple · outline · ghost.
   * ما يحدّد العنصر هو `href`: رابطٌ إن وُجد، وزرٌّ إن لم يوجد.
   */
  function Button(opts) {
    const o = opts || {};
    const kind = o.kind || 'cyan';
    const classes = ['tp-btn', 'tp-btn--' + kind];
    if (o.block) classes.push('tp-btn--block');
    if (o.small) classes.push('tp-btn--sm');
    const node = el(o.href ? 'a' : 'button', {
      class: classes.join(' '),
      href: o.href,
      type: o.href ? null : 'button',
      text: o.label || '',
      title: o.title,
      'aria-label': o.ariaLabel,
      disabled: o.disabled,
    });
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  /** رابط نصّي — مساحة ضغطه 44px مهما صغر نصّه */
  function TextLink(opts) {
    const o = opts || {};
    const node = el(o.href ? 'a' : 'button', {
      class: 'tp-link' + (o.danger ? ' tp-link--danger' : ''),
      href: o.href,
      type: o.href ? null : 'button',
      text: o.label || '',
      title: o.title,
    });
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  // ------------------------------------------------------ 3.7 شريحة تنقّل

  function NavChip(opts) {
    const o = opts || {};
    const node = el(o.href ? 'a' : 'button', {
      class: 'tp-chip' + (o.primary ? ' tp-chip--primary' : ''),
      href: o.href,
      type: o.href ? null : 'button',
      text: o.label || '',
    });
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  // ----------------------------------------------------------- الشارات

  function Badge(opts) {
    const o = opts || {};
    return el('span', { class: 'tp-badge' + (o.kind ? ' tp-badge--' + o.kind : '') }, [o.ltr ? ltr({ text: o.label }) : o.label]);
  }

  // -------------------------------------------------------- 3.11 الأفاتار

  /** صورة المعلّم إن رفعها، وإلا دائرةٌ بحرفه الأول */
  function Avatar(opts) {
    const o = opts || {};
    const box = el('span', { class: 'tp-avatar', 'aria-hidden': 'true' });
    if (o.src) box.append(el('img', { src: o.src, alt: '' }));
    else box.append(el('span', { text: (o.name || '').trim().charAt(0) || '👤' }));
    return box;
  }

  // ------------------------------------------------ 3.9 بطاقة الإنشاء

  function CreationCard(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-card' + (o.ai ? ' tp-card--ai' : '') }, [
      el('h2', { class: 'tp-card__title', text: o.title || '' }),
      el('p', { class: 'tp-card__body', text: o.body || '' }),
      Button({ label: o.cta, href: o.href, kind: o.ai ? 'cyan' : 'purple', block: true }),
    ]);
  }

  // ------------------------------------------------- 3.8 بطاقة النشاط

  /**
   * بطاقة نشاطٍ محفوظ: عنوان، ثم بياناتٌ وشارات، ثم زرّان متساويان، ثم صفّ
   * روابط ثانوية. الأفعال تصل جاهزةً من المتصل — المكوّن يرسم ولا يعرف
   * شيئاً عن الشبكة.
   */
  function ActivityCard(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-card' }, [
      el('h3', { class: 'tp-card__title', text: o.title || '' }),
      el('div', { class: 'tp-card__meta' }, o.meta || []),
      el('div', { class: 'tp-card__actions' }, o.actions || []),
      o.links && o.links.length ? el('div', { class: 'tp-card__links' }, o.links) : null,
      o.slot || null,
    ]);
  }

  // ------------------------------------------------ 3.10 شريط المسودة

  function DraftBar(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-draft' }, [
      el('div', { class: 'tp-draft__text' }, [
        el('span', { class: 'tp-draft__title', text: o.title || '' }),
        el('span', { class: 'tp-draft__meta' }, [o.meta || '']),
      ]),
      Button({ label: o.cta, href: o.href, kind: 'ghost', onClick: o.onClick }),
    ]);
  }

  // ------------------------------------------- حالات الشاشة الأربع

  /** هيكل انتظارٍ بمقاس البطاقات، فلا تقفز الصفحة حين تصل البيانات */
  function Skeleton(count) {
    const box = el('div', {});
    for (let i = 0; i < (count || 2); i++) box.append(el('div', { class: 'tp-skel' }));
    return box;
  }

  function EmptyState(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-empty' }, [
      el('div', { class: 'tp-empty__emoji', 'aria-hidden': 'true', text: o.emoji || '📭' }),
      el('h3', { class: 'tp-card__title', text: o.title || '' }),
      el('p', { class: 'tp-card__body', text: o.body || '' }),
      o.cta ? Button({ label: o.cta, href: o.href, kind: 'cyan', onClick: o.onClick }) : null,
    ]);
  }

  function ErrorState(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-empty' }, [
      el('div', { class: 'tp-empty__emoji', 'aria-hidden': 'true', text: '⚠️' }),
      el('h3', { class: 'tp-card__title', text: o.title || '' }),
      el('p', { class: 'tp-card__body', text: o.body || '' }),
      o.cta ? Button({ label: o.cta, kind: 'outline', onClick: o.onClick }) : null,
    ]);
  }

  /** تحذيرٌ يحمي عمل المعلّم — يبقى ظاهراً لا يُطوى */
  function Warning(opts) {
    const o = opts || {};
    return el('div', { class: 'tp-warn', role: 'status' }, [
      el('strong', { text: o.title || '' }),
      el('span', { text: o.body || '' }),
    ]);
  }

  global.TeacherUI = {
    el,
    ltr,
    Button,
    TextLink,
    NavChip,
    Badge,
    Avatar,
    CreationCard,
    ActivityCard,
    DraftBar,
    Skeleton,
    EmptyState,
    ErrorState,
    Warning,
  };
})(window);
