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
      homeResumeBtn: 'استئناف: {title}',
      homeWhyTitle: 'لماذا Tapio؟',
      homeWhy1: 'خفيف وسريع على الجوال — بلا تطبيق وبلا تسجيل.',
      homeWhy2: 'اسم أو كنية + أفاتار عشوائي، أو دخول مجهول تماماً للاستطلاعات.',
      homeWhy3: 'لوحة تحكم مباشرة: تقدّم المشاركين، نسب الإجابة، والترتيب.',
      homeWhy4: 'التخزين مؤقت في الذاكرة فقط — لا تُحفظ نتائج المشاركين.',
      homeFooter: 'التخزين مؤقت: تُحذف الجلسة تلقائياً بعد انتهائها أو عند خمولها.',
      homeCodeError: 'أدخل رمزاً من ٦ أرقام',

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
      homeResumeBtn: 'Resume: {title}',
      homeWhyTitle: 'Why Tapio?',
      homeWhy1: 'Light and fast on mobile — no app, no signup.',
      homeWhy2: 'A name or nickname + random avatar, or fully anonymous entry for polls.',
      homeWhy3: 'A live dashboard: participant progress, response rates, and rankings.',
      homeWhy4: 'Storage is temporary, in memory only — participant results are never saved.',
      homeFooter: 'Storage is temporary: the session is deleted automatically once it ends or goes idle.',
      homeCodeError: 'Enter a 6-digit code',

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
