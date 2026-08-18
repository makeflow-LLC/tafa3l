'use strict';

/**
 * مخزن الجلسات الحيّة: الذاكرة أولاً، ومعها **هيكلٌ** محفوظ على القرص.
 *
 * كل ما يخصّ المشاركين — أسماؤهم وإجاباتهم ودرجاتهم — يبقى في الذاكرة وحدها
 * ويختفي مع انتهاء الجلسة أو إعادة التشغيل. هذا وعد المنصة ولا نمسّه.
 *
 * ما يُكتب على القرص هو الهيكل فقط: الرمز، والأسئلة، والإعدادات، وموضع
 * العرض. والسبب أن ضياعه شيءٌ آخر تماماً: المعلّم يجدول اختباراً للغد
 * ويوزّع رمزه، ثم يُعيد المضيف نشر الخادم ليلاً فيجد الطلاب رمزاً ميتاً بلا
 * سببٍ يفهمونه. الإجابات لو ضاعت أُعيد السؤال؛ أما الرمز الموزَّع فلا يُستعاد.
 */

const { Session } = require('./session');
const storage = require('./storage');

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
  watch(session);
  return session;
}

function getSession(code) {
  if (!code) return null;
  return sessions.get(String(code).trim()) || null;
}

function deleteSession(code) {
  const session = sessions.get(code);
  if (session) session.dispose();
  forget(code);
  return sessions.delete(code);
}

// ------------------------------------------------------- حفظ الهيكل واسترجاعه

/** الأسطر المنتظرة الكتابة */
const dirty = new Set();
/** آخر بصمة كُتبت لكل رمز — تمنع كتابةً لا تغيّر شيئاً */
const signatures = new Map();
let flushTimer = null;
const FLUSH_DELAY_MS = 1500;

function driver() {
  try {
    const db = storage.get();
    return db && typeof db.saveLiveSession === 'function' ? db : null;
  } catch {
    // التخزين لم يُهيَّأ بعد (اختبارات وحدة تستورد المخزن وحده)
    return null;
  }
}

/**
 * ما الذي يستحقّ كتابةً جديدة؟ لا كل نبضة. كل إجابة طالب تستدعي `touch()`،
 * وفي صفٍّ من ثلاثين طالباً تعني كتابة القرص عند كل نقرة — وهي كتابةٌ بلا
 * فائدة لأن الإجابات ليست فيما نكتب أصلاً. فنقارن بصمةَ ما نحفظه وحده.
 */
function signatureOf(session) {
  return [
    session.status,
    session.phase,
    session.currentIndex,
    session.startedAt,
    session.ownerId,
    session.settings?.opensAt,
    session._shuffled ? 1 : 0,
  ].join('|');
}

