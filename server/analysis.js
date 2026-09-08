'use strict';

/**
 * تحليلُ الفصل — تقريرٌ يكتبه الذكاء الاصطناعي عن مجموعةٍ من الطلاب.
 *
 * المعلّم يملك عن صفّه أرقاماً كثيرة متفرّقة: متوسّطاتٌ في السجل، وواجباتٌ
 * مسلَّمة وأخرى لا، وأسئلةٌ تكرّر الخطأ فيها. وما لا يملكه هو **القراءة**:
 * ماذا يعني هذا كلّه؟ ومن يحتاج ماذا؟ وبم يبدأ الأسبوع القادم؟ هذه الوحدة
 * تجمع الأرقام في خلاصةٍ واحدة، وتسأل النموذج أن يقرأها قراءةَ مستشارٍ
 * تربويّ، ثم تُخرج ما قاله تقريراً يُطبع.
 *
 * وقاعدتان تحكمان ما هنا:
 *
 *  - **الأسماء لا تغادر الخادم.** ما يُرسل إلى النموذج خلاصةٌ بأسماءٍ
 *    مستعارة (s1, s2, …)، والأسماءُ الحقيقية تُعاد إلى التقرير هنا بعد أن
 *    يعود. الطلابُ قاصرون، وليس لأحدٍ خارج هذا الخادم حاجةٌ بأسمائهم.
 *  - **الأرقام من عندنا، والقراءة من عنده.** المتوسّطات والتوزيع والأسئلة
 *    الأكثر خطأً تُحسب هنا وتُعرض كما هي؛ النموذج يُسأل عن المعنى والخطّة،
 *    لا عن الحساب — فلا يُخترع رقمٌ في تقريرٍ يُطبع ويُسلَّم لمدير.
 */

const homework = require('./homework');
const records = require('./records');

/** حدود المستويات بالنسبة المئوية */
const STRONG = 85;
const STEADY = 60;
const LEVELS = ['strong', 'steady', 'support'];

/** أقصى ما يُرسل: خلاصةٌ لا سجلّ كامل */
const MAX_STUDENTS = 80;
const MAX_MISSED = 10;
const MAX_SKILLS = 8;
const MAX_PER_STUDENT = 3;

/** أقصى ما يُقبل من النموذج — نصٌّ أطول من هذا ليس تقريراً بل استطراد */
const CLAMP = { line: 260, para: 900, note: 320, list: 8 };

const levelOf = (avg) => (avg === null || avg === undefined ? 'support' : avg >= STRONG ? 'strong' : avg >= STEADY ? 'steady' : 'support');

/** طلاب النطاق: الفصلُ كلّه، أو مجموعةٌ باسمها */
function scopePupils(cls, group) {
  const pupils = Array.isArray(cls?.pupils) ? cls.pupils : [];
  const wanted = String(group || '').trim();
  if (!wanted) return pupils;
  return pupils.filter((p) => String(p.group || '').trim() === wanted);
}

const avgOf = (rows) => {
  const scored = rows.filter((r) => r.percent !== null && r.percent !== undefined);
  return scored.length ? Math.round(scored.reduce((s, r) => s + r.percent, 0) / scored.length) : null;
};

/**
 * الخلاصة: ما يُحسب من السجل والواجبات، مقسوماً إلى ما يُعرض (بالأسماء) وما
 * يُرسل (بالمستعار). والاثنان يُبنيان معاً من المصدر نفسه فلا يفترقان.
 */
