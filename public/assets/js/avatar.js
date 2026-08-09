/* توليد أفاتار عشوائي بصيغة SVG — بلا صور ولا طلبات شبكة */
(function (global) {
  'use strict';

  const BG = [
    ['#7c5cff', '#4338ca'],
    ['#22d3ee', '#0e7490'],
    ['#f472b6', '#be185d'],
    ['#34d399', '#047857'],
    ['#fbbf24', '#b45309'],
    ['#fb7185', '#9f1239'],
    ['#60a5fa', '#1d4ed8'],
    ['#a78bfa', '#6d28d9'],
    ['#fb923c', '#c2410c'],
    ['#4ade80', '#15803d'],
    ['#f0abfc', '#a21caf'],
    ['#5eead4', '#0f766e'],
  ];

  const BODY = ['#ffd7a8', '#f6c08a', '#e0a06b', '#c4784a', '#9c5b32', '#7a4526', '#ffe8cf', '#d9a066', '#b57c50', '#8d5a34', '#f2cba3', '#a86b3c'];

  // كل وجه: [شكل العين، شكل الفم]
  const EYES = [
    '<circle cx="-14" cy="-6" r="5"/><circle cx="14" cy="-6" r="5"/>',
    '<rect x="-19" y="-10" width="10" height="9" rx="4"/><rect x="9" y="-10" width="10" height="9" rx="4"/>',
    '<path d="M-20 -6 q6 -9 12 0" stroke-width="4" fill="none" stroke="currentColor"/><path d="M8 -6 q6 -9 12 0" stroke-width="4" fill="none" stroke="currentColor"/>',
    '<circle cx="-14" cy="-6" r="6"/><circle cx="14" cy="-6" r="6"/><circle cx="-12" cy="-8" r="2" fill="#fff"/><circle cx="16" cy="-8" r="2" fill="#fff"/>',
    '<rect x="-19" y="-8" width="11" height="4" rx="2"/><rect x="8" y="-8" width="11" height="4" rx="2"/>',
    '<path d="M-20 -2 q6 8 12 0" stroke-width="4" fill="none" stroke="currentColor"/><path d="M8 -2 q6 8 12 0" stroke-width="4" fill="none" stroke="currentColor"/>',
  ];

  const MOUTHS = [
    '<path d="M-12 12 q12 12 24 0" stroke-width="4" fill="none" stroke="currentColor" stroke-linecap="round"/>',
    '<ellipse cx="0" cy="14" rx="8" ry="9"/>',
    '<rect x="-11" y="11" width="22" height="5" rx="2.5"/>',
    '<path d="M-11 16 q11 -10 22 0" stroke-width="4" fill="none" stroke="currentColor" stroke-linecap="round"/>',
    '<path d="M-12 11 q12 14 24 0 z"/>',
    '<circle cx="0" cy="14" r="5"/>',
  ];

  const ACCESSORIES = [
    '',
    // نظارة
    '<g fill="none" stroke="#111827" stroke-width="3" opacity="0.85"><circle cx="-14" cy="-6" r="11"/><circle cx="14" cy="-6" r="11"/><path d="M-3 -6 h6"/></g>',
    // قبعة
    '<g fill="#111827" opacity="0.9"><rect x="-30" y="-46" width="60" height="8" rx="4"/><path d="M-20 -46 q20 -22 40 0 z"/></g>',
    // شعر مموج
    '<path d="M-32 -18 q4 -34 32 -34 q28 0 32 34 q-10 -16 -32 -16 q-22 0 -32 16 z" fill="#1f2937" opacity="0.92"/>',
    // سماعات
    '<g fill="#111827" opacity="0.9"><rect x="-38" y="-14" width="12" height="24" rx="6"/><rect x="26" y="-14" width="12" height="24" rx="6"/><path d="M-32 -14 q32 -34 64 0" fill="none" stroke="#111827" stroke-width="6"/></g>',
    // وردة
    '<g><circle cx="26" cy="-30" r="7" fill="#f472b6"/><circle cx="34" cy="-24" r="6" fill="#fb7185"/><circle cx="20" cy="-23" r="6" fill="#fda4af"/></g>',
  ];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  /** أفاتار عشوائي جديد */
  function random() {
    const seed = Math.random().toString(36).slice(2, 10);
    return {
      seed,
      bg: Math.floor(Math.random() * BG.length),
      body: Math.floor(Math.random() * BODY.length),
      face: Math.floor(Math.random() * (EYES.length * MOUTHS.length)),
      accessory: Math.floor(Math.random() * ACCESSORIES.length),
    };
  }

  /** أفاتار ثابت مشتق من نص (نفس الاسم ⇒ نفس الشكل) */
  function fromSeed(text) {
    const h = hash(String(text || 'tafa3l'));
    return {
      seed: String(text || '').slice(0, 32),
      bg: h % BG.length,
      body: Math.floor(h / 7) % BODY.length,
      face: Math.floor(h / 13) % (EYES.length * MOUTHS.length),
      accessory: Math.floor(h / 29) % ACCESSORIES.length,
    };
  }

  function pick(list, index) {
    return list[((index % list.length) + list.length) % list.length];
  }

  /** بناء SVG من كائن الأفاتار */
  function toSvg(avatar, size) {
    const a = avatar || fromSeed('؟');
    const gradient = pick(BG, a.bg | 0);
    const skin = pick(BODY, a.body | 0);
    const faceIndex = a.face | 0;
    const eyes = pick(EYES, faceIndex);
    const mouth = pick(MOUTHS, Math.floor(faceIndex / EYES.length));
    const accessory = pick(ACCESSORIES, a.accessory | 0);
    const gid = 'g' + hash((a.seed || '') + a.bg + a.body + a.face + a.accessory).toString(36);
    const dim = size ? `width="${size}" height="${size}"` : 'width="100%" height="100%"';

    return (
      `<svg ${dim} viewBox="-60 -60 120 120" role="img" aria-label="أفاتار" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${gradient[0]}"/><stop offset="1" stop-color="${gradient[1]}"/>` +
      `</linearGradient></defs>` +
      `<rect x="-60" y="-60" width="120" height="120" fill="url(#${gid})"/>` +
      `<circle cx="0" cy="46" r="42" fill="${skin}" opacity="0.95"/>` +
      `<circle cx="0" cy="0" r="36" fill="${skin}"/>` +
      `<g fill="#1f2937" color="#1f2937">${eyes}${mouth}</g>` +
      accessory +
      `</svg>`
    );
  }

  global.Avatar = { random, fromSeed, toSvg, count: { bg: BG.length, body: BODY.length } };
})(window);