function markChanged(session) {
  if (!driver()) return;
  const sig = signatureOf(session);
  if (signatures.get(session.code) === sig) return;
  signatures.set(session.code, sig);
  dirty.add(session.code);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

/** يربط جلسةً بالحفظ التلقائي ويحفظها أول مرة */
function watch(session) {
  session.onChange = () => markChanged(session);
  markChanged(session);
}

function forget(code) {
  dirty.delete(code);
  signatures.delete(code);
  fullyWritten.delete(code);
  const db = driver();
  if (db) db.deleteLiveSession(code).catch(() => {});
}

/**
 * الحقول التي تتغيّر أثناء الحصة. أما العنوان والأسئلة والإعدادات فتُكتب مرة
 * واحدة عند الإنشاء ولا تتبدّل — والأسئلة قد تحمل صوراً بميغابايتات، فإعادة
 * كتابتها عند كل انتقال شريحة هدرٌ خالص. الاستثناء الوحيد خلطُ الأسئلة، وهو
 * يقع مرة واحدة عند الإطلاق فنُعيد الصفّ كاملاً حينها.
 */
function lightPatch(session) {
  return {
    status: session.status,
    currentIndex: session.currentIndex,
    startedAt: session.startedAt,
    ownerId: session.ownerId,
    ownerName: session.ownerName,
    settings: session.settings,
    lastActivity: session.lastActivity,
  };
}

/**
 * رموزٌ كُتب صفّها كاملاً، والقيمة هي حالةُ الخلط وقتها. ولولا حفظ هذه الحالة
 * لمرّ الخلط — وهو يقع مرة واحدة عند الإطلاق ويغيّر ترتيب الأسئلة كلّه —
 * عبر التحديث الخفيف الذي لا يمسّ الأسئلة، فيعود الترتيب الأصلي بعد الإحياء
 * ويرى الطالب سؤالاً سبق أن أجابه.
 * @type {Map<string, boolean>}
 */
const fullyWritten = new Map();

async function flush() {
  const db = driver();
  if (!db) return;
  const codes = [...dirty];
  dirty.clear();
  for (const code of codes) {
    const session = sessions.get(code);
    if (!session) continue;
    try {
      // جلسة منتهية لا يُبعثها شيء: نتائجها كانت في الذاكرة وقد ذهبت،
      // فإحياء هيكلها الفارغ يعطي المعلّم صفحةً بلا بيانات ويوهمه بعطل
      if (session.status === 'ended') {
        await db.deleteLiveSession(code);
        fullyWritten.delete(code);
        continue;
      }
      const shuffled = Boolean(session._shuffled);
      const light = fullyWritten.get(code) === shuffled && db.patchLiveSession;
      if (light && (await db.patchLiveSession(code, lightPatch(session)))) continue;
      await db.saveLiveSession(session.snapshot());
      fullyWritten.set(code, shuffled);
    } catch (err) {
      console.error('تعذّر حفظ هيكل الجلسة ' + code + ':', err.message);
    }
  }
}

/**
 * إحياء الجلسات بعد الإقلاع. تُنادى مرة واحدة بعد تهيئة التخزين.
 * @returns {Promise<number>} كم جلسة عادت
 */
async function restore() {
  const db = driver();
  if (!db) return 0;
  let count = 0;
  let rows = [];
  try {
    rows = (await db.listLiveSessions()) || [];
  } catch (err) {
    console.error('تعذّرت قراءة الجلسات المحفوظة:', err.message);
    return 0;
  }
  const now = Date.now();
  for (const snap of rows) {
    if (!snap || !snap.code) continue;
    if (sessions.has(snap.code)) continue;
    if (sessions.size >= MAX_SESSIONS) break;
    /**
     * جلسة نامت أطول من عمرها الطبيعي لا تُبعث — ورمزها يعود متاحاً لغيرها.
     *
     * إلا المجدولة: هي **حصانة المنظّف نفسها** (انظر `sweep`)، ولولا استثناؤها
     * هنا لسقط الغرض كلّه — اختبارُ الأسبوع القادم أُنشئ اليوم ثم مضت ثلاث
     * ساعاتِ خمولٍ فأُسقط عند أول إعادة نشر، وهو بالضبط ما جئنا نمنعه.
     */
    const scheduled = snap.status === 'lobby' && snap.settings?.opensAt;
    const alive =
      now - (Number(snap.lastActivity) || 0) <= IDLE_TTL_MS || (scheduled && now < snap.settings.opensAt + 60 * 60 * 1000);
    if (!alive) {
      db.deleteLiveSession(snap.code).catch(() => {});
      continue;
    }
    try {
      const session = Session.restore(snap);
      sessions.set(session.code, session);
      session.onChange = () => markChanged(session);
      signatures.set(session.code, signatureOf(session));
      // صفّها موجود بأسئلته، فتكفيها التحديثات الخفيفة من الآن
      fullyWritten.set(session.code, Boolean(session._shuffled));
      // كتابةٌ فورية تُجدّد `lastActivity` على القرص: الإحياء يمنح الجلسة عمراً
      // كاملاً في الذاكرة، ولولا تدوينه لأسقطتها إعادةُ النشر التالية ظلماً.
      dirty.add(session.code);
      count += 1;
    } catch (err) {
      console.error('تعذّر إحياء الجلسة ' + snap.code + ':', err.message);
      db.deleteLiveSession(snap.code).catch(() => {});
    }
  }
  if (dirty.size) flush().catch(() => {});
  return count;
}

/**
 * حذف الجلسات الخاملة. `aggressive` يحذف أيضاً الجلسات المنتهية فوراً،
 * ويسقط حصانة الجلسات المجدولة: بدون ذلك كان يكفي إنشاء ٥٠٠ جلسة بموعد
 * بعيد ليعجز كل معلّم على الخادم عن بدء حصته، بلا أي وسيلة استرداد.
 */
function sweep(aggressive = false) {
  const now = Date.now();
  for (const [code, session] of sessions) {
    // اختبار مجدول لموعد قادم يبقى محفوظاً ولو لم يلمسه أحد — ما لم يمتلئ الخادم
    const scheduled = session.status === 'lobby' && session.settings?.opensAt;
    if (!aggressive && scheduled && now < session.settings.opensAt + 60 * 60 * 1000) continue;
    /**
     * واجبٌ له موعد تسليم يبقى حيّاً حتى موعده مهما طال الخمول بينهما.
     * ثلاث ساعاتٍ من الخمول هي القاعدة الصحيحة لحصةٍ في قاعة، وهي الخطأ
     * الصريح لواجب نهاية الأسبوع: يُرسَل ليل الخميس فيموت رابطه قبل الفجر.
     */
    const due = session.status !== 'ended' && session.settings?.dueAt;
    if (!aggressive && due && now < session.settings.dueAt + 60 * 60 * 1000) continue;
    const idle = now - session.lastActivity;
    const endedTooLong =
      session.status === 'ended' && now - (session.endedAt || session.lastActivity) > (aggressive ? 0 : ENDED_TTL_MS);
    // ملجأ أخير عند امتلاء الخادم: جلسة مجدولة لم ينضم إليها أحد ولم تُلمس منذ
    // ساعة. المعلّم الحقيقي يشارك الرمز ويتابع، أما جلسات الإغراق فتُترك وحدها.
    const reclaimable = aggressive && scheduled && session.participants.size === 0 && idle > 60 * 60 * 1000;
    if (idle > IDLE_TTL_MS || endedTooLong || reclaimable) {
      session.broadcast({ t: 'session:closed', reason: 'expired' });
      session.dispose();
      forget(code);
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

module.exports = { createSession, getSession, deleteSession, sweep, stats, sessions, restore, flush };
