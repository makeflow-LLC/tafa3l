'use strict';

/**
 * سجلٌّ تجريبيّ جاهز — فصلٌ نموذجيّ بطلابٍ وهميين ونتائجَ عبر خمسة أنشطة.
 *
 * غرضه واحد: أن يرى المعلّم (أو المدرّب في ورشة) ما تصير إليه الشاشة بعد
 * شهرٍ من الاستعمال، بدل أن يقف أمام جدولٍ فارغ يقول «لا نتائج بعد». ولذلك
 * البيانات هنا **مصنوعة لتُقرأ**: طالبةٌ تتحسّن، وطالبٌ يتراجع، وواحدٌ غاب
 * عن نشاطين، وأخطاءٌ تتكرّر في المهارة نفسها بين نشاطٍ ومراجعته، وثلاث
 * مجموعاتٍ متفاوتة المستوى ليظهر أثر التقسيم.
 *
 * وهو فصلٌ عاديّ في كل شيء عدا رايته: يُحذف كأيّ فصل، ويظهر في القائمة،
 * ويُرفق بنشاطٍ حقيقيّ لو أراد. والراية `demo` تخدم ثلاثة أشياء فقط: شارةٌ
 * في الواجهة تقول إن هذه أرقامٌ وهمية، وإعادةُ بنائه بدل تكديس نسخٍ منه،
 * ومعاينةُ صفحة الطالب (وهي لا تجوز على فصلٍ فيه طلابٌ حقيقيون).
 */

const CLASS_NAME = 'فصل تجريبي — نموذج للعرض';

const GROUPS = ['المجموعة أ', 'المجموعة ب', 'المجموعة ج'];

/**
 * الطلاب الوهميون وسِيَرهم. `base` نسبته المعتادة، و`slope` ميلُه بين نشاطٍ
 * وآخر (موجبٌ يتحسّن وسالبٌ يتراجع)، و`skip` أنشطةٌ غاب عنها.
 */
const STUDENTS = [
  { name: 'سارة أحمد', group: GROUPS[0], base: 90, slope: 1, skip: [] },
  { name: 'ليان محمود', group: GROUPS[0], base: 48, slope: 10, skip: [] },
  { name: 'كريم خالد', group: GROUPS[0], base: 71, slope: 0, skip: [] },
  { name: 'يوسف نبيل', group: GROUPS[0], base: 92, slope: -9, skip: [] },
  { name: 'رهف سامي', group: GROUPS[1], base: 36, slope: 4, skip: [] },
  { name: 'عمر زياد', group: GROUPS[1], base: 78, slope: 1, skip: [1, 3] },
  { name: 'جنى فادي', group: GROUPS[1], base: 96, slope: 0, skip: [0] },
  { name: 'محمود إياد', group: GROUPS[1], base: 63, slope: 3, skip: [] },
  { name: 'تالا وسيم', group: GROUPS[2], base: 58, slope: 5, skip: [] },
  { name: 'أنس مراد', group: GROUPS[2], base: 44, slope: 2, skip: [2] },
  { name: 'ملك عدنان', group: GROUPS[2], base: 82, slope: 2, skip: [] },
  { name: 'زيد حاتم', group: GROUPS[2], base: 55, slope: -3, skip: [] },
];

/** سؤالٌ في نشاطٍ تجريبي: نصّه، وصوابه، والخطأ الشائع فيه، والمهارة التي يقيسها */
const q = (text, right, mine, skill) => ({ text, right, mine, skill: skill || '' });

/**
 * الأنشطة من الأقدم إلى الأحدث. أسئلة كل نشاط مرتّبة **من الأسهل إلى
 * الأصعب**، لأن من أخطأ في سؤالين أخطأ في أصعبهما — وهذا وحده يجعل
 * «ما يتكرّر خطؤه» ذا معنى: سؤالُ المراجعة المكرّر يقع في ذيل القائمتين.
 */
const HARD_FRACTION = q('١/٣ + ١/٦ = ؟', '١/٢', '٢/٩', 'جمع الكسور المختلفة المقامات');
const HARD_GCD = q('أكبر قاسم مشترك للعددين ١٨ و٢٤؟', '٦', '٣', 'القاسم المشترك الأكبر');

