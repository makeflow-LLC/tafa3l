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
   * تهنئة الحساب الجديد بمنحة التسجيل — تظهر مرّة واحدة على أي صفحةٍ يهبط
   * فيها المعلّم بعد أول تسجيل دخول (`welcome=1` من الخادم).
   *
   * هنا لا في host.js: وجهة ما بعد الدخول ليست صفحةً واحدة، والمعلّم الذي
   * سجّل من صفحة الألعاب يستحق أن يعرف ما فُتح له مثل الذي سجّل من اللوحة.
   * وتُلصق على `body` لا داخل حاوية الصفحة لأن التوجيه يمسحها عند كل رسم.
   *
   * @param {object} premium ملخّص الاشتراك من `/api/auth/me`
   */
  function welcomeNewAccount(premium) {
    const url = new URL(location.href);
    if (url.searchParams.get('welcome') !== '1') return;
    // نمسح المعامل فوراً كي لا تتكرّر التهنئة مع كل تحديثٍ للصفحة
    url.searchParams.delete('welcome');
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    if (!premium?.onSignupTrial) return;

    const t = (key, vars) => (global.I18n ? global.I18n.t(key, vars) : key);
    const days = premium.daysLeft || premium.plan?.signupTrialDays || 0;
    const box = el('div', { class: 'welcome-pop' });
    const close = () => box.remove();
    box.append(
      el('div', { class: 'welcome-card stack' }, [
        el('div', { style: { fontSize: '2.6rem', textAlign: 'center' }, text: '🎉' }),
        el('h2', { style: { margin: 0, textAlign: 'center' }, text: t('upWelcomeTitle', { days }) }),
        el('p', { class: 'muted small', style: { margin: 0, textAlign: 'center' }, text: t('upWelcomeBody', { days }) }),
        el('ul', { class: 'plan-list' }, [t('upPro1'), t('upPro2'), t('upPro3')].map((line) =>
          el('li', {}, [el('span', { class: 'mark', 'aria-hidden': 'true', text: '✓' }), el('span', { text: line })])
        )),
        el('a', { class: 'btn primary', href: '/host.html#/ai', onclick: close }, t('upWelcomeCta')),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: close }, t('upWelcomeLater')),
      ])
    );
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key !== 'Escape') return;
      close();
      document.removeEventListener('keydown', esc);
    });
    document.body.append(box);
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
    welcomeNewAccount,
    OFFLINE_HINT: offlineHint,
  };
})(window);
