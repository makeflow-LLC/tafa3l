/* لوحة المدرب — إنشاء النشاط، إدارة العرض المباشر، والإحصاءات */
(function () {
  'use strict';

  const { $, el, avatarNode, toast, api, connect, store, TYPE_LABELS, TYPE_EMOJI, fmtMs, fmtLeft, countdownTo, serverAlive, showOfflineBanner, shrinkImage, copyLink } =
    window.T;
  const Fx = window.Fx;
  // اختصار الترجمة — إن غاب المحرّك نعرض المفتاح بدل الانهيار
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const tagLabel = (kind, id) => (window.I18n ? window.I18n.tagLabel(kind, id) : id);
  const SUBJECTS = (window.I18n && window.I18n.SUBJECTS) || [];
  const GRADES = (window.I18n && window.I18n.GRADES) || [];
  /** لغة التنسيق للتواريخ والأرقام */
  const loc = () => (window.I18n && window.I18n.getLang() === 'en' ? 'en' : 'ar');

  // نصوص الشريط العلوي ومبدّل اللغة
  const guide = $('#guideLink');
  if (guide) {
    guide.textContent = '📖';
    guide.title = t('hteacherGuideTip');
    guide.setAttribute('aria-label', t('hteacherGuideTip'));
  }
  for (const [id, key] of [['#homeBtn', 'hhomePage'], ['#soundBtn', 'hsound']]) {
    const node = $(id);
    if (!node) continue;
    node.title = t(key);
    node.setAttribute('aria-label', t(key));
  }
  if (window.I18n && $('#langRow')) window.I18n.mountToggle($('#langRow'));

  const app = $('#app');
  const bar = $('#bar');
  const connBadge = $('#conn');
  const codeBadge = $('#codeBadge');

  const HOSTS_KEY = 'tafa3l:hosts';
  const EDITING_KEY = 'tafa3l:host:editingActivity';

  const state = {
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

  /**
   * السِمة الداكنة للجلسة المباشرة فقط؛ الإعداد والتصفّح يبقيان على الأبيض.
   * نضبطها في التوجيه لأنها الموضع الوحيد الذي يعرف الشاشة الحالية.
   */
  function paintTheme(isLive) {
    document.documentElement.classList.toggle('stage', isLive);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isLive ? '#12102e' : '#ffffff');
  }

  function route() {
    const hash = location.hash.slice(1) || '/';
    const match = hash.match(/^\/live\/(\d{6})$/);
    paintTheme(!!match);
    if (match) return openLive(match[1]);
    if (hash === '/demo') return startDemo();
    if (hash === '/mine') return openMyActivities();
    if (hash === '/library') return openLibrary();
    if (hash === '/games') return openMyGames();
    if (hash === '/profile') return openProfile();
    const lib = hash.match(/^\/library\/([\w-]+)$/);
    if (lib) return openLibraryItem(lib[1]);
    if (hash === '/ai') return openAiDesigner();
    if (hash === '/admin') return openAdmin();
    const edit = hash.match(/^\/edit\/([\w-]+)$/);
    if (edit) return openSavedActivity(edit[1]);
    return openBuilder();
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

  function paintAccount() {
    const slot = $('#account');
    if (!slot) return;
    slot.innerHTML = '';
    if (state.user) {
      // الاسم الأول فقط ومقصوص: الاسم الكامل كان يدفع بقية الأزرار إلى سطر جديد
      const name = el('a', { class: 'btn ghost sm', href: '#/mine', title: `${state.user.name} · ${state.user.email}` }, [
        el('span', { text: '📚 ' }),
        el('span', { class: 'who', text: firstName(state.user.name) }),
      ]);
      slot.append(name);
      if (state.premium?.isAdmin) {
        slot.append(el('a', { class: 'icon-btn', href: '#/admin', title: t('hownerPanel'), 'aria-label': t('hownerPanel') }, '👑'));
      }
      // زر خروج ظاهر دائماً — لا مدفون داخل صفحة «نشاطاتي»
      slot.append(
        el('button', { class: 'icon-btn', type: 'button', title: t('hsignOut'), 'aria-label': t('hsignOut'), onclick: logout }, '🚪')
      );
    } else {
      slot.append(el('a', { class: 'btn ghost sm', href: '/login.html' }, t('hsignIn')));
    }
  }

  /** الاسم الأول فقط — الترحيب بالاسم الكامل يبدو رسمياً وطويلاً */
  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || t('hthere');
  }

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
  async function openMyActivities() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/login.html?next=' + encodeURIComponent('/host.html#/mine');
      return;
    }

    let activities = [];
    try {
      activities = (await api('/api/activities')).activities;
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('hcouldNotLoadYour') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhomePage')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/library' }, t('lNav')),
          el('a', { class: 'btn ghost sm', href: '/games.html' }, t('gNav')),
          el('a', { class: 'btn ghost sm', href: '#/ai' }, t('hdesignWithAi')),
          el('a', { class: 'btn accent sm', href: '#/' }, t('hnewActivity')),
        ]),
      ])
    );
    app.append(el('h1', { text: t('hHelloUser', { name: firstName(user.name) }) }));
    app.append(el('h2', { style: { margin: '0 0 6px' }, text: t('hmyActivities') }));
    app.append(
      el('p', { class: 'muted small' }, t('hMineIntro', { name: user.name, count: activities.length }))
    );

    if (state.durable === false) {
      app.append(
        el('div', { class: 'banner', style: { marginBottom: '12px' } }, [
          el('strong', { text: t('hstorageIsNotDurable') }),
          el('div', { class: 'small', text: t('haccountsAndActivitiesAre') }),
        ])
      );
    }

    if (!activities.length) {
      app.append(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.4rem' }, text: '📭' }),
          el('h2', { text: t('hnoSavedActivitiesYet') }),
          el('p', { class: 'muted small', text: t('hcreateAnActivityThen') }),
          el('a', { class: 'btn primary', href: '#/' }, t('hcreateAnActivity')),
        ])
      );
    } else {
      const list = el('div', { class: 'stack' });
      activities.forEach((activity) => list.append(activityCard(activity)));
      app.append(list);
    }

    app.append(
      el('div', { class: 'card stack' }, [
        el('div', { class: 'row between' }, [
          el('span', { class: 'muted small', text: state.user.email }),
          el(
            'button',
            { class: 'btn ghost sm', type: 'button', onclick: logout },
            t('hsignOut3')
          ),
        ]),
      ])
    );
  }

  function activityCard(activity) {
    const when = new Date(activity.updatedAt).toLocaleDateString(loc(), { year: 'numeric', month: 'short', day: 'numeric' });
    const pace = { host: t('hteacherPaced'), auto: t('hauto'), self: t('hselfPaced') }[activity.settings?.pace] || '';

    const launch = el('button', { class: 'btn accent sm', type: 'button' }, t('hlaunchASession'));
    launch.addEventListener('click', async () => {
      launch.disabled = true;
      launch.textContent = t('hlaunching');
      try {
        const created = await api(`/api/activities/${activity.id}/launch`, { method: 'POST' });
        rememberHost(created.code, created.hostToken, created.title);
        location.hash = '#/live/' + created.code;
      } catch (err) {
        toast(err.message, 'bad');
        launch.disabled = false;
        launch.textContent = t('hlaunchASession');
      }
    });

    const remove = el('button', { class: 'btn danger sm', type: 'button' }, t('hdelete'));
    remove.addEventListener('click', async () => {
      if (!confirm(t('hDeleteConfirm', { title: activity.title }))) return;
      try {
        await api(`/api/activities/${activity.id}`, { method: 'DELETE' });
        toast(t('hactivityDeleted'), 'ok');
        openMyActivities();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });

    const duplicate = el('button', { class: 'btn ghost sm', type: 'button' }, t('hduplicate'));
    duplicate.addEventListener('click', async () => {
      duplicate.disabled = true;
      try {
        const { activity: copy } = await api(`/api/activities/${activity.id}/duplicate`, { method: 'POST' });
        toast(t('hCopiedTo', { title: copy.title }), 'ok');
        openMyActivities();
      } catch (err) {
        toast(err.message, 'bad');
        duplicate.disabled = false;
      }
    });

    // النشر في المكتبة: زرّ واحد يفتح نموذجاً في البطاقة، وسحبٌ فوري إن كان منشوراً
    const slot = el('div', { class: 'stack tight' });
    const share = el('button', { class: 'btn ghost sm', type: 'button' }, activity.published ? t('lUnpublish') : t('lPublish'));
    share.addEventListener('click', async () => {
      if (activity.published) {
        share.disabled = true;
        try {
          await api(`/api/activities/${activity.id}/unpublish`, { method: 'POST' });
          toast(t('lUnpublishedOk'), 'ok');
          openMyActivities();
        } catch (err) {
          toast(err.message, 'bad');
          share.disabled = false;
        }
        return;
      }
      if (slot.firstChild) return slot.replaceChildren();
      slot.append(publishForm(activity, openMyActivities, () => slot.replaceChildren()));
    });

    return el('div', { class: 'card stack' }, [
      el('div', { class: 'row between' }, [
        el('h2', { text: activity.title, style: { margin: 0, fontSize: '1.05rem' } }),
        activity.live ? el('span', { class: 'badge live' }, t('hLiveCode', { code: activity.live.code })) : null,
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('span', { class: 'badge', text: t('hQuestionCount', { count: activity.questionCount }) }),
        pace ? el('span', { class: 'badge', text: pace }) : null,
        activity.published ? el('span', { class: 'badge ok', text: t('lPublished') }) : null,
        activity.published && activity.copies ? el('span', { class: 'badge', text: t('lCopies', { n: activity.copies }) }) : null,
        el('span', { class: 'muted small', text: t('hlastEdited') + when }),
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        activity.live
          ? el('a', { class: 'btn primary sm', href: '#/live/' + activity.live.code }, t('hbackToTheSession'))
          : launch,
        el('a', { class: 'btn ghost sm', href: '#/edit/' + activity.id }, t('hopenAndEdit')),
        duplicate,
        share,
        el('span', { class: 'grow' }),
        remove,
      ]),
      slot,
    ]);
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
      location.href = '/login.html?next=' + encodeURIComponent('/host.html#/games');
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
    app.append(el('h1', { style: { marginBottom: '4px' }, text: t('gMine') }));
    app.append(el('p', { class: 'muted small', text: t('gMineIntro') }));

    // رابطُ صفحةِ ألعاب المعلّم: يضعه في مجموعة صفّه فيتصفّح طلابه ألعابه وحدها
    const shelf = location.origin + '/games.html#/t/' + user.id;
    app.append(
      el('div', { class: 'card stack tight' }, [
        el('strong', { text: t('gShelfTitle') }),
        el('p', { class: 'muted small', style: { margin: 0 }, text: t('gShelfHint') }),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('code', { class: 'grow link-box', text: shelf }),
          shareButton(shelf, t('gCopyLink')),
          el('a', { class: 'btn ghost sm', href: shelf, target: '_blank', rel: 'noopener' }, t('gOpen')),
        ]),
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
    const shot = el('input', { type: 'file', accept: 'image/*' });
    const shotNote = el('div', { class: 'muted small' });
    const preview = el('div', { class: 'cover-preview', hidden: true });
    let cover = '';
    shot.addEventListener('change', async () => {
      const picked = shot.files?.[0];
      if (!picked) return;
      shotNote.textContent = t('gFormShotWorking');
      try {
        cover = await shrinkImage(picked);
        preview.innerHTML = '';
        preview.append(el('img', { src: cover, alt: t('gFormShot') }));
        preview.hidden = false;
        shotNote.textContent = t('gFormShotReady', { kb: Math.round((cover.length * 3) / 4 / 1024) });
      } catch (err) {
        cover = '';
        preview.hidden = true;
        shotNote.textContent = err.message;
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
      el('h2', { style: { margin: 0 }, text: t('gFormTitle') }),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('gFormHint') }),
      el('label', {}, [el('span', { class: 'small', text: t('gFormName') }), title]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormSubject') }), subject]),
      el('div', { class: 'stack tight' }, [
        el('span', { class: 'small', text: t('gFormGrades') }),
        el('span', { class: 'muted small', text: t('gFormGradesHint') }),
        gradePicker.node,
      ]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormDesc') }), description]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormFile') }), file]),
      el('label', {}, [el('span', { class: 'small', text: t('gFormCode') }), code]),
      note,
      el('label', {}, [
        el('span', { class: 'small', text: t('gFormShot') }),
        el('span', { class: 'muted small', style: { display: 'block' }, text: t('gFormShotHint') }),
        shot,
      ]),
      preview,
      shotNote,
      el('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start', flexWrap: 'nowrap' } }, [
        offlineOk,
        el('span', { class: 'small grow' }, [
          el('strong', { text: t('gFormOffline') }),
          el('span', { class: 'muted small', style: { display: 'block' }, text: t('gFormOfflineHint') }),
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
      location.href = '/login.html?next=' + encodeURIComponent('/host.html#/profile');
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
        el('a', { class: 'btn ghost sm', href: '#/games' }, t('gMine')),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' }, text: t('profTitle') }));
    app.append(el('p', { class: 'muted small', text: t('profIntro') }));

    const displayName = el('input', { maxlength: 60, placeholder: t('profNamePlaceholder'), value: profile.displayName });
    const phone = el('input', { type: 'tel', dir: 'ltr', maxlength: 24, placeholder: t('profPhonePlaceholder'), value: profile.phone });
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
        const body = { displayName: displayName.value, phone: phone.value };
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
            el('span', { class: 'small', text: t('profPhoto') }),
            el('span', { class: 'muted small', text: t('profPhotoHint') }),
            photoInput,
            el('div', { class: 'row', style: { gap: '6px' } }, [clearPhoto]),
          ]),
        ]),
        photoNote,
        el('label', {}, [
          el('span', { class: 'small', text: t('profName') }),
          el('span', { class: 'muted small', style: { display: 'block' }, text: t('profNameHint', { name: firstNameOf(profile.name) }) }),
          displayName,
        ]),
        el('label', {}, [
          el('span', { class: 'small', text: t('profPhone') }),
          el('span', { class: 'muted small', style: { display: 'block' }, text: t('profPhoneHint') }),
          phone,
        ]),
        el('p', { class: 'note warn small', style: { margin: 0 }, text: t('profPublicWarning') }),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          save,
          el('a', { class: 'btn ghost', href: '/games.html#/t/' + user.id, target: '_blank', rel: 'noopener' }, t('profPreview')),
        ]),
      ])
    );
  }

  const firstNameOf = (name) => String(name || '').trim().split(/\s+/)[0] || '';

  /**
   * اختيار الصفوف: شرائح تُنقر — واحدة أو عدّة، أو «كل المراحل» فتلغي الباقي.
   * القيمة مصفوفة معرِّفات، والفارغة تعني «الجميع» كما يفهمها الخادم.
   */
  function gradeChips() {
    const chosen = new Set();
    const node = el('div', { class: 'chips' });
    const all = el('button', { class: 'chip on', type: 'button' }, t('gAllStages'));
    const paint = () => {
      all.classList.toggle('on', chosen.size === 0);
      [...node.querySelectorAll('.chip[data-grade]')].forEach((c) => c.classList.toggle('on', chosen.has(c.dataset.grade)));
    };
    all.addEventListener('click', () => {
      chosen.clear();
      paint();
    });
    node.append(all);
    GRADES.forEach((id) => {
      const chip = el('button', { class: 'chip', type: 'button', 'data-grade': id }, tagLabel('grade', id));
      chip.addEventListener('click', () => {
        if (chosen.has(id)) chosen.delete(id);
        else chosen.add(id);
        paint();
      });
      node.append(chip);
    });
    return { node, value: () => GRADES.filter((id) => chosen.has(id)) };
  }

  /** حجمٌ مقروء — لعبةٌ صغيرة تُكتب «أقل من ١KB» لا «0KB» */
  const kb = (bytes) => (bytes < 1024 ? t('gUnderKb') : Math.round(bytes / 1024) + 'KB');

  /** طول النص بالبايت — الحدّ على الخادم بالبايت لا بالمحارف */
  function Buffer_len(text) {
    return new TextEncoder().encode(String(text || '')).length;
  }

  function myGameCard(game) {
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
      el('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } }, [
        gameThumb(game, 'sm'),
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
      box.append(el('img', { src: '/api/games/' + game.id + '/cover', alt: game.title, loading: 'lazy' }));
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
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    let data;
    try {
      const query = new URLSearchParams({ q: library.q, subject: library.subject, grade: library.grade, lang: library.lang, page: String(library.page) });
      data = await api('/api/library?' + query);
    } catch (err) {
      app.innerHTML = '';
      app.append(el('div', { class: 'card stack center' }, [el('h2', { text: t('lTitle') }), el('p', { class: 'muted small', text: err.message })]));
      return;
    }
    library.items = library.page ? [...library.items, ...data.items] : data.items;
    library.total = data.total;

    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhomePage')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/mine' }, t('hmyActivities')),
          el('a', { class: 'btn accent sm', href: '#/' }, t('hnewActivity')),
        ]),
      ])
    );
    app.append(el('h1', { style: { marginBottom: '4px' }, text: t('lTitle') }));
    app.append(el('p', { class: 'muted small', text: t('lIntro') }));

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
    app.append(
      el('div', { class: 'card stack tight' }, [
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('span', { class: 'grow' }, search),
          el('button', { class: 'btn primary sm', type: 'button', onclick: run }, '🔍'),
        ]),
        el('div', { class: 'row filters', style: { gap: '6px' } }, [
          pick('subject', t('lAllSubjects'), facet('subject')),
          pick('grade', t('lAllGrades'), facet('grade')),
          pick('lang', t('lAllLangs'), [{ value: 'ar', label: t('lArabic') }, { value: 'en', label: t('lEnglish') }]),
          el('span', { class: 'grow' }),
          el('span', { class: 'muted small', text: t('lCount', { n: library.total }) }),
        ]),
      ])
    );

    if (!library.items.length) {
      const filtered = library.q || library.subject || library.grade || library.lang;
      app.append(
        el('div', { class: 'card stack center' }, [
          el('div', { style: { fontSize: '2.4rem' }, text: filtered ? '🔍' : '🌍' }),
          el('p', { class: 'muted', text: filtered ? t('lEmpty') : t('lEmptyAll') }),
          el('a', { class: 'btn primary', href: '#/mine' }, t('hmyActivities')),
        ])
      );
      return;
    }

    const list = el('div', { class: 'stack' });
    library.items.forEach((item) => list.append(libraryCard(item)));
    app.append(list);

    if (library.items.length < library.total) {
      const more = el('button', { class: 'btn ghost block', type: 'button' }, t('lMore'));
      more.addEventListener('click', () => {
        library.page += 1;
        openLibrary(true);
      });
      app.append(more);
    }
  }

  function libraryCard(item) {
    return el('div', { class: 'card stack tight' }, [
      el('div', { class: 'row between' }, [
        el('h2', { text: item.title, style: { margin: 0, fontSize: '1.05rem' } }),
        item.copies ? el('span', { class: 'badge', text: t('lCopies', { n: item.copies }) }) : null,
      ]),
      el('div', { class: 'row', style: { gap: '6px' } }, [
        el('span', { class: 'badge', text: t('hQuestionCount', { count: item.questionCount }) }),
        item.subject ? el('span', { class: 'badge', text: item.subject }) : null,
        item.grade ? el('span', { class: 'badge', text: item.grade }) : null,
        el('span', { class: 'badge', text: item.lang === 'en' ? t('lEnglish') : t('lArabic') }),
        ...item.types.slice(0, 5).map((type) => el('span', { class: 'badge', text: TYPE_EMOJI[type] || '•' })),
      ]),
      el('div', { class: 'row between' }, [
        el('span', { class: 'muted small', text: item.author ? t('lBy', { name: item.author }) : '' }),
        el('a', { class: 'btn ghost sm', href: '#/library/' + item.id }, t('lPreview')),
      ]),
    ]);
  }

  /** معاينة نشاط من المكتبة قبل نسخه — الأسئلة كما سيراها الطالب */
  async function openLibraryItem(id) {
    teardown();
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';
    const user = state.user || (await loadAccount());
    if (!user) {
      location.href = '/login.html?next=' + encodeURIComponent('/host.html#/library/' + id);
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

  /** تجربة فورية: ينشئ جلسة من قالب جاهز بضغطة واحدة */
  async function startDemo() {
    teardown();
    app.innerHTML = '';
    app.append(el('div', { class: 'card center stack' }, [el('div', { class: 'spinner' }), el('p', { class: 'muted', text: t('hpreparingAQuickDemo') })]));
    const template = (window.TEMPLATES || []).find((item) => item.key === 'quiz') || (window.TEMPLATES || [])[0];
    if (!state.user && !(await loadAccount())) {
      location.href = '/login.html?next=' + encodeURIComponent('/host.html#/demo');
      return;
    }
    try {
      const created = await api('/api/sessions', {
        method: 'POST',
        body: { title: template.title, settings: template.settings, questions: template.questions },
      });
      rememberHost(created.code, created.hostToken, created.title);
      location.hash = '#/live/' + created.code;
    } catch (err) {
      app.innerHTML = '';
      showOfflineBanner(app);
      app.append(
        el('div', { class: 'card stack center' }, [
          el('h2', { text: t('hcouldNotStartThe') }),
          el('p', { class: 'muted small', text: err.message }),
          el('a', { class: 'btn primary', href: '#/' }, t('hgoToTheEditor')),
        ])
      );
    }
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

  function openBuilder() {
    teardown();
    // المسار «#/» يعني نشاطاً جديداً؛ التعديل يمر عبر «#/edit/:id»
    if ((location.hash.slice(1) || '/') === '/') setEditingActivity(null);
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';
    const root = el('div', { class: 'stack' });
    // زر رجوع صريح — لا يكفي الأيقونة الصغيرة في الشريط العلوي
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhomePage')),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('a', { class: 'btn ghost sm', href: '#/library' }, t('lNav')),
          el('a', { class: 'btn ghost sm', href: '/games.html' }, t('gNav')),
          el('a', { class: 'btn ghost sm', href: '/help.html' }, t('hteacherGuide')),
          el('span', { class: 'muted small', text: t('hyourDraftIsSaved') }),
        ]),
      ])
    );
    if (state.user) {
      // ترحيب باسم صاحب الحساب — أول ما يراه المعلّم بعد الدخول
      app.append(
        el('div', { class: 'welcome' }, [
          el('h1', { style: { margin: 0 }, text: t('hHelloUser', { name: firstName(state.user.name) }) }),
          el('p', {
            class: 'muted small',
            style: { margin: 0 },
            text: state.premium?.isPremium ? t('hyourAccountIsPremium') : t('hreadyForANew'),
          }),
        ])
      );
    }
    app.append(el('h1', { text: t('hcreateAnInteractiveActivity') }));
    // مدخل المساعد الذكي: أسرع طريق لمدرب لا يريد كتابة الأسئلة يدوياً
    app.append(
      el('div', { class: 'card row between', style: { marginBottom: '12px' } }, [
        el('div', { class: 'stack tight' }, [
          el('strong', { text: t('hnotSureWhereTo') }),
          el('span', { class: 'muted small', text: t('htellTheAssistantAbout') }),
        ]),
        el('a', { class: 'btn accent', href: '#/ai' }, t('hdesignWithAi2')),
      ])
    );
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

  /** لوحة المالك: كل المدربين وحالة اشتراكهم مع التحكّم بالمدة */
  async function openAdmin() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '<div class="card center"><div class="spinner"></div></div>';

    if (!state.user) await loadAccount();
    if (!state.user) {
      location.href = '/login.html?next=' + encodeURIComponent('/host.html#/admin');
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
      app.append(
        el('div', { class: 'stats' }, [
          stat(users.length, t('hregisteredTeachers')),
          stat(active, t('hactivePremiumSubscriptions')),
          stat(users.filter((u) => u.premiumUntil && !u.isPremium).length, t('hexpiredSubscriptions')),
        ])
      );

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
              el('thead', {}, el('tr', {}, [el('th', {}, t('hteacher')), el('th', {}, t('hsignedUp')), el('th', {}, t('hsubscription')), el('th', {}, t('hcontrols'))])),
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

  /** بطاقة «هذه ميزة بريميوم» — تُستخدم في المساعد الذكي وفي التصدير */
  function upgradeCard(plan, title) {
    const p = plan || { whatsapp: '970597034066', priceUsd: 3, perks: [] };
    return el('div', { class: 'card stack' }, [
      el('h2', { style: { margin: 0 }, text: title || t('hpremiumFeature') }),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('haPremiumSubscriptionUnlocks') }),
      el('div', { class: 'stack tight' }, [
        el('div', { class: 'q-preview' }, [el('span', { class: 'badge', text: '🤖' }), el('span', { class: 'grow', text: t('hdesignTheActivityWith') })]),
        el('div', { class: 'q-preview' }, [el('span', { class: 'badge', text: '📊' }), el('span', { class: 'grow', text: t('hexportResultsToExcel') })]),
      ]),
      el('div', { class: 'row between' }, [
        el('strong', { text: t('hPriceMonthly', { price: p.priceUsd }) }),
        el('a', { class: 'btn primary', href: whatsappLink(p), target: '_blank', rel: 'noopener' }, t('hWhatsappBtn', { phone: p.whatsapp })),
      ]),
      el('p', { class: 'muted small', style: { margin: 0 }, text: t('hafterYouGetIn') }),
    ]);
  }

  /** صفحة المحادثة مع المساعد الذكي — تنتهي بمسودة تُفتح في المحرّر */
  function openAiDesigner() {
    teardown();
    codeBadge.classList.add('hidden');
    connBadge.classList.add('hidden');
    bar.innerHTML = '';
    app.innerHTML = '';
    app.append(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        el('a', { class: 'btn ghost sm', href: '#/' }, t('hbackToTheEditor')),
        el('a', { class: 'btn ghost sm', href: '/' }, t('hhome')),
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
          el('a', { class: 'btn primary', href: '/login.html?next=' + encodeURIComponent('/host.html#/ai') }, t('hsignInWithGoogle')),
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
      root.append(upgradeCard(state.premium?.plan, t('hunlockTheAiAssistant')));
      return;
    }

    window.AiChat.render(root, {
      onApprove: (draft) => {
        window.Builder.saveDraft(draft);
        setEditingActivity(null);
        // المسودة جاهزة: نفتحها على المراجعة مباشرةً لا على أول الإعدادات
        state.builderStage = 'review';
        toast(t('htheDraftIsOpen'), 'ok');
        location.hash = '#/';
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
            location.href = '/login.html?next=' + encodeURIComponent('/host.html#/new');
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
      window.Builder.mount(root, onLaunch, saveAction, { startStage });
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
        { class: 'btn ghost', href: '/login.html?next=' + encodeURIComponent('/host.html#/') },
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
          renderLive();
        } else if (msg.t === 'reaction') {
          Fx.floatEmoji(msg.emoji);
        } else if (msg.t === 'dashboard') {
          state.dashboard = msg.data;
          // لوحة التحكم ومسرح الوضع الحر كلاهما يرسمان من هذه البيانات
          if (state.tab === 'dashboard' || state.live?.pace === 'self') renderLive();
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
  }

  function send(type, extra) {
    if (!state.socket?.send({ t: type, ...(extra || {}) })) toast(t('hnoConnection'), 'bad');
  }

  // ------------------------------------------------------------- الرسم

  function renderLive() {
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

    const tabs = el('div', { class: 'tabs', style: { marginBottom: '12px' } }, [
      tabBtn('stage', t('hstage')),
      tabBtn('dashboard', t('hdashboard')),
      tabBtn('analytics', t('hanalysis')),
      tabBtn('share', t('hshare')),
    ]);
    app.append(tabs);

    if (state.tab === 'stage') renderStage(s);
    else if (state.tab === 'dashboard') renderDashboard();
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
    if (!opensAt && !duration) return null;

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
  function gradingCard(item) {
    const rows = item.answers.map((answer) => {
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

  function renderBar(s) {
    bar.innerHTML = '';
    if (state.tab !== 'stage') return;

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
      actions.push(
        el('button', { class: 'btn danger', type: 'button', onclick: () => confirm(t('hendTheActivityFor')) && send('host:end') }, t('hendActivity'))
      );
    } else {
      actions.push(el('button', { class: 'icon-btn', type: 'button', title: t('hpreviousQuestion'), disabled: s.index <= 0, onclick: () => send('host:prev') }, '⟩'));
      if (s.question?.content) {
        // شريحة عرض: لا إجابات تُغلق ولا نتائج تُكشف — زرّ انتقال واحد فقط
        actions.push(
          el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:skip') }, s.index + 1 >= s.total ? t('hfinish') : t('hnextQuestion'))
        );
      } else if (s.phase === 'question') {
        actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => send('host:lock') }, t('hlockAnswers')));
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:results') }, t('hshowResults2')));
      } else if (s.phase === 'results') {
        if (s.settings.showLeaderboard) {
          actions.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => send('host:leaderboard') }, t('pLeaderboard')));
        }
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:skip') }, s.index + 1 >= s.total ? t('hfinish') : t('hnextQuestion')));
      } else {
        actions.push(el('button', { class: 'btn primary', type: 'button', onclick: () => send('host:skip') }, s.index + 1 >= s.total ? t('hfinish') : t('hnextQuestion')));
      }
      actions.push(el('button', { class: 'icon-btn', type: 'button', title: t('hendTheActivity'), onclick: () => confirm(t('hendTheActivityNow')) && send('host:end') }, '⏹'));
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

  /**
   * زر الصفحة الرئيسية: مغادرة الجلسة المباشرة لا تُنهيها — تبقى قائمة
   * ويستطيع المدرب استئنافها، لذلك نوضّح ذلك بدل تحذير مبهم.
   */
  const homeBtn = $('#homeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      const live = state.live && state.live.status === 'live';
      if (live && !confirm(t('htheSessionKeepsRunning'))) return;
      state.leavingIntentionally = true;
      teardown();
      location.href = '/';
    });
  }

  // زر كتم الصوت
  const soundBtn = $('#soundBtn');
  if (soundBtn) {
    const paint = () => (soundBtn.textContent = Fx.soundOn() ? '🔊' : '🔇');
    paint();
    soundBtn.addEventListener('click', () => {
      Fx.setSound(!Fx.soundOn());
      paint();
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
  loadAccount().finally(route);
})();
