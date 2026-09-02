/* مؤثرات: أصوات (Web Audio)، قصاصات ورق، إيموجي طائر، عدّاد «استعد» — بلا ملفات ولا مكتبات */
(function (global) {
  'use strict';

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  // ------------------------------------------------------------------ الصوت

  let ctx = null;
  let enabled = true;
  try {
    enabled = localStorage.getItem('tafa3l:sound') !== 'off';
  } catch {
    /* تجاهل */
  }

  function audio() {
    if (!enabled) return null;
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** نغمة واحدة */
  function tone(freq, start, duration, type = 'sine', gain = 0.12) {
    const ac = audio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const vol = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    vol.gain.setValueAtTime(0.0001, ac.currentTime + start);
    vol.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.015);
    vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
    osc.connect(vol).connect(ac.destination);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + duration + 0.02);
  }

  const SOUNDS = {
    join: () => tone(660, 0, 0.12, 'triangle', 0.08),
    tick: () => tone(880, 0, 0.05, 'square', 0.05),
    go: () => {
      tone(523, 0, 0.12, 'triangle');
      tone(784, 0.12, 0.22, 'triangle');
    },
    correct: () => {
      tone(659, 0, 0.11, 'triangle');
      tone(784, 0.1, 0.11, 'triangle');
      tone(1047, 0.2, 0.28, 'triangle');
    },
    wrong: () => {
      tone(220, 0, 0.18, 'sawtooth', 0.09);
      tone(160, 0.12, 0.26, 'sawtooth', 0.09);
    },
    sent: () => tone(720, 0, 0.09, 'sine', 0.07),
    reveal: () => {
      tone(440, 0, 0.1, 'triangle', 0.09);
      tone(587, 0.09, 0.16, 'triangle', 0.09);
    },
    finish: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle'));
    },
  };

  function play(name) {
    try {
      SOUNDS[name]?.();
    } catch {
      /* الصوت ليس ضرورياً */
    }
  }

  function setSound(on) {
    enabled = !!on;
    try {
      localStorage.setItem('tafa3l:sound', enabled ? 'on' : 'off');
    } catch {
      /* تجاهل */
    }
    if (enabled) play('sent');
  }

  function soundOn() {
    return enabled;
  }

  // -------------------------------------------------------------- القصاصات

  let canvas = null;
  let running = false;

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    document.body.append(canvas);
    return canvas;
  }

  /** انفجار قصاصات ورق ملوّنة */
  function confetti(count = 90) {
    if (reduced) return;
    const c = ensureCanvas();
    const ctx2d = c.getContext('2d');
    c.width = window.innerWidth;
    c.height = window.innerHeight;

    const colors = ['#7c5cff', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#fb923c'];
    const pieces = Array.from({ length: count }, () => ({
      x: c.width / 2 + (Math.random() - 0.5) * c.width * 0.6,
      y: c.height * 0.35 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -11 - 4,
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1,
    }));

    if (running) return;
    running = true;
    let frames = 0;

    (function frame() {
      frames += 1;
      ctx2d.clearRect(0, 0, c.width, c.height);
      let alive = 0;
      for (const p of pieces) {
        p.vy += 0.32;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.008;
        if (p.y < c.height && p.life > 0) alive += 1;
        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        ctx2d.globalAlpha = Math.max(0, p.life);
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx2d.restore();
      }
      if (alive > 0 && frames < 220) {
        requestAnimationFrame(frame);
      } else {
        ctx2d.clearRect(0, 0, c.width, c.height);
        running = false;
      }
    })();
  }

  // ------------------------------------------------------- إيموجي طائر

  function floatEmoji(emoji) {
    if (reduced) {
      return;
    }
    const node = document.createElement('div');
    node.className = 'fx-emoji';
    node.textContent = emoji;
    node.style.insetInlineStart = 10 + Math.random() * 70 + '%';
    node.style.fontSize = 1.6 + Math.random() * 1.4 + 'rem';
    node.style.animationDuration = 2.2 + Math.random() * 1.2 + 's';
    document.body.append(node);
    setTimeout(() => node.remove(), 3600);
  }

  // ----------------------------------------------------------- العدّاد

  let overlay = null;

  /** عدّاد «استعد» متزامن مع الخادم — يعيد الحالة عند انتهائه */
  function countdown(msLeft, onDone) {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'fx-countdown';
    const num = document.createElement('div');
    num.className = 'n';
    const label = document.createElement('div');
    label.className = 'l';
    // بلغة النشاط: هذه الشاشة يراها الطالب والبروجكتر، وكانت عربيةً في نشاطٍ إنجليزي
    label.textContent = window.I18n ? window.I18n.t('fxGetReady') : 'استعد…';
    overlay.append(num, label);
    document.body.append(overlay);

    let last = null;
    const end = Date.now() + msLeft;

    const timer = setInterval(() => {
      const left = end - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        overlay?.remove();
        overlay = null;
        play('go');
        onDone?.();
        return;
      }
      const seconds = Math.ceil(left / 1000);
      if (seconds !== last) {
        last = seconds;
        num.textContent = String(seconds);
        num.classList.remove('pop');
        void num.offsetWidth; // إعادة تشغيل الحركة
        num.classList.add('pop');
        play('tick');
      }
    }, 80);

    return () => {
      clearInterval(timer);
      overlay?.remove();
      overlay = null;
    };
  }

  global.Fx = { play, setSound, soundOn, confetti, floatEmoji, countdown, REACTIONS: ['👏', '🔥', '😂', '😮', '❤️', '🤔'] };
})(window);