const ACTIVITIES = [
  {
    title: 'الكسور: الجمع والطرح',
    code: '904113',
    days: 34,
    totalMark: 10,
    questions: [
      q('الكسر ٥/٥ يساوي؟', 'واحد صحيح', 'خمسة', 'مفهوم الكسر'),
      q('٣/٥ − ١/٥ = ؟', '٢/٥', '٢/٠', 'طرح الكسور المتشابهة المقامات'),
      q('الكسر المكافئ للكسر ٢/٤ هو؟', '١/٢', '٤/٢', 'الكسور المتكافئة'),
      q('١/٢ + ١/٤ = ؟', '٣/٤', '٢/٦', 'جمع الكسور المختلفة المقامات'),
      q('أيّهما أكبر: ٢/٣ أم ٣/٤؟', '٣/٤', '٢/٣', 'مقارنة الكسور'),
      HARD_FRACTION,
    ],
  },
  {
    title: 'الجملة الاسمية والفعلية',
    code: '904207',
    days: 27,
    totalMark: 0,
    questions: [
      q('«كتبَ الطالبُ الدرسَ» — نوع الجملة؟', 'فعلية', 'اسمية', 'تمييز نوع الجملة'),
      q('الفاعل في «قرأ محمدٌ القصةَ»؟', 'محمد', 'القصة', 'تحديد الفاعل'),
      q('المبتدأ في «العلمُ نورٌ»؟', 'العلم', 'نور', 'المبتدأ والخبر'),
      q('الخبر في «الجوُّ جميلٌ»؟', 'جميل', 'الجو', 'المبتدأ والخبر'),
      q('«الطالبان مجتهدان» — نوع الجملة؟', 'اسمية', 'فعلية', 'تمييز نوع الجملة'),
      q('علامة رفع المثنى؟', 'الألف', 'الواو', 'علامات الإعراب الفرعية'),
    ],
  },
  {
    title: 'دورة الماء في الطبيعة',
    code: '904318',
    days: 19,
    totalMark: 20,
    questions: [
      q('مصدر الطاقة الذي يحرّك دورة الماء؟', 'الشمس', 'الرياح', 'مصادر الطاقة في الطبيعة'),
      q('تحوّل الماء من سائل إلى بخار يسمّى؟', 'التبخّر', 'التكاثف', 'مراحل دورة الماء'),
      q('تكوّن الغيوم ينتج عن عملية؟', 'التكاثف', 'التبخّر', 'مراحل دورة الماء'),
      q('الماء الذي يتسرّب إلى باطن الأرض يسمّى؟', 'الماء الجوفي', 'الماء العذب', 'مصادر المياه'),
      q('أيٌّ ممّا يلي ليس من صور الهطول؟', 'الضباب', 'الثلج', 'صور الهطول'),
      q('نسبة الماء العذب من ماء الأرض تقارب؟', '٣٪', '٣٠٪', 'مصادر المياه'),
    ],
  },
  {
    title: 'المضاعفات والقواسم',
    code: '904425',
    days: 11,
    totalMark: 10,
    questions: [
      q('هل العدد ٣٤٥ يقبل القسمة على ٥؟', 'نعم', 'لا', 'قواعد القسمة'),
      q('العدد الأولي من بين: ٩، ١٥، ١٧، ٢١؟', '١٧', '٩', 'الأعداد الأولية'),
      q('أصغر مضاعف مشترك للعددين ٤ و٦؟', '١٢', '٢٤', 'المضاعف المشترك الأصغر'),
      q('كم مضاعفاً للعدد ٧ أقلّ من ٣٠؟', '٤', '٥', 'المضاعفات'),
      q('كم قاسماً للعدد ١٢؟', '٦', '٤', 'القواسم'),
      HARD_GCD,
    ],
  },
  {
    title: 'مراجعة الوحدة الأولى',
    code: '904536',
    days: 4,
    totalMark: 20,
    questions: [
      q('مجموع زوايا المثلث = ؟', '١٨٠°', '٣٦٠°', 'خصائص المثلث'),
      q('محيط مربّع طول ضلعه ٥ سم؟', '٢٠ سم', '٢٥ سم', 'المحيط والمساحة'),
      q('٢٥٪ من ٨٠ = ؟', '٢٠', '٢٥', 'النسبة المئوية'),
      q('الوسط الحسابي للأعداد ٤ و٦ و٨؟', '٦', '٩', 'الوسط الحسابي'),
      q('مساحة مستطيل بُعداه ٧ و٣ سم؟', '٢١ سم²', '٢٠ سم²', 'المحيط والمساحة'),
      q('أيّ الكسور أقرب إلى الواحد الصحيح؟', '٩/١٠', '١/٩', 'مقارنة الكسور'),
      // مكرّران عمداً من نشاطين سابقين: بهما تظهر «ما يتكرّر خطؤه» لمن لم يتقنهما
      HARD_GCD,
      HARD_FRACTION,
    ],
  },
];