function digest({ cls, records: rows, assignments = [], group = '' }) {
  const pupils = scopePupils(cls, group).slice(0, MAX_STUDENTS);
  const ids = new Set(pupils.map((p) => p.id));
  const scoped = (rows || []).filter((r) => ids.has(r.studentId));

  // اسمٌ مستعارٌ لكل طالب — بترتيب الكشف، فالمعلّم يستطيع مطابقته بعينه لو أراد
  const labels = new Map(pupils.map((p, i) => [p.id, `s${i + 1}`]));

  // كم شارك في كل جلسة: به تُقاس نسبةُ الخطأ في سؤالٍ لا عددُ مرّاته وحده
  const perSession = new Map();
  for (const r of scoped) perSession.set(r.code, (perSession.get(r.code) || 0) + 1);

  // الواجبات التي تمسّ هذا النطاق، مع الحالة لكل طالب
  const hwByStudent = new Map(pupils.map((p) => [p.id, { assigned: 0, done: 0, late: 0, missing: 0 }]));
  const hwTotals = { count: 0, assigned: 0, done: 0, late: 0, missing: 0, percents: [] };
  for (const item of assignments) {
    const wanted = (item.studentIds || []).filter((id) => ids.has(id));
    if (!wanted.length) continue;
    const { rows: progress, totals } = homework.progress({
      assignment: item,
      pupils: pupils.filter((p) => wanted.includes(p.id)),
      records: scoped,
    });
    hwTotals.count += 1;
    hwTotals.assigned += totals.assigned;
    hwTotals.done += totals.done;
    hwTotals.late += totals.late;
    hwTotals.missing += totals.missing;
    if (totals.avgPercent !== null) hwTotals.percents.push(totals.avgPercent);
    for (const row of progress) {
      const h = hwByStudent.get(row.id);
      if (!h) continue;
      h.assigned += 1;
      if (row.status === homework.STATUS.DONE) h.done += 1;
      else if (row.status === homework.STATUS.NONE) h.missing += 1;
      if (row.late) h.late += 1;
    }
  }

  const students = pupils.map((p) => {
    const mine = scoped.filter((r) => r.studentId === p.id).sort((a, b) => b.at - a.at);
    const avg = avgOf(mine);
    const scored = mine.filter((r) => r.percent !== null && r.percent !== undefined);
    return {
      id: p.id,
      label: labels.get(p.id),
      name: p.name,
      group: p.group || '',
      attempts: mine.length,
      avg,
      level: levelOf(avg),
      last: scored[0]?.percent ?? null,
      trend: scored.slice(0, 5).reverse().map((r) => r.percent),
      weakSkills: records.weakSkills(mine, MAX_PER_STUDENT).map((w) => w.skill),
      repeated: records.weakSpots(mine, MAX_PER_STUDENT).map((w) => w.text),
      homework: hwByStudent.get(p.id),
    };
  });

  // الأسئلة الأكثر خطأً في النطاق كلّه، بنسبةٍ من عدد من شارك في جلستها
  const missed = new Map();
  const skills = new Map();
  for (const r of scoped) {
    for (const it of r.items || []) {
      if (it.ok !== false && it.ok !== 'partial') continue;
      const m = missed.get(it.text) || { text: it.text, skill: it.skill || '', misses: 0, of: 0, codes: new Set() };
      m.misses += 1;
      if (!m.codes.has(r.code)) {
        m.codes.add(r.code);
        m.of += perSession.get(r.code) || 0;
      }
      missed.set(it.text, m);
      const skill = String(it.skill || '').trim();
      if (skill) skills.set(skill, (skills.get(skill) || 0) + 1);
    }
  }
  const topMissed = [...missed.values()]
    .map(({ codes, ...m }) => ({ ...m, rate: m.of ? Math.round((m.misses / m.of) * 100) : null }))
    .sort((a, b) => b.misses - a.misses)
    .slice(0, MAX_MISSED);
  const topSkills = [...skills.entries()]
    .map(([skill, misses]) => ({ skill, misses }))
    .sort((a, b) => b.misses - a.misses)
    .slice(0, MAX_SKILLS);

  const sessions = [...new Map(scoped.map((r) => [r.code, { code: r.code, title: r.title, at: r.at }])).values()]
    .map((s) => ({ ...s, avg: avgOf(scoped.filter((r) => r.code === s.code)), participants: perSession.get(s.code) || 0 }))
    .sort((a, b) => a.at - b.at);

  const distribution = {
    strong: students.filter((s) => s.attempts && s.level === 'strong').length,
    steady: students.filter((s) => s.attempts && s.level === 'steady').length,
    support: students.filter((s) => s.attempts && s.level === 'support').length,
    silent: students.filter((s) => !s.attempts).length,
  };

  const stats = {
    className: cls.name,
    group: String(group || '').trim(),
    students: students.length,
    sessions: sessions.length,
    results: scoped.length,
    from: sessions[0]?.at || null,
    to: sessions[sessions.length - 1]?.at || null,
    avg: avgOf(scoped),
    distribution,
    sessionsList: sessions,
    missed: topMissed,
    skills: topSkills,
    homework: {
      count: hwTotals.count,
      assigned: hwTotals.assigned,
      done: hwTotals.done,
      late: hwTotals.late,
      missing: hwTotals.missing,
      completion: hwTotals.assigned ? Math.round((hwTotals.done / hwTotals.assigned) * 100) : null,
      avg: hwTotals.percents.length ? Math.round(hwTotals.percents.reduce((a, b) => a + b, 0) / hwTotals.percents.length) : null,
    },
  };

  return { pupils, labels, students, stats };
}

/**
 * ما يُرسل إلى النموذج: الخلاصة نفسها بلا اسمٍ ولا معرّف — المستعار وحده.
 * وتُبنى نصّاً مرتّباً لا JSON خاماً: النموذج يقرأ الجداول القصيرة أفضل.
 */
