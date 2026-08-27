/* لوحة المدرب — إنشاء النشاط، إدارة العرض المباشر، والإحصاءات */
(function () {
  'use strict';

  const { $, firstName: baseFirstName, el, avatarNode, toast, api, connect, store, TYPE_LABELS, TYPE_EMOJI, fmtMs, fmtLeft, countdownTo, serverAlive, showOfflineBanner, shrinkImage, copyLink, fitCover, gradeChips } =
    window.T;
  const Fx = window.Fx;
  // اختصار الترجمة — إن غاب المحرّك نعرض المفتاح بدل الانهيار
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const SUBJECTS = (window.I18n && window.I18n.SUBJECTS) || [];
  const GRADES = (window.I18n && window.I18n.GRADES) || [];
  /** لغة التنسيق للتواريخ والأرقام */
  const loc = () => (window.I18n && window.I18n.getLang() === 'en' ? 'en' : 'ar');

  /*
   * اللغة والسِمَة كلتاهما في الشريط، لا داخل القائمة.
   *
   * كانتا مفترقتين: `EN` ظاهرٌ في الشريط ومبدّل السِمَة مدفونٌ في قائمة
   * النقاط الثلاث — بينما تعرضهما كل صفحةٍ أخرى (الرئيسية، الدخول، الدليل،
   * الألعاب…) جنباً إلى جنب. فبدا للمعلّم أن الوضع الداكن «اختفى» من صفحاته
   * الداخلية وحدها. مبدّلان متجاوران في كل صفحة: قاعدةٌ واحدة لا استثناء.
   */
  if (window.I18n && $('#langRow')) window.I18n.mountToggle($('#langRow'));
  if ($('#langRow')) {
    window.Theme?.mountToggle($('#langRow'), {
      toDark: window.I18n?.t('themeToDark'),
      toLight: window.I18n?.t('themeToLight'),
    });
  }

  const app = $('#app');
  const bar = $('#bar');
  const connBadge = $('#conn');
  const codeBadge = $('#codeBadge');

  const HOSTS_KEY = 'tafa3l:hosts';
  const EDITING_KEY = 'tafa3l:host:editingActivity';

  const state = {
    // كم صفَّ تصحيحٍ فُتح في كل سؤال — ينجو من إعادة الرسم
    gradeShown: new Map(),
    code: null,
    hostToken: null,
    socket: null,
    live: null, // آخر حالة من الخادم
    dashboard: null,
    tab: 'stage',
    tickTimer: null,
    joinUrl: '',
    cancelCountdown: null,
    lastPhaseKey: '',
    selfQuestion: 0, // السؤال المعروض في الوضع الحر
    leavingIntentionally: false, // خروج مقصود عبر أزرار التنقل
    user: null, // المدرب المسجّل، أو null للاستخدام بلا حساب
    durable: null, // هل تخزين الحسابات دائم على هذا الخادم
    premium: null, // { isPremium, isAdmin, premiumUntil, plan }
    editingActivityId: store.local.get(EDITING_KEY, null), // النشاط المحفوظ الجاري تعديله — يبقى بعد تحديث الصفحة
    dashOpenQ: null, // سؤال مفتوح النتائج في جدول لوحة التحكم
    stopSchedule: null, // عدّاد موعد الفتح
    stopDeadline: null, // عدّاد انتهاء مدة الاختبار
    analyticsData: null, // ملف النتائج الكامل الذي تُبنى منه الرسوم والتوصيات
    analyticsLoading: false,
    analyticsError: null,
    clockOffset: 0, // فرق ساعة المتصفح عن ساعة الخادم، يُلتقط عند وصول الرسالة
  };

  /** توقيت الخادم الآن كما نقدّره محلياً */
  function serverTime() {
    return Date.now() - state.clockOffset;
  }

  /** يثبّت النشاط الجاري تعديله في المتصفح حتى لا يتكرر النشاط مع كل إطلاق */
  function setEditingActivity(id) {
    state.editingActivityId = id || null;
    if (id) store.local.set(EDITING_KEY, id);
    else store.local.set(EDITING_KEY, null);
  }

  // -------------------------------------------------------------- التوجيه

  function route() {
    const hash = location.hash.slice(1) || '/';
    const match = hash.match(/^\/live\/(\d{6})$/);
    if (match) return openLive(match[1]);
    if (hash === '/demo') return startDemo();
    if (hash === '/mine') return openMyActivities();
    if (hash === '/library') return openLibrary();
    if (hash === '/games') return openMyGames();
    if (hash === '/contests') return openMyContests();
    if (hash === '/profile') return openProfile();
    const lib = hash.match(/^\/library\/([\w-]+)$/);
    if (lib) return openLibraryItem(lib[1]);
    if (hash === '/ai') return openAiDesigner();
    if (hash === '/game-ai') return openGameBuilder();
    if (hash === '/new') return openBuilder();
    if (hash === '/upgrade') return openUpgrade();
    if (hash === '/admin') return openAdmin();
    const edit = hash.match(/^\/edit\/([\w-]+)$/);
    if (edit) return openSavedActivity(edit[1]);
    return openStart();
  }

  // ------------------------------------------------------- حساب المدرب

  /** يجلب المستخدم الحالي مرة واحدة ويحدّث الشريط العلوي */
  async function loadAccount() {
    try {
      const data = await api('/api/auth/me');
      state.user = data.user || null;
      state.durable = data.durable;
      state.premium = data.premium || null;
    } catch {
      state.user = null;
      state.premium = null;
    }
    paintAccount();
    return state.user;
  }

  /**
   * الشريط العلوي: صورة المعلّم واسمه في طرف، والشعار ورمز اللغة في الطرف
   * الآخر، وكل ما عداهما في قائمةٍ من سطورٍ كاملة العرض.
   *
   * البريد ليس سطراً يُضغط بل تعريفٌ بالحساب، فيُعرض مرّة في رأس القائمة.
   */
  function paintAccount() {
    const who = $('#whoLink');
    const avatar = $('#whoAvatar');
    const name = $('#whoName');
    if (who && avatar && name) {
      who.hidden = !state.user;
      if (state.user) {
        who.title = `${state.user.name} · ${state.user.email}`;
        who.setAttribute('aria-label', t('profNav'));
        avatar.replaceChildren(
          state.user.hasPhoto
            ? el('img', { src: '/api/teachers/' + state.user.id + '/photo', alt: '' })
            : el('span', { text: (firstName(state.user.name) || '').charAt(0) || '👤' })
        );
        name.textContent = firstName(state.user.name);
      }
    }

    const UI = window.TapioUI;
    const menu = $('#hostMenu');
    if (!menu || !UI) return;
    menu.replaceChildren();
    const sep = UI.MenuSep;

    if (state.user) {
      menu.append(UI.MenuAccount({ name: state.user.name, mail: state.user.email }));
      menu.append(sep());
    }

    // تنقّل — الألعاب منها: الصفحات الداخلية لا تعرض شريط الشرائح، فبلا
    // سطرٍ هنا لا يبقى للمعلّم طريقٌ إلى قسم الألعاب من بروفايله أو باقاته
    /*
     * «الرئيسية» تعني الصفحة الرئيسية للموقع، لا رئيسية اللوحة.
     *
     * كانت تذهب إلى ‎#/‎ — أي إلى داخل اللوحة نفسها — فمن أراد الخروج إلى
     * الموقع لم يجد سطراً يخرجه، ومن ضغطها ظنّاً أنها تُخرجه بقي مكانه.
     * فصارت سطرين: «الرئيسية» إلى الموقع، و«لوحتي» إلى ما كانت تذهب إليه.
     */
    menu.append(UI.MenuRow({ label: t('hhome'), href: '/' }));
    menu.append(UI.MenuRow({ label: t('hDashboard'), href: '#/' }));
    menu.append(UI.MenuRow({ label: t('hmyActivities'), href: '#/mine' }));
    menu.append(UI.MenuRow({ label: t('lNav'), href: '#/library' }));
    menu.append(UI.MenuRow({ label: t('gNav'), href: '/games.html' }));
    menu.append(UI.MenuRow({ label: t('gbNav'), href: '#/game-ai' }));
    menu.append(UI.MenuRow({ label: t('ctNav'), href: '#/contests' }));
    menu.append(UI.MenuRow({ label: t('hteacherGuide'), href: '/help.html', title: t('hteacherGuideTip') }));

    // إعدادات — السِمَة ليست هنا بل في الشريط بجوار EN، فلا يُبنى مبدّلان
    // لأمرٍ واحد: مبدّلٌ مرئيٌّ دائماً خيرٌ من آخر مخبوءٍ يكرّره
    menu.append(sep());
    menu.append(
      UI.MenuToggle(
        t('hsound'),
        () => (Fx.soundOn() ? t('hSoundOn') : t('hSoundOff')),
        () => Fx.setSound(!Fx.soundOn())
      )
    );

    // الحساب
    menu.append(sep());
    if (!state.user) {
      menu.append(UI.MenuRow({ label: t('homeLoginShort'), href: '/login.html' }));
      return;
    }
    menu.append(UI.MenuRow({ label: t('profNav'), href: '#/profile' }));
    menu.append(UI.MenuRow({ label: t('upNav'), href: '#/upgrade' }));
    if (state.premium?.isAdmin) menu.append(UI.MenuRow({ label: t('hownerPanel'), href: '#/admin' }));
    menu.append(UI.MenuRow({ label: t('hsignOut'), danger: true, onClick: logout }));
  }

  /** الاسم الأول فقط — الترحيب بالاسم الكامل يبدو رسمياً وطويلاً */
  // ------------------------------------------------------ البداية الموجّهة

  const GUIDE_OFF = 'tafa3l:guide:off';
  const SAW_RESULTS = 'tafa3l:sawResults';

  /** يُعلَّم حين يفتح المعلّم نتائج جلسة فعلاً — آخر خطوةٍ في الدليل */
  function markSawResults() {
    if (!store.local.get(SAW_RESULTS, false)) store.local.set(SAW_RESULTS, true);
  }

  /**
   * دليل الخطوات الأربع لمن دخل أول مرة.
   *
   * ليس جولةً تعليمية تُعرض ثم تُنسى: كل خطوة **تُقاس من حالة الحساب**
   * الحقيقية (له نشاط؟ أطلق جلسة؟ فتح نتائج؟)، فتُشطب وحدها حين تتم،
   * وتختفي البطاقة كلها عند اكتمالها. والمعلّم الذي يعرف طريقه يُخفيها
   * بضغطة، فلا تلاحقه.
   *
   * @returns {HTMLElement|null} null إن اكتملت أو أُخفيت
   */
  function onboardingCard(activityCount, refresh) {
    if (store.local.get(GUIDE_OFF, false)) return null;
    const launched = Object.keys(store.local.get(HOSTS_KEY, {})).length > 0;
    const sawResults = store.local.get(SAW_RESULTS, false);

    const steps = [
      { done: true, title: t('gdAccount'), hint: t('gdAccountHint') },
      {
        done: activityCount > 0,
        title: t('gdDesign'),
        hint: t('gdDesignHint'),
        actions: [
          el('a', { class: 'btn primary sm', href: '#/ai' }, t('gdByAi')),
          el('a', { class: 'btn ghost sm', href: '#/new' }, t('gdByHand')),
        ],
      },
      {
        done: launched,
        title: t('gdLaunch'),
        hint: t('gdLaunchHint'),
        actions: activityCount ? [el('a', { class: 'btn primary sm', href: '#/mine' }, t('gdLaunchNow'))] : null,
      },
      { done: sawResults, title: t('gdResults'), hint: t('gdResultsHint') },
    ];

    if (steps.every((s) => s.done)) return null;
    const at = steps.findIndex((s) => !s.done);

    const list = el('div', { class: 'guide-steps' });
    steps.forEach((step, i) => {
      const current = i === at;
      list.append(
        el('div', { class: 'guide-step' + (step.done ? ' done' : '') + (current ? ' now' : '') }, [
          el('span', { class: 'gs-n', text: step.done ? '✓' : String(i + 1) }),
          el('div', { class: 'stack tight grow' }, [
            el('strong', { text: step.title }),
            // الشرح للخطوة الجارية وحدها: أربعةُ شروحٍ معاً تصير جداراً من نصّ
            current ? el('span', { class: 'muted small', text: step.hint }) : null,
            current && step.actions ? el('div', { class: 'row', style: { gap: '8px', marginTop: '4px' } }, step.actions) : null,
          ]),
        ])
      );
    });

    const hide = el('button', { class: 'btn ghost sm', type: 'button' }, t('gdHide'));
    hide.addEventListener('click', () => {
      store.local.set(GUIDE_OFF, true);
      (refresh || openMyActivities)();
    });

    return el('div', { class: 'card stack', style: { marginBottom: '12px' } }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 }, text: t('gdTitle') }),
        hide,
      ]),
      list,
    ]);
  }

  /** الاسم الأول ومعه بديلٌ مترجم لمن لا اسم له */
  const firstName = (name) => baseFirstName(name, t('hthere'));

  /** تسجيل الخروج من أي صفحة */
  async function logout() {
    if (!confirm(t('hsignOutOfYour'))) return;
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* حتى لو فشل النداء نُنهي الجلسة محلياً */
    }
    state.user = null;
    state.premium = null;
    paintAccount();
    location.href = '/';
  }

  /** لوحة «نشاطاتي»: فتح، إطلاق، حذف */
  /**
   * «نشاطاتي» — القائمة نفسها التي في الرئيسية ببطاقتها نفسها.
   *
   * كانت لهذه الصفحة بطاقةُ نشاطٍ ثانية بتصميمٍ آخر، فصار للفعل الواحد
   * («إطلاق»، «حذف») شكلان يتعلّمهما المعلّم مرّتين. حُذفت الثانية.
   * والبريد والخروج انتقلا إلى قائمة الشريط العلوي، فلا يتكرّران هنا.
   */
  async function openMyActivities() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';

    const UI = window.TeacherUI;
    const page = el('div', { class: 'tp-home' });
    app.append(page);

    page.append(
      el('div', { class: 'tp-chips' }, [
        UI.NavChip({ label: t('hnewActivity'), href: '#/new', primary: true }),
        UI.NavChip({ label: t('hdesignWithAi'), href: '#/ai' }),
        UI.NavChip({ label: t('gbNav'), href: '#/game-ai' }),
        UI.NavChip({ label: t('ctNav'), href: '#/contests' }),
        UI.NavChip({ label: t('lNav'), href: '#/library' }),
        UI.NavChip({ label: t('gNav'), href: '/games.html' }),
      ])
    );
    page.append(el('h1', { class: 'tp-greet', style: { display: 'block' } }, el('span', { class: 'tp-section', text: t('hmyActivities') })));

    // تحذير التخزين يسبق القائمة ولا يُطوى — يحمي عمل المعلّم
    if (state.durable === false) {
      page.append(UI.Warning({ title: t('hstorageIsNotDurable'), body: t('haccountsAndActivitiesAre') }));
    }

    const listBox = el('div', { class: 'tp-home' });
    page.append(listBox);
    const extras = el('div', { class: 'tp-extras' });
    page.append(extras);

    listBox.append(UI.Skeleton(2));
    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/mine');
      return;
    }

    let activities = [];
    try {
      activities = (await api('/api/activities')).activities;
    } catch (err) {
      listBox.replaceChildren(
        UI.ErrorState({ title: t('hcouldNotLoadYour'), body: err.message, cta: t('hHomeRetry'), onClick: () => openMyActivities() })
      );
      return;
    }

    listBox.replaceChildren();
    if (!activities.length) {
      listBox.append(
        UI.EmptyState({
          emoji: '📭',
          title: t('hnoSavedActivitiesYet'),
          body: t('hcreateAnActivityThen'),
          cta: t('hcreateAnActivity'),
          href: '#/new',
        })
      );
    } else {
      activities.forEach((activity) => listBox.append(homeActivityCard(activity, () => openMyActivities())));
    }

    const guide = onboardingCard(activities.length, () => openMyActivities());
    if (guide) extras.append(guide);
    extras.append(classesCard());
  }

  // ------------------------------------------------------------- الفصول

  /**
   * فصول المعلّم: كشفُ أسماءٍ **اختياري** يكتبه هو.
   *
   * غرضه واحد ومحدود: أن يختار الطالب اسمه من قائمة فتتّحد كتابته بين
   * الحصص (لا «احمد» و«أحمد» صفَّين في التقرير)، وأن يرى المعلّم من لم
   * يدخل بعد. وليس سجلَّ طلاب: لا بريد ولا رقم ولا درجة تُحفظ هنا، وإجابات
   * الطلاب تبقى في الذاكرة وتختفي بانتهاء الجلسة كما كانت.
   */
  function classesCard() {
    const body = el('div', { class: 'stack' });
    const card = el('div', { class: 'card stack', style: { marginTop: '12px' } }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 } }, [t('hClassesTitle'), ' ', window.T.hintDot(t('hClassesIntro'))]),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: () => openForm(null) }, t('hClassNew')),
      ]),
      body,
    ]);

    function openForm(existing) {
      const nameInput = el('input', { maxlength: 60, placeholder: t('hClassNamePh'), value: existing?.name || '' });
      const namesInput = el('textarea', { rows: 6, placeholder: t('hClassStudentsPh') });
      namesInput.value = (existing?.students || []).join('\n');
      const save = el('button', { class: 'btn primary sm', type: 'button' }, t('hClassSave'));
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const payload = { name: nameInput.value.trim(), students: namesInput.value };
          if (existing) await api('/api/classes/' + existing.id, { method: 'PUT', body: payload });
          else await api('/api/classes', { method: 'POST', body: payload });
          toast(t('hClassSaved'), 'ok');
          load();
        } catch (err) {
          toast(err.message, 'bad');
          save.disabled = false;
        }
      });
      body.replaceChildren(
        el('div', { class: 'stack' }, [
          el('div', {}, [el('label', { text: t('hClassName') }), nameInput]),
          el('div', {}, [el('label', { text: t('hClassStudents') }), namesInput]),
          el('div', { class: 'row', style: { gap: '8px' } }, [
            save,
            el('button', { class: 'btn ghost sm', type: 'button', onclick: () => load() }, t('hClassCancel')),
          ]),
        ])
      );
      nameInput.focus();
    }

    async function load() {
      body.replaceChildren(el('div', { class: 'spinner' }));
      let items = [];
      try {
        items = (await api('/api/classes')).classes || [];
      } catch (err) {
        return body.replaceChildren(el('span', { class: 'muted small', text: err.message }));
      }
      state.classes = items;
      if (!items.length) return body.replaceChildren(el('span', { class: 'muted small', text: t('hClassEmpty') }));
      body.replaceChildren(
        ...items.map((item) =>
          el('div', { class: 'row between', style: { padding: '8px 0', borderBottom: '1px solid var(--border)' } }, [
            el('div', { class: 'stack tight grow' }, [
              el('strong', { text: item.name }),
              el('span', { class: 'muted small', text: t('hClassCount', { n: item.students.length }) }),
            ]),
            el('button', { class: 'btn ghost sm', type: 'button', onclick: () => openForm(item) }, t('hClassEdit')),
            el('button', {
              class: 'btn danger sm', type: 'button',
              onclick: async () => {
                if (!confirm(t('hClassDeleteAsk'))) return;
                try {
                  await api('/api/classes/' + item.id, { method: 'DELETE' });
                  load();
                } catch (err) {
                  toast(err.message, 'bad');
                }
              },
            }, t('hClassDelete')),
          ])
        )
      );
    }

    load();
    return card;
  }

  // ------------------------------------------------- ألعابي التفاعلية

  /**
   * رفع لعبة: ملف HTML واحد مكتفٍ بذاته. نقرأ الملف في المتصفّح ونرسل نصّه،
   * فلا نحتاج رفعاً ثنائياً ولا تخزين ملفات — واللعبة تُقدَّم لاحقاً داخل
   * إطار معزول بلا أصل، فلا ترى حساب أحد ولا بيانات أحد.
   */
  async function openMyGames() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/games');
      return;
    }

    let mine = [];
    try {
      mine = (await api('/api/games?teacher=' + encodeURIComponent(user.id) + '&sort=new&limit=48')).items;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('gMine') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhomePage')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/profile' }, t('profNav')),
          el('a', { class: 'btn ghost sm', href: '/games.html' }, t('gNav')),
          el('a', { class: 'btn ghost sm', href: '#/mine' }, t('hmyActivities')),
        ]),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' } }, [t('gMine'), ' ', window.T.hintDot(t('gMineIntro'))]));

    // رابطُ صفحةِ ألعاب المعلّم: يضعه في مجموعة صفّه فيتصفّح طلابه ألعابه وحدها
    const shelf = location.origin + '/games.html#/t/' + user.id;
    app.append(
      el('div', { class: 'card stack tight' }, [
        el('strong', {}, [t('gShelfTitle'), ' ', window.T.hintDot(t('gShelfHint'))]),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('code', { class: 'grow link-box', text: shelf }),
          shareButton(shelf, t('gCopyLink')),
          el('a', { class: 'btn ghost sm', href: shelf, target: '_blank', rel: 'noopener' }, t('gOpen')),
        ]),
      ])
    );

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { style: { margin: 0 } }, [t('gbCardTitle'), ' ', window.T.hintDot(t('gbIntro'))]),
          el('span', { class: 'badge', text: t('gbCardBadge') }),
        ]),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gbCardBody') }),
        el('a', { class: 'btn accent block', href: '#/game-ai' }, t('gbCardCta')),
      ])
    );

    app.append(uploadCard());

    if (!mine.length) {
      app.append(el('div', { class: 'card stack center' }, [el('div', { style: { fontSize: '2.2rem' }, text: '🎮' }), el('p', { class: 'muted', text: t('gNoneYet') })]));
      return;
    }
    const list = el('div', { class: 'stack' });
    mine.forEach((game) => list.append(myGameCard(game)));
    app.append(el('div', { class: 'card stack' }, [el('h2', { style: { margin: 0 }, text: t('gMineCount', { n: mine.length }) }), list]));
  }

  function uploadCard() {
    const title = el('input', { maxlength: 120, placeholder: t('gFormTitlePlaceholder') });
    const subject = el('select', {}, [
      el('option', { value: '', text: t('gFormPickSubject') }),
      ...SUBJECTS.map((id) => el('option', { value: id, text: tagLabel('subj', id) })),
    ]);
    const gradePicker = gradeChips();
    const description = el('input', { maxlength: 300, placeholder: t('gFormDescPlaceholder') });
    const file = el('input', { type: 'file', accept: '.html,.htm,text/html' });
    const code = el('textarea', { rows: 6, placeholder: t('gFormCodePlaceholder') });
    const note = el('div', { class: 'muted small' });
    const submit = el('button', { class: 'btn accent', type: 'button' }, t('gFormSubmit'));

    const offlineOk = el('input', { type: 'checkbox' });
    offlineOk.checked = true;
    const shotNote = el('div', { class: 'muted small' });
    const preview = el('div', { class: 'cover-preview', hidden: true });
    const makeShot = el('button', { class: 'btn primary', type: 'button' }, t('gFormShotMake'));
    let cover = '';

    makeShot.addEventListener('click', async () => {
      if (!html.trim()) return toast(t('gFormShotNeedsCode'), 'bad');
      makeShot.disabled = true;
      shotNote.textContent = t('gFormShotWorking');
      // الرسم مهمّةٌ قد تبلغ دقيقتين — عدّادٌ يقول للمعلّم إنّها تجري ولم تتعطّل
      const startedAt = Date.now();
      const ticker = setInterval(() => {
        shotNote.textContent = t('gFormShotElapsed', { n: Math.round((Date.now() - startedAt) / 1000) });
      }, 1000);
      try {
        const res = await api('/api/games/cover', {
          method: 'POST',
          body: { html, title: title.value, subject: subject.value, grades: gradePicker.value() },
        });
        cover = await fitCover(res.image);
        preview.innerHTML = '';
        preview.append(el('img', { src: cover, alt: t('gFormShot') }));
        preview.hidden = false;
        shotNote.textContent = t('gFormShotReady', { kb: Math.round((cover.length * 3) / 4 / 1024) });
        makeShot.textContent = t('gFormShotAgain');
        if (!title.value.trim() && res.name) title.value = res.name;
      } catch (err) {
        shotNote.textContent = err.message;
      } finally {
        clearInterval(ticker);
        makeShot.disabled = false;
      }
    });

    let html = '';
    const setHtml = (value, from) => {
      html = value;
      const kb = Math.round(Buffer_len(value) / 1024);
      note.textContent = value ? t('gFormLoaded', { from, kb }) : '';
      note.style.color = kb > 2048 ? '#fca5a5' : '';
    };
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const text = await f.text();
      code.value = text;
      setHtml(text, f.name);
    });
    code.addEventListener('input', () => setHtml(code.value, t('gFormPasted')));

    /**
     * «كيف سترفع لعبتك؟» — سؤالٌ واحد قبل الحقول.
     *
     * كان الحقلان معروضين معاً: خانةُ ملفٍّ ومساحةُ لصقٍ فوق بعضهما، فيقف
     * المعلّم أمامهما لا يدري أيملأ واحداً أم كليهما. الآن يختار طريقته
     * فيظهر حقلُها وحده، ويستطيع تبديل رأيه بضغطة.
     */
    const fileBox = el('div', { class: 'stack tight', hidden: true }, [
      el('label', {}, [el('span', { class: 'small', text: t('gFormFile') }), file]),
    ]);
    const codeBox = el('div', { class: 'stack tight', hidden: true }, [
      el('label', {}, [el('span', { class: 'small', text: t('gFormCode') }), code]),
    ]);
    const pickFile = el('button', { class: 'btn ghost', type: 'button' }, t('gFormHaveFile'));
    const pickCode = el('button', { class: 'btn ghost', type: 'button' }, t('gFormHaveCode'));
    const sourceRow = el('div', { class: 'stack tight' }, [
      el('span', { class: 'small', text: t('gFormSourceAsk') }),
      el('div', { class: 'row', style: { gap: '6px' } }, [pickFile, pickCode]),
    ]);

    function chooseSource(which) {
      const isFile = which === 'file';
      fileBox.hidden = !isFile;
      codeBox.hidden = isFile;
      pickFile.className = 'btn ' + (isFile ? 'primary' : 'ghost');
      pickCode.className = 'btn ' + (isFile ? 'ghost' : 'primary');
      // ما لم يعد ظاهراً لا يُحتسب: الطريقة المختارة وحدها مصدر الشيفرة
      if (isFile) {
        code.value = '';
        if (file.files?.length) file.files[0].text().then((text) => setHtml(text, file.files[0].name));
        else setHtml('', '');
      } else {
        file.value = '';
        setHtml(code.value, t('gFormPasted'));
      }
      (isFile ? file : code).focus({ preventScroll: true });
    }
    pickFile.addEventListener('click', () => chooseSource('file'));
    pickCode.addEventListener('click', () => chooseSource('code'));

    submit.addEventListener('click', async () => {
      if (!cover) return toast(t('gFormShotRequired'), 'bad');
      submit.disabled = true;
      try {
        const body = {
          title: title.value,
          subject: subject.value,
          description: description.value,
          // مصفوفة فارغة = «كل المراحل»
          grades: gradePicker.value(),
          cover,
          offlineOk: offlineOk.checked,
          html,
        };
        const res = await api('/api/games', { method: 'POST', body });
        toast(t('gUploaded', { title: res.game.title }), 'ok');
        openMyGames();
      } catch (err) {
        toast(err.message, 'bad');
        submit.disabled = false;
      }
    });

    return el('div', { class: 'card stack' }, [
      el('h2', { style: { margin: 0 } }, [t('gFormTitle'), ' ', window.T.hintDot(t('gFormHint'))]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormName') }), title]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormSubject') }), subject]),
      el('div', { class: 'stack tight' }, [
        el('span', { class: 'small' }, [t('gFormGrades'), ' ', window.T.hintDot(t('gFormGradesHint'))]),
        gradePicker.node,
      ]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormDesc') }), description]),
      sourceRow,
      fileBox,
      codeBox,
      note,
      el('div', { class: 'stack tight' }, [
        el('span', { class: 'small' }, [t('gFormShot'), ' ', window.T.hintDot(t('gFormShotHint'))]),
        el('div', { class: 'row', style: { gap: '6px' } }, [makeShot]),
      ]),
      preview,
      shotNote,
      el('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
        offlineOk,
        el('span', { class: 'small grow' }, [
          el('strong', {}, [t('gFormOffline'), ' ', window.T.hintDot(t('gFormOfflineHint'))]),
        ]),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [submit]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('gFormSafety') }),
    ]);
  }

  /**
   * بروفايل المعلّم — الحقول الثلاثة اختيارية بالكامل. الحساب يعمل بلا أيٍّ
   * منها كما كان، وما يُترك فارغاً لا يظهر للطلاب أصلاً.
   */
  async function openProfile() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/profile');
      return;
    }

    let profile;
    try {
      profile = (await api('/api/profile')).profile;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('profTitle') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhomePage')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/upgrade' }, t('upNav')),
          el('a', { class: 'btn ghost sm', href: '#/games' }, t('gMine')),
        ]),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' } }, [t('profTitle'), ' ', window.T.hintDot(t('profIntro'))]));

    /*
     * دعوةٌ لا بوّابة: البروفايل كلّه اختياري، ومن تركه فارغاً يعمل حسابه
     * كما هو. لكنّ من لا يعرف أن له صفحةً يراها طلابه لا يملؤها — فتُذكر
     * مرّةً هنا، وتُسمّى الحقول الناقصة بالاسم بدل «أكمل بروفايلك».
     */
    if (profile.missing?.length) {
      const names = profile.missing.map((key) => t('profMissing' + key.charAt(0).toUpperCase() + key.slice(1)));
      app.append(
        el('div', { class: 'note small stack tight', style: { marginBottom: '10px' } }, [
          el('strong', { text: t('profCompleteTitle') }),
          el('span', { text: t('profCompleteBody', { fields: names.join(t('listSep')) }) }),
        ])
      );
    }

    const displayName = el('input', { maxlength: 60, placeholder: t('profNamePlaceholder'), value: profile.displayName });
    const phone = el('input', { type: 'tel', dir: 'ltr', maxlength: 24, placeholder: t('profPhonePlaceholder'), value: profile.phone });
    const bio = el('textarea', { rows: 3, maxlength: 300, placeholder: t('profBioPlaceholder') });
    bio.value = profile.bio || '';
    /*
     * إظهار الرقم رايةٌ مستقلّة عن كتابته.
     *
     * كان مَن يكتب رقمه للتواصل يجده منشوراً على صفحته للعموم بلا أن يُسأل.
     * الآن يكتبه ويقرّر: يظهر أو لا يظهر. والحجب على الخادم لا في الواجهة —
     * ما لا يُرسل لا يُكشف بفتح أدوات المتصفّح.
     */
    const phonePublic = el('input', { type: 'checkbox' });
    phonePublic.checked = profile.phonePublic !== false;
    const phoneRow = el('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
      phonePublic,
      el('span', { class: 'small grow' }, [
        el('strong', { text: t('profPhonePublic') }),
        el('span', { class: 'muted small', style: { display: 'block' }, text: t('profPhonePublicHint') }),
      ]),
    ]);
    const country = window.T.countrySelect(profile.country || '');
    const face = el('div', { class: 'profile-face' });
    const photoInput = el('input', { type: 'file', accept: 'image/*' });
    const photoNote = el('div', { class: 'muted small' });
    // undefined = لم تُلمس الصورة، '' = احذفها، data URI = صورة جديدة
    let photo;

    const paintFace = (src) => {
      face.innerHTML = '';
      if (src) face.append(el('img', { src, alt: t('profPhoto') }));
      else face.append(el('span', { text: (profile.displayName || profile.name || '؟').trim().slice(0, 1) }));
    };
    paintFace(profile.photo ? '/api/teachers/' + user.id + '/photo?t=' + Date.now() : '');

    photoInput.addEventListener('change', async () => {
      const picked = photoInput.files?.[0];
      if (!picked) return;
      photoNote.textContent = t('profPhotoWorking');
      try {
        // مربّعة: البروفايل يعرضها دائرةً، والمستطيلة تُقصّ بشكل سيّئ
        photo = await shrinkImage(picked, { width: 256, height: 256, quality: 0.85 });
        paintFace(photo);
        photoNote.textContent = t('profPhotoReady');
      } catch (err) {
        photo = undefined;
        photoNote.textContent = err.message;
      }
    });

    const clearPhoto = el('button', { class: 'btn ghost sm', type: 'button' }, t('profPhotoRemove'));
    clearPhoto.addEventListener('click', () => {
      photo = '';
      photoInput.value = '';
      paintFace('');
      photoNote.textContent = t('profPhotoCleared');
    });

    const save = el('button', { class: 'btn accent', type: 'button' }, t('profSave'));
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const body = {
          displayName: displayName.value,
          phone: phone.value,
          phonePublic: phonePublic.checked,
          bio: bio.value,
          country: country.value,
        };
        if (photo !== undefined) body.photo = photo;
        const res = await api('/api/profile', { method: 'PUT', body });
        toast(t('profSaved'), 'ok');
        state.user = { ...state.user, name: res.profile.publicName };
        openProfile();
      } catch (err) {
        toast(err.message, 'bad');
        save.disabled = false;
      }
    });

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row', style: { gap: '14px', alignItems: 'center' } }, [
          face,
          el('div', { class: 'stack tight grow' }, [
            el('span', { class: 'small' }, [t('profPhoto'), ' ', window.T.hintDot(t('profPhotoHint'))]),
            photoInput,
            el('div', { class: 'row', style: { gap: '6px' } }, [clearPhoto]),
          ]),
        ]),
        photoNote,
        el('label', {}, [
          el('span', { class: 'small' }, [t('profName'), ' ', window.T.hintDot(t('profNameHint', { name: firstName(profile.name) }))]),
          displayName,
        ]),
        el('label', {}, [
          el('span', { class: 'small' }, [t('profBio'), ' ', window.T.hintDot(t('profBioHint'))]),
          bio,
        ]),
        el('label', {}, [
          el('span', { class: 'small' }, [t('profPhone'), ' ', window.T.hintDot(t('profPhoneHint'))]),
          phone,
        ]),
        phoneRow,
        el('label', {}, [
          el('span', { class: 'small' }, [t('cnLabel'), ' ', window.T.hintDot(t('cnWhy'))]),
          country,
        ]),
        el('p', { class: 'note warn small', style: { margin: 0 }, text: t('profPublicWarning') }),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          save,
          el('a', { class: 'btn ghost', href: '/games.html#/t/' + user.id, target: '_blank', rel: 'noopener' }, t('profPreview')),
        ]),
      ])
    );
  }

  /**
   * اختيار الصفوف: شرائح تُنقر — واحدة أو عدّة، أو «كل المراحل» فتلغي الباقي.
   * القيمة مصفوفة معرِّفات، والفارغة تعني «الجميع» كما يفهمها الخادم.
   */
  /** حجمٌ مقروء — لعبةٌ صغيرة تُكتب «أقل من ١KB» لا «0KB» */
  const kb = (bytes) => (bytes < 1024 ? t('gUnderKb') : Math.round(bytes / 1024) + 'KB');

  /** طول النص بالبايت — الحدّ على الخادم بالبايت لا بالمحارف */
  function Buffer_len(text) {
    return new TextEncoder().encode(String(text || '')).length;
  }

  function myGameCard(game) {
    // --- تغيير صورة لعبةٍ مرفوعة ---
    // حقلٌ مخفيّ وزرٌّ يفتحه: حقل الملف الخام قبيحٌ ومختلف بين المتصفّحات،
    // والصورة تُصغَّر في المتصفّح قبل الرفع كما في نموذج الرفع نفسه.
    const picker = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const thumb = gameThumb(game, 'sm');
    const changeCover = el('button', { class: 'btn ghost sm', type: 'button' }, t('gChangeCover'));
    changeCover.addEventListener('click', () => picker.click());
    picker.addEventListener('change', async () => {
      const picked = picker.files?.[0];
      if (!picked) return;
      changeCover.disabled = true;
      const before = changeCover.textContent;
      changeCover.textContent = t('gCoverWorking');
      try {
        const cover = await shrinkImage(picked);
        const res = await api(`/api/games/${game.id}/cover`, { method: 'PATCH', body: { cover } });
        // نبدّل الصورة في مكانها بدل إعادة رسم القائمة: المعلّم يرى النتيجة
        // فوراً حيث ينظر، ولا يفقد موضعه في قائمةٍ طويلة
        game.cover = true;
        game.coverAt = res.game?.coverAt || Date.now();
        thumb.replaceWith(gameThumb(game, 'sm'));
        toast(t('gCoverChanged'), 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        picker.value = '';
        changeCover.disabled = false;
        changeCover.textContent = before;
      }
    });

    const remove = el('button', { class: 'btn danger sm', type: 'button' }, t('hdelete'));
    remove.addEventListener('click', async () => {
      if (!confirm(t('gDeleteConfirm', { title: game.title }))) return;
      try {
        await api('/api/games/' + game.id, { method: 'DELETE' });
        toast(t('gDeleted'), 'ok');
        openMyGames();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    return el('div', { class: 'card stack tight' }, [
      picker,
      el('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } }, [
        thumb,
        el('div', { class: 'stack tight grow' }, [
          el('div', { class: 'row between' }, [
            el('strong', { text: game.title }),
            el('span', { class: 'row', style: { gap: '6px' } }, [
              el('span', { class: 'badge', text: t('gPlays', { n: game.plays }) }),
              game.rating ? el('span', { class: 'badge', text: `⭐ ${game.rating}` }) : null,
            ]),
          ]),
          el('div', { class: 'row', style: { gap: '6px' } }, [
            game.subject ? el('span', { class: 'badge', text: tagLabel('subj', game.subject) }) : null,
            ...(game.grades.length
              ? game.grades.map((g) => el('span', { class: 'badge', text: tagLabel('grade', g) }))
              : [el('span', { class: 'badge', text: t('gAllStages') })]),
            el('span', { class: 'muted small', text: kb(game.bytes) }),
          ]),
        ]),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('a', { class: 'btn primary sm', href: '/games.html#/g/' + game.id }, t('gOpen')),
        changeCover,
        shareButton(location.origin + '/games.html#/g/' + game.id, t('gCopyLink')),
        el('span', { class: 'grow' }),
        remove,
      ]),
    ]);
  }

  /** صورة اللعبة، وبديلٌ مولَّد لألعابٍ رُفعت قبل أن تصير الصورة مطلوبة */
  function gameThumb(game, size) {
    const box = el('div', { class: 'game-thumb' + (size === 'sm' ? ' sm' : '') });
    if (game.cover) {
      // البصمة تجبر المتصفّح على جلب الصورة الجديدة بعد تبديلها
      box.append(el('img', { src: `/api/games/${game.id}/cover?v=${game.coverAt || 0}`, alt: game.title, loading: 'lazy' }));
    } else {
      box.classList.add('blank');
      box.append(el('span', { text: (game.title || '🎮').trim().slice(0, 1) }));
    }
    return box;
  }

  /** زرّ «انسخ الرابط» — يخبرك أنّه نسخ فعلاً لا أنّه حاول */
  function shareButton(url, label) {
    const btn = el('button', { class: 'btn ghost sm', type: 'button' }, '🔗 ' + label);
    btn.addEventListener('click', async () => {
      const done = await copyLink(url);
      toast(done ? t('gLinkCopied') : url, done ? 'ok' : '');
    });
    return btn;
  }

  // ------------------------------------------------------- المكتبة العامة

  const library = { q: '', subject: '', grade: '', lang: '', page: 0, items: [], total: 0 };

  /** يجمع قيم حقل من النتائج لبناء قوائم التصفية بلا مسار خادم إضافي */
  const facet = (key) => [...new Set(library.items.map((x) => x[key]).filter(Boolean))].sort();

  async function openLibrary(keepFilters) {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    if (!keepFilters) Object.assign(library, { q: '', subject: '', grade: '', lang: '', page: 0, items: [], total: 0 });
    if (!state.user) loadAccount();
    const UI = window.TeacherUI;
    app.innerHTML = '';
    const loading = el('div', { class: 'tp-home' }, UI.Skeleton(3));
    app.append(loading);

    let data;
    try {
      const query = new URLSearchParams({ q: library.q, subject: library.subject, grade: library.grade, lang: library.lang, page: String(library.page) });
      data = await api('/api/library?' + query);
    } catch (err) {
      app.innerHTML = '';
      app.append(
        el('div', { class: 'tp-home' }, [
          UI.ErrorState({ title: t('lTitle'), body: err.message, cta: t('hHomeRetry'), onClick: () => openLibrary(true) }),
        ])
      );
      return;
    }
    library.items = library.page ? [...library.items, ...data.items] : data.items;
    library.total = data.total;

    app.innerHTML = '';
    const page = el('div', { class: 'tp-home tp-d' });
    app.append(page);
    page.append(
      el('div', { class: 'tp-chips' }, [
        UI.NavChip({ label: t('hnewActivity'), href: '#/new', primary: true }),
        UI.NavChip({ label: t('hmyActivities'), href: '#/mine' }),
        UI.NavChip({ label: t('gNav'), href: '/games.html' }),
      ])
    );
    page.append(
      el('div', { class: 'tp-greet' }, [el('h1', { text: t('lTitle') }), el('p', { text: t('lIntro') })])
    );

    // البحث بالضغط على Enter أو الزر لا عند كل حرف: كل حرف طلبٌ للخادم
    const search = el('input', { type: 'search', placeholder: t('lSearchPlaceholder'), value: library.q, maxlength: 80 });
    const run = () => {
      library.q = search.value;
      library.page = 0;
      openLibrary(true);
    };
    search.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    const pick = (key, allLabel, options) => {
      const sel = el('select', {}, [el('option', { value: '', text: allLabel }), ...options.map((o) => el('option', { value: o.value ?? o, text: o.label ?? o, selected: library[key] === (o.value ?? o) }))]);
      sel.value = library[key];
      sel.addEventListener('change', () => {
        library[key] = sel.value;
        library.page = 0;
        openLibrary(true);
      });
      return sel;
    };
    // البحث والمرشِّحات في صندوقٍ واحد: سطرُ بحثٍ ثم قوائم أصلية تُفتح
    // بلمسةٍ واحدة على الجوال — أسرع من شرائح تتمدّد وتلتفّ
    page.append(
      el('div', { class: 'tp-d-section' }, [
        el('div', { class: 'tp-d-row' }, [
          el('span', { style: { flex: '1 1 auto', minWidth: '0' } }, search),
          el('button', { class: 'tp-btn tp-btn--purple tp-btn--sm', type: 'button', onclick: run, 'aria-label': t('lSearchPlaceholder') }, '🔍'),
        ]),
        el('div', { class: 'tp-d-row' }, [
          pick('subject', t('lAllSubjects'), facet('subject')),
          pick('grade', t('lAllGrades'), facet('grade')),
          pick('lang', t('lAllLangs'), [{ value: 'ar', label: t('lArabic') }, { value: 'en', label: t('lEnglish') }]),
        ]),
        el('p', { class: 'tp-d-note', text: t('lCount', { n: library.total }) }),
      ])
    );

    if (!library.items.length) {
      const filtered = library.q || library.subject || library.grade || library.lang;
      page.append(
        UI.EmptyState({
          emoji: filtered ? '🔍' : '🌍',
          title: filtered ? t('lEmpty') : t('lEmptyAll'),
          body: '',
          cta: t('hmyActivities'),
          href: '#/mine',
        })
      );
      return;
    }

    library.items.forEach((item) => page.append(libraryCard(item)));

    if (library.items.length < library.total) {
      const more = el('button', { class: 'tp-btn tp-btn--outline tp-btn--block', type: 'button' }, t('lMore'));
      more.addEventListener('click', () => {
        library.page += 1;
        openLibrary(true);
      });
      page.append(more);
    }
  }

  /** بطاقة نشاطٍ في المكتبة — بمفردات بطاقة «نشاطاتي» نفسها */
  function libraryCard(item) {
    const UI = window.TeacherUI;
    return UI.ActivityCard({
      title: item.title,
      meta: [
        UI.Badge({ label: t('hQuestionCount', { count: item.questionCount }) }),
        // اسمُ المادة والصفّ بلغة المعلّم لا معرّفهما («math» و«g5» لا يقولان شيئاً)
        item.subject ? UI.Badge({ label: tagLabel('subject', item.subject) }) : null,
        item.grade ? UI.Badge({ label: tagLabel('grade', item.grade) }) : null,
        UI.Badge({ label: item.lang === 'en' ? t('lEnglish') : t('lArabic') }),
        item.copies ? UI.Badge({ label: t('lCopies', { n: item.copies }) }) : null,
        item.author ? el('span', { text: t('lBy', { name: item.author }) }) : null,
      ].filter(Boolean),
      actions: [UI.Button({ label: t('lPreview'), href: '#/library/' + item.id, kind: 'purple' })],
    });
  }

  /** معاينة نشاط من المكتبة قبل نسخه — الأسئلة كما سيراها الطالب */
  async function openLibraryItem(id) {
    teardown();
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/library/' + id);
      return;
    }

    let activity;
    try {
      activity = (await api('/api/library/' + id)).activity;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('p', { class: 'muted', text: err.message }), el('a', { class: 'btn primary', href: '#/library' }, t('lBack'))]));
      return;
    }

    const copy = el('button', { class: 'btn accent', type: 'button' }, t('lCopyToMine'));
    copy.addEventListener('click', async () => {
      copy.disabled = true;
      copy.textContent = t('lCopying');
      try {
        const res = await api(`/api/library/${id}/copy`, { method: 'POST' });
        toast(res.droppedImages ? t('lCopiedNoImages', { title: res.activity.title, n: res.droppedImages }) : t('lCopied', { title: res.activity.title }), 'ok');
        location.hash = '#/edit/' + res.activity.id;
      } catch (err) {
        toast(err.message, 'bad');
        copy.disabled = false;
        copy.textContent = t('lCopyToMine');
      }
    });

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/library' }, t('lBack')),
        copy,
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' }, text: activity.title }));
    app.append(
      el('div', { class: 'row', style: { gap: '6px', marginBottom: '10px' } }, [
        activity.author ? el('span', { class: 'muted small', text: t('lBy', { name: activity.author }) }) : null,
        activity.subject ? el('span', { class: 'badge', text: activity.subject }) : null,
        activity.grade ? el('span', { class: 'badge', text: activity.grade }) : null,
        el('span', { class: 'badge', text: t('hQuestionCount', { count: activity.questions.length }) }),
      ])
    );

    activity.questions.forEach((q, index) => {
      const right = new Set(q.correct || []);
      app.append(
        el('div', { class: 'card stack tight' }, [
          el('div', { class: 'row', style: { gap: '6px' } }, [
            el('span', { class: 'badge', text: `${TYPE_EMOJI[q.type] || '•'} ${index + 1}` }),
            el('strong', { text: q.text }),
          ]),
          q.passage ? el('p', { class: 'passage', style: { margin: 0 } }, q.passage) : null,
          q.body ? el('p', { class: 'muted small', style: { margin: 0 }, text: q.body }) : null,
          (q.options || []).length
            ? el(
                'div',
                { class: 'row', style: { gap: '6px' } },
                q.options.map((o) => el('span', { class: 'badge' + (right.has(o.id) ? ' ok' : ''), text: (right.has(o.id) ? '✓ ' : '') + o.text }))
              )
            : null,
          q.explanation ? el('p', { class: 'muted small', style: { margin: 0 }, text: '💡 ' + q.explanation }) : null,
        ])
      );
    });

    app.append(
      el('p', { class: 'footer' }, [
        el('a', { href: 'https://wa.me/970597750343?text=' + encodeURIComponent(`${t('lReport')}: ${location.origin}/host.html#/library/${id}`), target: '_blank', rel: 'noopener', class: 'muted small' }, t('lReport')),
      ])
    );
  }

  /**
   * نموذج النشر داخل البطاقة نفسها لا في نافذة عائمة: النشر قرار يحتاج قراءة
   * تحذيرٍ بجانب اسم النشاط، والنافذة العائمة على الجوال تخفي ما تُقرَّر عليه.
   */
  function publishForm(activity, onDone, onCancel) {
    const subject = el('input', { maxlength: 40, placeholder: t('lSubjectPlaceholder'), value: activity.subject || '' });
    const grade = el('input', { maxlength: 40, placeholder: t('lGradePlaceholder'), value: activity.grade || '' });

    const go = el('button', { class: 'btn accent sm', type: 'button' }, t('lConfirmPublish'));
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await api(`/api/activities/${activity.id}/publish`, { method: 'POST', body: { subject: subject.value, grade: grade.value } });
        toast(t('lPublishedOk'), 'ok');
        onDone();
      } catch (err) {
        toast(err.message, 'bad');
        go.disabled = false;
      }
    });

    const box = el('div', { class: 'stack tight publish-form' }, [
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('lPublishWarn') }),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('label', { class: 'grow' }, [el('span', { class: 'small', text: t('lSubject') }), subject]),
        el('label', { class: 'grow' }, [el('span', { class: 'small', text: t('lGrade') }), grade]),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [go, el('button', { class: 'btn ghost sm', type: 'button', onclick: onCancel }, t('lCancel'))]),
    ]);
    setTimeout(() => subject.focus(), 0);
    return box;
  }

  /** فتح نشاط محفوظ داخل المحرّر */
  async function openSavedActivity(id) {
    teardown();
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    if (!state.user) await loadAccount();
    try {
      const { activity } = await api('/api/activities/' + id);
      window.Builder.saveDraft({ title: activity.title, settings: activity.settings, questions: activity.questions });
      setEditingActivity(activity.id);
      openBuilder();
      toast(t('hopened') + activity.title + t('htoEdit'), 'ok');
    } catch (err) {
      toast(err.message, 'bad');
      location.hash = '#/mine';
    }
  }

  /**
   * تجربة فورية بنشاط جاهز — **بلا حساب**.
   *
   * كانت تُنشئ جلسة، فلمّا صار الإطلاق يتطلّب حساباً صار زرٌّ يعد بـ«ضغطة
   * واحدة» يرمي الزائر إلى صفحة دخول: أسوأ من ألّا يكون. والوعدان ليسا
   * متعارضين حقاً — ما رفضه صاحب المنصة أن يُنشئ **مجهولٌ جلسةً حيّة**، لا
   * أن يرى المحرّر. فنفتح له نشاطاً كاملاً جاهزاً يقلّبه ويعدّله ويفهم
   * المنصة كلها، ويبقى الحساب مطلوباً عند الإطلاق وحده — حيث بابُه أصلاً.
   */
  function startDemo() {
    const template = (window.TEMPLATES || []).find((item) => item.key === 'quiz') || (window.TEMPLATES || [])[0];
    if (!template) {
      location.hash = '#/';
      return;
    }
    window.Builder.saveDraft({ title: template.title, settings: template.settings, questions: template.questions });
    setEditingActivity(null);
    // «المراجعة» لا «الإعدادات»: الزائر جاء ليرى نشاطاً جاهزاً لا ليملأ نموذجاً
    state.builderStage = 'review';
    // العنوان يجب أن يقول «المحرّر» لا «الاختيار»، وإلا أعاد زرّ الرجوع رسم شاشةٍ أخرى
    history.replaceState(null, '', '#/new');
    openBuilder();
    toast(t('hdemoLoaded'), 'ok');
  }

  window.addEventListener('hashchange', route);

  function hostTokenFor(code) {
    const hosts = store.local.get(HOSTS_KEY, {});
    return hosts[code] || null;
  }

  function rememberHost(code, hostToken, title) {
    const hosts = store.local.get(HOSTS_KEY, {});
    hosts[code] = hostToken;
    store.local.set(HOSTS_KEY, hosts);
    store.local.set('tafa3l:host:last', { code, hostToken, title });
  }

  // ------------------------------------------------------------- المحرّر

  /**
   * أول شاشة يراها المعلّم: سؤالٌ واحد بجوابين.
   *
   * كان المحرّر يُفتح مباشرةً وفوقه بطاقةٌ صغيرة تقترح المساعد الذكي — فمن
   * يرى نموذجاً بدأ يملؤه، ولا يلتفت إلى أن هناك من يملؤه عنه. والقرار بين
   * الطريقين قرارٌ يستحق شاشته: بطاقتان كبيرتان لا ثالث لهما.
   */
  /**
   * رئيسية المعلّم (DESIGN.md §2.5) — جوال أولاً.
   *
   * ترتيبها من أعلى: شرائح تنقّل، ثم تحية، ثم بطاقتا الإنشاء، ثم شريط
   * المسودة إن كانت، ثم قائمة «نشاطاتي» — كانت في مسارٍ آخر فصار المعلّم
   * يقطع خطوةً ليصل إلى أهمّ ما في الصفحة. وما بقي من بطاقات (المنحة،
   * والإرشاد، والفصول) تحتها.
   */
  async function openStart() {
    teardown();
    setEditingActivity(null);
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';

    const UI = window.TeacherUI;
    const home = el('div', { class: 'tp-home' });
    app.append(home);

    home.append(
      el('div', { class: 'tp-chips' }, [
        UI.NavChip({ label: t('hnewActivity'), href: '#/new', primary: true }),
        UI.NavChip({ label: t('hdesignWithAi'), href: '#/ai' }),
        UI.NavChip({ label: t('gbNav'), href: '#/game-ai' }),
        UI.NavChip({ label: t('ctNav'), href: '#/contests' }),
        UI.NavChip({ label: t('lNav'), href: '#/library' }),
        UI.NavChip({ label: t('gNav'), href: '/games.html' }),
        UI.NavChip({ label: t('hteacherGuide'), href: '/help.html' }),
      ])
    );

    home.append(
      el('div', { class: 'tp-greet' }, [
        el('h1', {
          text: state.user ? t('hHelloUser', { name: firstName(state.user.name) }) : t('startTitle'),
        }),
        el('p', {
          text: state.user
            ? state.premium?.isPremium
              ? t('hyourAccountIsPremium')
              : t('hreadyForANew')
            : t('startIntro'),
        }),
      ])
    );

    home.append(
      el('div', { class: 'tp-create' }, [
        UI.CreationCard({ ai: true, title: t('startAiTitle'), body: t('startAiBody'), cta: t('startAiCta'), href: '#/ai' }),
        UI.CreationCard({ title: t('startManualTitle'), body: t('startManualBody'), cta: t('startManualCta'), href: '#/new' }),
        /* اللعبة فعلُ إنشاءٍ ثالثٌ لا سطرٌ في قائمة: المعلّم لا يبحث عمّا لا
           يعرف أنه موجود، ورقاقةُ تنقّلٍ بين خمسٍ لا تُرى */
        UI.CreationCard({ ai: true, title: t('startGameTitle'), body: t('startGameBody'), cta: t('startGameCta'), href: '#/game-ai' }),
      ])
    );

    /*
     * مسودةٌ نصف مكتوبة لا يجوز أن تختفي خلف شاشة اختيار: نعرضها صراحةً.
     * لكن «المسودة الفارغة» ليست مسودة — قارئ المسودات يعيد هيكلاً فيه سؤال
     * فارغ حتى لو لم يكتب المعلّم حرفاً، فكان الشريط يظهر لمن لم يبدأ شيئاً.
     */
    const draft = window.Builder?.loadDraft?.();
    const started = !!draft && (String(draft.title || '').trim() || (draft.questions || []).some((q) => String(q?.text || '').trim()));
    if (started) {
      home.append(
        UI.DraftBar({
          title: t('startDraftTitle', { title: draft.title || t('startDraftUntitled') }),
          meta: t('startDraftBody', { n: draft.questions.length }),
          cta: t('startDraftCta'),
          href: '#/new',
        })
      );
    }

    /*
     * تحذير التخزين غير الدائم يسبق القائمة ولا يُطوى: المعلّم الذي لا يعرف
     * أن أنشطته قد تضيع مع أول نشرٍ سيكتشف ذلك بعد ضياعها.
     */
    if (state.durable === false) {
      home.append(UI.Warning({ title: t('hstorageIsNotDurable'), body: t('haccountsAndActivitiesAre') }));
    }

    home.append(el('h2', { class: 'tp-section', text: t('hmyActivities') }));
    const listBox = el('div', { class: 'tp-home' });
    home.append(listBox);

    const extras = el('div', { class: 'tp-extras' });
    home.append(extras);

    // زائرٌ بلا حساب: لا نداءَ شبكةٍ أصلاً، ودعوةٌ صريحة للدخول
    if (!state.user) {
      listBox.append(
        UI.EmptyState({
          emoji: '🔐',
          title: t('hHomeSignedOutTitle'),
          body: t('hHomeSignedOutBody'),
          cta: t('homeLoginShort'),
          href: '/login.html',
        })
      );
      paintExtras(extras, 0);
      return;
    }

    listBox.append(UI.Skeleton(2));
    listBox.setAttribute('aria-busy', 'true');
    listBox.setAttribute('aria-label', t('hHomeLoading'));

    let activities = [];
    try {
      activities = (await api('/api/activities')).activities;
    } catch (err) {
      listBox.removeAttribute('aria-busy');
      listBox.replaceChildren(
        UI.ErrorState({ title: t('hcouldNotLoadYour'), body: err.message, cta: t('hHomeRetry'), onClick: () => openStart() })
      );
      paintExtras(extras, 0);
      return;
    }

    listBox.removeAttribute('aria-busy');
    listBox.replaceChildren();
    if (!activities.length) {
      listBox.append(
        UI.EmptyState({
          emoji: '📭',
          title: t('hnoSavedActivitiesYet'),
          body: t('hcreateAnActivityThen'),
          cta: t('hcreateAnActivity'),
          href: '#/new',
        })
      );
    } else {
      activities.forEach((activity) => listBox.append(homeActivityCard(activity)));
    }

    paintExtras(extras, activities.length);
  }

  /** ما تبقّى من بطاقات الرئيسية: المنحة، والإرشاد، والفصول، وحال الخادم */
  function paintExtras(extras, activityCount) {
    extras.replaceChildren();
    const running = trialCountdown();
    if (running) extras.append(running);
    const guideCard = onboardingCard(activityCount, () => openStart());
    if (guideCard) extras.append(guideCard);
    if (state.user) extras.append(classesCard());
    serverAlive().then((alive) => {
      if (!alive) showOfflineBanner(extras);
    });
  }

  /**
   * بطاقة نشاطٍ محفوظ — §3.8: زرّان متساويان ثم روابط ثانوية.
   *
   * واحدةٌ تخدم الرئيسية و«نشاطاتي» معاً، و`refresh` تقول أيّ شاشةٍ تُعاد
   * رسمها بعد فعلٍ يغيّر القائمة (إطلاق، استنساخ، نشر، حذف).
   */
  function homeActivityCard(activity, onChange) {
    const UI = window.TeacherUI;
    const refresh = onChange || (() => openStart());
    const when = new Date(activity.updatedAt).toLocaleDateString(loc(), { year: 'numeric', month: 'short', day: 'numeric' });
    const pace = { host: t('hteacherPaced'), auto: t('hauto'), self: t('hselfPaced') }[activity.settings?.pace] || '';
    const slot = el('div', {});

    // الفعل الأول: إطلاق جلسة — أو العودة إليها إن كانت قائمة الآن
    const primary = activity.live
      ? UI.Button({ label: t('hbackToTheSession'), href: '#/live/' + activity.live.code, kind: 'purple' })
      : UI.Button({
          label: t('hlaunchASession'),
          kind: 'purple',
          onClick: async () => {
            primary.disabled = true;
            primary.textContent = t('hlaunching');
            try {
              const created = await api(`/api/activities/${activity.id}/launch`, { method: 'POST' });
              rememberHost(created.code, created.hostToken, created.title);
              location.hash = '#/live/' + created.code;
            } catch (err) {
              toast(err.message, 'bad');
              primary.disabled = false;
              primary.textContent = t('hlaunchASession');
            }
          },
        });

    const duplicate = UI.TextLink({
      label: t('hduplicate'),
      onClick: async () => {
        duplicate.disabled = true;
        try {
          const { activity: copy } = await api(`/api/activities/${activity.id}/duplicate`, { method: 'POST' });
          toast(t('hCopiedTo', { title: copy.title }), 'ok');
          refresh();
        } catch (err) {
          toast(err.message, 'bad');
          duplicate.disabled = false;
        }
      },
    });

    const share = UI.TextLink({
      label: activity.published ? t('lUnpublish') : t('lPublish'),
      onClick: async () => {
        if (activity.published) {
          share.disabled = true;
          try {
            await api(`/api/activities/${activity.id}/unpublish`, { method: 'POST' });
            toast(t('lUnpublishedOk'), 'ok');
            refresh();
          } catch (err) {
            toast(err.message, 'bad');
            share.disabled = false;
          }
          return;
        }
        if (slot.firstChild) return slot.replaceChildren();
        slot.append(publishForm(activity, refresh, () => slot.replaceChildren()));
      },
    });

    // النسخة الورقية تحتاج أسئلة النشاط، والبطاقة تحمل عددها لا نصّها
    const paper = UI.TextLink({
      label: t('bPaperPrint'),
      onClick: async () => {
        paper.disabled = true;
        try {
          const { activity: full } = await api('/api/activities/' + activity.id);
          if (!window.Exporter.toPaper(full, { teacher: state.user?.name || '' })) toast(t('bPaperBlocked'), 'warn');
        } catch (err) {
          toast(err.message, 'bad');
        } finally {
          paper.disabled = false;
        }
      },
    });

    const remove = UI.TextLink({
      label: t('hdelete'),
      danger: true,
      onClick: async () => {
        if (!confirm(t('hDeleteConfirm', { title: activity.title }))) return;
        try {
          await api(`/api/activities/${activity.id}`, { method: 'DELETE' });
          toast(t('hactivityDeleted'), 'ok');
          refresh();
        } catch (err) {
          toast(err.message, 'bad');
        }
      },
    });

    return UI.ActivityCard({
      title: activity.title,
      meta: [
        UI.Badge({ label: t('hQuestionCount', { count: activity.questionCount }) }),
        pace ? UI.Badge({ label: pace }) : null,
        activity.published ? UI.Badge({ label: t('lPublished'), kind: 'ok' }) : null,
        activity.published && activity.copies ? UI.Badge({ label: t('lCopies', { n: activity.copies }) }) : null,
        activity.live ? UI.Badge({ label: t('hLiveCode', { code: activity.live.code }), kind: 'live', ltr: true }) : null,
        el('span', {}, [t('hlastEdited'), UI.ltr({ text: when })]),
      ].filter(Boolean),
      actions: [primary, UI.Button({ label: t('hopenAndEdit'), href: '#/edit/' + activity.id, kind: 'outline' })],
      links: [duplicate, share, paper, remove],
      slot,
    });
  }

  function openBuilder() {
    teardown();
    // «#/new» يعني نشاطاً جديداً؛ التعديل يمر عبر «#/edit/:id»
    if ((location.hash.slice(1) || '/') === '/new') setEditingActivity(null);
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';
    const root = el('div', { class: 'stack' });
    // الرجوع وملاحظة الحفظ والدليل صارت في شريط المصمّم نفسه (DESIGN.md §2.6)
    app.append(root);

    // تحذير مبكر إن كان الخادم غير متاح، بدل مفاجأة المدرب عند الإطلاق
    serverAlive().then((alive) => {
      if (!alive && location.hash !== '#/live') showOfflineBanner(app);
    });

    // المحرّر يجب ألا يترك الصفحة فارغة أبداً: نتعافى تلقائياً، وإن استمر العطل نُظهره
    mountBuilderSafely(root);
  }


  // ------------------------------------------------------- لوحة المالك

  /** تاريخ مقروء بالعربية، أو «—» */
  function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString(loc(), { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /** كم يوماً بقي على الاشتراك (سالب = منتهٍ) */
  function daysLeft(ms) {
    if (!ms) return null;
    return Math.ceil((ms - Date.now()) / 86400000);
  }

  /**
   * رسم التسجيلات اليومية — أعمدة بـ HTML لا مكتبة رسمٍ خارجية.
   *
   * الارتفاع نسبيّ لأعلى يومٍ في المدى لا لرقمٍ ثابت، فالفرق بين يومين يُرى
   * سواء كانت الأرقام آحاداً أو مئات. واليوم الصفري يُرسم بخيطٍ رفيع لا بلا
   * شيء: عمودٌ غائب يُقرأ كأن اليوم غير موجود لا كأن أحداً لم يسجّل فيه.
   */
  function signupChart(series) {
    const max = Math.max(1, ...series.map((d) => d.count));
    const total = series.reduce((n, d) => n + d.count, 0);
    const label = (day) => new Date(day + 'T00:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });

    const bars = series.map((d) =>
      el('div', { class: 'sc-col', title: `${label(d.day)} · ${d.count}` }, [
        el('div', { class: 'sc-bar' + (d.count ? '' : ' zero'), style: { height: `${d.count ? Math.max(6, (d.count / max) * 100) : 2}%` } }),
      ])
    );

    return el('div', { class: 'card stack', style: { marginBottom: '12px' } }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 }, text: t('hadmChartTitle', { days: series.length }) }),
        el('span', { class: 'badge ok', text: t('hadmChartTotal', { n: total }) }),
      ]),
      el('div', { class: 'signup-chart' }, bars),
      el('div', { class: 'row between muted small' }, [
        el('span', { text: label(series[0].day) }),
        el('span', { text: t('hadmChartPeak', { n: max }) }),
        el('span', { text: label(series[series.length - 1].day) }),
      ]),
    ]);
  }

  /**
   * اسم البلد للعرض في لوحة المالك. تُملأ الأسماء بعد وصول القائمة، فنكتفي
   * الآن بالرمز — سطرٌ يقول «JO» أوضح من سطرٍ فارغ ينتظر الشبكة.
   */
  let countryNames = null;
  window.T.countryList(loc())
    .then(({ arab, rest }) => {
      countryNames = new Map([...arab, ...rest].map((c) => [c.code, c.name]));
    })
    .catch(() => {});
  const countryName = (code) => (code ? countryNames?.get(code) || code : t('cnNone'));

  /** لوحة المالك: كل المدربين وحالة اشتراكهم مع التحكّم بالمدة */
  async function openAdmin() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    if (!state.user) await loadAccount();
    if (!state.user) {
      location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/admin');
      return;
    }

    let data;
    try {
      data = await api('/api/admin/users');
    } catch (err) {
      app.innerHTML = '';
      app.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { text: t('hpageNotAvailable') }),
          el('p', { class: 'muted small', text: err.message }),
          el('a', { class: 'btn ghost', href: '#/' }, t('hback')),
        ])
      );
      return;
    }

    const draw = () => {
      const users = data.users;
      const active = users.filter((u) => u.isPremium).length;

      app.innerHTML = '';
      app.append(
        el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/' }, t('hback2')),
          el('button', { class: 'btn ghost sm', type: 'button', onclick: openAdmin }, t('hrefresh')),
        ])
      );
      app.append(el('h1', { text: t('hownerPanel2') }));
      const series = data.signups || [];
      const last7 = series.slice(-7).reduce((n, d) => n + d.count, 0);
      app.append(
        el('div', { class: 'stats' }, [
          stat(users.length, t('hregisteredTeachers')),
          stat(active, t('hactivePremiumSubscriptions')),
          stat(users.filter((u) => u.onSignupTrial).length, t('hadmOnTrial')),
          stat(users.filter((u) => u.premiumUntil && !u.isPremium).length, t('hexpiredSubscriptions')),
          stat(last7, t('hadmLast7')),
        ])
      );
      if (series.length) app.append(signupChart(series));

      const rows = users.map((user) => {
        const left = daysLeft(user.premiumUntil);
        const statusBadge = user.isAdmin
          ? el('span', { class: 'badge', text: t('howner') })
          : user.isPremium
            ? el('span', { class: 'badge ok', text: t('hPremiumDays', { days: left }) })
            : user.premiumUntil
              ? el('span', { class: 'badge bad', text: t('hexpired') })
              : el('span', { class: 'badge', text: t('hfree') });

        const apply = async (body, label) => {
          try {
            const res = await api(`/api/admin/users/${user.id}/premium`, { method: 'POST', body });
            const at = data.users.findIndex((u) => u.id === user.id);
            data.users[at] = res.user;
            toast(label, 'ok');
            draw();
          } catch (err) {
            toast(err.message, 'bad');
          }
        };

        const controls = el('div', { class: 'row', style: { gap: '6px' } }, [
          el('button', { class: 'btn sm ok', type: 'button', onclick: () => apply({ addDays: 30 }, t('haMonthWasAdded')) }, t('hmonth')),
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => apply({ addDays: 365 }, t('haYearWasAdded')) }, t('hyear')),
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => apply({ addDays: -30 }, t('haMonthWasDeducted')) }, t('hmonth2')),
          el(
            'button',
            {
              class: 'btn sm ghost',
              type: 'button',
              onclick: () => {
                const current = user.premiumUntil ? new Date(user.premiumUntil).toISOString().slice(0, 10) : '';
                const answer = prompt(t('hsubscriptionExpiryDateYyyy'), current);
                if (answer === null) return;
                if (!answer.trim()) return apply({ until: null }, t('hsubscriptionCancelled'));
                const stamp = Date.parse(answer + 'T23:59:59');
                if (Number.isNaN(stamp)) return toast(t('hdateNotUnderstoodWrite'), 'bad');
                apply({ until: stamp }, t('hdateUpdated'));
              },
            },
            t('hdate')
          ),
          user.premiumUntil
            ? el(
                'button',
                {
                  class: 'btn sm danger',
                  type: 'button',
                  onclick: () => confirm(t('hCancelSubConfirm', { name: user.name })) && apply({ until: null }, t('hsubscriptionCancelled')),
                },
                t('hcancel')
              )
            : null,
        ]);

        return el('tr', {}, [
          el('td', { style: { whiteSpace: 'normal' } }, [
            el('div', { class: 'stack tight' }, [el('strong', { text: user.name }), el('span', { class: 'muted small', text: user.email })]),
          ]),
          el('td', {}, fmtDate(user.createdAt)),
          el('td', {}, countryName(user.country)),
          // ماذا فعل هذا المعلّم فعلاً؟ الحساب المسجّل الذي لم ينشئ شيئاً ليس
          // مستخدماً بعد، والتمييز بينهما بنظرةٍ هو نصف قراءة اللوحة
          el('td', {}, [
            el('div', { class: 'stack tight' }, [
              el('span', { text: `📝 ${user.activities || 0}` }),
              el('span', { class: 'muted small', text: `🎮 ${user.games || 0}` }),
            ]),
          ]),
          el('td', {}, [el('div', { class: 'stack tight' }, [statusBadge, el('span', { class: 'muted small', text: fmtDate(user.premiumUntil) })])]),
          el('td', { style: { whiteSpace: 'normal' } }, [controls]),
        ]);
      });

      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: t('hregisteredTeachers2') }),
          el('p', { class: 'muted small', style: { margin: 0 }, text: t('hextensionsStartFromThe') }),
          el('div', { class: 'table-wrap' }, [
            el('table', {}, [
              el('thead', {}, el('tr', {}, [
                el('th', {}, t('hteacher')),
                el('th', {}, t('hsignedUp')),
                el('th', {}, t('cnColumn')),
                el('th', { title: t('hadmMadeHint') }, t('hadmMade')),
                el('th', {}, t('hsubscription')),
                el('th', {}, t('hcontrols')),
              ])),
              el('tbody', {}, rows),
            ]),
          ]),
        ])
      );
    };

    draw();
  }

  /** رابط واتساب جاهز برسالة مكتوبة — أقصر طريق من رغبة الاشتراك إلى محادثة */
  function whatsappLink(plan, note) {
    const text = t('hWhatsappMsg', { price: plan.priceUsd }) + (note ? ' ' + note : '');
    return `https://wa.me/${plan.whatsapp}?text=${encodeURIComponent(text)}`;
  }

  /**
   * دعوة التسجيل: الحساب الجديد يُفتح له بريميوم تلقائياً، بلا طلبٍ ولا انتظار.
   * تُعرض لمن لم يسجّل بعد — هي أقوى ما نقوله له، فتسبق السعر.
   */
  function signupTrialInvite(plan) {
    const days = plan?.signupTrialDays || 0;
    if (!days || state.user) return null;
    return el('div', { class: 'trial stack' }, [
      el('h2', { style: { margin: 0 }, text: t('upSignupTitle', { days }) }),
      el('p', { style: { margin: 0 }, text: t('upSignupBody', { days }) }),
      el('div', { class: 'row' }, [
        el('a', { class: 'btn accent', href: '/api/auth/google?next=' + encodeURIComponent('/host.html#/ai') }, t('upSignupBtn')),
      ]),
    ]);
  }

  /**
   * عدّاد التجربة للمعلّم الذي يعيشها الآن: كم بقي، وما الذي فُتح له.
   * يُعرض في كل بطاقة بوابة وفي صفحة الباقات — لا في مكانٍ واحد يفوته.
   */
  function trialCountdown() {
    if (!state.premium?.onSignupTrial) return null;
    const days = state.premium.daysLeft || 0;
    return el('div', { class: 'trial row between' }, [
      el('span', { class: 'grow', text: t('upTrialLeft', { days }) }),
      el('a', { class: 'btn primary sm', href: '#/ai' }, t('hdesignWithAi')),
    ]);
  }

  /** بطاقة «هذه ميزة بريميوم» — تُستخدم في المساعد الذكي وفي التصدير */
  function upgradeCard(plan, title) {
    const p = plan || { whatsapp: '970597034066', priceUsd: 5, perks: [], signupTrialDays: 10 };
    return el('div', { class: 'card stack' }, [
      el('h2', { style: { margin: 0 }, text: title || t('hpremiumFeature') }),
      // من لم يسجّل بعد يُدعى للتسجيل لا للدفع، ومن يعيش تجربته يرى ما بقي منها
      signupTrialInvite(p) || trialCountdown(),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('haPremiumSubscriptionUnlocks') }),
      el('div', { class: 'stack tight' }, [
        el('div', { class: 'q-preview' }, [el('span', { class: 'badge', text: '🤖' }), el('span', { class: 'grow', text: t('hdesignTheActivityWith') })]),
        el('div', { class: 'q-preview' }, [el('span', { class: 'badge', text: '📊' }), el('span', { class: 'grow', text: t('hexportResultsToExcel') })]),
      ]),
      el('div', { class: 'row between' }, [
        el('strong', { text: t('hPriceMonthly', { price: p.priceUsd }) }),
        el('a', { class: 'btn primary', href: whatsappLink(p), target: '_blank', rel: 'noopener' }, t('hWhatsappBtn', { phone: p.whatsapp })),
      ]),
      // «وماذا أدفع مقابله؟» سؤالٌ يجب أن يُجاب في الشاشة نفسها لا في رسالة واتساب
      el('a', { class: 'btn ghost sm', href: '#/upgrade' }, t('upCompareLink')),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('hafterYouGetIn') }),
    ]);
  }

  /** صفّ ميزة في بطاقة الباقة: علامةٌ ثم نصّ، والعلامة تحمل معناها للقارئ الصوتي */
  function planPerk(text, on = true) {
    return el('li', { class: on ? 'on' : 'off' }, [
      el('span', { class: 'mark', 'aria-hidden': 'true', text: on ? '✓' : '—' }),
      el('span', { class: 'grow', text }),
    ]);
  }

  /** خلية «متاح / غير متاح» في جدول المقارنة */
  function planCell(on) {
    return el('td', { class: 'plan-cell' }, [
      el('span', { 'aria-hidden': 'true', text: on ? '✅' : '✖' }),
      el('span', { class: 'sr-only', text: on ? t('upYes') : t('upNo') }),
    ]);
  }

  /** [مفتاح النصّ، هل هي في المجّاني؟] — بريميوم يشمل الكلّ */
  const PLAN_ROWS = [
    ['upRow1', true],
    ['upRow2', true],
    ['upRow3', true],
    ['upRow4', true],
    ['upRow5', true],
    ['upRow6', true],
    ['upRow7', true],
    ['upRow8', true],
    ['upRow9', false],
    ['upRow10', false],
    ['upRow11', false],
  ];

  /**
   * صفحة الباقات: ما يأخذه المجّاني مقابل ما يفتحه الاشتراك، مكتوبةً بصدق.
   * المجّاني هنا ليس نسخةً مبتورة — عشرة أنواع أسئلة وكل أنماط التشغيل — والمدفوع
   * ثلاث أدواتٍ للمعلّم وحده. نقولها صراحةً لأن المعلّم سيكتشفها في أول استخدام،
   * وصفحة سعرٍ يكتشف المعلّم أنها بالغت تُفقده الثقة بالمنصة كلها لا بالصفحة.
   */
  async function openUpgrade() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    // السعر ورقم الواتساب يأتيان من الخادم لا من ثابتٍ هنا: كلاهما متغيّر بيئة
    // يتغيّر بلا نشرٍ جديد، وأسوأ ما في صفحة سعرٍ أن تطبع سعراً قديماً.
    let info = state.premium?.plan ? state.premium : null;
    if (!info) info = await api('/api/ai/status').catch(() => null);
    const plan = info?.plan || { whatsapp: '970597034066', priceUsd: 5, perks: [], signupTrialDays: 10 };
    const paid = Boolean(info?.isPremium);

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('hback')),
        el('a', { class: 'btn ghost sm', href: '/help.html' }, t('hteacherGuideTip')),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' }, text: t('upTitle') }));
    app.append(
      el('p', { class: 'muted small', style: { marginTop: 0 } }, [
        el('span', { class: 'badge ok', text: t('upStudentFree') }),
        el('span', { text: ' ' + t('upIntro') }),
      ])
    );

    const freeCard = el('div', { class: 'plan' + (paid ? '' : ' current') }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 }, text: t('upFreeName') }),
        paid ? null : el('span', { class: 'badge ok', text: t('upCurrent') }),
      ]),
      el('div', { class: 'plan-price' }, [
        el('strong', { text: t('upFreePrice') }),
        el('span', { class: 'muted small', text: t('upFreeForever') }),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('upFreeTag') }),
      el('ul', { class: 'plan-list' }, ['upFree1', 'upFree2', 'upFree3', 'upFree4', 'upFree5', 'upFree6'].map((k) => planPerk(t(k)))),
    ]);

    // المشترك لا يُعرض عليه زرّ شراءٍ اشتراه: يرى مدّته وزرّ تجديد لا أكثر
    const until = paid && info?.premiumUntil ? el('span', { class: 'muted small', text: t('upUntilDate', { date: fmtDate(info.premiumUntil) }) }) : null;
    const cta = paid
      ? el('div', { class: 'stack tight' }, [
          el('span', { class: 'badge ok', text: t('upSubscribed') }),
          until,
          el('a', { class: 'btn ghost sm', href: whatsappLink(plan), target: '_blank', rel: 'noopener' }, t('upRenewBtn')),
        ])
      : state.user
        ? el('a', { class: 'btn primary', href: whatsappLink(plan), target: '_blank', rel: 'noopener' }, t('hWhatsappBtn', { phone: plan.whatsapp }))
        : el('div', { class: 'stack tight' }, [
            el('span', { class: 'muted small', text: t('upSignInFirst') }),
            el('a', { class: 'btn primary', href: '/api/auth/google?next=' + encodeURIComponent('/host.html#/upgrade') }, t('upSignInBtn')),
          ]);

    const proCard = el('div', { class: 'plan best' + (paid ? ' current' : '') }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 }, text: t('upProName') }),
        paid ? el('span', { class: 'badge ok', text: t('upCurrent') }) : null,
      ]),
      el('div', { class: 'plan-price' }, [
        el('strong', { dir: 'ltr', text: `$${plan.priceUsd}` }),
        el('span', { class: 'muted small', text: t('upPerMonth') }),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('upProTag') }),
      el('ul', { class: 'plan-list' }, [
        planPerk(t('upEverythingFree')),
        planPerk(t('upPro1')),
        planPerk(t('upPro2')),
        planPerk(t('upPro3')),
      ]),
      cta,
    ]);

    const invite = signupTrialInvite(plan) || trialCountdown();
    if (invite) app.append(invite);

    app.append(el('div', { class: 'plans' }, [freeCard, proCard]));

    app.append(
      el('div', { class: 'card stack', style: { marginTop: '12px' } }, [
        el('h2', { style: { margin: 0 }, text: t('upCompare') }),
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'plans-table' }, [
            el('thead', {}, el('tr', {}, [
              el('th', {}, t('upFeature')),
              el('th', { class: 'plan-cell' }, t('upFreeName')),
              el('th', { class: 'plan-cell' }, t('upProName')),
            ])),
            el('tbody', {}, PLAN_ROWS.map(([key, free]) => el('tr', {}, [el('td', {}, t(key)), planCell(free), planCell(true)]))),
          ]),
        ]),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('upHonest') }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('upManual') }),
      ])
    );
  }

  /**
   * ماذا يستطيع المساعد أن يفعل بالضبط؟
   *
   * «صمّم بالذكاء الاصطناعي» عنوانٌ لا يقول شيئاً: المعلّم يقف أمام حقل كتابة
   * فارغ ولا يعرف أيكتب سؤالاً أم موضوعاً أم أمراً. فنُسمّي الطرق الثلاث
   * صراحةً — وأكثرها مفاجأةً للمعلّم هي لصق نصّ الدرس نفسه.
   */
  function aiWaysCard() {
    const way = (emojiTitle, body) =>
      el('div', { class: 'ai-way' }, [
        el('strong', { text: emojiTitle }),
        el('span', { class: 'muted small', text: body }),
      ]);
    return el('div', { class: 'card stack', style: { marginBottom: '12px' } }, [
      el('h2', { style: { margin: 0 }, text: t('aiWaysTitle') }),
      el('div', { class: 'ai-ways' }, [
        way(t('aiWay1Title'), t('aiWay1Body')),
        way(t('aiWay2Title'), t('aiWay2Body')),
        way(t('aiWay3Title'), t('aiWay3Body')),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('aiWaysNote') }),
    ]);
  }

  // ------------------------------------------------ المسابقات المفتوحة

  /**
   * صفحة مسابقات المعلّم.
   *
   * المسابقة تُبنى من نشاطٍ محفوظ لا من الصفر: أسئلته جاهزةٌ ومجرَّبة،
   * وبناءُ محرّرٍ ثانٍ لها يعني قاعدتَي تحقّقٍ تنحرف إحداهما عن الأخرى.
   * والخادم يردّ ما لا يُصحَّح آلياً برسالةٍ تقول أيَّ أسئلةٍ يستبدل.
   */
  async function openMyContests() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/contests');
      return;
    }

    let items = [];
    let activities = [];
    try {
      [items, activities] = await Promise.all([
        api('/api/contests').then((d) => d.items),
        api('/api/activities').then((d) => d.activities).catch(() => []),
      ]);
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('ctMine') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('hDashboard')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/mine' }, t('hmyActivities')),
          el('a', { class: 'btn ghost sm', href: '#/games' }, t('gMine')),
        ]),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' } }, [t('ctMine'), ' ', window.T.hintDot(t('ctIntro'))]));

    app.append(newContestCard(activities));

    if (!items.length) {
      app.append(el('div', { class: 'card stack center' }, [el('div', { style: { fontSize: '2.2rem' }, text: '🏆' }), el('p', { class: 'muted', text: t('ctNoneYet') })]));
      return;
    }
    app.append(el('div', { class: 'stack' }, items.map(contestCard)));
  }

  function newContestCard(activities) {
    const pick = el('select', {}, [
      el('option', { value: '', text: t('ctPickActivity') }),
      ...activities.map((a) => el('option', { value: a.id, text: `${a.title} (${a.questions?.length || 0})` })),
    ]);
    const days = el('input', { type: 'number', min: '1', max: '30', step: '1', value: '7', inputmode: 'numeric' });
    const retries = el('input', { type: 'checkbox' });
    const note = el('div', { class: 'muted small' });
    const create = el('button', { class: 'btn accent', type: 'button' }, t('ctCreate'));

    create.addEventListener('click', async () => {
      if (!pick.value) return toast(t('ctPickActivity'), 'bad');
      const source = activities.find((a) => a.id === pick.value);
      create.disabled = true;
      note.textContent = '';
      try {
        const res = await api('/api/contests', {
          method: 'POST',
          body: {
            title: source.title,
            questions: source.questions,
            settings: source.settings || {},
            days: Number(days.value) || 7,
            retries: retries.checked,
          },
        });
        toast(t('ctCreated'), 'ok');
        void res;
        openMyContests();
      } catch (err) {
        // رسالة الخادم تسمّي الأسئلة المرفوضة، فهي أنفع من نصٍّ عامّ
        note.textContent = err.message;
        create.disabled = false;
      }
    });

    return el('div', { class: 'card stack' }, [
      el('h2', { style: { margin: 0 } }, [t('ctNewTitle'), ' ', window.T.hintDot(t('ctOnlyAuto'))]),
      activities.length
        ? el('div', { class: 'stack' }, [
            el('label', {}, [el('span', { class: 'small', text: t('ctFromActivity') }), pick]),
            el('label', {}, [el('span', { class: 'small', text: t('ctDays') }), days]),
            el('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
              retries,
              el('span', { class: 'small grow' }, [
                el('strong', { text: t('ctRetriesLabel') }),
                el('span', { class: 'muted small', style: { display: 'block' }, text: t('ctRetriesHint') }),
              ]),
            ]),
            el('div', { class: 'row' }, [create]),
            note,
          ])
        : el('p', { class: 'muted small', style: { margin: 0 }, text: t('ctNoActivities') }),
    ]);
  }

  function contestCard(c) {
    const link = location.origin + '/contest.html#/c/' + c.id;
    const statusLabel = { open: t('ctStatusOpen'), ended: t('ctStatusEnded'), closed: t('ctStatusClosed'), soon: t('ctStatusSoon') }[c.status] || c.status;

    const toggle = el('button', { class: 'btn ghost sm', type: 'button' }, c.status === 'open' ? t('ctClose') : t('ctReopen'));
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        // المفتوحة تُغلق، وما انتهى أو أُغلق يُمدَّد أسبوعاً بالرابط نفسه
        await api('/api/contests/' + c.id, { method: 'PATCH', body: c.status === 'open' ? { closed: true } : { days: 7 } });
        openMyContests();
      } catch (err) {
        toast(err.message, 'bad');
        toggle.disabled = false;
      }
    });

    const remove = el('button', { class: 'btn ghost sm danger', type: 'button' }, t('ctDelete'));
    remove.addEventListener('click', async () => {
      if (!confirm(t('ctDeleteConfirm', { title: c.title }))) return;
      try {
        await api('/api/contests/' + c.id, { method: 'DELETE' });
        toast(t('ctDeleted'), 'ok');
        openMyContests();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });

    return el('div', { class: 'card stack tight' }, [
      el('div', { class: 'row between' }, [
        el('strong', { text: c.title }),
        el('span', { class: 'badge' + (c.status === 'open' ? '' : ' warn'), text: statusLabel }),
      ]),
      el('div', { class: 'row wrap', style: { gap: '6px' } }, [
        el('span', { class: 'badge', text: t('ctQuestions', { n: c.questions }) }),
        el('span', { class: 'badge', text: t('ctEntries', { n: c.entries }) }),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('code', { class: 'grow link-box', text: link }),
        shareButton(link, t('ctCopyLink')),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('a', { class: 'btn primary sm', href: '/contest.html#/c/' + c.id + '/board', target: '_blank', rel: 'noopener' }, t('ctBoard')),
        el('a', { class: 'btn ghost sm', href: '/contest.html#/c/' + c.id, target: '_blank', rel: 'noopener' }, t('ctOpenLink')),
        toggle,
        el('span', { class: 'grow' }),
        remove,
      ]),
    ]);
  }

  /**
   * صفحة «منشئ الألعاب التفاعلية» — تنتهي بلعبةٍ تُلعب هنا وتُنشر في قسم
   * ألعاب المعلّم.
   *
   * بوابتان لا واحدة، وترتيبهما مقصود:
   *
   *  ١) **حساب مسجّل** — فالنداء يُكلّف الخادم. ومن لا حساب له يُساق إلى
   *     الدخول لا إلى صفحة باقاتٍ لا يستطيع الاشتراك فيها أصلاً.
   *
   *  ٢) **حصّة باقية** — لا اشتراكٌ صريح. الحساب المجاني يبني لعبتين مرّةً
   *     واحدة في عمره، والمشترك عشرين كل شهر. فمن معه حصّةٌ يدخل ويبني وإن
   *     كان مجانياً، ومن نفدت حصّته يرى ما نفد ولماذا وكيف يزيده — لا باباً
   *     مغلقاً بلا سبب.
   *
   * والحصّة تُقرأ من الخادم **قبل الرسم**: أن يكتب المعلّم درسه وينتظر
   * دقيقتين ثم يُقال له «لا حصّة لك» أسوأ من أن يُقال له قبل أن يبدأ.
   */
  async function openGameBuilder() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('hhome')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/games' }, t('gMine')),
          el('a', { class: 'btn ghost sm', href: '/games.html' }, t('gNav')),
        ]),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' } }, [t('gbTitle'), ' ', window.T.hintDot(t('gbIntro'))]));

    const root = el('div', { class: 'stack' });
    app.append(root);

    if (!state.user) {
      root.append(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.2rem' }, text: '🕹' }),
          el('h2', { style: { margin: 0 }, text: t('gbTitle') }),
          el('p', { class: 'muted', text: t('gbSignInFirst') }),
          el('a', { class: 'btn primary', href: '/api/auth/google?next=' + encodeURIComponent('/host.html#/game-ai') }, t('hsignInWithGoogle')),
        ])
      );
      return;
    }

    root.append(el('div', { class: 'card center' }, el('div', { class: 'spinner' })));

    let status;
    try {
      status = await api('/api/game-ai/status');
    } catch (err) {
      root.replaceChildren(el('div', { class: 'card stack center' }, [el('h2', { text: t('gbTitle') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }
    // غادر المعلّم الشاشة قبل أن يردّ الخادم
    if (!root.isConnected) return;
    root.replaceChildren();

    const quota = status.quota;
    if (quota && !quota.unlimited && quota.remaining <= 0) {
      root.append(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.2rem' }, text: '🕹' }),
          el('h2', { style: { margin: 0 }, text: t('gbTitle') }),
          el('p', { class: 'muted', style: { margin: 0 }, text: quotaSpentLine(quota) }),
        ])
      );
      // المشترك الذي نفدت حصّته لا يُعرض عليه اشتراك: حصّته تعود مع الشهر
      if (quota.plan !== 'premium') root.append(upgradeCard(status.plan, t('gbUnlock')));
      return;
    }

    if (!status.configured) root.append(el('div', { class: 'note warn small' }, t('gbNotConfigured')));
    if (quota) root.append(quotaNote(quota));
    const chat = el('div', { class: 'stack' });
    root.append(chat);
    window.GameBuilder.render(chat, quota);
  }

  /** سطرُ ما نفد — يقول كم كانت الحصّة ومتى تعود */
  function quotaSpentLine(quota) {
    return quota.plan === 'premium'
      ? t('gbQuotaSpentPremium', { n: quota.limit })
      : t('gbQuotaSpentFree', { n: quota.limit, premium: quota.premiumMonthly });
  }

  /** شارةُ ما بقي — تُقرأ قبل أن يكتب المعلّم حرفاً */
  function quotaNote(quota) {
    if (quota.unlimited) return el('div', { class: 'note small', text: t('gbQuotaUnlimited') });
    const line =
      quota.plan === 'premium'
        ? t('gbQuotaPremium', { left: quota.remaining, limit: quota.limit })
        : t('gbQuotaFree', { left: quota.remaining, limit: quota.limit, premium: quota.premiumMonthly });
    return el('div', { class: 'note small' + (quota.remaining <= 1 ? ' warn' : ''), 'data-quota': '1', text: line });
  }

  /** صفحة المحادثة مع المساعد الذكي — تنتهي بمسودة تُفتح في المحرّر */
  function openAiDesigner() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';
    app.append(
      /*
       * زرٌّ واحد يعود إلى لوحة المعلّم.
       *
       * كان هنا زرّان: «العودة للمحرّر» إلى ‎#/new‎ و«الرئيسية» إلى ‎#/‎.
       * والأوّل — وهو الذي يقع تحت الإبهام أوّلاً ويُقرأ «رجوع» — كان يفتح
       * المحرّر على أوّل مراحله (الإعدادات)، فيجد المعلّم نفسه في شاشةٍ لم
       * يطلبها ظنّاً أنه رجع. ولا حاجة إليه أصلاً: المسودة حين تجهز تُفتح في
       * المحرّر وحدها، وما لم تجهز فلا شيء ينتظره هناك.
       */
      el('div', { class: 'row', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('hbackToDashboard')),
      ])
    );
    const root = el('div', { class: 'stack' });
    app.append(root);

    // الخدمة تكلّف الخادم نداءً حقيقياً — لذا هي للمدربين المسجّلين فقط
    if (!state.user) {
      root.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { text: t('hdesignYourActivityWith') }),
          el('p', { class: 'muted', text: t('hsignInFirstSo') }),
          el('a', { class: 'btn primary', href: '/api/auth/google?next=' + encodeURIComponent('/host.html#/ai') }, t('hsignInWithGoogle')),
        ])
      );
      return;
    }

    if (!state.premium?.isPremium) {
      root.append(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.2rem' }, text: '🤖' }),
          el('h2', { style: { margin: 0 }, text: t('hdesignYourActivityWith2') }),
          el('p', { class: 'muted', style: { margin: 0 }, text: t('htellTheAssistantAbout2') }),
        ])
      );
      root.append(aiWaysCard());
      root.append(upgradeCard(state.premium?.plan, t('hunlockTheAiAssistant')));
      return;
    }

    // فوق `root` لا داخله: محادثة المساعد تمسح جذرها عند الرسم
    app.insertBefore(aiWaysCard(), root);
    window.AiChat.render(root, {
      onApprove: (draft) => {
        window.Builder.saveDraft(draft);
        setEditingActivity(null);
        // المسودة جاهزة: نفتحها على المراجعة مباشرةً لا على أول الإعدادات
        state.builderStage = 'review';
        toast(t('htheDraftIsOpen'), 'ok');
        location.hash = '#/new';
      },
    });

    api('/api/ai/status')
      .then((status) => {
        if (!status.configured) {
          root.prepend(
            el('div', { class: 'note warn small' },
              t('htheAssistantIsNot'))
          );
        }
      })
      .catch(() => {});
  }

  function mountBuilderSafely(root) {
    // المحرّر يحتاج معرفة الاشتراك: رفع الصور للمشتركين فقط
    window.Builder.setPremium(state.premium);
    const onLaunch = async (draft) => {
      try {
        const payload = {
          title: draft.title,
          // لغة النشاط = لغة واجهة منشئه، فتتبعها شاشات الطلاب
          settings: { ...draft.settings, lang: window.I18n ? window.I18n.getLang() : 'ar' },
          questions: draft.questions.map((question) => ({
            ...question,
            options: (question.options || []).filter((option) => option.text.trim()),
          })),
        };
        if (state.editingActivityId) payload.activityId = state.editingActivityId;
        // إنشاء الجلسة يتطلّب حساباً: نسوقه إلى الدخول ونعيده إلى محرّره
        if (!state.user && !(await loadAccount())) {
          toast(t('hLoginToLaunch'), 'bad');
          setTimeout(() => {
            location.href = '/api/auth/google?next=' + encodeURIComponent('/host.html#/new');
          }, 1200);
          return;
        }
        const created = await api('/api/sessions', { method: 'POST', body: payload });
        rememberHost(created.code, created.hostToken, created.title);
        // الخادم يحفظ النشاط تلقائياً للمدرب المسجّل — نتذكر معرّفه حتى لا يتكرر
        if (created.activityId) {
          setEditingActivity(created.activityId);
          toast(t('htheActivityWasSaved'), 'ok');
        }
        location.hash = '#/live/' + created.code;
      } catch (err) {
        toast(err.message, 'bad');
        if (err.offline) showOfflineBanner(app);
      }
    };

    try {
      const startStage = state.builderStage;
      state.builderStage = null;
      window.Builder.mount(root, onLaunch, saveAction, {
        startStage,
        teacherName: state.user?.name || '',
        // محفوظٌ في «نشاطاتي» أم في المتصفّح وحده — يقرّر تحذير المصمّم
        savedOnServer: !!state.editingActivityId,
        onBack: () => {
          location.hash = '#/';
        },
      });
      return;
    } catch (err) {
      // السبب الأشيع: مسودة محفوظة من نسخة قديمة — نمسحها ونعيد المحاولة
      console.error(t('hcouldNotBuildThe'), err);
      try {
        localStorage.removeItem(window.Builder.DRAFT_KEY);
      } catch {
        /* تجاهل */
      }
      root.innerHTML = '';
      try {
        // مسار التعافي بعد إعادة تعيين المسودة: يبدأ من أوّل المعالج دائماً
        window.Builder.mount(root, onLaunch, saveAction);
        toast(t('htheDraftWasReset'), 'ok');
        return;
      } catch (err2) {
        showBuilderError(root, err2);
      }
    }
  }

  /**
   * زر «حفظ في حسابي» داخل المحرّر.
   * بلا حساب يدعو لتسجيل الدخول بدل إخفاء الميزة، ومع نشاط مفتوح يحدّثه بدل تكراره.
   */
  function saveAction(draft, validate) {
    if (!state.user) {
      return el(
        'a',
        { class: 'btn ghost', href: '/api/auth/google?next=' + encodeURIComponent('/host.html#/new') },
        t('hsignInToSave')
      );
    }

    const editing = !!state.editingActivityId;
    const button = el('button', { class: 'btn ghost', type: 'button' }, editing ? t('hsaveChanges') : t('hsaveToMyAccount'));
    button.addEventListener('click', async () => {
      const problem = validate(draft);
      if (problem) return toast(problem, 'bad');
      const payload = {
        title: draft.title,
        settings: draft.settings,
        questions: draft.questions.map((question) => ({
          ...question,
          options: (question.options || []).filter((option) => option.text.trim()),
        })),
      };
      button.disabled = true;
      button.textContent = t('hsaving');
      try {
        if (editing) {
          await api('/api/activities/' + state.editingActivityId, { method: 'PUT', body: payload });
          toast(t('hchangesSaved'), 'ok');
        } else {
          const { activity } = await api('/api/activities', { method: 'POST', body: payload });
          setEditingActivity(activity.id);
          toast(t('hsavedToYourAccount'), 'ok');
        }
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        button.disabled = false;
        button.textContent = state.editingActivityId ? t('hsaveChanges') : t('hsaveToMyAccount');
      }
    });
    return button;
  }

  /** بديل مرئي بدل صفحة فارغة، مع نص الخطأ ليسهل تشخيصه */
  function showBuilderError(root, err) {
    root.innerHTML = '';
    root.append(
      el('div', { class: 'card stack' }, [
        el('h2', { text: t('hcouldNotOpenThe') }),
        el('p', { class: 'muted small', text: t('htryResettingIfIt') }),
        el('pre', {
          style: {
            direction: 'ltr',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            background: 'rgba(0,0,0,.3)',
            padding: '10px',
            borderRadius: '10px',
            fontSize: '.8rem',
            margin: 0,
          },
          text: String(err && err.message ? err.message : err),
        }),
        el(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: () => {
              try {
                localStorage.clear();
                sessionStorage.clear();
              } catch {
                /* تجاهل */
              }
              location.reload();
            },
          },
          t('hresetAndReload')
        ),
      ])
    );
  }

  // ---------------------------------------------------------- العرض المباشر

  function openLive(code) {
    const hostToken = hostTokenFor(code);
    if (!hostToken) {
      app.innerHTML = '';
      app.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { text: t('hweDoNotHave') }),
          el('p', { class: 'muted small', text: t('htheHostKeyIs') }),
          el('a', { class: 'btn primary', href: '#/' }, t('hcreateANewActivity')),
        ])
      );
      return;
    }

    teardown();
    state.code = code;
    state.hostToken = hostToken;
    state.tab = 'stage';
    codeBadge.textContent = '🔑 ' + code;
    codeBadge.classList.remove('hidden');
    connBadge.classList.remove('hidden');

    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    state.socket = connect({
      onOpen: () => state.socket.send({ t: 'host:hello', code, hostToken }),
      onStatus: (status) => {
        connBadge.className = 'badge ' + (status === 'online' ? 'ok' : status === 'offline' ? 'bad' : '');
        connBadge.textContent = status === 'online' ? t('hlive') : status === 'offline' ? t('hoffline') : t('hconnecting');
      },
      onMessage: (msg) => {
        if (msg.t === 'state') {
          // يجب التقاط الفارق لحظة الوصول؛ حسابه لاحقاً يجعله دائماً صفراً
          if (msg.serverNow) state.clockOffset = Date.now() - msg.serverNow;
          const previous = state.live;
          state.live = msg;
          announce(previous, msg);
          scheduleRender();
        } else if (msg.t === 'reaction') {
          Fx.floatEmoji(msg.emoji);
        } else if (msg.t === 'dashboard') {
          state.dashboard = msg.data;
          // لوحة التحكم ومسرح الوضع الحر كلاهما يرسمان من هذه البيانات
          if (state.tab === 'dashboard' || state.live?.pace === 'self') scheduleRender();
        } else if (msg.t === 'session:closed') {
          toast(t('hsessionEnded'), 'bad');
          teardown();
          location.hash = '#/';
        } else if (msg.t === 'error') {
          toast(msg.message, 'bad');
          if (msg.code === 'no_session' || msg.code === 'forbidden') {
            const hosts = store.local.get(HOSTS_KEY, {});
            delete hosts[code];
            store.local.set(HOSTS_KEY, hosts);
            setTimeout(() => (location.hash = '#/'), 1200);
          }
        }
      },
    });

    api('/api/sessions/' + code)
      .then((info) => {
        state.joinUrl = info.joinUrl;
      })
      .catch(() => {});
  }

  /** أصوات ومؤثرات عند تغيّر المراحل ودخول المشاركين */
  function announce(previous, next) {
    if (previous && next.participants.length > previous.participants.length) Fx.play('join');
    const key = next.status + ':' + next.phase + ':' + next.index;
    if (key === state.lastPhaseKey) return;
    const first = state.lastPhaseKey === '';
    state.lastPhaseKey = key;
    if (first) return;
    if (next.phase === 'results') Fx.play('reveal');
    else if (next.status === 'ended') {
      Fx.play('finish');
      Fx.confetti(150);
    } else if (next.phase === 'leaderboard') Fx.play('reveal');
  }

  function teardown() {
    state.socket?.close();
    state.socket = null;
    state.live = null;
    state.dashboard = null;
    state.lastPhaseKey = '';
    clearTick();
    // رسمةٌ معلّقة بعد المغادرة ترسم على شاشةٍ أخرى — تُلغى مع الاتصال
    cancelRender();
  }

  function send(type, extra) {
    if (!state.socket?.send({ t: type, ...(extra || {}) })) toast(t('hnoConnection'), 'bad');
  }

  // ------------------------------------------------------------- الرسم

  /**
   * رسمةٌ واحدة لكل إطار، مهما تدفّقت الرسائل.
   *
   * كان كل «state» وكل «dashboard» يستدعي `renderLive` فوراً، والخادم يرسلهما
   * معاً كل ١٢٠ms ما دام أحدٌ يجيب. فصفٌّ من ستين طالباً يعني ثماني عمليات
   * إعادة بناءٍ كاملة للشاشة في الثانية — وتكلفة كلٍّ منها **تكبر** مع تقدّم
   * الاختبار، لأن طابور التصحيح يضمّ صفّاً لكل طالبٍ في كل سؤالٍ نصّي.
   *
   * فتبدأ الشاشة سريعة وتتجمّد في أواخر الاختبار: قِسناها فوجدنا الاستجابة
   * تنزل من ٢٦ms في الجولة الأولى إلى ٢٥٣ms في الأخيرة، و٥.٩ ثانية محجوبة
   * إجمالاً. وعلى جهاز معلّمٍ حقيقي — أبطأ من بيئة القياس — تصير ثوانٍ.
   *
   * `requestAnimationFrame` يطوي الدفعة كلّها في رسمةٍ واحدة. ومهلة احتياطية
   * لأن المتصفّح يوقف الإطارات في التبويب المخفيّ، فلولاها لبقيت الشاشة على
   * حالٍ قديمة حتى يعود إليها المعلّم.
   */
  let renderPending = 0;
  let renderFallback = null;
  function scheduleRender() {
    if (renderPending) return;
    const run = () => {
      if (!renderPending) return;
      cancelAnimationFrame(renderPending);
      clearTimeout(renderFallback);
      renderPending = 0;
      renderFallback = null;
      renderLive();
    };
    renderPending = requestAnimationFrame(run);
    renderFallback = setTimeout(run, 250);
  }

  function cancelRender() {
    if (renderPending) cancelAnimationFrame(renderPending);
    clearTimeout(renderFallback);
    renderPending = 0;
    renderFallback = null;
  }

  function renderLive() {
    cancelRender();
    const s = state.live;
    if (!s) return;
    clearTick();
    app.innerHTML = '';

    app.append(
      el('div', { class: 'row between', style: { marginBottom: '12px' } }, [
        el('div', { class: 'grow' }, [
          el('h1', { text: s.title, style: { margin: 0, fontSize: '1.3rem' } }),
          el('div', { class: 'muted small', text: statusLabel(s) }),
        ]),
        el('span', { class: 'badge live' }, `👥 ${s.participants.length}`),
      ])
    );

    // الصدق أرخص من الحيرة: جلسةٌ نجت إعادة تشغيل الخادم تبدو سليمة تماماً
    // بينما عدّاد المشاركين صفر، فيظنّ المعلّم العطل في جهازه أو في طلابه.
    if (s.restored) {
      app.append(el('div', { class: 'banner', style: { marginBottom: '12px' }, text: '⚠️ ' + t('hRestoredNote') }));
    }

    const tabs = el('div', { class: 'tabs', style: { marginBottom: '12px' } }, [
      tabBtn('stage', t('hstage')),
      tabBtn('dashboard', t('hdashboard')),
      tabBtn('analytics', t('hanalysis')),
      tabBtn('share', t('hshare')),
    ]);
    app.append(tabs);

    if (state.tab === 'stage') renderStage(s);
    else if (state.tab === 'dashboard') {
      // فتحُ لوحة النتائج هو الخطوة الرابعة في الدليل — نعلّمها هنا لا نفترضها
      markSawResults();
      renderDashboard();
    }
    else if (state.tab === 'analytics') renderAnalytics();
    else renderShare(s);

    renderBar(s);
  }

  function tabBtn(key, label) {
    const button = el('button', { class: state.tab === key ? 'on' : '', type: 'button' }, label);
    button.addEventListener('click', () => {
      state.tab = key;
      if (key === 'dashboard') send('host:dashboard');
      if (key === 'analytics') loadAnalytics(true);
      renderLive();
    });
    return button;
  }

  const PACE_LABEL = { host: t('hyouControlThePace'), auto: t('hautoAdvance'), self: t('heveryoneAtTheirOwn') };

  function statusLabel(s) {
    if (s.status === 'ended') return t('pActivityEnded');
    if (s.status === 'lobby') return t('hWaitingStart', { pace: PACE_LABEL[s.pace] || '' });
    if (s.pace === 'self') return t('hSelfTotal', { pace: PACE_LABEL.self, total: s.total });
    const phase = { question: t('hanswering'), results: t('hshowResults'), leaderboard: t('hleaderboard') }[s.phase] || '';
    return t('hStatusLine', { index: s.index + 1, total: s.total, phase, auto: s.pace === 'auto' ? ' · ' + t('hAutoSuffix') : '' });
  }

  // ------------------------------------------------------------- المسرح

  function renderStage(s) {
    if (s.status === 'lobby') return renderLobby(s);
    if (s.deadlineAt && s.deadlineAt > serverTime()) {
      const value = el('strong', {});
      app.append(el('div', { class: 'deadline-bar' }, [el('span', { text: t('htheQuizEndsIn') }), value]));
      state.stopDeadline = countdownTo(value, s.deadlineAt);
    }
    if (s.status === 'ended' || s.phase === 'final') return renderFinal(s);
    if (s.pace === 'self') return renderSelfStage(s);
    if (s.phase === 'leaderboard') return renderBoard(s);
    return renderQuestion(s);
  }

  /** شاشة المدرب في الوضع الحر: متابعة تقدّم الجميع + تصفّح نتائج أي سؤال */
  function renderSelfStage(s) {
    const total = s.participants.length;
    const done = s.finishedCount || 0;

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('span', { class: 'badge' }, t('hselfPacedEveryoneAt')),
          el('span', { class: 'badge' + (done === total && total ? ' ok' : '') }, t('hFinishedOf', { done, total })),
        ]),
        el('div', { class: 'progress' }, el('i', { style: { width: (total ? (done / total) * 100 : 0) + '%' } })),
      ])
    );

    // أين وصل كل متدرب
    const people = el('div', { class: 'people' });
    if (!total) people.append(el('span', { class: 'muted small', text: t('hnoParticipants') }));
    s.participants.forEach((p) => {
      people.append(
        el('span', { class: 'chip' + (p.done ? ' answered' : '') + (p.connected ? '' : ' off') }, [
          avatarNode(p.avatar, 'sm'),
          el('span', { text: p.name }),
          el('span', { class: 'badge', text: p.done ? t('hfinished') : `${p.at}/${s.total}` }),
        ])
      );
    });
    app.append(el('div', { class: 'card stack' }, [el('h2', { text: t('hwhereIsEveryone'), style: { margin: 0 } }), people]));

    // تصفّح نتائج أي سؤال
    const picker = el('div', { class: 'tabs', style: { marginBottom: '10px' } });
    s.questions.forEach((question, index) => {
      const button = el('button', { class: state.selfQuestion === index ? 'on' : '', type: 'button' }, String(index + 1));
      button.addEventListener('click', () => {
        state.selfQuestion = index;
        renderLive();
      });
      picker.append(button);
    });
    const index = Math.min(state.selfQuestion || 0, s.questions.length - 1);
    const current = s.questions[index];
    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { text: t('hquestionResults'), style: { margin: 0 } }),
          el('span', { class: 'badge' }, `${TYPE_EMOJI[current.type]} ${TYPE_LABELS[current.type]}`),
        ]),
        picker,
        el('h3', { text: current.text }),
        selfResults(index),
      ])
    );
  }

  /** نتائج سؤال محدد في الوضع الحر (تُؤخذ من لوحة الإحصاءات) */
  function selfResults(index) {
    const data = state.dashboard;
    const row = data?.perQuestion?.[index];
    if (!row) {
      send('host:dashboard');
      return el('p', { class: 'muted center', text: t('hloading') });
    }
    const wrap = el('div', { class: 'stack' });
    wrap.append(
      el('div', { class: 'stats' }, [
        stat(`${row.responses}/${row.reached}`, t('hansweredReached')),
        row.accuracy === null ? null : stat(row.accuracy + t('pctSuffix'), t('haccuracy')),
        stat(fmtMs(row.avgMs), t('haverageTime')),
      ].filter(Boolean))
    );
    // النتائج الفعلية: سحابة الكلمات، أعمدة المقياس، الخيارات، أو الإجابات المفتوحة
    if (row.results && row.results.total > 0) {
      wrap.append(resultsView({ scored: row.correct !== null }, row.results, true));
    } else {
      wrap.append(el('p', { class: 'muted center small', style: { margin: 0 }, text: t('hnoAnswersToThis') }));
    }
    return wrap;
  }

  function renderLobby(s) {
    const card = scheduleCard(s);
    if (card) app.append(card);
    app.append(
      el('div', { class: 'card' }, [
        el('div', { class: 'joinbox' }, [qrBox(), joinInfo(s)]),
      ])
    );
    app.append(peopleCard(s));
  }

  /** بطاقة الجدولة: متى يفتح الاختبار تلقائياً وكم مدته */
  function scheduleCard(s) {
    const opensAt = s.scheduledAt && s.scheduledAt > serverTime() ? s.scheduledAt : null;
    const duration = s.durationMinutes || 0;
    // موعد التسليم يظهر حتى قبل انطلاق الجلسة: المعلّم يوزّع الرابط الآن
    // ويريد أن يرى — قبل أن يرسله — إلى متى سيبقى حيّاً
    const dueAt = s.settings?.dueAt || 0;
    if (!opensAt && !duration && !dueAt) return null;

    const value = opensAt ? el('strong', { class: 'countdown-big' }) : null;
    if (value) state.stopSchedule = countdownTo(value, opensAt, () => renderLive());

    return el('div', { class: 'card stack schedule-card' }, [
      opensAt ? el('span', { class: 'badge', text: t('hscheduledQuiz') }) : el('span', { class: 'badge', text: t('hfixedDuration') }),
      opensAt ? el('p', { class: 'muted', style: { margin: 0 }, text: t('hopensAutomaticallyIn') }) : null,
      value,
      opensAt
        ? el('span', {
            class: 'muted small',
            text: new Date(opensAt).toLocaleString(loc(), { dateStyle: 'full', timeStyle: 'short' }),
          })
        : null,
      duration ? el('span', { class: 'badge' }, t('hDurationNote', { n: duration })) : null,
      dueAt
        ? el('span', { class: dueAt > serverTime() ? 'badge' : 'badge bad' },
            dueAt > serverTime()
              ? t('hDueBadge', { when: new Date(dueAt).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }) })
              : t('hDuePassed'))
        : null,
      opensAt ? el('span', { class: 'muted small', text: t('hyouCanStartBefore') }) : null,
    ]);
  }

  function qrBox() {
    const box = el('div', { class: 'qr' });
    const url = state.joinUrl || `${location.origin}/j/${state.code}`;
    fetch('/api/qr?text=' + encodeURIComponent(url))
      .then((response) => response.text())
      .then((svg) => {
        box.innerHTML = svg;
      })
      .catch(() => {
        box.textContent = t('hcouldNotGenerateThe');
      });
    return box;
  }

  function joinInfo(s) {
    const url = state.joinUrl || `${location.origin}/j/${state.code}`;
    return el('div', { class: 'stack center' }, [
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('hopenThisAddressIn') }),
      el('div', { style: { direction: 'ltr', fontWeight: '700' }, text: url.replace(/^https?:\/\//, '') }),
      el('p', { class: 'muted small', style: { margin: '6px 0 0' }, text: t('horEnterTheCode') }),
      el('div', { class: 'bigcode', text: state.code }),
      el('div', { class: 'row', style: { justifyContent: 'center' } }, [
        el('button', { class: 'btn sm', type: 'button', onclick: () => copy(url) }, t('hcopyLink')),
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => share(url, s.title) }, t('hshare2')),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: s.settings.requireName ? t('hparticipantsWillBeAsked') : t('hanonymousModeNoName') }),
    ]);
  }

  function peopleCard(s) {
    const people = el('div', { class: 'people' });
    if (!s.participants.length) {
      people.append(el('span', { class: 'muted small', text: t('hnobodyHasJoinedYet') }));
    }
    s.participants.forEach((participant) => {
      const team = s.teams && participant.teamId != null ? s.teams[participant.teamId] : null;
      const chip = el(
        'span',
        { class: 'chip' + (participant.answeredCurrent ? ' answered' : '') + (participant.connected ? '' : ' off') },
        [avatarNode(participant.avatar, 'sm'), el('span', { text: (team ? team.emoji + ' ' : '') + participant.name })]
      );
      chip.title = t('hlongPressToRemove');
      chip.addEventListener('dblclick', () => {
        if (confirm(t('hKickConfirm', { name: participant.name }))) send('host:kick', { participantId: participant.id });
      });
      people.append(chip);
    });
    return el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('h2', { text: t('hPeopleCount', { count: s.participants.length }), style: { margin: 0 } }),
        el('span', { class: 'muted small', text: t('hdoubleTapAName') }),
      ]),
      people,
    ]);
  }

  /** كم بقي على فتح السؤال (بتوقيت الخادم) */
  function openIn(s) {
    if (!s.opensAt) return 0;
    return s.opensAt - serverTime();
  }

  function renderQuestion(s) {
    const q = s.question;
    const results = s.results;
    const answered = s.answeredCount;
    const total = s.participants.length;

    // عدّاد «استعد» — نفس التوقيت على كل الشاشات
    const untilOpen = openIn(s);
    if (s.phase === 'question' && untilOpen > 250) {
      app.append(
        el('div', { class: 'card stack center' }, [
          el('span', { class: 'badge' }, t('hEmojiQuestionOf', { emoji: TYPE_EMOJI[q.type], index: s.index + 1, total: s.total })),
          q.imageUrl ? el('img', { class: 'q-image', src: q.imageUrl, alt: t('pQuestionImage') }) : null,
          el('h2', { class: 'big-q', text: q.text }),
          el('p', { class: 'muted', text: t('pGetReady') }),
        ])
      );
      state.cancelCountdown = Fx.countdown(untilOpen, () => {
        state.cancelCountdown = null;
        renderLive();
      });
      return;
    }

    const head = el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('span', { class: 'badge' }, `${TYPE_EMOJI[q.type]} ${TYPE_LABELS[q.type]}`),
        el('span', { class: 'badge' + (answered === total && total > 0 ? ' ok' : '') }, t('hAnsweredOf', { answered, total })),
      ]),
      q.imageUrl ? el('img', { class: 'q-image', src: q.imageUrl, alt: t('pQuestionImage') }) : null,
      el('h2', { class: 'big-q', text: q.text }),
    ]);

    if (q.timeLimit && s.phase === 'question') {
      head.append(
        el('div', { class: 'timer' }, [
          el('span', { class: 'num', id: 'tnum', text: String(q.timeLimit) }),
          el('div', { class: 'progress' }, el('i', { id: 'tbar', style: { width: '100%' } })),
        ])
      );
    }
    app.append(head);

    // شريط تقدّم الإجابات
    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between small muted' }, [el('span', { text: t('hanswerRate') }), el('span', { text: total ? Math.round((answered / total) * 100) + t('pctSuffix') : '—' })]),
        el('div', { class: 'progress thin' }, el('i', { style: { width: (total ? (answered / total) * 100 : 0) + '%' } })),
      ])
    );

    // مؤشر الانتقال التلقائي
    if (s.autoNextAt && s.phase !== 'question') {
      const label = el('span', { class: 'badge', id: 'autoNext' }, '…');
      app.append(el('div', { class: 'card row between' }, [el('span', { class: 'muted small', text: t('hautoAdvanceIn') }), label]));
      startAutoTick(s, label);
    }

    app.append(resultsView(q, results, s.phase === 'results'));
    if (s.phase === 'question') startTick(s, q);
  }

  function resultsView(q, results, reveal) {
    const card = el('div', { class: 'card stack' });
    if (!results || results.total === 0) {
      card.append(el('p', { class: 'muted center', style: { margin: 0 }, text: t('sNoAnswersYet') }));
      return card;
    }

    if (results.options) {
      const options = el('div', { class: 'options' });
      results.options.forEach((option, index) => {
        options.append(
          el(
            'div',
            { class: `opt c${index % 8}` + (reveal && option.correct ? ' correct' : '') + (reveal && !option.correct && q.scored ? ' dim' : '') },
            [
              el('i', { class: 'bar', style: { width: option.percent + '%' } }),
              el('span', { class: 'tag', text: String.fromCharCode(65 + index) }),
              el('span', { class: 'grow', text: option.text }),
              option.correct ? el('span', { class: 'badge ok', text: '✓' }) : null,
              el('span', { class: 'count', text: `${option.percent}${t('pctSuffix')} · ${option.count}` }),
            ]
          )
        );
      });
      card.append(options);
      if (q.scored) {
        card.append(
          el('p', { class: 'muted small center', style: { margin: 0 } }, t('hCorrectSummary', { correct: results.correctCount, total: results.total, time: fmtMs(results.avgMs) }))
        );
      }
      return card;
    }

    if (results.words) {
      const cloud = el('div', { class: 'cloud' });
      const max = Math.max(1, ...results.words.map((word) => word.count));
      const colors = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#22d3ee'];
      results.words.forEach((word, index) => {
        cloud.append(
          el('span', {
            text: word.text + (word.count > 1 ? ` ×${word.count}` : ''),
            style: { fontSize: (1 + (word.count / max) * 2.2).toFixed(2) + 'rem', color: colors[index % colors.length] },
          })
        );
      });
      card.append(cloud);
      return card;
    }

    if (results.buckets) {
      results.buckets.forEach((bucket) => {
        card.append(
          el('div', { class: 'row' }, [
            el('span', { class: 'badge', text: String(bucket.value) }),
            el('div', { class: 'progress grow' }, el('i', { style: { width: bucket.percent + '%' } })),
            el('span', { class: 'small muted', text: `${bucket.percent}${t('pctSuffix')} (${bucket.count})` }),
          ])
        );
      });
      card.append(el('p', { class: 'center', style: { margin: 0 } }, [el('strong', { text: t('sAverage') + results.average })]));
      return card;
    }

    if (results.responses) {
      const quotes = el('div', { class: 'quotes' });
      results.responses
        .slice()
        .reverse()
        .forEach((response) => {
          quotes.append(
            el('div', { class: 'quote' }, [
              response.name ? el('div', { class: 'small muted', text: response.name }) : null,
              el('div', { text: response.text }),
            ])
          );
        });
      card.append(quotes);
      return card;
    }

    return card;
  }

  function renderBoard(s) {
    app.append(el('h2', { class: 'center', text: t('hleaderboard2') }));
    app.append(el('div', { class: 'card' }, boardList(s.leaderboard || [])));
    const teamCard = teamBoard(s.teamLeaderboard);
    if (teamCard) app.append(teamCard);
  }

  /** ترتيب الفرق — يظهر إلى جانب ترتيب الأفراد عندما يكون وضع الفرق مفعّلاً */
  function teamBoard(list) {
    if (!list?.length) return null;
    const board = el('div', { class: 'board' });
    list.forEach((team) => {
      board.append(
        el('div', { class: 'item' }, [
          el('span', { class: 'rank', text: String(team.rank) }),
          el('span', { style: { fontSize: '1.3rem' }, text: team.emoji }),
          el('span', { class: 'grow', text: `${team.name} (${team.members})` }),
          el('span', { class: 'score', text: String(team.score) }),
        ])
      );
    });
    return el('div', { class: 'card stack' }, [el('h2', { text: t('pTeamBoard'), style: { margin: 0 } }), board]);
  }

  function renderFinal(s) {
    app.append(
      el('div', { class: 'card stack center' }, [
        el('div', { style: { fontSize: '3rem' }, text: '🎊' }),
        el('h2', { text: t('pActivityEnded'), style: { margin: 0 } }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('hdownloadTheResultsNow') }),
        el('div', { class: 'row', style: { justifyContent: 'center' } }, [
          el('button', { class: 'btn accent', type: 'button', onclick: () => exportAs('excel') }, t('hdownloadExcel')),
          el('button', { class: 'btn accent', type: 'button', onclick: () => exportAs('pdf') }, t('hpdfReport')),
          el('button', { class: 'btn ghost', type: 'button', onclick: exportResults }, '⬇ JSON'),
        ]),
        state.premium?.isPremium ? null : el('span', { class: 'badge', text: t('hexcelAndPdfAre') }),
        el('div', { class: 'row', style: { justifyContent: 'center' } }, [
          el(
            'button',
            {
              class: 'btn ghost sm',
              type: 'button',
              onclick: () => {
                state.leavingIntentionally = true;
                teardown();
                location.href = '/host.html#/';
              },
            },
            t('hnewActivity')
          ),
          el(
            'button',
            {
              class: 'btn ghost sm',
              type: 'button',
              onclick: () => {
                state.leavingIntentionally = true;
                teardown();
                location.href = '/';
              },
            },
            t('hhomePage')
          ),
        ]),
      ])
    );
    const board = s.leaderboard || [];
    if (board.length) {
      app.append(el('div', { class: 'card stack' }, [el('h2', { text: t('sPodium'), style: { margin: 0 } }), podium(board)]));
      if (board.length > 3) app.append(el('div', { class: 'card stack' }, [el('h2', { text: t('sRestOfBoard') }), boardList(board.slice(3))]));
    }
    const teamCard = teamBoard(s.teamLeaderboard);
    if (teamCard) app.append(teamCard);

    // أوسمة تحفيزية: تُبرز نجاحات لا يلتقطها الترتيب وحده
    if (s.badgeList?.length) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: t('sAwards'), style: { margin: 0 } }),
          el(
            'div',
            { class: 'stack' },
            s.badgeList.map((entry) =>
              el('div', { class: 'row', style: { gap: '10px' } }, [
                avatarNode(entry.avatar, 'sm'),
                el('span', { style: { fontWeight: '700' }, text: entry.name }),
                el(
                  'span',
                  { class: 'badges grow' },
                  entry.badges.map((badge) =>
                    el('span', { class: 'award sm' }, [
                      el('span', { class: 'em', text: badge.emoji }),
                      el('span', { class: 'lbl', text: badge.label }),
                    ])
                  )
                ),
              ])
            )
          ),
        ])
      );
    }
  }

  /** منصة التتويج للأوائل الثلاثة */
  function podium(board) {
    const order = [1, 0, 2]; // الفضة، الذهب، البرونز — ليكون الأول في الوسط
    const medals = ['🥇', '🥈', '🥉'];
    const heights = ['86px', '120px', '64px'];
    const wrap = el('div', { class: 'podium' });
    order.forEach((index, slot) => {
      const entry = board[index];
      if (!entry) return;
      wrap.append(
        el('div', { class: 'pod' }, [
          el('div', { class: 'who' }, [
            avatarNode(entry.avatar, ''),
            el('div', { class: 'nm', text: entry.name }),
            el('div', { class: 'sc', text: String(entry.score) }),
          ]),
          el('div', { class: 'block', style: { height: heights[slot] } }, [
            el('span', { class: 'medal', text: medals[index] }),
          ]),
        ])
      );
    });
    return wrap;
  }

  function boardList(list) {
    const board = el('div', { class: 'board' });
    if (!list.length) board.append(el('p', { class: 'muted center', text: t('sNoResults') }));
    list.forEach((entry) => {
      board.append(
        el('div', { class: 'item' }, [
          el('span', { class: 'rank', text: String(entry.rank) }),
          avatarNode(entry.avatar, 'sm'),
          el('span', { class: 'grow', text: entry.name }),
          entry.streak > 1 ? el('span', { class: 'badge', text: `🔥 ${entry.streak}` }) : null,
          el('span', { class: 'score', text: String(entry.score) }),
        ])
      );
    });
    return board;
  }

  // -------------------------------------------------------- لوحة التحكم

  /**
   * بطاقة تصحيح سؤال نصّي: إجابة كل مشارك وأمامها أزرار العلامات
   * (0..العلامة القصوى) — النقر يمنح العلامة فوراً وتظهر للطالب مباشرة.
   */
  /**
   * كم صفَّ تصحيحٍ يُعرض دفعةً واحدة.
   *
   * كان يُعرض الجميع: ستون طالباً في سبعة أسئلة نصّية = ٤٢٠ صفّاً بـ٢٥٢٨
   * زرّاً و١٤٩٤٤ عقدة، تُبنى من الصفر كلّما أجاب أحدٌ في الصفّ. فتتجمّد شاشة
   * المعلّم في أواخر الاختبار بالضبط — حين يكتمل الطابور.
   *
   * والمعلّم يصحّح صفّاً بعد صفّ لا يقرأ أربعمئة دفعةً واحدة، فالسقف يخدم
   * عينَه كما يخدم جهازه. والباقي خلف زرٍّ يقول عددَه بصراحة.
   */
  const GRADE_PAGE = 12;

  function gradingCard(item) {
    // الخادم يرتّب المعلّق أولاً — فالمعروض هو ما ينتظر التصحيح فعلاً
    const shown = state.gradeShown.get(item.id) || GRADE_PAGE;
    const visible = item.answers.slice(0, shown);
    const hidden = item.answers.length - visible.length;
    const rows = visible.map((answer) => {
      const grade = (points) => send('host:grade', { participantId: answer.participantId, questionId: item.id, points });
      const done = !answer.pending;

      // صح / خطأ أولاً — أسرع قرار للمدرب، ثم العلامات الجزئية
      const marks = [
        el(
          'button',
          {
            class: 'btn sm ' + (done && answer.points >= item.maxPoints ? 'ok' : 'ghost'),
            type: 'button',
            title: t('hFullMarkTitle', { max: item.maxPoints }),
            onclick: () => grade(item.maxPoints),
          },
          t('hcorrect')
        ),
        el(
          'button',
          {
            class: 'btn sm ' + (done && answer.points === 0 ? 'danger' : 'ghost'),
            type: 'button',
            title: t('hwrongZero'),
            onclick: () => grade(0),
          },
          t('hwrong')
        ),
      ];
      // علامة جزئية: أرقام بين الصفر والعلامة الكاملة (تظهر فقط إن كان بينهما مجال)
      if (item.maxPoints > 1 && item.maxPoints <= 10) {
        marks.push(el('span', { class: 'muted small', text: t('horAScore') }));
        for (let value = 1; value < item.maxPoints; value += 1) {
          const chosen = done && answer.points === value;
          marks.push(
            el(
              'button',
              {
                class: 'btn sm ' + (chosen ? 'primary' : 'ghost'),
                type: 'button',
                onclick: () => grade(value),
              },
              String(value)
            )
          );
        }
      } else if (item.maxPoints > 10) {
        const input = el('input', { type: 'number', min: 0, max: item.maxPoints, value: String(answer.points || 0), style: { width: '80px' } });
        marks.push(
          input,
          el(
            'button',
            {
              class: 'btn sm primary',
              type: 'button',
              onclick: () => send('host:grade', { participantId: answer.participantId, questionId: item.id, points: Number(input.value) }),
            },
            t('happly')
          )
        );
      }

      const status = answer.pending
        ? el('span', { class: 'badge warn', text: t('hawaitingGrading') })
        : el('span', { class: 'badge ' + (answer.correct === true ? 'ok' : answer.correct === false ? 'bad' : '') }, t('hPointsOf', { points: answer.points, max: item.maxPoints }));

      // في «أكمل الفراغ» نعرض الإجابة المتوقعة تحت جواب الطالب للمقارنة السريعة
      const expected = item.expected && item.expected.some((value) => value)
        ? el('p', { class: 'grade-expected', text: t('hexpected') + item.expected.map((value) => value || '—').join(' · ') })
        : null;

      return el('div', { class: 'grade-row' + (answer.pending ? ' pending' : '') }, [
        el('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, [avatarNode(answer.avatar, 'sm'), el('strong', { text: answer.name }), status]),
        el('p', { class: 'grade-text', text: answer.text }),
        expected,
        el('div', { class: 'row', style: { gap: '4px' } }, marks),
      ]);
    });

    return el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: { margin: 0 } }, t('hGradingTitle', { text: item.text })),
        item.pending
          ? el('span', { class: 'badge warn' }, t('hPendingCount', { n: item.pending }))
          : el('span', { class: 'badge ok', text: t('hgradingComplete') }),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 } }, t('hGradingHint', { max: item.maxPoints })),
      rows.length ? el('div', { class: 'stack tight' }, rows) : el('p', { class: 'muted center', text: t('hnoAnswersYet') }),
      hidden > 0
        ? el(
            'button',
            {
              class: 'btn ghost sm',
              type: 'button',
              onclick: () => {
                state.gradeShown.set(item.id, shown + GRADE_PAGE);
                renderLive();
              },
            },
            t('hGradeShowMore', { n: hidden })
          )
        : null,
    ]);
  }

  // ------------------------------------------------------- تحليل النتائج

  /** يجلب ملف النتائج الكامل — منه تُبنى الرسوم والتوصيات والتقرير المطبوع */
  async function loadAnalytics(force) {
    if (state.analyticsLoading) return;
    if (state.analyticsData && !force) return;
    state.analyticsLoading = true;
    try {
      state.analyticsData = await api(`/api/sessions/${state.code}/export`, { headers: { 'x-host-token': state.hostToken } });
      state.analyticsAt = Date.now();
    } catch (err) {
      state.analyticsError = err.message || t('hcouldNotLoadThe');
    } finally {
      state.analyticsLoading = false;
      if (state.tab === 'analytics') renderLive();
    }
  }

  function renderAnalytics() {
    if (state.analyticsLoading || (!state.analyticsData && !state.analyticsError)) {
      app.append(el('div', { class: 'card center' }, el('div', { class: 'spinner' })));
      if (!state.analyticsData) loadAnalytics();
      return;
    }
    if (state.analyticsError && !state.analyticsData) {
      app.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { text: t('hcouldNotLoadThe2') }),
          el('p', { class: 'muted small', text: state.analyticsError }),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => loadAnalytics(true) }, t('htryAgain')),
        ])
      );
      return;
    }

    const analysis = window.Analytics.compute(state.analyticsData);
    const head = el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
      el('div', { class: 'stack tight' }, [
        el('h2', { style: { margin: 0 }, text: t('hresultsAnalysis') }),
        el('span', {
          class: 'muted small',
          text: [
            state.analyticsData?.teacher ? t('hteacher2') + state.analyticsData.teacher : null,
            analysis.title,
            new Date(analysis.startedAt).toLocaleString(loc()),
            t('hMinutes', { n: analysis.durationMinutes }),
          ]
            .filter(Boolean)
            .join(' · '),
        }),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('button', { class: 'btn ghost sm', type: 'button', onclick: () => loadAnalytics(true) }, t('hrefresh')),
        el('button', { class: 'btn ok sm', type: 'button', title: t('hpdfRichHint'), onclick: () => exportAs('pdf') }, t('hpdfReport')),
        el('button', { class: 'btn ghost sm', type: 'button', title: t('hpdfFileHint'), onclick: () => exportAs('pdffile') }, t('hpdfFile')),
        el('button', { class: 'btn ok sm', type: 'button', onclick: () => exportAs('excel') }, '📊 Excel'),
      ]),
    ]);
    app.append(head);

    const box = el('div');
    box.innerHTML = window.Analytics.reportHtml(analysis);
    app.append(box);
  }

  /**
   * خلية العلامة في جدول التقدّم: الرقم أولاً لأنه المقصود، ولون واحد
   * يفصل الناجح من غيره — المعلّم يمسح ثلاثين صفاً بعينه لا يقرؤها.
   */
  function markCell(mark, of) {
    return el('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, [
      el('strong', { text: `${mark.mark} / ${of}` }),
      el('span', { class: 'badge' + (mark.passed ? ' ok' : ' bad'), text: mark.percent + t('pctSuffix') }),
      mark.pending ? el('span', { class: 'badge', title: t('mPendingNote', { n: mark.pending }), text: '⏳' }) : null,
    ]);
  }

  // أنواع لا دقّة لها بطبيعتها — نسمّي السبب بدل شرطة صامتة
  const UNSCORED = { poll: 'typePoll', word: 'typeWord', scale: 'typeScale', open: 'typeOpen', slide: 'typeSlide' };

  /**
   * لوحة استطلاع واحد: الرأي الأعلى أولاً وبأكبر خطّ، ثم البقية بأعمدة
   * متناسبة. الترتيب بحسب الأصوات لا بحسب ترتيب الخيارات في المحرّر: المعلّم
   * ينظر ليعرف أين يقف صفّه، لا ليقرأ قائمته كما كتبها.
   */
  function pollPanel(question, data) {
    const results = question.results;
    const total = results.total;
    const ranked = results.options
      .map((option, index) => ({ ...option, index }))
      .sort((a, b) => b.count - a.count || a.index - b.index);
    const top = ranked[0];
    // تعادل الصدارة: لا نتوّج أحداً، فتاجٌ على رأي متعادل مع غيره يضلّل
    const tied = ranked.filter((o) => o.count === top.count).length > 1 || top.count === 0;

    const bars = el('div', { class: 'poll-bars' });
    ranked.forEach((option) => {
      bars.append(
        el('div', { class: 'poll-bar c' + (option.index % 8) + (!tied && option === top ? ' lead' : '') }, [
          el('i', { class: 'fill', style: { width: Math.max(option.percent, 1.5) + '%' } }),
          el('span', { class: 'grow', text: option.text }),
          el('span', { class: 'pct', text: option.percent + t('pctSuffix') }),
          el('span', { class: 'n', text: t('hPollVotes', { n: option.count }) }),
        ])
      );
    });

    const detail = el('div', { class: 'stack tight', hidden: true });
    const toggle = el('button', { class: 'btn ghost sm', type: 'button' }, t('hPollWhoChose'));
    toggle.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      toggle.textContent = detail.hidden ? t('hPollWhoChose') : t('hPollHideWho');
      if (detail.hidden || detail.firstChild) return;

      const voters = question.voters;
      if (!voters) {
        detail.append(el('p', { class: 'muted small', style: { margin: 0 }, text: t('hPollNoDetail') }));
        return;
      }
      const byId = new Map(voters.options.map((o) => [o.id, o.names]));
      ranked.forEach((option) => {
        const names = byId.get(option.id) || [];
        detail.append(
          el('div', { class: 'poll-who' }, [
            el('strong', { class: 'small', text: `${option.text} · ${names.length}` }),
            names.length
              ? el('div', { class: 'row', style: { gap: '4px' } }, names.map((name) => el('span', { class: 'badge', text: name })))
              : el('span', { class: 'muted small', text: t('hPollNobody') }),
          ])
        );
      });
      if (voters.silent.length) {
        detail.append(
          el('div', { class: 'poll-who' }, [
            el('strong', { class: 'small', text: `${t('hPollSilent')} · ${voters.silent.length}` }),
            el('div', { class: 'row', style: { gap: '4px' } }, voters.silent.map((name) => el('span', { class: 'badge bad', text: name }))),
          ])
        );
      }
      detail.append(el('p', { class: 'muted small', style: { margin: 0 }, text: t('hPollPrivacyNote') }));
    });

    return el('div', { class: 'poll-panel stack tight' }, [
      el('div', { class: 'row between' }, [
        el('strong', { text: `${question.index + 1}. ${question.text}` }),
        el('span', { class: 'badge', text: t('hPollAnswered', { n: total, of: question.reached }) }),
      ]),
      bars,
      el('div', { class: 'row' }, [
        tied ? el('span', { class: 'muted small', text: t('hPollTied') }) : el('span', { class: 'small', text: t('hPollLead', { text: top.text, pct: top.percent }) }),
        el('span', { class: 'grow' }),
        data.participants.length ? toggle : null,
      ]),
      detail,
    ]);
  }

  function renderDashboard() {
    const data = state.dashboard;
    if (!data) {
      app.append(el('div', { class: 'card center' }, el('div', { class: 'spinner' })));
      send('host:dashboard');
      return;
    }
    const summary = data.summary;

    app.append(
      el('div', { class: 'stats' }, [
        stat(summary.participants, t('hparticipants')),
        stat(summary.connected, t('honlineNow')),
        stat(summary.asked + ' / ' + data.questionCount, t('hquestionsShown')),
        stat(summary.participation + t('pctSuffix'), t('hparticipationRate')),
        data.hasScores ? stat(summary.avgScore, t('haveragePoints')) : null,
        data.hasScores && summary.avgAccuracy !== null ? stat(summary.avgAccuracy + t('pctSuffix'), t('haverageAccuracy')) : null,
        // العلامات: ما ينقله المعلّم إلى دفتره بلا حساب يدوي
        data.hasMark && summary.avgMark !== null ? stat(`${summary.avgMark} / ${data.totalMark}`, t('mAvgMark')) : null,
        data.hasMark ? stat(`${summary.passed} / ${data.participants.length}`, t('mPassedCount', { pct: data.passPercent })) : null,
      ].filter(Boolean))
    );

    /**
     * من في الكشف ولم يدخل بعد — الغرض الأول من إرفاق فصل. المعلّم واقفٌ
     * أمام صفّه ويريد اسماً ينادي به، لا عدّاً يقارنه بدفتره.
     */
    if ((data.missing || []).length || (data.hasRoster && !(data.missing || []).length)) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { style: { margin: 0 }, text: data.missing.length ? t('hMissingTitle', { n: data.missing.length }) : t('hMissingAllIn') }),
          data.missing.length
            ? el('div', { class: 'roster' }, data.missing.map((name) => el('span', { class: 'chip', text: name })))
            : null,
        ])
      );
    }

    // ---- تصحيح الإجابات النصّية: أول ما يحتاجه المدرب، فنضعه أعلى اللوحة
    (data.grading || []).forEach((item) => app.append(gradingCard(item)));

    /**
     * ---- الاستطلاعات: نتيجتها مقروءة فوراً بلا نقر.
     * الاستطلاع لا يُصحَّح، فصفّه في جدول الأداء كله شُرَط «—»: لا دقّة ولا
     * صواب. وما يريده المعلّم منه سؤال واحد — «ماذا قال الصف؟» — فنجيب عنه
     * هنا مباشرة، ونترك التفصيل (من اختار ماذا) خلف زرّ لمن أراده.
     */
    const polls = data.perQuestion.filter((q) => q.type === 'poll' && q.asked && q.results?.total > 0);
    if (polls.length) {
      app.append(
        el('div', { class: 'card stack' }, [
          el('h2', { text: t('hPollsTitle'), style: { margin: 0 } }),
          el('p', { class: 'muted small', style: { margin: 0 }, text: t('hPollsIntro') }),
          ...polls.map((question) => pollPanel(question, data)),
        ])
      );
    }

    // جدول الأسئلة — النقر على سؤال يفتح نتائجه الكاملة (سحابة الكلمات، الأعمدة…)
    const qRows = [];
    data.perQuestion.forEach((question) => {
      const open = state.dashOpenQ === question.index;
      const row = el('tr', { style: { cursor: 'pointer' } }, [
        el('td', {}, [el('span', { class: 'badge', text: TYPE_EMOJI[question.type] }), ' ' + (question.index + 1)]),
        el('td', { style: { whiteSpace: 'normal', minWidth: '180px' } }, [
          el('span', { text: question.text + ' ' }),
          el('span', { class: 'muted small', text: open ? '▲' : t('hresults') }),
        ]),
        el('td', {}, question.asked ? t('hResponsesRate', { n: question.responses, rate: question.responseRate }) : '—'),
        // «—» في خانة الدقّة تبدو بياناً ناقصاً؛ والسبب الحقيقي أن السؤال لا يُصحَّح أصلاً
        el('td', {}, question.accuracy === null ? el('span', { class: 'muted small', text: UNSCORED[question.type] ? t(UNSCORED[question.type]) : '—' }) : question.accuracy + t('pctSuffix')),
        el('td', {}, question.responses ? fmtMs(question.avgMs) : '—'),
      ]);
      row.addEventListener('click', () => {
        state.dashOpenQ = open ? null : question.index;
        renderLive();
      });
      qRows.push(row);
      if (open) {
        qRows.push(
          el('tr', {}, [
            el('td', { colspan: 5, style: { whiteSpace: 'normal' } }, [
              question.results && question.results.total > 0
                ? resultsView({ scored: question.correct !== null }, question.results, true)
                : el('p', { class: 'muted center small', style: { margin: 0 }, text: t('hnoAnswersYet') }),
            ]),
          ])
        );
      }
    });

    app.append(
      el('div', { class: 'card stack' }, [
        el('h2', { text: t('hquestionPerformance'), style: { margin: 0 } }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('htapAnyQuestionTo') }),
        el('div', { class: 'table-wrap' }, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '#'), el('th', {}, t('hquestion')), el('th', {}, t('hanswers')), el('th', {}, t('haccuracy')), el('th', {}, t('htime'))])),
            el('tbody', {}, qRows),
          ]),
        ]),
      ])
    );

    // جدول المشاركين
    const pRows = data.participants.map((participant, index) => {
      const dots = el(
        'span',
        { class: 'dots' },
        participant.answers.map((answer) =>
          el('i', { class: answer === null ? '' : answer.correct === true ? 'ok' : answer.correct === false ? 'bad' : 'neutral' })
        )
      );
      return el('tr', {}, [
        el('td', {}, String(index + 1)),
        el('td', {}, [
          el('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, [
            avatarNode(participant.avatar, 'sm'),
            el('span', { text: participant.name }),
            participant.connected ? null : el('span', { class: 'badge bad', text: t('hoffline2') }),
          ]),
        ]),
        el('td', {}, [
          el('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, [
            el('div', { class: 'progress thin', style: { width: '60px' } }, el('i', { style: { width: Math.min(100, participant.progress) + '%' } })),
            el('span', { class: 'small muted', text: `${participant.answered}/${participant.asked}` }),
          ]),
        ]),
        data.hasMark
          ? el('td', {}, participant.mark ? markCell(participant.mark, data.totalMark) : '—')
          : null,
        data.hasScores ? el('td', {}, participant.accuracy === null ? '—' : participant.accuracy + t('pctSuffix')) : null,
        data.hasScores ? el('td', {}, String(participant.score)) : null,
        el('td', {}, fmtMs(participant.avgMs)),
        el('td', {}, dots),
      ].filter(Boolean));
    });

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('h2', { text: t('hProgressCount', { count: data.participants.length }), style: { margin: 0 } }),
          el('div', { class: 'row', style: { gap: '6px' } }, [
            el('button', { class: 'btn sm ghost', type: 'button', onclick: exportResults }, '⬇ JSON'),
            el('button', { class: 'btn sm ok', type: 'button', onclick: () => exportAs('excel', 'results') }, '📊 Excel'),
            el('button', { class: 'btn sm ok', type: 'button', title: t('hpdfRichHint'), onclick: () => exportAs('pdf', 'results') }, t('hpdfRich')),
            el('button', { class: 'btn sm ghost', type: 'button', title: t('hpdfFileHint'), onclick: () => exportAs('pdffile', 'results') }, t('hpdfFile')),
            state.premium?.isPremium ? null : el('span', { class: 'badge', text: t('hpremium') }),
          ].filter(Boolean)),
        ]),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('hresultsFilesNote') }),
        data.participants.length
          ? el('div', { class: 'table-wrap' }, [
              el('table', {}, [
                el(
                  'thead',
                  {},
                  el('tr', {}, [
                    el('th', {}, '#'),
                    el('th', {}, t('hparticipant')),
                    el('th', {}, t('hprogress')),
                    data.hasMark ? el('th', {}, t('mMarkOf', { of: data.totalMark })) : null,
                    data.hasScores ? el('th', {}, t('haccuracy')) : null,
                    data.hasScores ? el('th', {}, t('hpoints')) : null,
                    el('th', {}, t('haverageTime')),
                    el('th', {}, t('hanswers')),
                  ].filter(Boolean))
                ),
                el('tbody', {}, pRows),
              ]),
            ])
          : el('p', { class: 'muted center', text: t('hnoParticipantsYet') }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('hcorrectWrongUngradedAnswer') }),
      ])
    );

    app.append(el('p', { class: 'footer', text: t('hallOfThisData') }));
  }

  function stat(value, label) {
    return el('div', { class: 'stat' }, [el('div', { class: 'v', text: String(value) }), el('div', { class: 'k', text: label })]);
  }

  // ------------------------------------------------------------- المشاركة

  function renderShare(s) {
    app.append(el('div', { class: 'card' }, [el('div', { class: 'joinbox' }, [qrBox(), joinInfo(s)])]));

    // شاشة عرض منفصلة للبروجكتر: تعرض السؤال والنتائج بلا أي زر تحكم — أنت تتحكم من جوالك
    const screenUrl = `${location.origin}/screen.html?code=${state.code}&hostToken=${encodeURIComponent(state.hostToken)}`;
    app.append(
      el('div', { class: 'card stack' }, [
        el('h2', { text: t('hprojectorScreen'), style: { margin: 0 } }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('hopenItOnThe') }),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn accent sm', href: screenUrl, target: '_blank', rel: 'noopener' }, t('hopenTheProjectorScreen')),
          el('button', { class: 'btn ghost sm', type: 'button', onclick: () => copy(screenUrl) }, t('hcopyLink')),
        ]),
      ])
    );

    app.append(
      el('div', { class: 'card stack' }, [
        el('h2', { text: t('hhowDoParticipantsJoin') }),
        el('ol', { class: 'muted small', style: { margin: 0, paddingInlineStart: '20px', lineHeight: '2' } }, [
          el('li', {}, t('htheyScanTheQr')),
          el('li', {}, s.settings.requireName ? t('htheyTypeAName') : t('htheyJoinStraightAway')),
          el('li', {}, t('htheyAnswerQuestionBy')),
        ]),
        el('button', { class: 'btn danger', type: 'button', onclick: endSession }, t('hendTheSessionAnd')),
      ])
    );
  }

  // -------------------------------------------------------- شريط التحكم

  /**
   * «إنهاء للجميع» — الزرّ الذي يُغلق الاختبار على كل مشارك دفعةً واحدة
   * ويُظهر النتائج.
   *
   * كان أحمرَ بلون الحذف في وضعٍ، وأيقونةَ ⏹ صغيرة في وضعٍ آخر، فاختلط
   * على المعلّم فعلان مختلفان تماماً: إنهاءٌ يحفظ النتائج ليراجعها، وحذفٌ
   * يمحوها. لونٌ ثالثٌ صريح ونصٌّ واحد في كل الأوضاع يفصلهما — والتأكيد
   * يقول ما سيحدث بالضبط لا «هل أنت متأكد؟».
   */
  function finishBtn() {
    return el(
      'button',
      { class: 'btn finish', type: 'button', onclick: () => confirm(t('hfinishConfirm')) && send('host:end') },
      t('hfinishForAll')
    );
  }

  function renderBar(s) {
    bar.innerHTML = '';
    // الزرّ يلزم أينما جلس المعلّم لا في «العرض» وحده: في الوضع الحرّ يقضي
    // وقته على تبويب «التقدّم» يراقب، ولو غاب الزرّ هناك بدا النشاط بلا نهاية.
    if (state.tab !== 'stage') {
      if (s.status === 'live') bar.append(el('div', { class: 'actionbar' }, [finishBtn()]));
      return;
    }

    const actions = [];
    if (s.status === 'lobby') {
      actions.push(
        el('button', { class: 'btn primary', type: 'button', disabled: s.participants.length === 0, onclick: () => send('host:start') },
          s.participants.length ? t('hstartActivity') : t('hwaitingForParticipants'))
      );
      actions.push(
        el('button', { class: 'icon-btn', type: 'button', title: t('hcancelAndDeleteThe'), onclick: endSession }, '🗑')
      );
    } else if (s.status === 'ended') {
      actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: exportResults }, t('hdownloadResults')));
      actions.push(el('button', { class: 'btn danger', type: 'button', onclick: endSession }, t('hdeleteSession')));
    } else if (s.pace === 'self') {
      // الوضع الحر: لا شرائح ينقلها المدرب — فقط الإنهاء
      actions.push(
        el(
          'button',
          {
            class: 'btn ghost',
            type: 'button',
            onclick: () => {
              state.tab = 'dashboard';
              send('host:dashboard');
              renderLive();
            },
          },
          t('htrackProgress')
        )
      );
      actions.push(finishBtn());
    } else {
      actions.push(el('button', { class: 'icon-btn', type: 'button', title: t('hpreviousQuestion'), disabled: s.index <= 0, onclick: () => send('host:prev') }, '⟩'));
      /**
       * على السؤال الأخير كان يظهر زرّان متجاوران: «🏁 إنهاء» و«🏁 إنهاء
       * للجميع» — فعلهما واحدٌ حرفياً (كلاهما يُنهي النشاط)، واسمهما متشابه.
       * فنُسقط الأول ونترك الثاني: خيارٌ واحد لا يحتاج المعلّم أن يوازن بينه
       * وبين توأمه أمام صفٍّ ينتظر.
       */
      const last = s.index + 1 >= s.total;
      const nextBtn = () =>
        last ? null : el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:skip') }, t('hnextQuestion'));
      if (s.question?.content) {
        // شريحة عرض: لا إجابات تُغلق ولا نتائج تُكشف — زرّ انتقال واحد فقط
        actions.push(nextBtn());
      } else if (s.phase === 'question') {
        actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => send('host:lock') }, t('hlockAnswers')));
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:results') }, t('hshowResults2')));
      } else if (s.phase === 'results') {
        if (s.settings.showLeaderboard) {
          actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => send('host:leaderboard') }, t('pLeaderboard')));
        }
        actions.push(nextBtn());
      } else {
        actions.push(nextBtn());
      }
      actions.push(finishBtn());
    }

    bar.append(el('div', { class: 'actionbar' }, actions));
  }

  // ------------------------------------------------------------- أدوات

  /**
   * تصدير منسّق (بريميوم): Excel حقيقي أو تقرير PDF عبر نافذة الطباعة.
   * scope='results' (قسم تقدم المشاركين): سجل علامات الطلاب فقط — تقرير رسمي.
   * scope='full' (تبويب التحليل): التقرير الكامل بالرسوم والتوصيات.
   */
  async function exportAs(kind, scope = 'full') {
    if (!state.premium?.isPremium) {
      app.prepend(upgradeCard(state.premium?.plan, t('hexportingResultsIsA')));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(t('hexcelAndPdfExport'), 'warn');
      return;
    }
    try {
      const data = await api(`/api/sessions/${state.code}/export`, { headers: { 'x-host-token': state.hostToken } });
      if (kind === 'excel') {
        if (scope === 'results') window.Exporter.toResultsExcel(data);
        else window.Exporter.toExcel(data);
        toast(t('hexcelFileDownloaded'), 'ok');
      } else if (kind === 'pdf') {
        // التقرير الملوّن: صفحة كاملة الأنماط بالرسوم، يحفظها المتصفح PDF متجهاً
        const opened = scope === 'results' ? window.Exporter.toResultsPdf(data) : window.Exporter.toPdf(data);
        toast(opened ? t('hchooseSaveAsPdf') : t('htheBrowserBlockedThe'), opened ? 'ok' : 'bad');
      } else {
        // ملف مباشر بلا نافذة — أبسط، لكن بلا رسوم ملوّنة
        toast(t('hpreparingPdf'), 'ok');
        await (scope === 'results' ? window.Exporter.toResultsPdfFile(data) : window.Exporter.toPdfFile(data));
        toast(t('hpdfFileDownloaded'), 'ok');
      }
    } catch (err) {
      toast(err.message || t('hexportFailed'), 'bad');
    }
  }

  /** تنزيل JSON الخام — بترويسة لا بعنوان، فلا يتسرّب مفتاح المضيف إلى السجلات */
  async function exportResults() {
    try {
      const data = await api(`/api/sessions/${state.code}/export`, { headers: { 'x-host-token': state.hostToken } });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: `tapio-${state.code}.json` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      toast(err.message || t('hexportFailed'), 'bad');
    }
  }

  async function endSession() {
    if (!confirm(t('hendTheSessionAnd2'))) return;
    try {
      await api(`/api/sessions/${state.code}`, { method: 'DELETE', headers: { 'x-host-token': state.hostToken } });
      toast(t('hsessionDeleted'), 'ok');
      const hosts = store.local.get(HOSTS_KEY, {});
      delete hosts[state.code];
      store.local.set(HOSTS_KEY, hosts);
      teardown();
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('hlinkCopied'), 'ok');
    } catch {
      toast(text);
    }
  }

  function share(url, title) {
    if (navigator.share) navigator.share({ title: title || 'Tapio', text: t('hjoinTheActivity'), url }).catch(() => {});
    else copy(url);
  }

  function startTick(s, q) {
    if (!s.endsAt) return;
    const num = $('#tnum');
    const barEl = $('#tbar');
    if (!num || !barEl) return;
    const total = q.timeLimit * 1000;
    let lastSecond = null;
    state.tickTimer = setInterval(() => {
      const left = Math.max(0, s.endsAt - serverTime());
      const seconds = Math.ceil(left / 1000);
      num.textContent = String(seconds);
      barEl.style.width = Math.max(0, (left / total) * 100) + '%';
      if (seconds !== lastSecond) {
        if (lastSecond !== null && seconds > 0 && seconds <= 5) Fx.play('tick');
        lastSecond = seconds;
      }
      num.classList.toggle('hot', seconds <= 5);
      if (left <= 0) clearTick();
    }, 200);
  }

  /** عدّاد الانتقال التلقائي على شاشة المدرب */
  function startAutoTick(s, label) {
    clearInterval(state.autoTimer);
    const paint = () => {
      const left = Math.max(0, s.autoNextAt - serverTime());
      label.textContent = Math.ceil(left / 1000) + t('hs');
      if (left <= 0) clearInterval(state.autoTimer);
    };
    paint();
    state.autoTimer = setInterval(paint, 250);
  }

  function clearTick() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = null;
    if (state.autoTimer) clearInterval(state.autoTimer);
    state.autoTimer = null;
    state.cancelCountdown?.();
    state.cancelCountdown = null;
    state.stopSchedule?.();
    state.stopSchedule = null;
    state.stopDeadline?.();
    state.stopDeadline = null;
  }

  // قائمة الشريط العلوي: تُفتح بزرٍّ واحد وتُغلق بالضغط خارجها أو بـ Escape
  const menuBtn = $('#menuBtn');
  const hostMenu = $('#hostMenu');
  if (menuBtn && hostMenu) {
    const setOpen = (open) => {
      hostMenu.hidden = !open;
      if (open) window.TapioUI?.clampMenu(hostMenu);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    menuBtn.title = t('hMenuAria');
    menuBtn.setAttribute('aria-label', t('hMenuAria'));
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(hostMenu.hidden);
    });
    document.addEventListener('click', (event) => {
      if (!hostMenu.hidden && !hostMenu.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
    // المبدّلات تبقي القائمة مفتوحة (الحالة تتغيّر أمام عين المعلّم)،
    // وما ينقل إلى صفحةٍ أخرى يغلقها
    hostMenu.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
  }

  // تنبيه قبل مغادرة صفحة جلسة مباشرة
  window.addEventListener('beforeunload', (event) => {
    // لا نزعج المدرب إن كان خروجه مقصوداً عبر أزرار التنقل
    if (state.leavingIntentionally) return;
    if (state.live && state.live.status === 'live') {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // نعرف المستخدم أولاً حتى تظهر أزرار الحساب صحيحة من أول رسم
  loadAccount()
    .finally(route)
    .finally(() => window.T.afterLogin(state.user, state.premium));
})();
