(function () {
  'use strict';

  /**
   * Microsoft Clarity — قياسُ الاستعمال: خرائط النقر، ومواضع التعثّر، وإعادة
   * تشغيل الجلسة لنرى أين يقف المعلّم حائراً.
   *
   * ثلاثة قرارات تحكم هذا الملفّ، وكلُّها تخصّ منصّةً فيها بيانات أطفال:
   *
   *  ١) **كلُّ نصٍّ على الشاشة مُقنَّع.** الوسم `data-clarity-mask` على جذر
   *     الصفحة يسري على كل ما تحته، فلا يغادر الجهازَ اسمُ طالبٍ ولا إجابته
   *     ولا رمزه الشخصي ولا رقم المعلّم — تُرسل الأشكال والنقرات لا الكلمات.
   *     وبه نستفيد من الخرائط والتعثّر كاملةً بلا أن ندفع ثمنها من خصوصية
   *     من لا يملك أن يوافق. (ويصحّ أيضاً ضبط «Mask all text» في لوحة
   *     Clarity نفسها — والوسم هنا يكفي وحده ولا يعتمد على إعدادٍ هناك.)
   *     ومن أراد كشف منطقةٍ آمنة بعينها — صفحةَ تسويقٍ مثلاً — فليضع عليها
   *     `data-clarity-unmask="true"`.
   *
   *  ٢) **لا قياس في التطوير ولا في الاختبار.** المضيف المحلّي وملفّات
   *     `file://` تخرج من الحساب، فلا تختلط جلساتُ التجربة بجلسات المعلّمين
   *     ولا تُحمَّل الصفحةُ في الاختبارات نداءً خارجياً.
   *
   *  ٣) **لا يدخل إطار اللعبة.** الألعاب تُقدَّم من مسارها بسياسة محتوى
   *     مغلقة (`server/game-frame.js`)، ولا نحقن فيها شيئاً — فما يلعبه
   *     الطالب يبقى معزولاً كما وُعد.
   *
   * ومعرّف المشروع ليس سرّاً: هو معرّفٌ علنيّ يظهر في شيفرة كل صفحة، لا مفتاح.
   */

  var PROJECT_ID = 'ykk3ucekc5';

  var host = location.hostname || '';
  var LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
  if (location.protocol === 'file:' || LOCAL.test(host) || host.slice(-6) === '.local' || host.indexOf('.') === -1) return;

  // التقنيع قبل أن يبدأ التسجيل لا بعده
  document.documentElement.setAttribute('data-clarity-mask', 'true');
  document.addEventListener('DOMContentLoaded', function () {
    // والجسد أيضاً: صريحٌ لا متوارَث، فلا يعتمد التقنيع على ترتيب القراءة
    if (document.body) document.body.setAttribute('data-clarity-mask', 'true');
  });

  (function (c, l, a, r, i, t, y) {
    c[a] =
      c[a] ||
      function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
    t = l.createElement(r);
    t.async = 1;
    t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', PROJECT_ID);
})();
