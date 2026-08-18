(function (global) {
  'use strict';

  /**
   * دليل المعلّم بلغتيه. المحتوى هنا بيانات لا HTML مبعثر في الصفحة، فتُرسم
   * الصفحة كلها من اللغة الحالية وتُعاد رسمها عند التبديل.
   *
   * أنواع الكتل: p | muted | note | h3 | ul | ol | table | actions
   * يسمح النص بوسوم بسيطة (strong/em/code) لأنه محتوى مؤلَّف عندنا لا مُدخَل مستخدم.
   */

  const GUIDE = {
    ar: {
      docTitle: 'دليل المعلّم — Tapio',
      metaDescription: 'دليل عملي: كيف تصمّم اختباراً أو استطلاعاً في Tapio، كيف تُحتسب النقاط، وأفضل الممارسات الصفّية.',
      pageTitle: '📖 دليل المعلّم',
      intro: 'كل ما تحتاجه لتصميم نشاط ناجح: الخطوات، أنواع الأسئلة، طريقة احتساب النقاط، وأفضل الممارسات.',
      tocTitle: 'اختصارات',
      navNew: '➕ نشاط جديد',
      navHome: '🏠 الرئيسية',
      footer: 'Tapio — منصة أسئلة واستطلاعات تفاعلية للمعلّمين والمدرّبين.',
      waButton: '💬 اشترك في بريميوم عبر واتساب',
      waButtonPriced: '💬 اشترك في بريميوم — {price}$ شهرياً عبر واتساب',
      waMessage: 'مرحباً، أريد الاشتراك في بريميوم Tapio ({price}$ شهرياً).',
      startNow: 'ابدأ نشاطاً الآن',
      sections: [
        {
          id: 'start',
          toc: '١. البداية في ٣ دقائق',
          title: '١. أول نشاط في ٣ دقائق',
          blocks: [
            {
              ol: [
                '<strong>افتح «نشاط جديد»</strong> من الصفحة الرئيسية (لا حاجة لحساب للتجربة، لكن الحساب يحفظ أنشطتك).',
                '<strong>اكتب عنواناً واضحاً</strong> — يراه الطلاب على شاشاتهم، مثل «مراجعة الوحدة الثالثة».',
                '<strong>أضف أسئلتك</strong>: اختر النوع، اكتب النص، حدّد الإجابة الصحيحة والعلامة والوقت. أو ابدأ من <em>قالب جاهز</em>، أو دع <em>المساعد الذكي</em> يصوغها لك — وهو يصوغ افتراضياً أسئلةً <strong>تُصحَّح آلياً</strong> (اختيار من متعدد، صح/خطأ، ترتيب، مطابقة) فلا يتركك أمام كومة إجاباتٍ تصحّحها بيدك؛ وإن أردت أسئلة الجواب الحرّ أو أكمل الفراغ فعّل خيارها تحت المحادثة. وكلُّ دخولٍ إلى المساعد يبدأ حواراً جديداً، فلا يبني على كلامٍ قديم انتهى.',
                '<strong>اضبط الإعدادات</strong>: نمط العرض، احتساب النقاط، لوحة الترتيب، الفرق.',
                '<strong>اضغط «ابدأ الجلسة»</strong> فيظهر رمز من ٦ أرقام و QR.',
                '<strong>اعرض الرمز على البروجكتر</strong> من زر «افتح شاشة العرض»، والطلاب يدخلون من <code>tapio.fun</code> بالرمز أو بمسح الـ QR.',
                '<strong>أدر الجلسة</strong> من تبويب «العرض»: ابدأ، اعرض النتائج، انتقل للسؤال التالي، ثم أنهِ النشاط.',
                '<strong>حمّل النتائج</strong> (Excel أو تقرير PDF) قبل إغلاق الجلسة.',
              ],
            },
            {
              note: 'بيانات الطلاب مؤقتة في ذاكرة الخادم وتُمحى بعد انتهاء الجلسة — الأسئلة وحدها تُحفظ في حسابك. لذا نزّل النتائج قبل الإغلاق.',
              tone: 'warn',
            },
          ],
        },
        {
          id: 'types',
          toc: '٢. أنواع الأسئلة',
          title: '٢. أنواع الأسئلة ومتى تستخدم كلاً منها',
          blocks: [
            {
              table: {
                head: ['النوع', 'يصلح لـ', 'مصحَّح؟', 'ملاحظة عملية'],
                rows: [
                  ['🎯 اختيار من متعدد', 'التقييم السريع والمراجعة', 'آلياً', '٤ خيارات كافية؛ اجعل المشتّتات منطقية لا سخيفة.'],
                  ['✅ صح / خطأ', 'المفاهيم القاطعة', 'آلياً', 'احتمال التخمين ٥٠٪ — استخدمه للتهيئة لا للتقييم النهائي.'],
                  ['📊 استطلاع رأي', 'قياس الاتجاه وكسر الجليد', 'لا', 'بلا إجابة صحيحة، والنتائج تظهر حيّة على الشاشة.'],
                  ['☁️ سحابة كلمات', 'العصف الذهني', 'لا', 'اطلب <em>كلمة واحدة</em> صراحةً كي تتجمّع الكلمات المتكررة.'],
                  ['📈 مقياس', 'التغذية الراجعة (١–٥)', 'لا', 'سمِّ الطرفين بوضوح: «غير واضح ← واضح جداً».'],
                  ['💬 إجابة مفتوحة', 'التفسير والتحليل', 'يدوياً (اختياري)', 'علامة صفر = رأي حرّ، وأي علامة أكبر تعني أنك ستصحّحه بنفسك.'],
                  ['✏️ أكمل الفراغ', 'المصطلحات والقواعد والأرقام', 'يدوياً', 'ضع <code>___</code> مكان كل فراغ، واكتب الإجابة المتوقعة لتقارن بها بسرعة.'],
                  ['🔢 رتّب بالترتيب', 'الخطوات والتسلسل الزمني والمراحل', 'آلياً بعلامة جزئية', 'اكتبها بالترتيب الصحيح — تُخلط لكل طالب. من رتّب ٣ من ٤ يأخذ ٧٥٪.'],
                  ['🔗 طابِق بين طرفين', 'المصطلح وتعريفه، الدولة وعاصمتها', 'آلياً بعلامة جزئية', 'الأطراف اليمنى تُخلط وتصير قائمة اختيار لكل طرف أيسر.'],
                  ['🖼️ شريحة عرض', 'الشرح والتمهيد والملخّص بين الأسئلة', 'لا تُجاب', 'اشرح ثم اسأل في تدفّق واحد — لا علامة لها ولا تُحسب في تقدّم الطالب ولا في التقرير.'],
                ],
              },
            },
            { muted: 'يمكن إضافة <strong>صورة</strong> لأي سؤال (ميزة بريميوم) — مفيدة للخرائط والرسوم والمسائل المصوّرة.' },
            { p: '<strong>فيديو يوتيوب داخل السؤال</strong>: الصق رابط الفيديو في حقل «فيديو يوتيوب» فيظهر المقطع فوق نصّ السؤال عند الطالب وعلى شاشة العرض معاً. يُقبل رابط <code>youtube.com</code> أو <code>youtu.be</code> فقط، ويُشغَّل عبر نطاق <code>youtube-nocookie</code> فلا يتتبّع يوتيوب الطالب. اجعله قصيراً (دقيقة أو دقيقتين)، وإن كان مؤقّت السؤال قصيراً فأطفئه لئلا ينتهي الوقت قبل المشاهدة.' },
            { p: '<strong>الألعاب التفاعلية 🎮</strong>: عندك لعبة صمّمتها بنفسك أو بمساعدة الذكاء الاصطناعي؟ ارفعها من «ألعابي» كملف HTML واحد مكتفٍ بذاته (كل الشفرة والتنسيق داخله، حتى ٢ ميغابايت)، واختر المادة من القائمة والصفوف من الشرائح — صفّاً أو أكثر، أو «كل المراحل» إن كانت تصلح للجميع. و<strong>أرفق لقطةَ شاشة</strong> تدلّ على اللعبة: هي أول ما يراه الطالب في البطاقة، وتُصغَّر في جهازك قبل الرفع فلا تُثقل شيئاً. تفتح اللعبة عند الطالب <strong>ملء الشاشة</strong> لا داخل مربّع صغير، فتُلعب على الجوال كتطبيق.' },
            { p: '<strong>اللعب بلا إنترنت 📥</strong>: يستطيع الطالب حفظ لعبتك على جهازه فتعمل عنده حتى بلا اتصال — في الحصّة التي ضعف فيها الواي فاي، أو في البيت. وهي محفوظةٌ تبقى داخل الحماية نفسها تماماً كما لو كانت على المنصّة، ولا تُنزَّل كملفٍّ يخرج عن سيطرتك. وإن أردتَ لعبتك على المنصّة وحدها فأزل علامة «اسمح بحفظها للّعب بلا إنترنت» عند الرفع.' },
            { p: '<strong>كيف يدخل طلابك؟ 🔑</strong>: أسهل طريق هو <strong>رمز QR</strong> تعرضه على الشاشة أو <strong>الرابط</strong> ترسله في مجموعة الصف — بضغطةٍ واحدة يكون الطالب داخل النشاط. ومن أراد الدخول بالرمز يدوياً فصفحتُه <strong>tapio.fun/c</strong> (حرف c فقط، سهلٌ أن تُمليه شفهياً). ولا يحتاج الطالب حساباً ولا تطبيقاً في الحالتين.' },
            { p: '<strong>العلامات غير النقاط 📝</strong>: <em>النقاط</em> لعبةٌ — تحدّد نقاط كل سؤال، وتتناقص مع سرعة الإجابة، فتصلح للمنافسة وكسر الجمود. أما <em>العلامات</em> فسجلٌّ لدفترك: تختار «الاختبار من ٣٠»، ثم إما أن تُوزَّع <strong>بالتساوي</strong> على الأسئلة (٣٠ على ١٠ أسئلة = ٣ لكل سؤال، ويحسبها لك التطبيق) أو تكتب <strong>علامة كل سؤال</strong> بنفسك على أن يساوي مجموعها العلامة الكاملة — والمحرّر يعرض لك المجموع أوّلاً بأوّل ويحذّرك إن خالف. والعلامة <strong>لا تتأثر بسرعة الإجابة إطلاقاً</strong>: طالبان أجابا الإجابات نفسها يأخذان العلامة نفسها.' },
            { p: '<strong>وقت الإجابة اختياري ⏱️</strong>: الافتراضي <em>بلا مؤقّت</em> فيجيب الطالب على راحته، وإن أردت التوقيت فهو <em>وقتٌ واحد بالثواني يسري على كل الأسئلة</em> — لا رقمٌ تحت كل سؤال. والمحرّر معالجٌ من ثلاث خطوات: <strong>الإعدادات</strong> أولاً (معلومات النشاط وسيره والتقييم والوقت)، ثم <strong>الأسئلة</strong> سؤالاً في كل صفحة، ثم <strong>المراجعة</strong> ترى فيها أسئلتك كلها قبل الإطلاق — والفارغُ منها مُعلَّم بلون. فلا تزدحم الشاشة أبداً.' },
            { p: '<strong>بروفايلك 👤</strong>: من «بروفايلي» تستطيع — إن أردت — أن تضع اسمك كما تحبّ أن يراه طلابك (أ. فلان)، وصورتك الشخصية، ورقمك للتواصل عبر واتساب. الثلاثة <strong>اختيارية بالكامل</strong>، وحسابك يعمل بلا أيٍّ منها كما هو الآن تماماً. وانتبه: ما تضعه هنا يراه كل من يفتح صفحة ألعابك بمن فيهم من لا حساب له، فلا تضع رقماً لا تريد نشره — ويمكنك مسحه في أي وقت.' },
            { p: '<strong>رابط ألعابك 🔗</strong>: في أعلى صفحة «ألعابي» رابطٌ خاصٌّ بك — ضعه في مجموعة صفّك أو في ورقة العمل، فيفتح طلابك صفحةً فيها ألعابك <strong>وحدها</strong> بلا تشتّت. ولكل لعبة رابطها المستقلّ أيضاً إن أردت مشاركة واحدة بعينها. ولا يحتاج الطالب حساباً في الحالتين.' },
            { p: '<strong>وهل هي آمنة على الطلاب؟</strong> كل لعبة تعمل داخل <strong>إطار معزول</strong> لا يصل إلى حسابك ولا إلى بيانات أي طالب ولا إلى المنصة أصلاً، ولا تستطيع إرسال شيء إلى خارجها. ومع ذلك: ارفع ما تملك حقّ نشره، وفي كل صفحة لعبة رابط إبلاغ عن محتوى مخالف.' },
            { p: '<strong>لا تبدأ من صفحة بيضاء 🌍</strong>: «مكتبة الأنشطة» فيها أنشطة نشرها معلّمون ليستفيد منها غيرهم. ابحث بالمادة أو الصف، عاين الأسئلة، ثم انسخ ما يناسبك إلى نشاطاتك — <strong>النسخة ملكك تماماً</strong>، عدّلها كما تشاء، ولا يؤثر فيها أن يعدّل صاحب الأصل نشاطه أو يسحبه لاحقاً. وحين تنشر أنت نشاطاً، تذكّر أن أسئلته <strong>وإجاباته الصحيحة</strong> تصير مرئية لكل معلّم مسجَّل: لا تنشر اختباراً لم تعقده بعد، وتستطيع سحبه في أي وقت من بطاقة النشاط.' },
            { p: '<strong>عندك بنك أسئلة في Excel؟</strong> لا تعِد كتابته: في المحرّر بطاقة «استورد أسئلتك من جدول» تقبل ملف CSV أو لصقاً مباشراً من الجدول، وتفهم العناوين العربية والإنجليزية، والإجابة الصحيحة مكتوبةً نصاً أو حرفاً أو رقماً. الملف يُقرأ في متصفحك ولا يُرفع إلى أي خادم.' },
          ],
        },
        {
          id: 'scoring',
          toc: '٣. احتساب النقاط',
          title: '٣. كيف تُحتسب النقاط بالضبط',
          blocks: [
            { p: 'لكل سؤال <strong>علامة</strong> تضعها أنت (١٠٠٠ افتراضياً للأسئلة المصحَّحة آلياً). وطريقة الاحتساب تختارها من إعدادات النشاط:' },
            {
              ul: [
                '<strong>نقاط حسب السرعة</strong> (الافتراضي داخل وضع النقاط): الإجابة الصحيحة الفورية تأخذ العلامة كاملة، وتتناقص تدريجياً حتى <em>نصف</em> العلامة عند آخر ثانية. يحتاج مؤقّتاً للسؤال.',
                '<strong>نقاط ثابتة</strong>: كل إجابة صحيحة تأخذ العلامة كاملة مهما كان الزمن.',
              ],
            },
            { p: '<strong>مضاعف السلسلة 🔥</strong> (اختياري): كل إجابة صحيحة متتالية تزيد النقاط ١٠٪ حتى سقف ٥٠٪ — يرفع الحماس، لكن أطفئه في الاختبارات الرسمية: فهو يوسّع الفارق بين الطلاب وقد يرفع نسبة الطالب فوق ١٠٠٪.' },
            { p: '<strong>الإجابة الخاطئة</strong> لا تخصم نقاطاً أبداً، لكنها تصفّر السلسلة. و<strong>السؤال المتروك</strong> صفر بلا خصم.' },
            { p: '<strong>الأسئلة اليدوية</strong> (مفتوحة/أكمل الفراغ) لا تتأثر بالسرعة إطلاقاً: تأخذ العلامة التي تمنحها أنت.' },
            { p: '<strong>اختر نظام تقييم واحداً 🏅</strong>: من الإعدادات تختار غرضك — <strong>🎮 نقاط ومنافسة</strong> (نقاط وسلسلة ولوحة ترتيب وأوسمة، للمسابقات)، أو <strong>📝 علامات ودرجات</strong> (علامة من مجموع تحدّده، وتقدير، ونسبة نجاح، للاختبارات الرسمية)، أو <strong>🕊️ بلا تقييم</strong> (للاستطلاعات والعصف الذهني). لا يجتمع نظامان: طالبٌ يرى رقمين لا يعرف أيّهما نتيجته.' },
            { p: '<strong>لماذا لا سرعة في وضع العلامات؟</strong> لأن العلامة سجلٌّ لا لعبة: طالبان أجابا الإجابات نفسها يجب أن يأخذا العلامة نفسها وإن سبق أحدهما الآخر بثوانٍ. لذلك يُطفئ الوضعُ مكافأةَ السرعة ومضاعفَ السلسلة تلقائياً — ولو بقيا لتجاوزت العلامة سقفها ولظُلم الطالب البطيء الذي أصاب.' },
            { p: '<strong>العلامة الكاملة 📝</strong>: اختر ١٠ أو ٢٠ أو ٣٠ أو أي رقم تريده، فيخرج كل طالب بعلامة من ذلك المجموع مع تقديره (ممتاز، جيد جداً…) ونسبته — صالحةً لدفترك ولتقريرك للإدارة.' },
            { table: { head: ['النسبة', 'التقدير'], rows: [['٩٠٪ فأكثر', '🌟 ممتاز'], ['٨٠–٨٩٪', '🎯 جيد جداً'], ['٧٠–٧٩٪', '👍 جيد'], ['٦٠–٦٩٪', '🙂 مقبول'], ['أقل من ٦٠٪', '💪 يحتاج مراجعة'] ] } },
            { p: '<strong>ماذا يدخل في العلامة؟</strong> كل سؤال مصحَّح (آلياً أو يدوياً) علامته أكبر من صفر، موزوناً بعلامته: سؤال بألف نقطة يزن ضعف سؤال بخمسمئة. والاستطلاع وسحابة الكلمات والمقياس والشرائح خارجها تماماً. والسؤال النصّي الذي لم تصحّحه بعد يُستثنى من الحساب كلّه — فلا تظهر علامة ناقصة على أنها ضعف — ويرى الطالب تنبيهاً بأن علامته قد تتغيّر.' },
            { p: '<strong>نسبة النجاح</strong> تحدّدها أنت (٥٠٪ افتراضياً)، وعليها يُبنى «ناجح / دون النجاح» في لوحتك وفي التقرير، ويظهر لك عدد الناجحين ومتوسط علامة الصفّ بلا حساب يدوي.' },
            { note: '<strong>النسبة المئوية في التقرير</strong> = مجموع درجات الطالب ÷ مجموع علامات كل الأسئلة المصحَّحة (آلياً ويدوياً).' },
          ],
        },
        {
          id: 'grading',
          toc: '٤. التصحيح اليدوي',
          title: '٤. التصحيح اليدوي (الإجابات النصّية)',
          blocks: [
            {
              ol: [
                'اجعل علامة السؤال المفتوح أكبر من صفر (أو استخدم «أكمل الفراغ» فهو يدوي دائماً).',
                'يكتب الطالب جوابه ويرى «بانتظار تصحيح المدرب» — <strong>بلا أي نتيجة</strong>.',
                'افتح <strong>لوحة التحكم</strong>: تظهر بطاقة تصحيح فيها نص كل إجابة، وأمامها <code>✓ صح</code> و<code>✕ خطأ</code> وأرقام العلامات الجزئية.',
                'بمجرد ضغطك تظهر العلامة للطالب فوراً وتدخل في مجموعه وترتيبه. وتعديلها لاحقاً يصحّح المجموع تلقائياً.',
              ],
            },
            { muted: 'إن أنهيت النشاط وبقيت إجابات بلا تصحيح، يرى أصحابها شاشة انتظار بدل نتيجة ناقصة — أكمل التصحيح لتظهر نتائجهم وبطاقاتهم.' },
          ],
        },
        {
          id: 'schedule',
          toc: '٥. الجدولة والمدة',
          title: '٥. جدولة الاختبار ومدّته ⏰',
          blocks: [
            { p: 'في إعدادات النشاط قسم <strong>«الجدولة والمدة»</strong>:' },
            {
              ul: [
                '<strong>موعد فتح الاختبار</strong>: اختر التاريخ والساعة (بتوقيت جهازك). أطلق الجلسة مبكراً وشارك الرمز، فيرى الطلاب <em>عدّاداً تنازلياً</em> حتى الموعد، ثم <strong>يفتح الاختبار وحده</strong> بلا أي ضغطة منك — على شاشات الطلاب وعلى البروجكتر معاً.',
                '<strong>مدة الاختبار بالدقائق</strong>: عند انتهائها <strong>يُقفل الاختبار تلقائياً</strong> للجميع وتظهر النتائج. يظهر للطالب وللمعلّم شريط «⏳ ينتهي الاختبار خلال …».',
              ],
            },
            { p: 'الاثنان اختياريان ومستقلان: تقدر تضع موعداً بلا مدة، أو مدة بلا موعد، أو الاثنين معاً.' },
            { muted: 'تستطيع دائماً البدء قبل الموعد من زر «بدء النشاط» — وعندها تُحسب المدة من لحظة بدئك الفعلي. المدة الكلية شيء مختلف عن <em>مؤقّت السؤال</em>: الأول يقفل الاختبار كله، والثاني ينهي سؤالاً واحداً.' },
          ],
        },
        {
          id: 'modes',
          toc: '٦. أنماط العرض',
          title: '٦. أنماط العرض: أيها تختار؟',
          blocks: [
            {
              table: {
                head: ['النمط', 'كيف يعمل', 'الأنسب لـ'],
                rows: [
                  ['🎛️ المدرب ينقل الأسئلة', 'الجميع على نفس السؤال، وأنت تتحكم بالانتقال', 'الصف الحضوري مع بروجكتر'],
                  ['⏱️ انتقال تلقائي', 'ينتقل بعد ثوانٍ محدّدة تلقائياً', 'المسابقات السريعة والفعاليات'],
                  ['🏃 كل طالب بسرعته <strong>(الافتراضي)</strong>', 'يفتح الرابط فيبدأ فوراً، وبمجرّد أن يجيب ينتقل للتالي', 'الواجبات والتعلّم عن بُعد'],
                ],
              },
            },
            { p: '<strong>شاشة العرض</strong>: زر «افتح شاشة العرض» يفتح صفحة مخصّصة للبروجكتر — رمز الدخول و QR كبيران، والأسئلة والنتائج والترتيب بخط ضخم، ولا تحوي أي أزرار تحكّم فلا خوف من ضغطة خاطئة أمام الصف.' },
            { p: '<strong>لماذا الحرّ افتراضياً؟</strong> لأن أكثر استعمالات المنصة واجبٌ يُرسَل برابط لا صفٌّ أمام بروجكتر. فالطالب يفتح الرابط فيجد السؤال الأول فوراً، وبمجرّد أن يجيب ينتقل إلى التالي بلا ضغطة زرّ — تُعرض له نتيجته وشرحها ثانيتين أولاً (وهي الفائدة التربوية كلها)، ويستطيع تعجيلها بزرّ «التالي»، والسؤال الأخير بلا انتقال تلقائي فالإنهاء قراره. وإن أردته يتأمّل نتيجته حتى يضغط بنفسه فأطفئ «الانتقال التلقائي بعد الإجابة».' },
            { p: '<strong>وضع الفرق</strong>: يوزّع الطلاب تلقائياً على فرق ملوّنة متوازنة، ونقاط الفريق مجموع أعضائه — ممتاز للصفوف الكبيرة والمشاغبة.' },
          ],
        },
        {
          id: 'results',
          toc: '٧. النتائج والتحليل',
          title: '٧. النتائج والتحليل',
          blocks: [
            {
              ul: [
                '<strong>لوحة التحكم</strong>: تقدّم كل طالب سؤالاً بسؤال، ونتائج كل سؤال، وبطاقات التصحيح. ملفات Excel وPDF هنا هي <strong>سجل علامات الطلاب فقط</strong> — PDF رسمي فيه توقيعا المعلّم والمدير، يصلح تقريراً للإدارة أو مرجعاً للعلامات.',
                '<strong>تبويب التحليل 📈</strong>: متوسط الصف والوسيط ونسبة المشاركة، توزيع الدرجات، دقة كل سؤال، متوسط زمن الإجابة، و<strong>أصعب سؤال / أسهل سؤال / الأسرع / الأبطأ / الأكثر تخطّياً</strong>، مع <strong>توصيات مكتوبة</strong> مبنية على أرقام نشاطك أنت. ملفات هذا التبويب هي <strong>تقارير التحليل الكاملة</strong>.',
                '<strong>Excel التحليل</strong>: أربع أوراق — بطاقة النشاط (التاريخ والمدة والإعدادات والتوصيات)، الطلاب (درجة ونسبة وترتيب وزمن)، الأسئلة (دقة وأزمنة)، والإجابات (كل إجابة في سطر).',
                '<strong>لكل تقرير زرّان</strong>: «📄 PDF ملوّن» يفتح التقرير بكامل رسومه وألوانه ثم نافذة الطباعة (اختر «حفظ كـ PDF») — وهو الأجمل للطباعة والأرشفة؛ و«⤓ ملف» ينزّل PDF فوراً بلا أي نافذة حين تريد الملف بسرعة.',
              ],
            },
            { p: '<strong>نتائج الاستطلاعات 📊</strong>: أسئلة الاستطلاع لا تُصحَّح، فلا معنى لدقّتها في جدول الأداء. لذلك تظهر نتيجتها في لوحة التحكم <strong>مباشرة بلا نقر</strong>: أعمدة مرتّبة بالأصوات، الرأي الأعلى مميّز، والنسبة والعدد وكم أجاب من الصف. وإن أردت التفصيل فزرّ «من اختار ماذا؟» يفتح أسماء أصحاب كل رأي ومن لم يشارك — وهذا <strong>يظهر لك وحدك</strong>: لا على شاشة العرض ولا عند الطلاب.' },
            { p: '<strong>مراجعة الطالب لنفسه 📚</strong>: بعد انتهاء النشاط يظهر للطالب زر «راجع إجاباتك» يفتح له بطاقات — سؤالاً سؤالاً، الأخطاء أولاً — يحاول تذكّر الجواب ثم يكشفه ليرى إجابته والإجابة الصحيحة وشرحك. لذلك <strong>اكتب الشرح</strong> في الأسئلة المهمة: هو ما يحوّل الاختبار إلى درس. والمراجعة لا تُفتح إلا بعد انتهاء النشاط، فلا تسرّب إجابةً أثناءه.' },
            { muted: 'التصدير المنسّق (Excel و PDF) ميزة بريميوم. تنزيل JSON الخام يبقى متاحاً للجميع.' },
          ],
        },
        {
          id: 'practices',
          toc: '٨. أفضل الممارسات',
          title: '٨. أفضل الممارسات',
          blocks: [
            { h3: 'في تصميم الأسئلة' },
            {
              ul: [
                '<strong>مفهوم واحد لكل سؤال.</strong> إن أخطأ الطالب تعرف تماماً أين الخلل.',
                '<strong>٨–١٢ سؤالاً</strong> للحصة، و٥ للتهيئة. الأطول من ١٥ يُفقد التركيز.',
                '<strong>ابدأ بسؤال سهل</strong> ليدخل الجميع بثقة، وتدرّج في الصعوبة.',
                '<strong>اجعل الخيارات متقاربة الطول</strong> — الخيار الأطول عادةً هو الصحيح، والطلاب يكتشفون ذلك.',
                'تجنّب «كل ما سبق» و«لا شيء مما سبق»، وتجنّب النفي المزدوج.',
                'اكتب <strong>شرح الإجابة</strong>؛ ظهوره بعد الكشف يحوّل الاختبار إلى درس.',
              ],
            },
            { h3: 'في الوقت' },
            {
              ul: [
                'سؤال معرفة قصير: ١٥–٢٠ ثانية. سؤال يحتاج حساباً أو قراءة: ٤٥–٩٠ ثانية.',
                'في الاختبارات الرسمية استخدم <strong>نقاطاً ثابتة</strong> وأطفئ مضاعف السلسلة — السرعة ليست فهماً.',
                'راقب «متوسط زمن الإجابة» في التحليل: زمن مرتفع مع دقة منخفضة = صياغة غامضة غالباً.',
              ],
            },
            { h3: 'في نزاهة الاختبار' },
            {
              ul: [
                '<strong>خلط الخيارات لكل طالب</strong> أقوى إجراء عملي ضد النقل: ترتيب الخيارات يختلف من جهاز لآخر، فـ«ب» عند جارك ليست «ب» عندك — ولا يحتاج منك شيئاً سوى تفعيله.',
                '<strong>خلط ترتيب الأسئلة</strong> يفيد حين تعيد الاختبار على شعبة ثانية في اليوم نفسه.',
                'أضف <strong>مدة للاختبار</strong> فيُقفل تلقائياً للجميع في اللحظة نفسها.',
                'استخدم <strong>نقاطاً ثابتة</strong> لا نقاط السرعة: الأسرع ليس بالضرورة الأفهم.',
              ],
            },
            { h3: 'في إدارة الصف' },
            {
              ul: [
                'اعرض الرمز على البروجكتر من <strong>شاشة العرض</strong> واترك الطلاب يدخلون قبل البدء بدقيقة.',
                'في الأسئلة المصحَّحة لا تظهر الأعداد أثناء الإجابة (عمداً) حتى لا يقلّد المتأخرون الأغلبية — بل تضيء أسماء من أجاب.',
                'بعد كل سؤال صعب، توقّف ٣٠ ثانية للشرح قبل الانتقال. النتيجة أمامك مباشرة، فاستثمرها.',
                'أطفئ «لوحة الترتيب» مع الصفوف الحسّاسة أو استخدم <strong>الفرق</strong> بدل الأفراد.',
                'اطلب أسماءً حقيقية عند التقييم، وأطفئ «طلب الاسم» في الاستطلاعات الصريحة.',
              ],
            },
            { h3: 'بعد النشاط' },
            {
              ul: [
                'نزّل التقرير فوراً — الجلسة تُمحى تلقائياً.',
                'ابدأ حصتك القادمة بأصعب سؤالين من التحليل: أعلى أثر بأقل وقت.',
                'كرّر الاختبار نفسه بعد أسبوع (استنسخ النشاط) وقارن المتوسط — هذا هو الدليل الحقيقي على التعلّم.',
              ],
            },
          ],
        },
        {
          id: 'faq',
          toc: '٩. أسئلة شائعة',
          title: '٩. أسئلة شائعة',
          blocks: [
            { p: '<strong>هل يحتاج الطالب حساباً؟</strong> لا. يدخل بالرمز أو الـ QR ويكتب اسمه فقط.' },
            { p: '<strong>هل تُحفظ إجابات الطلاب؟</strong> لا. كل شيء في ذاكرة الخادم ويُمحى بعد الجلسة — لذا التنزيل مهم.' },
            { p: '<strong>انقطع النت عن طالب.</strong> يعيد فتح الرابط فيعود بنفس اسمه ونقاطه ما دامت الجلسة قائمة.' },
            { p: '<strong>عندي طلاب لا يقرؤون العربية.</strong> التطبيق كله ثنائي اللغة (عربي/إنجليزي): لوحتك والمحرّر والتحليلات والتقارير وصفحات الطالب وهذا الدليل. بدّل لغتك من زر «EN/AR» أعلى الصفحة قبل أن تطلق النشاط.' },
            { p: '<strong>بأي لغة يرى الطالب النشاط؟</strong> <strong>بلغتك أنت وقت الإطلاق.</strong> إن كانت لوحتك بالإنجليزية فسيرى كل مشارك النشاط بالإنجليزية وباتجاه LTR حتى لو كان متصفحه عربياً، والعكس صحيح — وشاشة البروجكتر تتبع النشاط أيضاً. فإن أردت نشاطاً بالإنجليزية بدّل لغتك <em>قبل</em> الضغط على «إطلاق». (هذا لا يغيّر تفضيل الطالب المحفوظ لبقية الموقع، وأسئلتك تبقى كما كتبتها بالطبع.)' },
            { p: '<strong>هل يبقى الاختبار المجدول محفوظاً حتى موعده؟</strong> نعم — الجلسة المجدولة لا تُمسح بالخمول قبل موعدها، فتقدر تُطلقها اليوم لموعد بعد أيام وتوزّع الرمز مسبقاً.' },
            { p: '<strong>هل أستطيع تعديل نشاط أطلقته؟</strong> نعم — كل نشاط تطلقه يُحفظ في «نشاطاتي» تلقائياً، وإنهاء الجلسة لا يحذفه. عدّله أو استنسخه وأطلقه من جديد.' },
            { p: '<strong>ما الفرق بين المجاني والبريميوم؟</strong> كل الأنشطة والأسئلة والجلسات مجانية بلا حدود. البريميوم يفتح: <strong>تصميم النشاط بالذكاء الاصطناعي</strong>، و<strong>صور الأسئلة</strong>، و<strong>تصدير النتائج Excel و PDF</strong>.' },
            { actions: true },
          ],
        },
      ],
    },

    en: {
      docTitle: 'Teacher guide — Tapio',
      metaDescription: 'A practical guide: how to design a quiz or poll in Tapio, how scoring works, and classroom best practices.',
      pageTitle: '📖 Teacher guide',
      intro: 'Everything you need to design an activity that works: the steps, the question types, how scoring is calculated, and best practices.',
      tocTitle: 'Jump to',
      navNew: '➕ New activity',
      navHome: '🏠 Home',
      footer: 'Tapio — live questions and polls for teachers and trainers.',
      waButton: '💬 Get premium on WhatsApp',
      waButtonPriced: '💬 Get premium — ${price}/month on WhatsApp',
      waMessage: 'Hello, I would like to subscribe to Tapio premium (${price}/month).',
      startNow: 'Start an activity now',
      sections: [
        {
          id: 'start',
          toc: '1. Start in 3 minutes',
          title: '1. Your first activity in 3 minutes',
          blocks: [
            {
              ol: [
                '<strong>Open “New activity”</strong> from the home page (no account needed to try it, but an account saves your activities).',
                '<strong>Write a clear title</strong> — students see it on their screens, e.g. “Unit 3 review”.',
                '<strong>Add your questions</strong>: pick the type, write the text, set the correct answer, the score and the time. Or start from a <em>ready template</em>, or let the <em>AI assistant</em> write them for you — by default it only writes <strong>auto-graded</strong> questions (multiple choice, true/false, ordering, matching), so it never leaves you with a pile of answers to mark by hand; if you do want open-ended or fill-in-the-blank questions, turn on the option under the chat. And every time you open the assistant it starts a fresh conversation rather than continuing an old one.',
                '<strong>Adjust the settings</strong>: pace, scoring, leaderboard, teams.',
                '<strong>Press “Start the session”</strong> and a 6-digit code and a QR appear.',
                '<strong>Show the code on the projector</strong> via “Open the projector screen”. Students join from <code>tapio.fun</code> with the code or by scanning the QR.',
                '<strong>Run the session</strong> from the “Stage” tab: start, show results, move to the next question, then end the activity.',
                '<strong>Download the results</strong> (Excel or a PDF report) before you close the session.',
              ],
            },
            {
              note: 'Student data lives in the server’s memory only and is erased when the session ends — only your questions are saved to your account. So download the results before closing.',
              tone: 'warn',
            },
          ],
        },
        {
          id: 'types',
          toc: '2. Question types',
          title: '2. Question types and when to use each',
          blocks: [
            {
              table: {
                head: ['Type', 'Good for', 'Graded?', 'Practical note'],
                rows: [
                  ['🎯 Multiple choice', 'Quick assessment and review', 'Automatically', 'Four options is plenty; make the distractors plausible, not silly.'],
                  ['✅ True / false', 'Clear-cut facts', 'Automatically', 'A 50% guess rate — use it to warm up, not to grade finally.'],
                  ['📊 Poll', 'Reading the room and breaking the ice', 'No', 'No right answer, and results appear live on screen.'],
                  ['☁️ Word cloud', 'Brainstorming', 'No', 'Ask for <em>one word</em> explicitly so repeated words cluster.'],
                  ['📈 Scale', 'Feedback (1–5)', 'No', 'Label both ends clearly: “Not clear → Very clear”.'],
                  ['💬 Open answer', 'Explanation and analysis', 'Manually (optional)', 'A score of zero means a free opinion; any score above zero means you will grade it yourself.'],
                  ['✏️ Fill in the blank', 'Terms, grammar and numbers', 'Manually', 'Put <code>___</code> where each blank goes, and write the expected answer so you can compare at a glance.'],
                  ['🔢 Put in order', 'Steps, timelines and stages', 'Automatically, partial credit', 'Write them in the correct order — shuffled per student. Getting 3 of 4 in place scores 75%.'],
                  ['🔗 Match the pairs', 'A term and its definition, a country and its capital', 'Automatically, partial credit', 'The right-hand sides are shuffled into a dropdown for each left-hand item.'],
                  ['🖼️ Content slide', 'Explaining, setting up, or summarising between questions', 'Not answered', 'Teach then ask in one flow — no score, and it counts in neither the student’s progress nor the report.'],
                ],
              },
            },
            { muted: 'You can attach an <strong>image</strong> to any question (a premium feature) — useful for maps, diagrams and picture problems.' },
            { p: '<strong>A YouTube video inside the question</strong>: paste the link into the “YouTube video” field and the clip appears above the question text, both on the student’s device and on the projector screen. Only <code>youtube.com</code> and <code>youtu.be</code> links are accepted, and playback goes through the <code>youtube-nocookie</code> domain so YouTube does not track your students. Keep it short (a minute or two), and if the question timer is tight, turn it off so the clock does not run out before they have watched.' },
            { p: '<strong>Interactive games 🎮</strong>: have a game you built yourself or with AI? Upload it from “My games” as a single self-contained HTML file (all code and styling inside it, up to 2 MB), pick the subject from the list and the grades from the chips — one, several, or “All stages” if it suits everyone. And <strong>attach a screenshot</strong> that shows what the game is: it is the first thing a student sees on the card, and it is shrunk on your device before upload so it costs nothing. For the student the game opens <strong>full screen</strong>, not inside a small box, so it plays like an app on a phone.' },
            { p: '<strong>Offline play 📥</strong>: a student can save your game on their device so it works with no connection — in the lesson where the Wi-Fi drops, or at home. A saved game stays inside exactly the same protection as on the platform; it is not downloaded as a file that escapes your control. If you would rather keep your game on the platform only, untick “Allow saving it for offline play” when you upload.' },
            { p: '<strong>How do students join? 🔑</strong>: the easiest way is the <strong>QR code</strong> on screen or the <strong>link</strong> you post in your class group — one tap and they are in. If someone would rather type the code, the page for that is <strong>tapio.fun/c</strong> (just the letter c, easy to say out loud). Either way students need no account and no app.' },
            { p: '<strong>Marks are not points 📝</strong>: <em>points</em> are a game — you set the points per question and they decrease with answer speed, which suits competition and warm-ups. <em>Marks</em> are a record for your gradebook: you set “this test is out of 30”, then either split it <strong>equally</strong> across the questions (30 over 10 questions = 3 each, worked out for you) or write <strong>a mark per question</strong> yourself so long as they add up to the total — the editor shows the running sum and warns you when it does not match. And a mark is <strong>never affected by answer speed</strong>: two students with identical answers get identical marks.' },
            { p: '<strong>Answer time is optional ⏱️</strong>: the default is <em>no timer</em>, so students answer at their own pace; if you do want timing it is <em>one number of seconds applied to every question</em> — not a figure under each one. And the editor is a three-step wizard: <strong>Settings</strong> first (activity info, flow, scoring, time), then <strong>Questions</strong> one per page, then <strong>Review</strong> where you see them all before launching — with any empty one flagged. The screen never gets crowded.' },
            { p: '<strong>Your profile 👤</strong>: from “My profile” you can — if you want to — set the name your students see (Ms. So-and-so), your photo, and a contact number for WhatsApp. All three are <strong>entirely optional</strong>, and your account works without any of them exactly as it does now. Note that whatever you put there is visible to anyone who opens your games page, including people without an account, so do not add a number you would not publish — and you can clear it at any time.' },
            { p: '<strong>A link to your games 🔗</strong>: at the top of “My games” there is a link of your own — put it in your class group or on a worksheet and your students land on a page holding <strong>only</strong> your games, with nothing else to distract them. Every game also has its own link if you want to share just one. Neither needs the student to have an account.' },
            { p: '<strong>Is it safe for students?</strong> Every game runs inside an <strong>isolated frame</strong> that cannot reach your account, any student’s data, or the platform at all, and cannot send anything outside itself. Even so: only upload what you have the right to publish, and every game page carries a link to report inappropriate content.' },
            { p: '<strong>Do not start from a blank page 🌍</strong>: the “Activity library” holds activities teachers published for others to use. Search by subject or grade, preview the questions, then copy what suits you into your own activities — <strong>the copy is entirely yours</strong>, edit it freely, and it is unaffected if the original author later edits or withdraws theirs. When you publish one yourself, remember that its questions <strong>and their correct answers</strong> become visible to every signed-in teacher: do not publish a quiz you have not run yet, and you can withdraw it at any time from the activity card.' },
            { p: '<strong>Have a question bank in Excel?</strong> Do not retype it: the editor has an “Import your questions from a spreadsheet” card that takes a CSV file or a direct paste from your sheet, understands Arabic and English headers, and reads the correct answer written as text, a letter or a number. The file is read in your browser and never uploaded.' },
          ],
        },
        {
          id: 'scoring',
          toc: '3. How scoring works',
          title: '3. Exactly how points are calculated',
          blocks: [
            { p: 'Every question carries a <strong>score</strong> that you set (1000 by default for auto-graded questions). You choose how it is awarded in the activity settings:' },
            {
              ul: [
                '<strong>Speed-based points</strong> (default): an instant correct answer earns the full score, decreasing gradually to <em>half</em> the score at the last second. Requires a timer on the question.',
                '<strong>Flat points</strong>: every correct answer earns the full score regardless of time — the fairest option for real exams.',
                '<strong>No points</strong>: for review and polls; no ranking, no competition.',
              ],
            },
            { p: '<strong>Streak bonus 🔥</strong> (optional): each consecutive correct answer adds 10% up to a 50% ceiling — it lifts the energy, but turn it off for formal exams: it widens the gap between students and can push a student above 100%.' },
            { p: 'A <strong>wrong answer</strong> never subtracts points, but it resets the streak. An <strong>unanswered question</strong> scores zero with no penalty.' },
            { p: '<strong>Manually graded questions</strong> (open answer / fill in the blank) are never affected by speed: they get exactly the score you award.' },
            { p: '<strong>Pick one assessment system 🏅</strong>: in the settings you choose your purpose — <strong>🎮 Points &amp; competition</strong> (points, streaks, a leaderboard and badges, for contests), or <strong>📝 Marks &amp; grades</strong> (a mark out of a total you set, a grade, and a pass mark, for real exams), or <strong>🕊️ No assessment</strong> (for polls and brainstorming). The two never run together: a student looking at two numbers cannot tell which one is their result.' },
            { p: '<strong>Why is there no speed bonus in marks mode?</strong> Because a mark is a record, not a game: two students who gave the same answers must get the same mark even if one was seconds faster. So the mode switches off the speed bonus and the streak multiplier automatically — leaving them on would push marks past their ceiling and punish the slower student who still got it right.' },
            { p: '<strong>The total mark 📝</strong>: pick 10, 20, 30 or any number you like, and every student ends with a mark out of that total, plus a grade (Excellent, Very good…) and a percentage — fit for your gradebook and for a report to administration.' },
            { table: { head: ['Percentage', 'Grade'], rows: [['90% and above', '🌟 Excellent'], ['80–89%', '🎯 Very good'], ['70–79%', '👍 Good'], ['60–69%', '🙂 Satisfactory'], ['Below 60%', '💪 Needs review'] ] } },
            { p: '<strong>What counts towards the mark?</strong> Every graded question (automatic or manual) whose points are above zero, weighted by those points: a 1000-point question weighs twice a 500-point one. Polls, word clouds, scales and content slides are excluded entirely. A written answer you have not graded yet is left out of the calculation altogether — so an incomplete mark is never shown as a weakness — and the student sees a note that their mark may change.' },
            { p: '<strong>The pass mark</strong> is yours to set (50% by default). It drives “Passed / Below pass” on your dashboard and in the report, and shows you how many passed and the class average without any manual arithmetic.' },
            { note: 'The <strong>percentage in the report</strong> = the student’s total points ÷ the total score of every graded question (both auto and manual).' },
          ],
        },
        {
          id: 'grading',
          toc: '4. Manual grading',
          title: '4. Manual grading (text answers)',
          blocks: [
            {
              ol: [
                'Give the open question a score above zero (or use “Fill in the blank”, which is always manual).',
                'The student writes their answer and sees “Waiting for the teacher to grade” — <strong>with no result at all</strong>.',
                'Open the <strong>Dashboard</strong>: a grading card shows each answer with <code>✓ correct</code>, <code>✕ wrong</code> and partial-score buttons next to it.',
                'The moment you press, the score appears to the student and enters their total and rank. Changing it later corrects the total automatically.',
              ],
            },
            { muted: 'If you end the activity while answers are still ungraded, those students see a waiting screen instead of an incomplete result — finish grading and their results and cards appear.' },
          ],
        },
        {
          id: 'schedule',
          toc: '5. Scheduling and duration',
          title: '5. Scheduling the quiz and its duration ⏰',
          blocks: [
            { p: 'In the activity settings, under <strong>“Schedule and duration”</strong>:' },
            {
              ul: [
                '<strong>Opening time</strong>: pick the date and time (in your device’s timezone). Launch the session early and share the code — students see a <em>countdown</em> until the moment, then <strong>the quiz opens on its own</strong> without any click from you, on the students’ screens and on the projector alike.',
                '<strong>Duration in minutes</strong>: when it runs out <strong>the quiz closes automatically</strong> for everyone and the results appear. Both student and teacher see a “⏳ Quiz ends in …” bar.',
              ],
            },
            { p: 'Both are optional and independent: set a time without a duration, a duration without a time, or both together.' },
            { muted: 'You can always start early with the “Start activity” button — the duration is then counted from your actual start. The overall duration is different from a <em>question timer</em>: the first closes the whole quiz, the second ends a single question.' },
          ],
        },
        {
          id: 'modes',
          toc: '6. Pace modes',
          title: '6. Pace modes: which one to choose?',
          blocks: [
            {
              table: {
                head: ['Mode', 'How it works', 'Best for'],
                rows: [
                  ['🎛️ Teacher-paced', 'Everyone is on the same question and you control the moves', 'An in-person class with a projector'],
                  ['⏱️ Auto-advance', 'Moves on automatically after a set number of seconds', 'Fast quizzes and events'],
                  ['🏃 Student-paced <strong>(default)</strong>', 'They open the link and start at once, and move on the moment they answer', 'Homework and remote learning'],
                ],
              },
            },
            { p: '<strong>The projector screen</strong>: the “Open the projector screen” button opens a page made for a projector — a huge join code and QR, questions, results and rankings in large type, and no control buttons at all, so there is no fear of a wrong click in front of the class.' },
            { p: '<strong>Why is student-paced the default?</strong> Because most of what this platform is used for is homework sent as a link, not a class in front of a projector. The student opens the link and the first question is already there, and the moment they answer they move on with no button press — their result and its explanation show for two seconds first (that is where the learning happens), they can skip ahead with “Next”, and the last question never auto-advances because finishing is their decision. If you want them to sit with their result until they press it themselves, switch off “Advance automatically after answering”.' },
            { p: '<strong>Team mode</strong>: distributes students automatically into balanced coloured teams, and a team’s score is the sum of its members — excellent for large and lively classes.' },
          ],
        },
        {
          id: 'results',
          toc: '7. Results and analysis',
          title: '7. Results and analysis',
          blocks: [
            {
              ul: [
                '<strong>Dashboard</strong>: each student’s progress question by question, the results of every question, and the grading cards. The Excel and PDF files here are the <strong>student score record only</strong> — an official PDF with teacher and principal signature lines, suitable as a report for administration or a marks reference.',
                '<strong>Analysis tab 📈</strong>: class average, median and participation rate, score distribution, per-question accuracy, average answering time, and the <strong>hardest / easiest / fastest / slowest / most skipped question</strong>, plus <strong>written recommendations</strong> built on your own activity’s numbers. The files in this tab are the <strong>full analysis reports</strong>.',
                '<strong>Analysis Excel</strong>: four sheets — the activity card (date, duration, settings and recommendations), students (score, percentage, rank and time), questions (accuracy and timings), and answers (one row per answer).',
                '<strong>Every report has two buttons</strong>: “📄 Colour PDF” opens the report with all its charts and colour and then the print window (choose “Save as PDF”) — the best-looking option for printing and archiving; “⤓ File” downloads a PDF immediately with no window when you just want the file fast.',
              ],
            },
            { p: '<strong>Poll results 📊</strong>: poll questions are not graded, so their accuracy column means nothing. Their results therefore appear on the dashboard <strong>immediately, with no clicking</strong>: bars ordered by votes, the leading answer highlighted, with the percentage, the count, and how many of the class replied. If you want the detail, the “Who chose what?” button opens the names behind each answer and who did not reply — and that is <strong>for your eyes only</strong>: never on the projector, never on the students’ screens.' },
            { p: '<strong>Students review themselves 📚</strong>: once the activity ends, each student gets a “Review your answers” button that opens flashcards — question by question, wrong ones first. They try to recall the answer, then reveal it to see what they wrote, the correct answer, and your explanation. So <strong>write the explanation</strong> on the questions that matter: it is what turns a quiz into a lesson. Review only opens after the activity ends, so nothing leaks while it is running.' },
            { muted: 'Formatted export (Excel and PDF) is a premium feature. Downloading the raw JSON stays free for everyone.' },
          ],
        },
        {
          id: 'practices',
          toc: '8. Best practices',
          title: '8. Best practices',
          blocks: [
            { h3: 'Designing questions' },
            {
              ul: [
                '<strong>One concept per question.</strong> When a student gets it wrong you know exactly where the gap is.',
                '<strong>8–12 questions</strong> for a full lesson, 5 for a warm-up. Beyond 15 attention drops.',
                '<strong>Open with an easy question</strong> so everyone joins in confidently, then build up the difficulty.',
                '<strong>Keep the options a similar length</strong> — the longest option is usually the correct one, and students work that out.',
                'Avoid “all of the above” and “none of the above”, and avoid double negatives.',
                'Write the <strong>answer explanation</strong>; showing it after the reveal turns a quiz into a lesson.',
              ],
            },
            { h3: 'On timing' },
            {
              ul: [
                'A short recall question: 15–20 seconds. A question needing calculation or reading: 45–90 seconds.',
                'For formal exams use <strong>flat points</strong> and turn off the streak bonus — speed is not understanding.',
                'Watch “average answering time” in the analysis: a long time with low accuracy usually means unclear wording.',
              ],
            },
            { h3: 'On exam integrity' },
            {
              ul: [
                '<strong>Shuffling options per student</strong> is the strongest practical measure against copying: the option order differs per device, so your neighbour’s “B” is not your “B” — and it costs you nothing but a toggle.',
                '<strong>Shuffling the question order</strong> helps when you repeat the quiz with a second class on the same day.',
                'Add a <strong>quiz duration</strong> so it closes automatically for everyone at the same moment.',
                'Use <strong>flat points</strong> rather than speed points: the fastest is not necessarily the one who understood.',
              ],
            },
            { h3: 'Running the class' },
            {
              ul: [
                'Show the code on the projector from the <strong>projector screen</strong> and let students join a minute before you start.',
                'On graded questions the counts stay hidden while students answer (deliberately) so latecomers cannot follow the majority — instead the names of those who answered light up.',
                'After each hard question, pause 30 seconds to explain before moving on. The result is right in front of you, so use it.',
                'Turn off the <strong>leaderboard</strong> with sensitive classes, or use <strong>teams</strong> instead of individuals.',
                'Ask for real names when assessing, and turn off “require a name” for candid polls.',
              ],
            },
            { h3: 'After the activity' },
            {
              ul: [
                'Download the report immediately — the session is erased automatically.',
                'Open your next lesson with the two hardest questions from the analysis: the highest impact for the least time.',
                'Repeat the same quiz a week later (duplicate the activity) and compare the average — that is the real evidence of learning.',
              ],
            },
          ],
        },
        {
          id: 'faq',
          toc: '9. FAQ',
          title: '9. Frequently asked questions',
          blocks: [
            { p: '<strong>Does a student need an account?</strong> No. They join with the code or the QR and just type their name.' },
            { p: '<strong>Are student answers stored?</strong> No. Everything lives in the server’s memory and is erased after the session — which is why downloading matters.' },
            { p: '<strong>A student lost their connection.</strong> They reopen the link and come back with the same name and points, as long as the session is still running.' },
            { p: '<strong>Some of my students do not read Arabic.</strong> The whole app is bilingual (Arabic/English): your panel, the editor, the analytics, the reports, the student pages and this guide. Switch your language with the “EN/AR” button at the top of the page before you launch the activity.' },
            { p: '<strong>Which language do students see the activity in?</strong> <strong>Yours, at the moment you launch.</strong> If your panel is in English every participant sees the activity in English and in LTR even if their browser is Arabic, and the other way round — and the projector screen follows the activity too. So if you want an English activity, switch your language <em>before</em> pressing “Launch”. (This does not change the student’s saved preference for the rest of the site, and your questions stay exactly as you wrote them.)' },
            { p: '<strong>Does a scheduled quiz survive until its time?</strong> Yes — a scheduled session is not swept away for being idle before its opening time, so you can launch it today for a date days away and hand out the code in advance.' },
            { p: '<strong>Can I edit an activity I already launched?</strong> Yes — every activity you launch is saved to “My activities” automatically, and ending the session does not delete it. Edit it or duplicate it and launch it again.' },
            { p: '<strong>What is the difference between free and premium?</strong> All activities, questions and sessions are free and unlimited. Premium unlocks: <strong>designing the activity with AI</strong>, <strong>question images</strong>, and <strong>exporting results to Excel and PDF</strong>.' },
            { actions: true },
          ],
        },
      ],
    },
  };

  function elem(tag, attrs, html) {
    const node = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function listNode(tag, items, tight) {
    const list = elem(tag);
    list.style.cssText = `line-height: ${tight ? '2' : '2.1'}; padding-inline-start: 22px; margin: 0`;
    items.forEach((item) => list.append(elem('li', null, item)));
    return list;
  }

  function tableNode(spec) {
    const head = elem('tr');
    spec.head.forEach((cell) => head.append(elem('th', null, cell)));
    const body = elem('tbody');
    spec.rows.forEach((row) => {
      const tr = elem('tr');
      row.forEach((cell) => tr.append(elem('td', null, cell)));
      body.append(tr);
    });
    const table = elem('table');
    table.append(elem('thead'));
    table.querySelector('thead').append(head);
    table.append(body);
    const wrap = elem('div', { class: 'table-wrap' });
    wrap.append(table);
    return wrap;
  }

  /** أزرار الاشتراك أسفل الأسئلة الشائعة — الرقم والسعر يأتيان من الخادم */
  function actionsNode(copy) {
    const row = elem('div', { class: 'row', style: 'margin-top: 4px' });
    const wa = elem('a', {
      class: 'btn primary',
      id: 'waLink',
      href: 'https://wa.me/970597034066',
      target: '_blank',
      rel: 'noopener',
    });
    wa.textContent = copy.waButton;
    const start = elem('a', { class: 'btn ghost', href: '/host.html' });
    start.textContent = copy.startNow;
    row.append(wa, start);
    return row;
  }

  function blockNode(block, copy) {
    if (block.p) return elem('p', { style: 'margin: 0' }, block.p);
    if (block.muted) return elem('p', { class: 'muted small', style: 'margin: 0' }, block.muted);
    if (block.note) return elem('div', { class: 'note small' + (block.tone ? ' ' + block.tone : '') }, block.note);
    if (block.h3) return elem('h3', { style: 'margin: 6px 0 0' }, block.h3);
    if (block.ul) return listNode('ul', block.ul, true);
    if (block.ol) return listNode('ol', block.ol, false);
    if (block.table) return tableNode(block.table);
    if (block.actions) return actionsNode(copy);
    return null;
  }

  /** يرسم الدليل كاملاً باللغة الحالية */
  function render(root) {
    const lang = global.I18n && global.I18n.getLang() === 'en' ? 'en' : 'ar';
    const copy = GUIDE[lang];

    document.title = copy.docTitle;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', copy.metaDescription);
    document.querySelectorAll('[data-nav="new"]').forEach((n) => (n.textContent = copy.navNew));
    document.querySelectorAll('[data-nav="home"]').forEach((n) => (n.textContent = copy.navHome));

    root.innerHTML = '';
    root.append(elem('h1', null, copy.pageTitle));
    root.append(elem('p', { class: 'muted' }, copy.intro));

    // فهرس سريع: الصفحة طويلة عمداً، فليصل المعلّم لما يريده بنقرة
    const toc = elem('div', { class: 'card stack' });
    toc.append(elem('h2', { style: 'margin: 0' }, copy.tocTitle));
    const tocRow = elem('div', { class: 'row' });
    copy.sections.forEach((section) => {
      const link = elem('a', { class: 'btn ghost sm', href: '#' + section.id });
      link.textContent = section.toc;
      tocRow.append(link);
    });
    toc.append(tocRow);
    root.append(toc);

    copy.sections.forEach((section) => {
      const card = elem('div', { class: 'card stack', id: section.id });
      card.append(elem('h2', { style: 'margin: 0' }, section.title));
      section.blocks.forEach((block) => {
        const node = blockNode(block, copy);
        if (node) card.append(node);
      });
      root.append(card);
    });

    root.append(elem('p', { class: 'footer' }, copy.footer));

    // رقم الواتساب والسعر من الخادم كي يبقى الدليل مطابقاً للإعدادات
    global.T.api('/api/auth/me')
      .then((data) => {
        const plan = data.premium?.plan;
        const link = document.getElementById('waLink');
        if (!plan || !link) return;
        link.href = `https://wa.me/${plan.whatsapp}?text=${encodeURIComponent(
          copy.waMessage.replace('{price}', plan.priceUsd)
        )}`;
        link.textContent = copy.waButtonPriced.replace('{price}', plan.priceUsd);
      })
      .catch(() => {});
  }

  global.Help = { render, GUIDE };
})(window);
