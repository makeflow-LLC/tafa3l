'use strict';

/**
 * تسجيل الدخول عبر جوجل فقط — تدفّق Authorization Code القياسي.
 * بلا أي مكتبة خارجية: نستخدم fetch المدمجة في Node (>=18).
 *
 * لماذا جوجل فقط: بريد جوجل مُتحقَّق منه دائماً من طرف جوجل نفسها، فيصعب
 * على شخص واحد فتح عشرات الحسابات كما كان ممكناً ببريد+كلمة مرور عاديين.
 */

const crypto = require('crypto');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

const STATE_COOKIE = 'tafa3l_oauth';
const STATE_PATH = '/api/auth/google';
const STATE_MAX_AGE = 10 * 60; // عشر دقائق تكفي لإتمام الدخول عبر جوجل

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function isSecureReq(req) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || '').split(',')[0].trim();
  return proto === 'https';
}

/** رابط العودة — يجب أن يطابق ما سجّلته بالضبط في Google Cloud Console */
function callbackUrl(req) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}${STATE_PATH}/callback`;
}

/** يبني رابط تحويل المستخدم إلى جوجل، وحمولة كوكي الحالة المرافقة له */
function buildAuthUrl(req, next) {
  const state = crypto.randomBytes(16).toString('base64url');
  const cookiePayload = Buffer.from(JSON.stringify({ state, next }), 'utf8').toString('base64url');

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  // يسمح باختيار حساب مختلف حتى لو كان المستخدم مسجّلاً في جوجل بحساب آخر مسبقاً
  url.searchParams.set('prompt', 'select_account');

  return { authUrl: url.toString(), cookiePayload };
}

function setStateCookie(req, res, payload) {
  const parts = [`${STATE_COOKIE}=${payload}`, `Path=${STATE_PATH}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${STATE_MAX_AGE}`];
  if (isSecureReq(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearStateCookie(req, res) {
  const parts = [`${STATE_COOKIE}=`, `Path=${STATE_PATH}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureReq(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** يقرأ ويفكّ حمولة كوكي الحالة — null إن كانت غائبة أو تالفة */
function readStateCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== STATE_COOKIE) continue;
    try {
      return JSON.parse(Buffer.from(part.slice(at + 1).trim(), 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/** يستبدل رمز التفويض ببيانات صاحب حساب جوجل */
async function resolveUser(req, code) {
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(req),
    }),
  });
  if (!tokenRes.ok) throw new Error('تعذّر تبادل رمز جوجل (' + tokenRes.status + ')');
  const tokens = await tokenRes.json();
  if (!tokens.access_token) throw new Error('لم يُعِد جوجل رمز وصول');

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) throw new Error('تعذّر جلب بيانات حساب جوجل (' + infoRes.status + ')');
  const info = await infoRes.json();

  if (!info.email || info.email_verified === false) {
    throw new Error('بريد حساب جوجل غير مُتحقَّق منه');
  }

  return {
    email: String(info.email).trim().toLowerCase(),
    name: String(info.name || info.email.split('@')[0]).trim().slice(0, 60) || 'مستخدم',
    googleId: String(info.sub || ''),
  };
}

module.exports = { isConfigured, buildAuthUrl, setStateCookie, clearStateCookie, readStateCookie, resolveUser };
