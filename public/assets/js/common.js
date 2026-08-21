/* أدوات مشتركة: اختصارات DOM، اتصال ويب سوكت مع إعادة محاولة، تنبيهات */
(function (global) {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => [...(root || document).querySelectorAll(selector)];

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function avatarNode(avatar, cls) {
    const box = el('div', { class: 'avatar ' + (cls || '') });
    box.innerHTML = global.Avatar.toSvg(avatar);
    return box;
  }

  let toastTimer = null;
  function toast(message, kind) {
    const existing = $('.toast');
    if (existing) existing.remove();
    const long = String(message).length > 60;
    const node = el('div', { class: 'toast ' + (kind || '') + (long ? ' long' : ''), text: message });
    document.body.append(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.remove(), long ? 6000 : 2600);
  }

  /** هل الصفحة مفتوحة كملف بدل الخادم؟ (سبب شائع لفشل كل الطلبات) */
  function isFileProtocol() {
    return location.protocol === 'file:';
  }

  /**
   * ما يجري بعد تسجيل الدخول: تهنئةُ الحساب الجديد، وسؤالُ البلد الإلزامي.
   *
   * الاثنان في بطاقةٍ واحدة لا بطاقتين متتاليتين — نافذةٌ تُغلق لتفتح أخرى
   * تُشعر المعلّم أنه في طابور. والبلد **مطلوب**: لا زرّ إغلاق، ولا نقرةٌ
   * خارج البطاقة تُغلقها، ولا Escape. من لم يجب لا يُكمل.
   *
   * وشرطُ العرض حالةُ الحساب لا معاملُ العنوان: من أغلق التبويب قبل أن يجيب
   * يُسأل في زيارته التالية. لو ربطناه بـ`welcome=1` وحده لأفلت منه كثيرون.
   *
   * @param {object} user المستخدم من `/api/auth/me` (أو null)
   * @param {object} premium ملخّص الاشتراك
   */
  function afterLogin(user, premium) {
    const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);

    // معامل التهنئة يُقرأ ويُمسح دائماً، كي لا تتكرّر مع كل تحديثٍ للصفحة
    const url = new URL(location.href);
    const justSignedUp = url.searchParams.get('welcome') === '1';
    if (justSignedUp) {
      url.searchParams.delete('welcome');
      history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    }

    const needsCountry = Boolean(user && !user.country);
    const showWelcome = justSignedUp && premium?.onSignupTrial;
    if (!needsCountry && !showWelcome) return null;
    if (document.querySelector('.welcome-pop')) return null;

    const days = premium?.daysLeft || premium?.plan?.signupTrialDays || 0;
    const box = el('div', { class: 'welcome-pop' + (needsCountry ? ' locked' : '') });
    const card = el('div', { class: 'welcome-card stack' });
    const close = () => box.remove();

    const parts = [];
    if (showWelcome) {
      parts.push(
        el('div', { style: { fontSize: '2.6rem', textAlign: 'center' }, text: '🎉' }),
        el('h2', { style: { margin: 0, textAlign: 'center' }, text: t('upWelcomeTitle', { days }) }),
        el('p', { class: 'muted small', style: { margin: 0, textAlign: 'center' }, text: t('upWelcomeBody', { days }) }),
        el('ul', { class: 'plan-list' }, [t('upPro1'), t('upPro2'), t('upPro3')].map((line) =>
          el('li', {}, [el('span', { class: 'mark', 'aria-hidden': 'true', text: '✓' }), el('span', { text: line })])
        ))
      );
    }

    if (needsCountry) {
      const select = countrySelect('', { placeholder: t('cnPick') });
      const note = el('span', { class: 'muted small', text: t('cnWhy') });
      // الزرّ مقفلٌ حتى يُختار بلد: زرٌّ يُضغط ولا يفعل شيئاً أسوأ من زرٍّ مقفل
      const go = el('button', { class: 'btn primary', type: 'button', disabled: true }, t('cnContinue'));
      select.addEventListener('change', () => {
        go.disabled = !select.value;
      });
      go.addEventListener('click', async () => {
        if (!select.value) return;
        go.disabled = true;
        const before = go.textContent;
        go.textContent = t('cnSaving');
        try {
          await api('/api/profile', { method: 'PUT', body: { country: select.value } });
          if (user) user.country = select.value;
          // الحساب الجديد لا يخرج من البطاقة إلى فراغ: بعد أن يجيب، تصير
          // البطاقة دعوةً إلى أول ما يستحقّ أن يجرّبه. ولولا هذا لابتلع
          // سؤالُ البلد دعوةَ «ابدأ بالمساعد الذكي» التي هي غرض التهنئة.
          if (showWelcome) {
            box.classList.remove('locked');
            card.replaceChildren(
              el('div', { style: { fontSize: '2.6rem', textAlign: 'center' }, text: '🚀' }),
              el('h2', { style: { margin: 0, textAlign: 'center' }, text: t('upWelcomeTitle', { days }) }),
              el('p', { class: 'muted small', style: { margin: 0, textAlign: 'center' }, text: t('upWelcomeBody', { days }) }),
              el('a', { class: 'btn primary', href: '/host.html#/ai', onclick: close }, t('upWelcomeCta')),
              el('button', { class: 'btn ghost sm', type: 'button', onclick: close }, t('upWelcomeLater'))
            );
            box.addEventListener('click', (e) => { if (e.target === box) close(); });
            return;
          }
          close();
        } catch (err) {
          note.textContent = err.message;
          go.textContent = before;
          go.disabled = false;
        }
      });

      if (!showWelcome) {
        parts.push(
          el('div', { style: { fontSize: '2.4rem', textAlign: 'center' }, text: '🌍' }),
          el('h2', { style: { margin: 0, textAlign: 'center' }, text: t('cnGateTitle') })
        );
      }
      parts.push(
        el('label', { class: 'stack tight' }, [el('span', { class: 'small', text: t('cnGateLabel') }), select, note]),
        go
      );
    } else {
      parts.push(
        el('a', { class: 'btn primary', href: '/host.html#/ai', onclick: close }, t('upWelcomeCta')),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: close }, t('upWelcomeLater'))
      );
      // الإغلاق بالنقر خارجها أو بـEscape — للتهنئة وحدها، لا لسؤال البلد
      box.addEventListener('click', (e) => { if (e.target === box) close(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key !== 'Escape') return;
        close();
        document.removeEventListener('keydown', esc);
      });
    }

    card.append(...parts);
    box.append(card);
    document.body.append(box);
    return box;
  }

  /**
   * قائمة البلدان — رموزٌ من الخادم، وأسماءٌ يولّدها المتصفّح بلغة قارئه.
   *
   * لا نرسل قاموس أسماءٍ بلغتين لمئتَي بلد ولا نصونه: `Intl.DisplayNames`
   * موجودة في كل متصفّحٍ حديث وتعرف الأسماء بكل اللغات. ونتجاوزها في حالةٍ
   * واحدة يفرضها الخادم (فلسطين)، ونسقط إلى الرمز إن غابت الدالة أصلاً.
   */
  let countryCache = null;
  async function countryList(lang) {
    if (!countryCache) countryCache = await api('/api/countries');
    const code = lang === 'en' ? 'en' : 'ar';
    let display = null;
    try {
      display = new Intl.DisplayNames([code], { type: 'region', fallback: 'code' });
    } catch {
      /* متصفّح قديم: نعرض الرموز */
    }
    const overrides = countryCache.overrides?.[code] || {};
    const name = (c) => overrides[c] || (display ? display.of(c) : c);
    const sort = (list) => list.map((c) => ({ code: c, name: name(c) })).sort((a, b) => a.name.localeCompare(b.name, code));
    // العربية أولاً بلا ترتيبٍ أبجدي مفروض: فلسطين رأس القائمة كما جاءت
    return { arab: countryCache.arab.map((c) => ({ code: c, name: name(c) })), rest: sort(countryCache.rest) };
  }

  /**
   * قائمة منسدلة للبلدان في مجموعتين. تُملأ بعد الرسم فلا تنتظر الشبكة:
   * الحقل يظهر فوراً معطّلاً ثم يمتلئ — أهون من صفحةٍ تتجمّد حتى تصل القائمة.
   */
  function countrySelect(value, opts) {
    const sel = el('select', { disabled: true });
    const lang = global.I18n ? global.I18n.getLang() : 'ar';
    const t = (key) => (global.I18n ? global.I18n.t(key) : key);
    sel.append(el('option', { value: '', text: opts?.placeholder || t('cnPick') }));
    countryList(lang)
      .then(({ arab, rest }) => {
        const group = (label, items) => {
          const g = el('optgroup', { label });
          items.forEach((c) => g.append(el('option', { value: c.code, text: c.name })));
          return g;
        };
        sel.append(group(t('cnArab'), arab), group(t('cnOther'), rest));
        if (value) sel.value = value;
        sel.disabled = false;
      })
      .catch(() => {
        sel.disabled = false;
      });
    return sel;
  }

  /** النص الافتراضي عربي دائماً؛ الصفحات المُترجمة (المحمَّل فيها i18n.js) تستبدله بلغتها الحالية */
  function offlineHint() {
    return global.I18n ? global.I18n.t('offlineHint') : 'تعذّر الوصول إلى خادم Tapio — هذه الصفحة تُقدَّم كملفات ثابتة فقط. محلياً شغّل «npm start»، وللنشر استخدم استضافة تشغّل Node دائماً (Render أو Railway أو Fly.io) لأن منصات serverless مثل Vercel لا تدعم WebSocket.';
  }

  async function api(path, options) {
    if (isFileProtocol()) {
      throw Object.assign(new Error(offlineHint()), { offline: true });
    }
    let response;
    try {
      response = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
        ...options,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      // فشل الشبكة نفسه: الخادم متوقف أو الصفحة تُقدَّم من مكان آخر
      throw Object.assign(new Error(offlineHint()), { offline: true });
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* لا شيء */
    }
    if (!response.ok) {
      // خادم ملفات ثابت يردّ HTML على مسارات API — نفس العلاج
      if (!data && (response.status === 404 || response.status === 405 || response.status >= 500)) {
        throw Object.assign(new Error(offlineHint()), { offline: true });
      }
      const fallback = global.I18n ? global.I18n.t('requestFailed', { status: response.status }) : `تعذّر تنفيذ الطلب (${response.status})`;
      throw new Error(data?.error || fallback);
    }
    return data;
  }

  /** فحص وجود الخادم — يعيد true/false بلا رمي استثناء */
  async function serverAlive() {
    if (isFileProtocol()) return false;
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) return false;
      const data = await response.json();
      return data?.ok === true;
    } catch {
      return false;
    }
  }

  /** شريط تحذير ثابت أعلى الصفحة يشرح كيف يشغّل المستخدم الخادم */
  function showOfflineBanner(container) {
    if (document.querySelector('#offlineBanner')) return;
    const I = global.I18n;
    const banner = el('div', { class: 'banner', id: 'offlineBanner', style: { marginBottom: '12px' } }, [
      el('strong', { text: I ? I.t('offlineTitle') : '⚠️ الخادم غير متصل — الوضع التجريبي' }),
      el('div', { class: 'small', style: { marginTop: '4px' } }, [
        I ? I.t('offlineBody1') : 'يمكنك تجهيز الأسئلة الآن، لكن بدء جلسة مباشرة يحتاج خادماً يعمل. محلياً: ',
        el('code', { text: 'npm install && npm start', style: { direction: 'ltr', display: 'inline-block' } }),
        I ? I.t('offlineBody1End') : ' ثم ',
        el('code', { text: 'http://localhost:3000', style: { direction: 'ltr', display: 'inline-block' } }),
        '.',
      ]),
      el('div', { class: 'small', style: { marginTop: '4px' } }, [
        I ? I.t('offlineBody2') : 'للنشر على الإنترنت استخدم استضافة تشغّل عملية Node دائمة (Render أو Railway أو Fly.io). ',
        I ? I.t('offlineBody2End') : 'منصات serverless مثل Vercel و Netlify و GitHub Pages تخدم الملفات الثابتة فقط ولا تدعم WebSocket، لذلك لن تعمل الجلسات المباشرة عليها.',
      ]),
    ]);
    (container || document.querySelector('#app') || document.body).prepend(banner);
  }

  function hideOfflineBanner() {
    document.querySelector('#offlineBanner')?.remove();
  }

  /** اتصال ويب سوكت مع إعادة اتصال تلقائية (مهم على شبكات الجوال) */
  function connect({ onOpen, onMessage, onStatus }) {
    let socket = null;
    let attempts = 0;
    let closed = false;
    let pingTimer = null;

    function open() {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/ws`);
      onStatus?.('connecting');

      socket.addEventListener('open', () => {
        attempts = 0;
        onStatus?.('online');
        onOpen?.();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => send({ t: 'ping' }), 25000);
      });

      socket.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') return;
        onMessage?.(msg);
      });

      socket.addEventListener('close', () => {
        clearInterval(pingTimer);
        if (closed) return;
        onStatus?.('offline');
        attempts += 1;
        setTimeout(open, Math.min(8000, 500 * 2 ** Math.min(attempts, 4)));
      });

      socket.addEventListener('error', () => socket?.close());
    }

    function send(message) {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify(message));
        return true;
      }
      return false;
    }

    function close() {
      closed = true;
      clearInterval(pingTimer);
      socket?.close();
    }

    open();
    return { send, close, get ready() { return socket?.readyState === 1; } };
  }

  const store = {
    get(key, fallback) {
      try {
        const raw = sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* الوضع الخاص قد يمنع التخزين */
      }
    },
    del(key) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* تجاهل */
      }
    },
    // نسخة تدوم بين الجلسات لمسودات المدرب فقط
    local: {
      get(key, fallback) {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : fallback;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* تجاهل */
        }
      },
    },
  };

  // أسماء الأنواع تُقرأ عند الاستعمال لا عند التحميل: شاشة الطالب قد تبدّل
  // لغتها بعد الإقلاع (لتتبع لغة النشاط) فيجب أن تتبعها الأسماء فوراً.
  const TYPE_FALLBACK = {
    mc: 'اختيار من متعدد',
    truefalse: 'صح / خطأ',
    poll: 'استطلاع رأي',
    word: 'سحابة كلمات',
    scale: 'مقياس',
    open: 'إجابة مفتوحة',
    blank: 'أكمل الفراغ',
    order: 'رتّب',
    match: 'طابِق',
    slide: 'شريحة عرض',
};
  const TYPE_KEYS = {
    mc: 'typeMc',
    truefalse: 'typeTruefalse',
    poll: 'typePoll',
    word: 'typeWord',
    scale: 'typeScale',
    open: 'typeOpen',
    blank: 'typeBlank',
    order: 'typeOrder',
    match: 'typeMatch',
    slide: 'typeSlide',
  };
  const TYPE_LABELS = {};
  for (const type of Object.keys(TYPE_FALLBACK)) {
    Object.defineProperty(TYPE_LABELS, type, {
      enumerable: true,
      get: () => (global.I18n ? global.I18n.t(TYPE_KEYS[type]) : TYPE_FALLBACK[type]),
    });
  }

  const TYPE_EMOJI = {
    mc: '🎯',
    truefalse: '✅',
    poll: '📊',
    word: '☁️',
    scale: '📈',
    open: '💬',
    blank: '✏️',
    order: '🔢',
    match: '🔗',
    slide: '🖼️',
  };

  function fmtMs(ms) {
    if (!ms) return '—';
    return (Math.round(ms / 100) / 10).toFixed(1) + (global.I18n ? global.I18n.t('aSecShort') : 'ث');
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** «٥ دقائق و٣٠ ثانية» — أوضح من 05:30 في نصّ عربي */
  function fmtLeft(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h} س ${String(m).padStart(2, '0')} د`;
    if (m) return `${m}:${String(s).padStart(2, '0')} د`;
    return `${s} ثانية`;
  }

  /**
   * عدّاد تنازلي حيّ داخل عنصر حتى لحظة معيّنة.
   * يعيد دالة إيقاف، ويستدعي onDone مرة واحدة عند الوصول.
   */
  function countdownTo(node, timestamp, onDone) {
    let done = false;
    const paint = () => {
      const left = timestamp - Date.now();
      node.textContent = fmtLeft(left);
      if (left <= 0 && !done) {
        done = true;
        clearInterval(timer);
        if (onDone) onDone();
      }
    };
    const timer = setInterval(paint, 1000);
    paint();
    return () => clearInterval(timer);
  }

  /**
   * يصغّر صورةً يختارها المستخدم إلى data URI صغيرة قبل رفعها.
   * التصغير في المتصفّح لا على الخادم: صورةُ الجوال بأربعة ميغابايت
   * تصير عشراتِ الكيلوبايت، فلا نرفع ما سنرميه.
   */
  function shrinkImage(file, { width = 640, height = 360, quality = 0.82 } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('اختر ملف صورة'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // قصٌّ يملأ الإطار بلا تشويهٍ للنِّسَب (مثل object-fit: cover)
        const scale = Math.max(width / img.width, height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
        let out = canvas.toDataURL('image/webp', quality);
        // متصفّح لا يعرف webp يعيد PNG صامتاً، وPNG للصور الفوتوغرافية ثقيل
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality);
        resolve(out);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('تعذّرت قراءة الصورة'));
      };
      img.src = url;
    });
  }

  /** ينسخ رابطاً إلى الحافظة، وإن مُنع ذلك رجع إلى تحديد النص */
  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      const box = document.createElement('textarea');
      box.value = url;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.append(box);
      box.select();
      let done = false;
      try {
        done = document.execCommand('copy');
      } catch {
        done = false;
      }
      box.remove();
      return done;
    }
  }

  function vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* تجاهل */
    }
  }

  /**
   * الاسم الأول بعد تخطّي الألقاب.
   *
   * «أول كلمة» في «أ. سلمى» هي «أ.» لا «سلمى»، فكانت المنصة تحيّي معلّمتها
   * بـ«أهلاً أ.». والبروفايل نفسه يدعو المعلّم إلى كتابة «أ. فلان»، فالحالة
   * هي القاعدة لا الشذوذ. وموضعها هنا لا في لوحة المعلّم وحدها: الصفحة
   * الرئيسية تحيّي بالاسم أيضاً، وكانت تقطعه عند اللقب نفسه.
   */
  const NAME_TITLES = /^(أ|د|م|ا|الأستاذ|الأستاذة|الاستاذ|الاستاذة|الدكتور|الدكتورة|المعلم|المعلمة|المعلّم|المعلّمة|مس|مستر|mr|mrs|ms|dr|prof|miss)\.?$/i;

  function firstName(name, fallback) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    while (parts.length > 1 && NAME_TITLES.test(parts[0])) parts.shift();
    return parts[0] || fallback || '';
  }

  /**
   * أيقونة «؟» تفتح فقاعة شرحٍ عند الضغط — بديل الفقرات الإرشادية الظاهرة.
   *
   * القاعدة: الشرح لمن يطلبه، لا فوق كل شاشة. الفقرة الدائمة تحت الزرّ تقرأها
   * العين في كل زيارة وإن حفظتها من أول مرّة، فتتراكم الصفحة «تعجيقاً». هنا
   * النص يسكن خلف نقطةٍ صغيرة بجوار العنوان، ويُفتح بضغطة ويُغلق بضغطةٍ خارجه
   * أو بـ Esc. ما يبقى ظاهراً دائماً: التحذيرات التي تحمي من خسارة (التخزين
   * غير الدائم، شروط النشر) — تلك ليست شرحاً بل حماية.
   */
  function hintDot(text) {
    const wrap = el('span', { class: 'hintdot' });
    const btn = el('button', { class: 'hintdot__btn', type: 'button', 'aria-expanded': 'false' });
    btn.setAttribute('aria-label', window.I18n ? window.I18n.t('hintWhat') : '?');
    btn.append(el('span', { class: 'hintdot__dot', 'aria-hidden': 'true', text: window.I18n && window.I18n.getLang() === 'en' ? '?' : '؟' }));
    const pop = el('span', { class: 'hintdot__pop', role: 'note', text });
    pop.hidden = true;

    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function onOutside(event) {
      if (!wrap.contains(event.target)) close();
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }
    btn.addEventListener('click', () => {
      if (!pop.hidden) return close();
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      // الفقاعة مربوطة بالنقطة، والشاشة قد تقصّها من أي الجهتين — قصٌّ بالبكسل
      pop.style.transform = '';
      const box = pop.getBoundingClientRect();
      const margin = 12;
      let shift = 0;
      if (box.right > window.innerWidth - margin) shift = window.innerWidth - margin - box.right;
      if (box.left + shift < margin) shift = margin - box.left;
      if (shift) pop.style.transform = 'translateX(' + Math.round(shift) + 'px)';
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    });

    wrap.append(btn, pop);
    return wrap;
  }

  /**
   * حقل رمز الدخول بخاناته الستّ — للرئيسية وصفحة الدخول معاً.
   *
   * الحقل الحقيقي واحدٌ شفّاف فوق الخانات: اللصق والإكمال التلقائي ولوحة
   * المفاتيح والقارئ الصوتي تعمل كلها بلا حيلة، والخانات طبقة عرضٍ تُملأ من
   * قيمته. اكتمال الأرقام الستّة يُرسل وحده — لا زرَّ ينتظره طالبٌ متلهّف.
   */
  function mountCodeEntry(form, options) {
    const opts = options || {};
    const t = (key) => (global.I18n ? global.I18n.t(key) : key);
    const input = el('input', {
      class: 'code-input',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: 6,
      autocomplete: 'one-time-code',
      enterkeyhint: 'go',
      'aria-label': t('homeCodeAria'),
    });
    const field = el('div', { class: 'code-field' }, input);
    const cells = [];
    for (let i = 0; i < 6; i += 1) {
      const cell = el('span', { class: 'code-cell', 'aria-hidden': 'true' });
      field.append(cell);
      cells.push(cell);
    }
    const paint = () => {
      const digits = input.value;
      cells.forEach((cell, i) => {
        cell.textContent = digits[i] || '';
        cell.classList.toggle('filled', i < digits.length);
        cell.classList.toggle('next', i === digits.length);
      });
    };
    input.addEventListener('focus', () => field.classList.add('focused'));
    input.addEventListener('blur', () => field.classList.remove('focused'));
    // المؤشّر دائماً في آخر الرمز: النقر في منتصفه لا يجعله يكتب بين رقمين
    const toEnd = () => setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
    input.addEventListener('click', toEnd);
    input.addEventListener('focus', toEnd);
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      paint();
      if (input.value.length === 6) form.requestSubmit();
    });
    paint();

    form.append(field);
    // زرٌّ ظاهر يطمئن من لا يعرف أن الرمز يُرسل وحده — والإرسال الفعلي واحد
    form.append(el('button', { class: 'btn primary block', type: 'submit', text: t('homeJoinBtn') }));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = input.value.trim();
      if (code.length !== 6) return toast(t('homeCodeError'), 'bad');
      try {
        await api('/api/sessions/' + code);
        location.href = '/play.html?code=' + code;
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    if (opts.autofocus) input.focus();
    return { input, field };
  }

  global.T = {
    $,
    $$,
    el,
    firstName,
    avatarNode,
    toast,
    api,
    connect,
    store,
    TYPE_LABELS,
    TYPE_EMOJI,
    fmtMs,
    fmtLeft,
    countdownTo,
    escapeHtml,
    shrinkImage,
    copyLink,
    vibrate,
    serverAlive,
    showOfflineBanner,
    hideOfflineBanner,
    isFileProtocol,
    afterLogin,
    countrySelect,
    countryList,
    mountCodeEntry,
    hintDot,
    OFFLINE_HINT: offlineHint,
  };
})(window);
