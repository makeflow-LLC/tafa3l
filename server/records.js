'use strict';

/**
 * سجلّ الطالب — نتائجه عبر الحصص، بقرارٍ من معلّمه.
 *
 * كانت المنصة تعد بأن إجابات الطلاب لا تلمس القرص، وذلك الوعد باقٍ **حيث لم
 * يقرّر المعلّم غيره**. هذه الوحدة لا تعمل إلا حين يشغّل المعلّم «سجلّ
 * الطلاب» على فصلٍ بعينه، وحينها:
 *
 *   - يصير لكل اسمٍ في الفصل **ملفٌ** بمعرّفٍ ثابت ورمزٍ شخصي من أربعة أرقام.
 *   - الطالب الذي يختار اسمه من الكشف يُدخل رمزه، فتُنسب نتيجته إلى ملفه.
 *   - عند انتهاء النشاط تُكتب نتيجته (النسبة، العلامة، وما أخطأ فيه) في
 *     السجل، وتبقى بعد موت الجلسة.
 *
 * وما عدا ذلك لم يُمسّ: فصلٌ بلا سجل، أو طالبٌ لم يجد اسمه ودخل ضيفاً،
 * يمرّان كما كانا — في الذاكرة، ويختفيان مع الجلسة.
 */

const crypto = require('crypto');
const storage = require('./storage');

const PIN_LENGTH = 4;
const MAX_ITEM_TEXT = 140;
/** الأنواع التي لا تُعدّ سؤالاً في السجل */
const SKIPPED_TYPES = new Set(['slide']);

function newPin() {
  // أربعة أرقام لا تبدأ بصفر: تُقرأ من ورقةٍ مطبوعة بلا لبس
  return String(1000 + crypto.randomInt(0, 9000));
}

function newKey() {
  return crypto.randomBytes(12).toString('base64url');
}

function nameKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/**
 * يوائم ملفّات الفصل مع كشف أسمائه: الاسم الباقي يحتفظ بملفّه ورمزه، والاسم
 * الجديد يأخذ ملفّاً جديداً، والاسم المحذوف يذهب ملفّه (وسجلّه يبقى حتى يحذفه
 * المعلّم صراحةً — الحذف قرارٌ لا أثرٌ جانبي لتعديل قائمة).
 */
function syncPupils(students, previous, groups) {
  const old = new Map((previous || []).map((p) => [nameKey(p.name), p]));
  const pins = new Set();
  const out = [];
  (students || []).forEach((name, i) => {
    const found = old.get(nameKey(name));
    let pin = found?.pin || '';
    // رمزان متطابقان في فصلٍ واحد يفتحان ملفاً بالخطأ — نعيد توليد المكرّر
    while (!pin || pins.has(pin)) pin = newPin();
    pins.add(pin);
    out.push({
      id: found?.id || storage.newId('st_'),
      name,
      pin,
      key: found?.key || newKey(),
      // مجموعته داخل الفصل — تُشتقّ من الكشف نفسه، فلا تفترق عنه
      group: String((groups || [])[i] || ''),
    });
  });
  return out;
}

/** ما يُرسل للمعلّم عن ملفّ: بلا مفتاح الطالب السرّي */
function publicPupil(p) {
  return { id: p.id, name: p.name, pin: p.pin, group: p.group || '' };
}

/** رمز الطالب لصفحته: يُعطى له عند الدخول ويعيش على جهازه */
function tokenFor(classId, pupil) {
  return `${classId}.${pupil.id}.${pupil.key}`;
}

/** يحلّ رمز طالبٍ إلى فصله وملفّه، أو null */
async function resolveToken(raw) {
  const parts = String(raw || '').split('.');
  if (parts.length !== 3) return null;
  const [classId, studentId, key] = parts;
  if (!/^cl_[\w-]{4,40}$/.test(classId) || !/^st_[\w-]{4,40}$/.test(studentId)) return null;
  const cls = await storage.get().getClass(classId);
  if (!cls || !cls.record) return null;
  const pupil = (cls.pupils || []).find((p) => p.id === studentId);
  if (!pupil || !pupil.key) return null;
  if (pupil.key.length !== key.length || !crypto.timingSafeEqual(Buffer.from(pupil.key), Buffer.from(key))) return null;
  return { cls, pupil };
}

/**
 * يجد ملفّ الطالب الذي يدخل باسمٍ ورمز، داخل فصلٍ مُسجَّل.
 *
 * @returns {{ok:true, pupil}|{ok:false, reason:'guest'|'pin'}}
 *   guest — الاسم ليس في الفصل (أو الفصل بلا سجل): يدخل ضيفاً كما كان
 *   pin   — الاسم في الفصل ورمزه خاطئ: لا يُقبل حتى لا يكتب أحدٌ في ملفّ غيره
 */
