'use strict';

/**
 * مخزن مؤقت بالكامل في الذاكرة (RAM).
 * لا توجد قاعدة بيانات ولا كتابة على القرص — كل شيء يختفي عند إعادة تشغيل الخادم
 * أو بعد انتهاء مدة الجلسة.
 */

const { Session } = require('./session');

/** @type {Map<string, Session>} */
const sessions = new Map();

// تُحذف الجلسة بعد مدة خمول (٣ ساعات افتراضياً) أو بعد إنهائها بمدة (٣٠ دقيقة).
// يمكن تمديدهما بمتغيرات البيئة للمحاضرات الطويلة.
const IDLE_TTL_MS = Math.max(5, Number(process.env.SESSION_IDLE_MINUTES) || 180) * 60 * 1000;
const ENDED_TTL_MS = Math.max(1, Number(process.env.SESSION_ENDED_MINUTES) || 30) * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_SESSIONS = 500;

function generateCode() {
  for (let i = 0; i < 200; i++) {
    // رمز من ٦ أرقام يسهل إدخاله على الجوال
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!sessions.has(code)) return code;
  }
  throw new Error('تعذّر توليد رمز جلسة فريد');
}

function createSession(data) {
  if (sessions.size >= MAX_SESSIONS) {
    sweep(true);
    if (sessions.size >= MAX_SESSIONS) {
      throw Object.assign(new Error('الخادم مشغول، حاول لاحقاً'), { status: 503 });
    }
  }
  const session = new Session(generateCode(), data);
  sessions.set(session.code, session);
  return session;
}

function getSession(code) {
  if (!code) return null;
  return sessions.get(String(code).trim()) || null;
}

function deleteSession(code) {
  const session = sessions.get(code);
  if (session) session.dispose();
  return sessions.delete(code);
}

/** حذف الجلسات الخاملة. `aggressive` يحذف أيضاً الجلسات المنتهية فوراً. */
function sweep(aggressive = false) {
  const now = Date.now();
  for (const [code, session] of sessions) {
    // اختبار مجدول لموعد قادم يبقى محفوظاً ولو لم يلمسه أحد
    const scheduled = session.status === 'lobby' && session.settings?.opensAt;
    if (scheduled && now < session.settings.opensAt + 60 * 60 * 1000) continue;
    const idle = now - session.lastActivity;
    const endedTooLong =
      session.status === 'ended' && now - (session.endedAt || session.lastActivity) > (aggressive ? 0 : ENDED_TTL_MS);
    if (idle > IDLE_TTL_MS || endedTooLong) {
      session.broadcast({ t: 'session:closed', reason: 'expired' });
      session.dispose();
      sessions.delete(code);
    }
  }
}

const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

function stats() {
  let participants = 0;
  for (const s of sessions.values()) participants += s.participants.size;
  return { sessions: sessions.size, participants };
}

module.exports = { createSession, getSession, deleteSession, sweep, stats, sessions };
