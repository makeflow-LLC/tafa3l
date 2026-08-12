/**
 * محرّك اللغتين — عربي/إنجليزي. كشف تلقائي حسب لغة متصفح المستخدم، مع إمكانية
 * التبديل يدوياً وحفظ الاختيار. يُحمَّل أولاً في <head> ليضبط اتجاه الصفحة
 * (rtl/ltr) قبل أي رسم، فلا يظهر «ومضة» اتجاه خاطئ.
 *
 * ترحّل الصفحات إلى هذا المحرّك تدريجياً — إن لم تحمّل صفحة هذا الملف تبقى
 * عربية RTL كما كانت، بلا أي تغيير في سلوكها.
 */
(function (global) {
  'use strict';

  const LANG_KEY = 'tapio:lang';

  const DICT = {
    ar: {
      // عام — مشترك بين الصفحات
      brand: 'Tapio',
      offlineTitle: '⚠️ الخادم غير متصل — الوضع التجريبي',
      offlineBody1: 'يمكنك تجهيز الأسئلة الآن، لكن بدء جلسة مباشرة يحتاج خادماً يعمل. محلياً: ',
      offlineBody1End: ' ثم ',
      offlineBody2: 'للنشر على الإنترنت استخدم استضافة تشغّل عملية Node دائمة (Render أو Railway أو Fly.io). ',
      offlineBody2End: 'منصات serverless مثل Vercel و Netlify و GitHub Pages تخدم الملفات الثابتة فقط ولا تدعم WebSocket، لذلك لن تعمل الجلسات المباشرة عليها.',
      offlineHint: 'تعذّر الوصول إلى خادم Tapio — هذه الصفحة تُقدَّم كملفات ثابتة فقط. محلياً شغّل «npm start»، وللنشر استخدم استضافة تشغّل Node دائماً (Render أو Railway أو Fly.io) لأن منصات serverless مثل Vercel لا تدعم WebSocket.',
      requestFailed: 'تعذّر تنفيذ الطلب ({status})',
      langToggleToEn: 'English',
      langToggleToAr: 'العربية',

      // الصفحة الرئيسية
      homeTagline: 'أسئلة تفاعلية واستطلاعات حية — بلا حسابات وبلا تخزين دائم',
      homeJoinTitle: 'ادخل إلى نشاط',
      homeCodeLabel: 'رمز الدخول',
      homeCodeAria: 'رمز الدخول المكوّن من ستة أرقام',
      homeJoinBtn: 'دخول',
      homeOrScan: 'أو امسح رمز QR الذي يعرضه المدرب',
      homeTeacherTitle: 'أنت مدرب أو معلم؟',
      homeTeacherBody: 'أنشئ اختباراً أو استطلاعاً خلال دقيقة، اعرض رمز QR لطلابك، وتابع تقدّمهم مباشرة على لوحة التحكم.',
      homeCreateBtn: 'إنشاء نشاط جديد',
      homeDemoBtn: '⚡ تجربة سريعة بضغطة واحدة',
      homeLoginBtn: '🔐 دخول المدرب — احفظ أنشطتك',
      homeMyActivities: '📚 نشاطاتي ({name})',
      homeLogoutBtn: '🚪 تسجيل الخروج',
      homeWelcome: '👋 أهلاً {name}!',
      homeResumeBtn: 'استئناف: {title}',
      homeWhyTitle: 'لماذا Tapio؟',
      homeWhy1: 'خفيف وسريع على الجوال — بلا تطبيق وبلا تسجيل.',
      homeWhy2: 'اسم أو كنية + أفاتار عشوائي، أو دخول مجهول تماماً للاستطلاعات.',
      homeWhy3: 'لوحة تحكم مباشرة: تقدّم المشاركين، نسب الإجابة، والترتيب.',
      homeWhy4: 'التخزين مؤقت في الذاكرة فقط — لا تُحفظ نتائج المشاركين.',
      homeFooter: 'التخزين مؤقت: تُحذف الجلسة تلقائياً بعد انتهائها أو عند خمولها.',
      homeCodeError: 'أدخل رمزاً من ٦ أرقام',
      // ---------------------------------------------- شاشة المشارك (play)
      pJoinTitle: 'ابدأ المشاركة',
      pNameLabel: 'اسمك أو كنيتك',
      pNamePlaceholder: 'مثال: أبو محمد',
      pNameHint: 'اكتب اسمك أو كنيتك، وسنمنحك أفاتاراً عشوائياً.',
      pAnonHint: 'هذا استطلاع مجهول — لا حاجة لاسمك، إجابتك لن تُنسب إليك.',
      pNameShort: 'اكتب اسماً من حرفين على الأقل',
      pAvatarBtn: '🎲 أفاتار آخر',
      pJoinBtn: 'انضمام',
      pConnecting: 'جارٍ الاتصال',
      pConnected: 'متصل',
      pDisconnected: 'انقطع الاتصال',
      pNoConnection: 'لا يوجد اتصال، حاول بعد لحظات',
      pNoConnectionRetry: 'لا يوجد اتصال — حاول مجدداً',
      pSessionNotFound: 'لم نعثر على الجلسة',
      pCheckCode: 'تأكد من الرمز أو اسأل المدرب.',
      pBackHome: 'العودة للصفحة الرئيسية',
      pSessionEnded: 'انتهت الجلسة',
      pRejoinHint: 'يمكنك الدخول مجدداً برمز الجلسة.',
      pKicked: 'تم إخراجك من الجلسة',
      pLeaveConfirm: 'هل تريد الخروج من النشاط؟ ستفقد نقاطك ولن تعود إلا بالدخول من جديد.',
      pWaitHost: 'أنت في القاعة، انتظر بدء المدرب…',
      pWaitAuto: 'سيبدأ النشاط وينتقل تلقائياً',
      pWaitSelf: 'وضع حر — لكن المدرب اختار أن يبدأ الجميع معاً',
      pKeepOpen: 'أبقِ هذه الصفحة مفتوحة. إن انقطع الاتصال سنعيد وصلك تلقائياً.',
      pKeepOpenLive: 'أبقِ الصفحة مفتوحة — تتحدّث تلقائياً.',
      pParticipants: '👥 {count} مشارك',
      pStartsIn: '⏰ يبدأ الاختبار بعد',
      pEndsIn: '⏳ ينتهي الاختبار خلال',
      pGetReady: 'استعد… ينطلق الجميع معاً',
      pQuestionOf: 'سؤال {index} من {total}',
      pSend: 'إرسال',
      pSendAnswer: 'إرسال الإجابة',
      pSendCheck: 'إرسال ✓',
      pPickAll: 'اختر كل الإجابات الصحيحة ثم أرسل',
      pOneWord: 'كلمة واحدة…',
      pWriteAnswer: 'اكتب إجابتك…',
      pWriteFirst: 'اكتب إجابتك أولاً',
      pFillFirst: 'املأ الفراغ أولاً',
      pFillBlank: '✏️ أكمل الفراغ',
      pQuestionImage: 'صورة السؤال',
      pSliderAria: 'اسحب لاختيار قيمة بين {min} و {max}',
      pReceived: 'تم استلام إجابتك',
      pTimeUp: 'انتهى وقتك على هذا السؤال',
      pCorrect: 'إجابة صحيحة!',
      pWrong: 'إجابة غير صحيحة',
      pCorrectFull: 'إجابة صحيحة كاملة!',
      pPartial: 'علامة جزئية',
      pGradedByHost: 'صحّحها المدرب',
      pPendingGrade: 'وصلت إجابتك — بانتظار تصحيح المدرب',
      pPendingHint: 'العلامة القصوى {max} · ستظهر نتيجتك فور تصحيحها',
      pPointsOf: '{points} من {max}',
      pPlusPoints: '+{points} نقطة',
      pStreakX: '🔥 مضاعف ×{x}',
      pStreakRow: '{n} إجابات متتالية!',
      pWaitOthers: 'انتظر بقية المشاركين…',
      pWaitHostNext: 'في انتظار المدرب للانتقال…',
      pWaitNextQuestion: 'في انتظار السؤال التالي…',
      pNextQuestion: 'السؤال التالي ⟨',
      pFinishBtn: '🏁 إنهاء',
      pKeepGoing: 'لا بأس — تابع إلى التالي!',
      pNoAnswersYet: 'لا توجد إجابات بعد',
      pCorrectAnswer: '✓ الإجابة الصحيحة',
      pReactionsTitle: 'أرسل تفاعلك للشاشة 👇',
      pReactionAria: 'تفاعل {emoji}',
      pRankBadge: 'المركز {rank} من {of}',
      pRankUp: '⬆ صعدت',
      pRankDown: '⬇ نزلت',
      pLeaderboard: '🏆 الترتيب',
      pTopBoard: '🏆 الأوائل',
      pTeamBoard: '🏳️ ترتيب الفرق',
      pBadges: '🏅 أوسمتك',
      pActivityEnded: 'انتهى النشاط',
      pGradingNow: 'انتهى النشاط — المدرب يصحّح إجابتك الآن',
      pGradingOne: 'إجابة نصّية واحدة تنتظر التصحيح — ستظهر نتيجتك وبطاقتك فور انتهائه.',
      pGradingMany: '{n} إجابات نصّية تنتظر التصحيح — ستظهر نتيجتك وبطاقتك فور انتهائه.',
      pThanks: 'شكراً لمشاركتك! لم تُحفظ أي بيانات — كل شيء مؤقت.',
      pThanksShort: 'شكراً لمشاركتك!',
      pScoreBadge: '⭐ {score} نقطة',
      pCardTitle: '📤 بطاقة نتيجتك',
      pCardHint: 'شاركها على واتساب أو أي منصة — أو احفظها للذكرى',
      pCardShare: '📤 مشاركة البطاقة',
      pCardSave: '⬇ حفظ الصورة',
      pCardWhatsapp: '🟢 واتساب',
      pCardCopy: '📋 نسخ النص',
      pCopied: 'نُسخ النص — ألصقه أينما تريد',
      pCopyFailed: 'تعذّر النسخ',
      pCardFile: 'tapio-نتيجتي.png',
      pCardShareTitle: 'نتيجتي في Tapio',
      pCardCaption: 'بطاقة نتيجتي في Tapio',
      pCardMadeWith: 'صُنعت على منصة Tapio — أسئلة واستطلاعات حية',
      pCardCode: 'رمز الجلسة: ',
      pCardNoData: ' · لا تُحفظ بياناتك — كل شيء مؤقت.',
      pDefaultTitle: 'نشاط تفاعلي',
      pLevelChampion: 'بطل الجلسة',
      pLevelLegend: 'أسطورة',
      pLevelPro: 'محترف',
      pLevelSkilled: 'متمكّن',
      pLevelPromising: 'واعد — القادم أفضل',
      pLevelActive: 'مشارك متفاعل',
      pFirst: 'المركز الأول',
      pSecond: 'المركز الثاني',
      pThird: 'المركز الثالث',
      pYourAnswer: 'إجابتك',
      pRankDelta: '{dir} {n} مركزاً',
      pctSuffix: '٪',
      typeMc: 'اختيار من متعدد',
      typeTruefalse: 'صح / خطأ',
      typePoll: 'استطلاع رأي',
      typeWord: 'سحابة كلمات',
      typeScale: 'مقياس',
      typeOpen: 'إجابة مفتوحة',
      typeBlank: 'أكمل الفراغ',
      sFullscreen: 'ملء الشاشة',
      pOfParticipants: 'من {of} مشارك',
      pAmongParticipants: 'من بين {of} مشاركاً',
      pBlankAria: 'الفراغ {n}',
      pAverage: 'المتوسط: {value}',
      pWonBanner: '{emblem} حصلت على {banner}',
      pWonLevel: '{emoji} حصلت على لقب «{label}»',
      pShareLine: '{lead} في «{title}» على منصة Tapio{perf} 🎊',
      pLeaveTitle: 'الخروج من النشاط',
      pSoundTitle: 'الصوت',
      pSoundAria: 'تشغيل أو كتم الصوت',


      // ---------------------------------------------- شاشة العرض (screen)
      sInvalidLink: 'رابط شاشة غير صالح',
      sOpenFromHost: 'افتح هذه الشاشة من زر «🖥️ شاشة العرض» داخل لوحة المدرب.',
      sScanToJoin: 'امسح رمز QR للانضمام',
      sQrFailed: 'تعذّر توليد QR',
      sWaitingPeople: 'بانتظار انضمام المشاركين…',
      sConnected: '🟢 متصل',
      sOffline: '🔴 منقطع',
      sFullscreenFailed: 'تعذّر تفعيل ملء الشاشة',
      sNoAnswersYet: 'لا توجد إجابات بعد…',
      sNoAnswersQuestion: 'لا توجد إجابات على هذا السؤال بعد…',
      sNoResults: 'لا توجد نتائج بعد',
      sWhoIsWhere: 'من وصل إلى أين؟',
      sSelfPaced: '🏃 وضع حر — كل متدرب بسرعته',
      sFinishedOf: 'أنهى {done} من {total}',
      sPodium: '🏆 منصة التتويج',
      sRestOfBoard: 'بقية الترتيب',
      sAwards: '🏅 الأوسمة',
      sSessionOver: '👋 انتهت الجلسة',
      sAverage: 'المتوسط: ',
      sQuestionResults: 'نتائج السؤال {index}',
      sAnsweredOf: 'أجاب {answered} من {total}',
      sPeopleCount: 'المشاركون ({count})',
      sTypedQuestion: '{emoji} سؤال {index} من {total}',
      sTypedQuestionFull: '{emoji} {label} — سؤال {index} من {total}',


      // صفحة الدخول
      loginBackHome: '🏠 الرئيسية',
      loginWelcome: 'أهلاً {name}',
      loginMyActivities: '📚 نشاطاتي',
      loginNewActivity: '➕ نشاط جديد',
      loginLogout: 'تسجيل الخروج',
      loginTitle: 'دخول المدرب',
      loginSubtitle: 'الحساب يحفظ أنشطتك لتعيد فتحها وإطلاقها متى شئت. نتائج الطلاب تبقى مؤقتة ولا تُحفظ.',
      loginGoogleBtn: 'متابعة عبر جوجل',
      loginNotConfiguredTitle: '⚠️ تسجيل الدخول عبر جوجل غير مُفعّل بعد',
      loginNotConfiguredBody: 'اضبط GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET على الخادم.',
      loginFooter: 'يمكنك أيضاً استخدام Tapio بلا حساب — لكن أنشطتك لن تُحفظ لإعادة استخدامها.',
    },
    en: {
      brand: 'Tapio',
      offlineTitle: '⚠️ Server offline — demo mode',
      offlineBody1: 'You can prepare questions now, but starting a live session needs a running server. Locally: ',
      offlineBody1End: ' then ',
      offlineBody2: 'To deploy, use a host that runs a persistent Node process (Render, Railway, or Fly.io). ',
      offlineBody2End: 'Serverless platforms like Vercel, Netlify, and GitHub Pages only serve static files and do not support WebSocket, so live sessions will not work there.',
      offlineHint: "Couldn't reach the Tapio server — this page is being served as static files only. Locally run \"npm start\"; to deploy, use a host that runs Node persistently (Render, Railway, or Fly.io) since serverless platforms like Vercel don't support WebSocket.",
      requestFailed: 'Request failed ({status})',
      langToggleToEn: 'English',
      langToggleToAr: 'العربية',

      homeTagline: 'Live interactive quizzes & polls — no accounts, no permanent storage',
      homeJoinTitle: 'Join an activity',
      homeCodeLabel: 'Join code',
      homeCodeAria: 'Six-digit join code',
      homeJoinBtn: 'Join',
      homeOrScan: 'Or scan the QR code shown by the host',
      homeTeacherTitle: 'Are you a teacher or trainer?',
      homeTeacherBody: 'Build a quiz or poll in a minute, show your students a QR code, and follow their progress live on your dashboard.',
      homeCreateBtn: 'Create a new activity',
      homeDemoBtn: '⚡ One-click quick demo',
      homeLoginBtn: '🔐 Teacher login — save your activities',
      homeMyActivities: '📚 My activities ({name})',
      homeLogoutBtn: '🚪 Sign out',
      homeWelcome: '👋 Welcome back, {name}!',
      homeResumeBtn: 'Resume: {title}',
      homeWhyTitle: 'Why Tapio?',
      homeWhy1: 'Light and fast on mobile — no app, no signup.',
      homeWhy2: 'A name or nickname + random avatar, or fully anonymous entry for polls.',
      homeWhy3: 'A live dashboard: participant progress, response rates, and rankings.',
      homeWhy4: 'Storage is temporary, in memory only — participant results are never saved.',
      homeFooter: 'Storage is temporary: the session is deleted automatically once it ends or goes idle.',
      homeCodeError: 'Enter a 6-digit code',
      // ---------------------------------------------- player screen
      pJoinTitle: 'Join the activity',
      pNameLabel: 'Your name or nickname',
      pNamePlaceholder: 'e.g. Sara',
      pNameHint: 'Type your name or nickname and we will give you a random avatar.',
      pAnonHint: 'This is an anonymous poll — no name needed, your answer stays unattributed.',
      pNameShort: 'Type a name of at least two letters',
      pAvatarBtn: '🎲 Another avatar',
      pJoinBtn: 'Join',
      pConnecting: 'Connecting',
      pConnected: 'Connected',
      pDisconnected: 'Disconnected',
      pNoConnection: 'No connection, try again in a moment',
      pNoConnectionRetry: 'No connection — try again',
      pSessionNotFound: 'Session not found',
      pCheckCode: 'Check the code or ask your teacher.',
      pBackHome: 'Back to home',
      pSessionEnded: 'Session ended',
      pRejoinHint: 'You can join again with the session code.',
      pKicked: 'You were removed from the session',
      pLeaveConfirm: 'Leave the activity? You will lose your points and must join again.',
      pWaitHost: 'You are in the lobby, waiting for the teacher to start…',
      pWaitAuto: 'The activity will start and advance automatically',
      pWaitSelf: 'Self-paced — but the teacher chose to start everyone together',
      pKeepOpen: 'Keep this page open. If the connection drops we will reconnect you automatically.',
      pKeepOpenLive: 'Keep this page open — it updates automatically.',
      pParticipants: '👥 {count} participants',
      pStartsIn: '⏰ The quiz starts in',
      pEndsIn: '⏳ The quiz ends in',
      pGetReady: 'Get ready… everyone starts together',
      pQuestionOf: 'Question {index} of {total}',
      pSend: 'Send',
      pSendAnswer: 'Send answer',
      pSendCheck: 'Send ✓',
      pPickAll: 'Pick every correct answer, then send',
      pOneWord: 'One word…',
      pWriteAnswer: 'Write your answer…',
      pWriteFirst: 'Write your answer first',
      pFillFirst: 'Fill in the blank first',
      pFillBlank: '✏️ Fill in the blank',
      pQuestionImage: 'Question image',
      pSliderAria: 'Drag to pick a value between {min} and {max}',
      pReceived: 'Your answer was received',
      pTimeUp: 'Time is up for this question',
      pCorrect: 'Correct answer!',
      pWrong: 'Incorrect answer',
      pCorrectFull: 'Fully correct!',
      pPartial: 'Partial credit',
      pGradedByHost: 'Graded by your teacher',
      pPendingGrade: 'Answer received — waiting for your teacher to grade it',
      pPendingHint: 'Out of {max} · your score appears as soon as it is graded',
      pPointsOf: '{points} of {max}',
      pPlusPoints: '+{points} points',
      pStreakX: '🔥 Multiplier ×{x}',
      pStreakRow: '{n} correct in a row!',
      pWaitOthers: 'Waiting for the others…',
      pWaitHostNext: 'Waiting for the teacher to move on…',
      pWaitNextQuestion: 'Waiting for the next question…',
      pNextQuestion: 'Next question ⟩',
      pFinishBtn: '🏁 Finish',
      pKeepGoing: 'No worries — on to the next one!',
      pNoAnswersYet: 'No answers yet',
      pCorrectAnswer: '✓ Correct answer',
      pReactionsTitle: 'Send a reaction to the screen 👇',
      pReactionAria: 'React {emoji}',
      pRankBadge: 'Rank {rank} of {of}',
      pRankUp: '⬆ Moved up',
      pRankDown: '⬇ Moved down',
      pLeaderboard: '🏆 Leaderboard',
      pTopBoard: '🏆 Top scores',
      pTeamBoard: '🏳️ Team standings',
      pBadges: '🏅 Your badges',
      pActivityEnded: 'Activity finished',
      pGradingNow: 'Activity finished — your teacher is grading your answer',
      pGradingOne: 'One written answer is waiting to be graded — your score and card appear right after.',
      pGradingMany: '{n} written answers are waiting to be graded — your score and card appear right after.',
      pThanks: 'Thanks for taking part! Nothing was stored — everything is temporary.',
      pThanksShort: 'Thanks for taking part!',
      pScoreBadge: '⭐ {score} points',
      pCardTitle: '📤 Your result card',
      pCardHint: 'Share it on WhatsApp or anywhere — or keep it as a memento',
      pCardShare: '📤 Share card',
      pCardSave: '⬇ Save image',
      pCardWhatsapp: '🟢 WhatsApp',
      pCardCopy: '📋 Copy text',
      pCopied: 'Text copied — paste it anywhere',
      pCopyFailed: 'Copy failed',
      pCardFile: 'tapio-my-result.png',
      pCardShareTitle: 'My Tapio result',
      pCardCaption: 'My result card on Tapio',
      pCardMadeWith: 'Made with Tapio — live quizzes and polls',
      pCardCode: 'Session code: ',
      pCardNoData: ' · your data is never stored — everything is temporary.',
      pDefaultTitle: 'Interactive activity',
      pLevelChampion: 'Session champion',
      pLevelLegend: 'Legend',
      pLevelPro: 'Pro',
      pLevelSkilled: 'Skilled',
      pLevelPromising: 'Promising — next time is yours',
      pLevelActive: 'Active participant',
      pFirst: '1st place',
      pSecond: '2nd place',
      pThird: '3rd place',
      pYourAnswer: 'Your answer',
      pRankDelta: '{dir} {n} places',
      pctSuffix: '%',
      typeMc: 'Multiple choice',
      typeTruefalse: 'True / False',
      typePoll: 'Poll',
      typeWord: 'Word cloud',
      typeScale: 'Scale',
      typeOpen: 'Open answer',
      typeBlank: 'Fill in the blank',
      sFullscreen: 'Fullscreen',
      pOfParticipants: 'of {of} participants',
      pAmongParticipants: 'among {of} participants',
      pBlankAria: 'Blank {n}',
      pAverage: 'Average: {value}',
      pWonBanner: '{emblem} You earned {banner}',
      pWonLevel: '{emoji} You earned the title «{label}»',
      pShareLine: '{lead} in «{title}» on Tapio{perf} 🎊',
      pLeaveTitle: 'Leave the activity',
      pSoundTitle: 'Sound',
      pSoundAria: 'Turn sound on or off',


      // ---------------------------------------------- projector screen
      sInvalidLink: 'Invalid screen link',
      sOpenFromHost: 'Open this screen from the «🖥️ Projector screen» button in the teacher panel.',
      sScanToJoin: 'Scan the QR code to join',
      sQrFailed: 'Could not generate the QR code',
      sWaitingPeople: 'Waiting for participants to join…',
      sConnected: '🟢 Connected',
      sOffline: '🔴 Offline',
      sFullscreenFailed: 'Could not enter fullscreen',
      sNoAnswersYet: 'No answers yet…',
      sNoAnswersQuestion: 'No answers to this question yet…',
      sNoResults: 'No results yet',
      sWhoIsWhere: 'Who is where?',
      sSelfPaced: '🏃 Self-paced — everyone at their own speed',
      sFinishedOf: '{done} of {total} finished',
      sPodium: '🏆 Podium',
      sRestOfBoard: 'Rest of the ranking',
      sAwards: '🏅 Badges',
      sSessionOver: '👋 Session over',
      sAverage: 'Average: ',
      sQuestionResults: 'Question {index} results',
      sAnsweredOf: '{answered} of {total} answered',
      sPeopleCount: 'Participants ({count})',
      sTypedQuestion: '{emoji} Question {index} of {total}',
      sTypedQuestionFull: '{emoji} {label} — question {index} of {total}',


      loginBackHome: '🏠 Home',
      loginWelcome: 'Welcome, {name}',
      loginMyActivities: '📚 My activities',
      loginNewActivity: '➕ New activity',
      loginLogout: 'Log out',
      loginTitle: 'Teacher login',
      loginSubtitle: 'Your account saves your activities so you can reopen and launch them anytime. Student results stay temporary and are never saved.',
      loginGoogleBtn: 'Continue with Google',
      loginNotConfiguredTitle: '⚠️ Google login is not enabled yet',
      loginNotConfiguredBody: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.',
      loginFooter: 'You can also use Tapio without an account — but your activities won’t be saved for reuse.',
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch {
      /* الوضع الخاص قد يمنع التخزين */
    }
    const raw = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    const langs = raw.map((l) => String(l).toLowerCase());
    if (langs.some((l) => l.startsWith('en'))) return 'en';
    if (langs.some((l) => l.startsWith('ar'))) return 'ar';
    return 'ar'; // السوق الأساسي عربي، فهو الافتراضي عند لغة متصفح غير معروفة
  }

  let current = detect();

  function apply() {
    document.documentElement.lang = current;
    document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
  }
  apply();

  function t(key, vars) {
    let text = (DICT[current] && DICT[current][key]) ?? DICT.ar[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) text = text.replace('{' + k + '}', v);
    }
    return text;
  }

  function getLang() {
    return current;
  }

  function setLang(lang) {
    if (lang !== 'ar' && lang !== 'en') return;
    current = lang;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* تجاهل */
    }
    apply();
  }

  /** يضيف زر تبديل اللغة إلى حاوية — يعيد تحميل الصفحة عند الضغط لإعادة رسم كل شيء */
  function mountToggle(container) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn lang-btn';
    btn.type = 'button';
    const label = current === 'ar' ? t('langToggleToEn') : t('langToggleToAr');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.textContent = current === 'ar' ? 'EN' : 'AR';
    btn.addEventListener('click', () => {
      setLang(current === 'ar' ? 'en' : 'ar');
      location.reload();
    });
    container.append(btn);
    return btn;
  }

  global.I18n = { t, getLang, setLang, mountToggle };
})(window);