async function identify(classId, name, pin) {
  if (!classId) return { ok: false, reason: 'guest' };
  let cls = null;
  try {
    cls = await storage.get().getClass(classId);
  } catch {
    cls = null;
  }
  if (!cls || !cls.record) return { ok: false, reason: 'guest' };
  const pupil = (cls.pupils || []).find((p) => nameKey(p.name) === nameKey(name));
  if (!pupil) return { ok: false, reason: 'guest' };
  if (String(pin || '').trim() !== pupil.pin) return { ok: false, reason: 'pin' };
  return { ok: true, pupil, cls };
}

// ------------------------------------------------------------- الالتقاط

function short(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_TEXT);
}

function readable(q, value) {
  if (value == null) return '';
  if (q.type === 'order') {
    const byId = new Map((q.items || []).map((it) => [it.id, it.text]));
    return (Array.isArray(value) ? value : []).map((id2) => byId.get(id2) || id2).join(' ← ');
  }
  if (q.type === 'match') {
    return (q.pairs || []).map((pr) => `${pr.left}: ${value?.[pr.id] || '—'}`).join(' · ');
  }
  if (Array.isArray(value)) {
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    return value.map((v) => byId.get(v) || v).join(' + ');
  }
  return String(value);
}

function rightAnswer(q) {
  if (q.type === 'order') return (q.items || []).map((it) => it.text).join(' ← ');
  if (q.type === 'match') return (q.pairs || []).map((pr) => `${pr.left}: ${pr.right}`).join(' · ');
  if (q.type === 'blank') return (q.blanks || []).filter(Boolean).join(' · ');
  const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
  return (q.correct || []).map((c) => byId.get(c) || c).join(' · ');
}

/**
 * سطرٌ واحد في السجل: نتيجة طالبٍ في نشاطٍ واحد.
 *
 * معرّفه ثابت (الفصل + الطالب + رمز الجلسة) فالكتابة مرّتين — عند إنهائه هو
 * ثم عند إنهاء المعلّم الجلسة، أو بعد تصحيح إجابةٍ نصّية — تُحدّث السطر
 * نفسه ولا تكرّره.
 */
function entryFor(session, participant) {
  const questions = session.questions.filter((q) => !SKIPPED_TYPES.has(q.type));
  const items = [];
  let correct = 0;
  let partial = 0;
  let wrong = 0;
  let answered = 0;
  let pending = 0;
  for (const q of questions) {
    const a = participant.answers.get(q.id);
    if (a) answered += 1;
    if (a?.pending) pending += 1;
    const ok = a && !a.pending ? a.correct : null;
    if (ok === true) correct += 1;
    else if (ok === 'partial') partial += 1;
    else if (ok === false) wrong += 1;
    // السجل لا يحمل الأسئلة كلها، بل ما يحتاجه المعلّم لاحقاً: ما أُخطئ فيه أو تُرك
    if (ok === true) continue;
    items.push({
      text: short(q.text),
      type: q.type,
      ok: ok === undefined ? null : ok,
      mine: a ? short(readable(q, a.value)) : '',
      right: short(rightAnswer(q)),
    });
  }
  // النسبة من المصحَّح آلياً أو يدوياً: سؤالٌ بلا إجابةٍ صحيحة (استطلاع) خارج القسمة
  const graded = questions.filter((q) => q.manual || (q.correct || []).length > 0 || q.type === 'order' || q.type === 'match' || q.type === 'blank');
  const maxScore = questions.reduce((sum, q) => sum + (q.points || 0), 0);
  const mark = typeof session.markFor === 'function' ? session.markFor(participant) : null;
  const percent = mark ? mark.percent : graded.length ? Math.round(((correct + partial * 0.5) / graded.length) * 100) : null;
  return {
    id: `${session.settings.recordClassId}:${participant.studentId}:${session.code}`,
    classId: session.settings.recordClassId,
    studentId: participant.studentId,
    ownerId: session.ownerId || null,
    code: session.code,
    title: session.title,
    at: session.endedAt || Date.now(),
    total: graded.length || questions.length,
    answered,
    correct,
    partial,
    wrong,
    pending,
    percent,
    points: participant.score || 0,
    maxScore,
    mark: mark ? { mark: mark.mark, of: mark.of, percent: mark.percent, passed: mark.passed } : null,
    // ما سمح به المعلّم للطالب يبقى حدَّ ما يراه في سجلّه أيضاً
    reveal: session.settings.revealAnswer !== false,
    showScore: session.settings.showScore !== false,
    items,
  };
}

