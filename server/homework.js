'use strict';

/**
 * الواجب — نشاطٌ يُكلَّف به طلابٌ بأعيانهم، وتُتابَع نتيجته.
 *
 * والفرق بينه وبين «إطلاق جلسة» ليس في الرابط بل فيمن يُنتظر منه الحلّ:
 * الجلسة تُفتح فيدخلها من دخل، والواجب **له كشفٌ مُكلَّف** — فيصير السؤال
 * الذي يهمّ المعلّم ممكناً أصلاً: من سلّم؟ ومن لم يسلّم بعد؟ وكم أخذ من
 * سلّم؟ وهذا سؤالٌ لا تجيب عنه الجلسة الحيّة لأنها لا تعرف من كان يُنتظر.
 *
 * ولا يعيش الواجب إلا على فصلٍ شغّل معلّمه **سجلّ الطلاب**: النتيجة تُكتب في
 * ملفّ الطالب (انظر records.js)، وبلا ملفٍّ لا فرق بين «سلّم زيدٌ» و«سلّم
 * أحدهم باسم زيد». فالسجل شرطُ الواجب لا زينته.
 *
 * وما يُخزَّن هنا هو **التكليف** وحده — من، وأيّ نشاط، وإلى متى. أمّا
 * النتائج فتُقرأ من السجل عند كل عرض، فلا تُكتب مرّتين ولا تفترقان.
 */

const MAX_ASSIGNMENTS = 60;
/** حالات الطالب في واجب */
const STATUS = { DONE: 'done', STARTED: 'started', NONE: 'none' };

/** رمز جلسةٍ من ستّة أرقام، أو '' */
function cleanCode(value) {
  return /^\d{6}$/.test(String(value || '')) ? String(value) : '';
}

/**
 * كلّ رموز جلسات هذا الواجب — الحاليّ وما سبقه.
 *
 * والواجب قد يُعاد فتحه: رابطُه جلسةٌ حيّة، والجلسة تسقط بعد موعدها بمدّة أو
 * عند إعادة نشرٍ بعد طول خمول. فمن أعاد فتحه أخذ رمزاً جديداً — ولو نسينا
 * القديم لضاع من سلّم قبل الفتح الثاني وظهر أنه لم يسلّم.
 */
function codesOf(assignment) {
  const list = Array.isArray(assignment?.codes) ? assignment.codes : [];
  const all = [...list, assignment?.code].map(cleanCode).filter(Boolean);
  return [...new Set(all)];
}

/**
 * حالة كل طالبٍ مُكلَّف، والمجاميع فوقها.
 *
 * @param {object} opts
 * @param {object} opts.assignment الواجب
 * @param {Array}  opts.pupils     ملفّات الفصل (id, name, group)
 * @param {Array}  opts.records    سطور سجلّ الفصل كلّها — نصفّيها برموز الواجب
 * @param {Set|Array} [opts.started] معرّفات من فتح الواجب ولم ينهه (من الجلسة الحيّة)
 */
function progress({ assignment, pupils = [], records = [], started = [] }) {
  const codes = new Set(codesOf(assignment));
  const ids = new Set(assignment?.studentIds || []);
  const open = started instanceof Set ? started : new Set(started || []);

  // آخرُ محاولةٍ لكل طالب: الواجب قد يُعاد فتحه فتصير له محاولتان، والمعلّم
  // يسأل عن نتيجته الآن لا عن أوّل مرّة
  const best = new Map();
  for (const row of records) {
    if (!codes.has(row.code) || !ids.has(row.studentId)) continue;
    const current = best.get(row.studentId);
    if (!current || (row.at || 0) > (current.at || 0)) best.set(row.studentId, row);
  }

  const due = Number(assignment?.dueAt) || 0;
  const rows = (pupils || [])
    .filter((p) => ids.has(p.id))
    .map((p) => {
      const row = best.get(p.id);
      if (!row) {
        return {
          id: p.id,
          name: p.name,
          group: p.group || '',
          status: open.has(p.id) ? STATUS.STARTED : STATUS.NONE,
          percent: null,
          at: null,
          late: false,
          pending: 0,
          mark: null,
        };
      }
      return {
        id: p.id,
        name: p.name,
        group: p.group || '',
        status: STATUS.DONE,
        percent: row.percent ?? null,
        at: row.at || null,
        // «متأخّر» وصفٌ لا عقوبة: المعلّم يقرّر ما يفعل به، ونحن نقول متى سلّم
        late: Boolean(due && row.at && row.at > due),
        // إجاباتٌ نصّية تنتظر تصحيح المعلّم — نتيجتُه ناقصةٌ حتى يصحّحها
        pending: Number(row.pending) || 0,
        mark: row.mark || null,
      };
    });

  const done = rows.filter((r) => r.status === STATUS.DONE);
  const scored = done.filter((r) => r.percent !== null && r.percent !== undefined);
  return {
    rows,
    totals: {
      assigned: rows.length,
      done: done.length,
      started: rows.filter((r) => r.status === STATUS.STARTED).length,
      missing: rows.filter((r) => r.status === STATUS.NONE).length,
      late: done.filter((r) => r.late).length,
      pending: done.reduce((sum, r) => sum + r.pending, 0),
      avgPercent: scored.length ? Math.round(scored.reduce((sum, r) => sum + r.percent, 0) / scored.length) : null,
    },
  };
}

/**
 * من يُكلَّف؟ مجموعاتٌ مختارة، أو طلابٌ بأعيانهم، أو الفصل كلّه.
 *
 * والاختيار بالمجموعة هو الحالة الغالبة — «مجموعة الدعم» أو «الشعبة (أ)» —
 * لكنّ المخرَج طلابٌ بأعيانهم لا اسمُ مجموعة: الطالب قد ينتقل بين المجموعات
 * بعد التكليف، ولو حفظنا اسم المجموعة وحدها لتغيّر المُكلَّفون تحت الواجب.
 */
function pickStudents(pupils, { groups = [], studentIds = [] } = {}) {
  const wantIds = new Set((studentIds || []).filter(Boolean));
  const wantGroups = new Set((groups || []).map((g) => String(g || '').trim()).filter(Boolean));
  if (!wantIds.size && !wantGroups.size) return (pupils || []).map((p) => p.id);
  return (pupils || [])
    .filter((p) => wantIds.has(p.id) || wantGroups.has(String(p.group || '').trim()))
    .map((p) => p.id);
}

module.exports = { MAX_ASSIGNMENTS, STATUS, codesOf, progress, pickStudents, cleanCode };
