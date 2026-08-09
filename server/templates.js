'use strict';

/** قوالب جاهزة يبدأ منها المدرب بسرعة (تُنسخ في المتصفح ثم تُرسل عند الإنشاء). */
module.exports = [
  {
    key: 'quiz',
    name: 'اختبار سريع',
    description: 'أسئلة اختيار من متعدد مع إجابات صحيحة ونقاط وترتيب',
    title: 'اختبار سريع',
    settings: { requireName: true, allowLateJoin: true, showLeaderboard: true },
    questions: [
      {
        type: 'mc',
        text: 'ما هي عاصمة الأردن؟',
        timeLimit: 20,
        points: 1000,
        options: [
          { id: 'o0', text: 'عمّان' },
          { id: 'o1', text: 'دمشق' },
          { id: 'o2', text: 'بيروت' },
          { id: 'o3', text: 'القاهرة' },
        ],
        correct: ['o0'],
      },
      {
        type: 'truefalse',
        text: 'الماء يغلي عند ١٠٠ درجة مئوية عند مستوى سطح البحر.',
        timeLimit: 15,
        points: 1000,
        correct: ['true'],
      },
    ],
  },
  {
    key: 'poll',
    name: 'استطلاع مجهول',
    description: 'بلا أسماء وبلا نقاط — مناسب للآراء والتغذية الراجعة',
    title: 'استطلاع رأي',
    settings: { requireName: false, allowLateJoin: true, showLeaderboard: false },
    questions: [
      {
        type: 'poll',
        text: 'ما الوقت الأنسب للحصة القادمة؟',
        timeLimit: 0,
        options: [
          { id: 'o0', text: 'صباحاً' },
          { id: 'o1', text: 'بعد الظهر' },
          { id: 'o2', text: 'مساءً' },
        ],
      },
      {
        type: 'scale',
        text: 'كم كانت الحصة مفيدة بالنسبة لك؟',
        timeLimit: 0,
        scale: { min: 1, max: 5, minLabel: 'غير مفيدة', maxLabel: 'مفيدة جداً' },
      },
      {
        type: 'word',
        text: 'صف الحصة بكلمة واحدة',
        timeLimit: 0,
      },
    ],
  },
  {
    key: 'feedback',
    name: 'تغذية راجعة',
    description: 'سحابة كلمات + مقياس + سؤال مفتوح لختام الحصة',
    title: 'ختام الحصة',
    settings: { requireName: false, allowLateJoin: true, showLeaderboard: false },
    questions: [
      { type: 'word', text: 'أهم فكرة خرجت بها اليوم؟', timeLimit: 0 },
      {
        type: 'scale',
        text: 'ما مدى وضوح الشرح؟',
        timeLimit: 0,
        scale: { min: 1, max: 5, minLabel: 'غير واضح', maxLabel: 'واضح جداً' },
      },
      { type: 'open', text: 'ما الذي تقترح تحسينه؟', timeLimit: 0 },
    ],
  },
];
