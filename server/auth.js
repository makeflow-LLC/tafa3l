'use strict';

/**
 * مصادقة المدربين: كلمة مرور مُجزَّأة بـ scrypt، وجلسة عبر كوكي HttpOnly.
 * بلا أي اعتماد خارجي — كل شيء من وحدة crypto المدمجة.
 */

const crypto = require('crypto');
const storage = require('./storage');

const COOKIE = 'tafa3l_sid';
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD = 8;

// ------------------------------------------------------------ كلمة المرور

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, derived) => {
      if (err) return reject(err);
      resolve({ hash: derived.toString('hex'), salt });
    });
  });
}

async function verifyPassword(password, expectedHash, salt) {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------- الكوكيز

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

function isSecure(req) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || '').split(',')[0].trim();
  return proto === 'https';
}

function setSessionCookie(req, res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isSecure(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// ------------------------------------------------------------- الجلسات

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await storage.get().createAuthSession({ token, userId, expiresAt });
  setSessionCookie(req, res, token);
  return token;
}

async function endSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await storage.get().deleteAuthSession(token);
  clearSessionCookie(req, res);
}

/** يضع req.user إن وُجدت جلسة صالحة — بلا منع */
async function attachUser(req, _res, next) {
  try {
    const token = parseCookies(req)[COOKIE];
    if (token) {
      const session = await storage.get().getAuthSession(token);
      if (session) {
        const user = await storage.get().findUserById(session.userId);
        if (user) req.user = { id: user.id, email: user.email, name: user.name };
      }
    }
  } catch (err) {
    console.error('تعذّر قراءة جلسة الدخول:', err.message);
  }
  next();
}

/** يمنع الوصول بلا تسجيل دخول */
function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  next();
}

// ------------------------------------------------------------- التحقق

function validateEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 160) return null;
  // تحقق عملي كافٍ: نص@نص.نص بلا فراغات
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < MIN_PASSWORD) return { error: `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD} أحرف` };
  if (password.length > 200) return { error: 'كلمة المرور طويلة جداً' };
  return { password };
}

// -------------------------------------------- حدّ محاولات الدخول الفاشلة

const attempts = new Map(); // مفتاح → { count, until }
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function throttleKey(req, email) {
  const ip = (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  return `${ip}|${email}`;
}

function tooManyAttempts(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.until < Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const entry = attempts.get(key) || { count: 0, until: Date.now() + WINDOW_MS };
  entry.count += 1;
  entry.until = Date.now() + WINDOW_MS;
  attempts.set(key, entry);
}

function clearFailures(key) {
  attempts.delete(key);
}

const sweepAttempts = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
}, 10 * 60 * 1000);
sweepAttempts.unref?.();

module.exports = {
  COOKIE,
  MIN_PASSWORD,
  hashPassword,
  verifyPassword,
  startSession,
  endSession,
  attachUser,
  requireUser,
  validateEmail,
  validatePassword,
  throttleKey,
  tooManyAttempts,
  recordFailure,
  clearFailures,
};
