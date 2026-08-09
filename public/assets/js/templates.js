/* قوالب جاهزة — مصدر واحد يستخدمه المتصفح والخادم معاً (بلا طلب شبكة) */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.TEMPLATES = data;
})(typeof self !== 'undefined' ? self : this, function () {
  return [
    {
      key: 'quiz',
      name: '🎯 اختبار سريع',
      description: 'أسئلة اختيار من متعدد مع إجابات صحيحة ونقاط وترتيب',
      title: 'اختبار سريع',
      settings: { requireName: true, allowLateJoin: true, showLeaderboard: true, countdown: true },
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
        {
          type: 'mc',
          text: 'أيٌّ من هذه كواكب في المجموعة الشمسية؟ (اختر كل الإجابات الصحيحة)',
          timeLimit: 30,
          points: 2000,
          options: [
            { id: 'o0', text: 'المريخ' },
            { id: 'o1', text: 'الزهرة' },
            { id: 'o2', text: 'الشمس' },
            { id: 'o3', text: 'القمر' },
          ],
          correct: ['o0', 'o1'],
        },
      ],
    },
    {
      key: 'poll',
      name: '📊 استطلاع مجهول',
      description: 'بلا أسماء وبلا نقاط — مناسب للآراء والتغذية الراجعة',
      title: 'استطلاع رأي',
      settings: { requireName: false, allowLateJoin: true, showLeaderboard: false, countdown: false },
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
        { type: 'word', text: 'صف الحصة بكلمة واحدة', timeLimit: 0 },
      ],
    },
    {
      key: 'icebreaker',
      name: '🧊 كسر الجليد',
      description: 'نشاط تحمية سريع وممتع في بداية الحصة',
      title: 'نبدأ بالتحمية!',
      settings: { requireName: true, allowLateJoin: true, showLeaderboard: true, countdown: true },
      questions: [
        {
          type: 'poll',
          text: 'كيف حالك اليوم؟',
          timeLimit: 0,
          options: [
            { id: 'o0', text: '🔋 مشحون بالكامل' },
            { id: 'o1', text: '🙂 تمام' },
            { id: 'o2', text: '😴 أحتاج قهوة' },
            { id: 'o3', text: '🤯 مشغول جداً' },
          ],
        },
        { type: 'word', text: 'اكتب كلمة واحدة تصف توقعك من هذه الحصة', timeLimit: 0 },
        {
          type: 'truefalse',
          text: 'أعرف موضوع الحصة مسبقاً.',
          timeLimit: 15,
          points: 0,
          correct: [],
        },
      ],
    },
    {
      key: 'feedback',
      name: '💬 تغذية راجعة',
      description: 'سحابة كلمات + مقياس + سؤال مفتوح لختام الحصة',
      title: 'ختام الحصة',
      settings: { requireName: false, allowLateJoin: true, showLeaderboard: false, countdown: false },
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
});