function promptFor(d) {
  const s = d.stats;
  const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
  const lines = [];
  lines.push(`النطاق: ${s.group ? `مجموعة «${s.group}» من فصل «${s.className}»` : `فصل «${s.className}»`}`);
  lines.push(`الطلاب: ${s.students} · الجلسات المسجّلة: ${s.sessions} · النتائج: ${s.results} · متوسّط النطاق: ${pct(s.avg)}`);
  lines.push(
    `التوزيع: قويّ (≥${STRONG}%) ${s.distribution.strong} · مستقرّ (${STEADY}–${STRONG - 1}%) ${s.distribution.steady} · يحتاج دعماً (<${STEADY}%) ${s.distribution.support} · بلا نتائج ${s.distribution.silent}`
  );
  if (s.homework.count) {
    lines.push(
      `الواجبات: ${s.homework.count} واجباً · كُلِّف ${s.homework.assigned} · سلّم ${s.homework.done} · متأخّر ${s.homework.late} · لم يسلّم ${s.homework.missing} · نسبة التسليم ${pct(s.homework.completion)} · متوسّط الواجبات ${pct(s.homework.avg)}`
    );
  } else lines.push('الواجبات: لم يُكلَّف هذا النطاق بواجبٍ بعد');

  if (s.sessionsList.length) {
    lines.push('', 'الجلسات (من الأقدم):');
    for (const x of s.sessionsList) lines.push(`- «${x.title}»: متوسّط ${pct(x.avg)} من ${x.participants} مشاركاً`);
  }
  if (s.skills.length) {
    lines.push('', 'المهارات الأكثر تعثّراً (عدد الأخطاء):');
    for (const k of s.skills) lines.push(`- ${k.skill}: ${k.misses}`);
  }
  if (s.missed.length) {
    lines.push('', 'الأسئلة الأكثر خطأً (نسبة من أخطأ ممّن شارك):');
    for (const m of s.missed) lines.push(`- «${m.text}»${m.skill ? ` [${m.skill}]` : ''}: ${pct(m.rate)} (${m.misses} خطأ)`);
  }

  lines.push('', 'الطلاب (بأسماءٍ مستعارة — لا تذكرهم في النصّ الحرّ، بل في قائمة students فقط):');
  for (const st of d.students) {
    const hw = st.homework;
    const parts = [
      `${st.label}: محاولات ${st.attempts}`,
      `متوسّط ${pct(st.avg)}`,
      st.trend.length > 1 ? `الاتجاه ${st.trend.join('→')}` : '',
      hw && hw.assigned ? `واجبات ${hw.done}/${hw.assigned}${hw.late ? ` (متأخّر ${hw.late})` : ''}` : '',
      st.weakSkills.length ? `يتعثّر في: ${st.weakSkills.join('، ')}` : '',
      st.repeated.length ? `يكرّر الخطأ في: ${st.repeated.map((x) => `«${x}»`).join('، ')}` : '',
    ].filter(Boolean);
    lines.push(`- ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `أنت مستشارٌ تربويّ خبير يقرأ نتائج صفٍّ ويكتب للمعلّم تقريراً عمليّاً موجزاً بالعربية الفصحى.

تُعطى خلاصةً رقميّة عن مجموعةٍ من الطلاب: متوسّطاتهم، وتوزيعهم، وواجباتهم، والمهارات والأسئلة التي تكرّر الخطأ فيها. مهمّتك القراءة والتفسير والتوصية — لا إعادة سرد الأرقام.

قواعد صارمة:
1. أجب بكائن JSON واحد فقط، بلا أيّ نصٍّ قبله أو بعده، وبلا علامات markdown.
2. لا تخترع رقماً أو اسماً أو سبباً غير موجود في الخلاصة. إن كانت البيانات قليلة فقل ذلك صراحةً في summary.
3. الطلاب في الخلاصة بأسماءٍ مستعارة (s1, s2, …). لا تذكر أيّ طالبٍ في النصوص الحرّة؛ اذكرهم فقط داخل قائمة students وبمعرّفهم المستعار حرفياً.
4. اكتب للمعلّم بصيغة المخاطَب، بجملٍ قصيرة عمليّة، وتجنّب العموميّات مثل «يُنصح بالمتابعة».
5. level لكل طالب واحدٌ من: strong (أداء قويّ)، steady (مستقرّ يحتاج تثبيتاً)، support (يحتاج دعماً عاجلاً). ومن بلا محاولات فهو support مع ملاحظةٍ تقول إنه لم يشارك.

الشكل المطلوب بالضبط:
{
  "headline": "جملة واحدة تلخّص حال المجموعة",
  "summary": "فقرة من ٣ إلى ٥ جمل: أين تقف المجموعة، وما أبرز ما يلفت في الأرقام",
  "strengths": ["نقطة قوّة ملموسة", "..."],
  "gaps": ["فجوة أو مهارة متعثّرة مع ما يدلّ عليها", "..."],
  "patterns": ["نمط ملاحَظ في الأخطاء أو في الالتزام", "..."],
  "students": [{ "id": "s1", "level": "strong|steady|support", "note": "جملة أو جملتان عن حاله", "next": "خطوة واحدة محدّدة معه" }],
  "plan": ["خطوة عمليّة للأسبوعين القادمين", "..."],
  "homework": "فقرة قصيرة عن الالتزام بالواجبات وما يُستنتج منه — أو نصّ فارغ إن لم تكن هناك واجبات"
}

اذكر كل طالبٍ في الخلاصة مرّةً واحدة في students. وليكن في plan من ٤ إلى ٦ خطوات مرتّبة بالأولوية.`;

const clampText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampList = (v, max, size) =>
  (Array.isArray(v) ? v : [])
    .map((x) => clampText(x, max))
    .filter(Boolean)
    .slice(0, size);

/**
 * ما ردّ به النموذج → تقريرٌ بأسماءٍ حقيقيّة.
 *
 * ويُقرأ بتسامح: بعض النماذج تلفّ JSON بسياج markdown أو تسبقه بجملة رغم
 * النهي — فنقتطع من أوّل قوسٍ إلى آخره. وما بعد ذلك يُقصّ ويُصفّى: لا مستوى
 * خارج القائمة، ولا طالبٍ ليس في النطاق، ولا نصٍّ بلا حدّ.
 */
function parseReport(text, d) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(new Error('ردّ النموذج ليس تقريراً مقروءاً — أعد المحاولة'), { status: 502 });
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error('ردّ النموذج ليس تقريراً مقروءاً — أعد المحاولة'), { status: 502 });
  }

  // من المستعار إلى الحقيقيّ — وفي النصّ الحرّ أيضاً لو زلّ النموذج وذكر أحداً
  const byLabel = new Map(d.students.map((s) => [s.label, s]));
  const deLabel = (s) => s.replace(/\b[sS](\d{1,3})\b/g, (m, n) => byLabel.get('s' + n)?.name || m);

  const seen = new Set();
  const students = (Array.isArray(parsed.students) ? parsed.students : [])
    .map((row) => {
      const st = byLabel.get(String(row?.id || '').trim().toLowerCase());
      if (!st || seen.has(st.id)) return null;
      seen.add(st.id);
      return {
        id: st.id,
        name: st.name,
        group: st.group,
        level: LEVELS.includes(row.level) ? row.level : st.level,
        note: deLabel(clampText(row.note, CLAMP.note)),
        next: deLabel(clampText(row.next, CLAMP.note)),
        avg: st.avg,
        attempts: st.attempts,
        trend: st.trend,
        homework: st.homework,
      };
    })
    .filter(Boolean);
  // ومن لم يذكره النموذج يُدرج بأرقامه بلا ملاحظة — التقرير لا يُسقط طالباً
  for (const st of d.students) {
    if (seen.has(st.id)) continue;
    students.push({ id: st.id, name: st.name, group: st.group, level: st.level, note: '', next: '', avg: st.avg, attempts: st.attempts, trend: st.trend, homework: st.homework });
  }
  // من يحتاج دعماً أوّلاً، والأدنى متوسّطاً قبل غيره — ومن لم يشارك آخرَ فئته
  const order = { support: 0, steady: 1, strong: 2 };
  students.sort(
    (a, b) => order[a.level] - order[b.level] || (a.attempts ? 0 : 1) - (b.attempts ? 0 : 1) || (a.avg ?? 0) - (b.avg ?? 0)
  );

  return {
    headline: deLabel(clampText(parsed.headline, CLAMP.line)),
    summary: deLabel(clampText(parsed.summary, CLAMP.para)),
    strengths: clampList(parsed.strengths, CLAMP.line, CLAMP.list).map(deLabel),
    gaps: clampList(parsed.gaps, CLAMP.line, CLAMP.list).map(deLabel),
    patterns: clampList(parsed.patterns, CLAMP.line, CLAMP.list).map(deLabel),
    plan: clampList(parsed.plan, CLAMP.line, CLAMP.list).map(deLabel),
    homework: deLabel(clampText(parsed.homework, CLAMP.para)),
    students,
  };
}

module.exports = { digest, promptFor, parseReport, scopePupils, SYSTEM_PROMPT, STRONG, STEADY, LEVELS };