/**
 * يكتب سطور المشاركين المنسوبين إلى ملفّات. `only` يحصرها في مشاركٍ واحد
 * (أنهى بنفسه في الوضع الحرّ، أو صُحّحت إجابته بعد الانتهاء).
 */
async function capture(session, only) {
  if (!session?.settings?.recordClassId) return 0;
  const who = only ? [only] : [...session.participants.values()];
  const rows = who.filter((p) => p.studentId && p.answers.size > 0).map((p) => entryFor(session, p));
  if (!rows.length) return 0;
  try {
    await storage.get().saveRecords(rows);
  } catch (err) {
    console.error('تعذّر حفظ سجلّ الطلاب للجلسة ' + session.code + ':', err.message);
    return 0;
  }
  return rows.length;
}

// -------------------------------------------------------------- التلخيص

/** ملخّص فصلٍ للمعلّم: لكل طالبٍ عدد محاولاته ومتوسّطه وآخر نتيجة */
function summarize(pupils, records) {
  const byStudent = new Map();
  for (const r of records) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId).push(r);
  }
  const students = (pupils || []).map((p) => {
    const rows = (byStudent.get(p.id) || []).sort((a, b) => b.at - a.at);
    const scored = rows.filter((r) => r.percent !== null && r.percent !== undefined);
    const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.percent, 0) / scored.length) : null;
    return {
      ...publicPupil(p),
      attempts: rows.length,
      avgPercent: avg,
      lastAt: rows[0]?.at || null,
      lastPercent: rows[0]?.percent ?? null,
      // آخر خمس نتائج من الأقدم إلى الأحدث — خطٌّ صغير يقول إن كان يتحسّن
      trend: scored.slice(0, 5).reverse().map((r) => r.percent),
    };
  });
  const sessions = [...new Map(records.map((r) => [r.code, { code: r.code, title: r.title, at: r.at }])).values()].sort((a, b) => b.at - a.at);
  const scoredAll = records.filter((r) => r.percent !== null && r.percent !== undefined);
  return {
    students,
    sessions,
    groups: groupStats(students),
    avgPercent: scoredAll.length ? Math.round(scoredAll.reduce((s, r) => s + r.percent, 0) / scoredAll.length) : null,
  };
}

/**
 * المجموعات داخل الفصل: صفٌّ لكل مجموعة بعددها ومتوسّطها.
 *
 * فصلُ ستّين طالباً جدولٌ لا يُقرأ، والمعلّم يسأل عن مجموعةٍ لا عن ستّين
 * اسماً. والترتيب ترتيبُ ظهورها في الكشف — كما كتبها المعلّم لا كما يرتّبها
 * حاسوب، ومن بلا مجموعة يُجمعون في آخر القائمة.
 */
function groupStats(students) {
  const order = [];
  const byName = new Map();
  for (const s of students) {
    const key = s.group || '';
    if (!byName.has(key)) {
      byName.set(key, { name: key, students: 0, attempts: 0, sum: 0, scored: 0 });
      order.push(key);
    }
    const row = byName.get(key);
    row.students += 1;
    row.attempts += s.attempts;
    if (s.avgPercent !== null && s.avgPercent !== undefined) {
      row.sum += s.avgPercent;
      row.scored += 1;
    }
  }
  // بلا مجموعاتٍ أصلاً: لا داعي لصفٍّ واحدٍ اسمه فارغ
  if (order.length === 1 && order[0] === '') return [];
  return order
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0))
    .map((key) => {
      const row = byName.get(key);
      return {
        name: row.name,
        students: row.students,
        attempts: row.attempts,
        avgPercent: row.scored ? Math.round(row.sum / row.scored) : null,
      };
    });
}

/** أكثر ما أخطأ فيه طالبٌ عبر محاولاته: نصّ السؤال وكم مرّة */
function weakSpots(records, limit = 8) {
  const count = new Map();
  for (const r of records) {
    for (const it of r.items || []) {
      if (it.ok !== false && it.ok !== 'partial') continue;
      const key = it.text;
      const cur = count.get(key) || { text: it.text, times: 0, right: it.right };
      cur.times += 1;
      count.set(key, cur);
    }
  }
  return [...count.values()].sort((a, b) => b.times - a.times).slice(0, limit);
}

module.exports = {
  PIN_LENGTH,
  newPin,
  syncPupils,
  publicPupil,
  tokenFor,
  resolveToken,
  identify,
  entryFor,
  capture,
  summarize,
  groupStats,
  weakSpots,
  nameKey,
};
