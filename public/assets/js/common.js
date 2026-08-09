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
    const node = el('div', { class: 'toast ' + (kind || ''), text: message });
    document.body.append(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.remove(), 2600);
  }

  async function api(path, options) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* لا شيء */
    }
    if (!response.ok) throw new Error(data?.error || 'تعذّر تنفيذ الطلب');
    return data;
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

  const TYPE_LABELS = {
    mc: 'اختيار من متعدد',
    truefalse: 'صح / خطأ',
    poll: 'استطلاع رأي',
    word: 'سحابة كلمات',
    scale: 'مقياس',
    open: 'إجابة مفتوحة',
  };

  const TYPE_EMOJI = {
    mc: '🎯',
    truefalse: '✅',
    poll: '📊',
    word: '☁️',
    scale: '📈',
    open: '💬',
  };

  function fmtMs(ms) {
    if (!ms) return '—';
    return (Math.round(ms / 100) / 10).toFixed(1) + 'ث';
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* تجاهل */
    }
  }

  global.T = { $, $$, el, avatarNode, toast, api, connect, store, TYPE_LABELS, TYPE_EMOJI, fmtMs, escapeHtml, vibrate };
})(window);