/** ضوضاء صغيرة ثابتة لكل (طالب، نشاط) — تكسر انتظام الأرقام بلا عشوائيةٍ متقلّبة */
function jitter(name, index) {
  let h = 2166136261;
  const key = name + '|' + index;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h ^ (h >>> 15)) >>> 0) % 13) - 6;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * يبني سطور السجل. تُمرَّر إليه ملفّات الطلاب بعد مواءمتها (فيها المعرّفات)
 * كي تكون السطور منسوبةً إلى ملفّاتٍ حقيقية يفتحها الرمز الشخصي.
 */
function buildRows({ classId, ownerId, pupils }) {
  const rows = [];
  const now = Date.now();
  const byName = new Map(STUDENTS.map((s, i) => [s.name, { ...s, index: i }]));
  pupils.forEach((pupil) => {
    const profile = byName.get(pupil.name);
    if (!profile) return;
    ACTIVITIES.forEach((activity, ai) => {
      if (profile.skip.includes(ai)) return;
      const total = activity.questions.length;
      const wanted = clamp(profile.base + profile.slope * ai + jitter(profile.name, ai), 15, 100);
      let correct = clamp(Math.round((total * wanted) / 100), 0, total);
      /*
       * إجابةٌ نصّية تنتظر تصحيح المعلّم في آخر نشاط لطالبٍ واحد: حالةٌ
       * حقيقية في المنصة («بانتظار التصحيح»)، ولا تُرى إن لم يصنعها أحد.
       */
      const pending = profile.index === 7 && ai === ACTIVITIES.length - 1 ? 1 : 0;
      if (pending && correct === total) correct -= 1;
      const graded = total - pending;
      const wrong = Math.max(0, graded - correct);
      const percent = graded ? Math.round((correct / graded) * 1000) / 10 : 0;
      // الخطأ يقع في الأصعب: أسئلة النشاط مرتّبة من الأسهل إلى الأصعب
      const missed = activity.questions.slice(graded - wrong, graded);
      const items = missed.map((item, k) => {
        // آخر سؤالٍ عند الطالب الأضعف يُترك بلا إجابة — «لم يُجب» حالةٌ أخرى تستحقّ الظهور
        const blank = profile.index === 4 && k === missed.length - 1;
        return { text: item.text, type: 'mc', skill: item.skill || '', ok: blank ? null : false, mine: blank ? '' : item.mine, right: item.right };
      });
      const mark = activity.totalMark
        ? {
            mark: Math.round((correct / (graded || 1)) * activity.totalMark * 10) / 10,
            of: activity.totalMark,
            percent,
            passed: percent >= 50,
          }
        : null;
      // ساعةُ الحصّة لا لحظةُ الإنشاء: نتائج تحمل توقيت منتصف الليل تبدو مصطنعة
      const at = now - activity.days * 86400000 - ((now % 86400000) - (9 + (ai % 3)) * 3600000);
      rows.push({
        id: `${classId}:${pupil.id}:${activity.code}`,
        classId,
        studentId: pupil.id,
        ownerId,
        code: activity.code,
        title: activity.title,
        at,
        total: graded,
        answered: graded - items.filter((it) => it.ok === null).length,
        correct,
        partial: 0,
        wrong: items.filter((it) => it.ok === false).length,
        pending,
        percent,
        points: correct * 100,
        maxScore: total * 100,
        mark,
        reveal: true,
        showScore: true,
        items,
      });
    });
  });
  return rows;
}

module.exports = { CLASS_NAME, GROUPS, STUDENTS, ACTIVITIES, buildRows };
