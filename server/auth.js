'use strict';

/**
 * جلسة المدرب بعد الدخول عبر جوجل: كوكي HttpOnly + SameSite=Lax، بلا كلمات مرور.
 * آلية الدخول نفسها (تدفّق OAuth) في server/google-auth.js.
 */

const crypto = require('crypto');
const storage = require('./storage');

const COOKIE = 'tafa3l_sid';
const SESSION_DAYS = 30;

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
        if (user) {
          req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            premiumUntil: user.premiumUntil ?? null,
            // يميّز منحة التسجيل عن اشتراكٍ مدفوع في ما تعرضه الواجهة
            trialGrantedAt: user.trialGrantedAt ?? null,
            createdAt: user.createdAt,
          };
        }
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

module.exports = {
  COOKIE,
  startSession,
  endSession,
  attachUser,
  requireUser,
  validateEmail,
};
