'use strict';

/**
 * طبقة التخزين الدائم — للحسابات والأنشطة المحفوظة فقط.
 *
 * مهم: نتائج المشاركين وإجاباتهم لا تُخزَّن هنا إطلاقاً؛ تبقى في ذاكرة
 * العملية وتختفي بانتهاء الجلسة (انظر server/store.js).
 *
 * سائقان بنفس الواجهة:
 *  - postgres: عند وجود DATABASE_URL (الخيار الموصى به للنشر).
 *  - file: ملف JSON على القرص (للتطوير المحلي وللخوادم ذات قرص دائم).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
// منحة التسجيل تُقرأ من إعدادات الاشتراك — premium.js بلا تبعيات فلا دورة هنا
const premium = require('./premium');
const countries = require('./countries');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'tafa3l.json');

function newId(prefix) {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

/** متوسّط التقييم — صفرٌ لمن لم يُقيَّم بعد */
function gameRating(g) {
  return g.ratingCount ? g.ratingSum / g.ratingCount : 0;
}

/**
 * ترتيب الألعاب. «الأعلى تقييماً» لا يعني أعلى متوسّط: لعبةٌ قيّمها واحد
 * بخمس نجوم ليست أفضل من لعبةٍ قيّمها مئةٌ بأربع ونصف. فنستعمل ترجيحاً
 * بايزياً بسيطاً يسحب المتوسّط نحو ٣٫٥ حتى تتراكم التقييمات.
 */
function sortGames(sort) {
  if (sort === 'new') return (a, b) => b.createdAt - a.createdAt;
  if (sort === 'rated') {
    const PRIOR = 5; // كم تقييماً «افتراضياً» نضيفه قبل أن نصدّق المتوسّط
    const MEAN = 3.5;
    const score = (g) => ((g.ratingSum || 0) + PRIOR * MEAN) / ((g.ratingCount || 0) + PRIOR);
    return (a, b) => score(b) - score(a) || (b.plays || 0) - (a.plays || 0);
  }
  return (a, b) => (b.plays || 0) - (a.plays || 0) || b.createdAt - a.createdAt;
}

// ------------------------------------------------------------- سائق الملف

function fileDriver() {
  /** @type {{users:Object, activities:Object, authSessions:Object, bankQuestions:Object, games:Object, liveSessions:Object}} */
  let db = { users: {}, activities: {}, authSessions: {}, bankQuestions: {}, games: {}, liveSessions: {}, classes: {}, meta: {} };
  let writeTimer = null;
  let writing = false;
  let dirty = false;

  async function flush() {
    if (writing) {
      dirty = true;
      return;
    }
    writing = true;
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      // كتابة ذرّية: ملف مؤقت ثم إعادة تسمية، حتى لا يتلف الملف عند التوقف المفاجئ
      const tmp = DATA_FILE + '.' + process.pid + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(db), 'utf8');
      await fsp.rename(tmp, DATA_FILE);
    } catch (err) {
      console.error('تعذّر حفظ بيانات الحسابات:', err.message);
    } finally {
      writing = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      flush();
    }, 150);
    writeTimer.unref?.();
  }

  /**
   * ترحيلٌ يجري **مرّةً واحدة في عمر التخزين**: كل حسابٍ كان موجوداً لحظة
   * الترقية يصير فلسطينياً — فأولئك هم عملاء المنصة اليوم وكلهم من فلسطين.
   *
   * والعلامة ضرورية لا زينة: بدونها يجري الترحيل عند كل إقلاع، فيختم بفلسطين
   * على حسابٍ سجّل قبل دقائق ولم يُسأل بعد — فلا يُسأل أبداً. والسؤال مطلوب.
   */
  function backfillCountry() {
    if (db.meta?.countryBackfillAt) return;
    for (const u of Object.values(db.users)) {
      if (!u.country) u.country = countries.DEFAULT_COUNTRY;
    }
    db.meta = { ...(db.meta || {}), countryBackfillAt: Date.now() };
    schedule();
  }

  return {
    kind: 'file',
    location: DATA_FILE,

    async init() {
      try {
        const raw = await fsp.readFile(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        db = {
          users: parsed.users || {},
          activities: parsed.activities || {},
          games: parsed.games || {},
          authSessions: parsed.authSessions || {},
          bankQuestions: parsed.bankQuestions || {},
          liveSessions: parsed.liveSessions || {},
          classes: parsed.classes || {},
          meta: parsed.meta || {},
        };
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('ملف البيانات غير قابل للقراءة، سنبدأ فارغاً:', err.message);
      }
      backfillCountry();
    },

    async findUserByEmail(email) {
      return Object.values(db.users).find((u) => u.email === email) || null;
    },
    async findUserById(id) {
      const u = db.users[id];
      // بلا الصورة: هذه الدالة تُنادى مع كل طلبٍ مُصادق، والصورة data URI ثقيلة
      if (!u) return null;
      const { photo, ...rest } = u;
      return { ...rest, hasPhoto: Boolean(photo) };
    },
    /** كل المدربين — للوحة المالك فقط */
    async listUsers() {
      return Object.values(db.users).sort((a, b) => b.createdAt - a.createdAt);
    },
    /** تاريخ انتهاء اشتراك بريميوم (ms) أو null لإلغائه */
    async setPremiumUntil(userId, until) {
      const user = db.users[userId];
      if (!user) return null;
      user.premiumUntil = until;
      schedule();
      return user;
    },
    /**
     * يسجّل بناء لعبةٍ واحدة في حساب المعلّم — ويعيد عدّاديه بعد الزيادة.
     *
     * عدّادان لا واحد: `gamesBuilt` مجموعُ العمر (منه حصّةُ الحساب المجاني،
     * وهي لعبتان مرّةً واحدة لا تتجدّدان)، و`gamesMonth` عدّادُ الشهر الجاري
     * (منه حصّةُ المشترك، عشرون كل شهر). و`gamesMonthKey` هو ما يجعل الشهري
     * شهريّاً: نقارنه بمفتاح الشهر الحالي فنصفّر عند انقلابه — بلا مهمّةٍ
     * دوريّة تمرّ على الحسابات كلّها.
     */
    async bumpGameBuilds(userId, monthKey) {
      const user = db.users[userId];
      if (!user) return null;
      user.gamesBuilt = (Number(user.gamesBuilt) || 0) + 1;
      user.gamesMonth = user.gamesMonthKey === monthKey ? (Number(user.gamesMonth) || 0) + 1 : 1;
      user.gamesMonthKey = monthKey;
      schedule();
      return { gamesBuilt: user.gamesBuilt, gamesMonth: user.gamesMonth, gamesMonthKey: user.gamesMonthKey };
    },
    /** بروفايل المعلّم الاختياري — يكتبه هو، ولا يمسّه دخول جوجل */
    async updateProfile(userId, patch) {
      const u = db.users[userId];
      if (!u) return null;
      // undefined = «لم يُرسَل هذا الحقل»؛ السلسلة الفارغة = «امسحه»
      for (const key of ['displayName', 'phone', 'photo', 'country']) {
        if (patch[key] !== undefined) u[key] = patch[key] || '';
      }
      schedule();
      const { photo, ...rest } = u;
      return { ...rest, hasPhoto: Boolean(photo) };
    },
    async getUserPhoto(id) {
      return db.users[id]?.photo || '';
    },
    /** إنشاء أو تحديث بحسب البريد — بريد جوجل مُتحقَّق منه فهو المفتاح الطبيعي للحساب */
    async upsertUser({ email, name, googleId }) {
      const existing = Object.values(db.users).find((u) => u.email === email);
      if (existing) {
        existing.name = name;
        existing.googleId = googleId;
        schedule();
        return { ...existing, isNew: false };
      }
      // منحة التسجيل تُكتب مع الحساب لحظة إنشائه — لا مسار آخر يمنحها،
      // فلا يستطيع أحد تجديدها بتسجيل دخولٍ جديد بالبريد نفسه
      const now = Date.now();
      const trial = premium.signupTrialMs();
      const user = {
        id: newId('u_'), email, name, googleId, displayName: '', phone: '', photo: '',
        premiumUntil: trial ? now + trial : null,
        trialGrantedAt: trial ? now : null,
        createdAt: now,
      };
      db.users[user.id] = user;
      schedule();
      return { ...user, isNew: true };
    },

    async listActivities(ownerId) {
      return Object.values(db.activities)
        .filter((a) => a.ownerId === ownerId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    /**
     * كم نشاطاً وكم لعبةً لكل مالك — للوحة المالك.
     * مرورٌ واحد على كلٍّ من الجدولين بدل استعلامٍ لكل مدرب: اللوحة تعرض
     * كل المدربين في صفحة واحدة، فاستعلامٌ لكلٍّ منهم يعني مئات الاستعلامات.
     */
    async ownerCounts() {
      const out = new Map();
      const bump = (ownerId, key) => {
        if (!ownerId) return;
        const row = out.get(ownerId) || { activities: 0, games: 0 };
        row[key] += 1;
        out.set(ownerId, row);
      };
      Object.values(db.activities).forEach((a) => bump(a.ownerId, 'activities'));
      Object.values(db.games).forEach((g) => bump(g.ownerId, 'games'));
      return out;
    },
    async getActivity(id) {
      return db.activities[id] || null;
    },
    async saveActivity(activity) {
      db.activities[activity.id] = activity;
      schedule();
      return activity;
    },
    async deleteActivity(id) {
      delete db.activities[id];
      schedule();
    },

    async listPublished({ q = '', subject = '', grade = '', lang = '', limit = 24, offset = 0 } = {}) {
      const needle = q.trim().toLowerCase();
      const all = Object.values(db.activities)
        .filter((a) => a.published)
        .filter((a) => !subject || a.subject === subject)
        .filter((a) => !grade || a.grade === grade)
        .filter((a) => !lang || (a.settings?.lang || 'ar') === lang)
        .filter((a) => !needle || String(a.title).toLowerCase().includes(needle))
        .sort((a, b) => (b.copies || 0) - (a.copies || 0) || b.publishedAt - a.publishedAt);
      return {
        total: all.length,
        items: all.slice(offset, offset + limit).map((a) => ({ ...a, authorName: db.users[a.ownerId]?.name || '' })),
      };
    },
    async bumpCopies(id) {
      const a = db.activities[id];
      if (!a) return;
      a.copies = (a.copies || 0) + 1;
      schedule();
    },

    // ------------------------------------------- هياكل الجلسات الحيّة
    // ما يُحفظ هنا هيكلٌ فقط (رمز، أسئلة، إعدادات، موضع العرض). لا مشارك
    // ولا إجابة ولا درجة — تلك تبقى في الذاكرة وتموت مع العملية عمداً.

    async saveLiveSession(snap) {
      db.liveSessions[snap.code] = { ...snap, savedAt: Date.now() };
      schedule();
    },
    /** تحديث الحقول الخفيفة وحدها — يعيد false إن لم يكن للجلسة صفّ بعد */
    async patchLiveSession(code, patch) {
      const row = db.liveSessions[code];
      if (!row) return false;
      Object.assign(row, patch, { savedAt: Date.now() });
      schedule();
      return true;
    },
    async deleteLiveSession(code) {
      if (!db.liveSessions[code]) return;
      delete db.liveSessions[code];
      schedule();
    },
    async listLiveSessions() {
      return Object.values(db.liveSessions);
    },

    // ------------------------------------------------------------- الفصول

    async listClasses(ownerId) {
      return Object.values(db.classes)
        .filter((c) => c.ownerId === ownerId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async getClass(id) {
      return db.classes[id] || null;
    },
    async saveClass(item) {
      db.classes[item.id] = item;
      schedule();
      return item;
    },
    async deleteClass(id) {
      delete db.classes[id];
      schedule();
    },


    // ------------------------------------------------------------- الألعاب

    async listGames({ q = '', subject = '', grade = '', ownerId = '', sort = 'popular', limit = 24, offset = 0 } = {}) {
      const needle = q.trim().toLowerCase();
      const all = Object.values(db.games)
        .filter((g) => !ownerId || g.ownerId === ownerId)
        .filter((g) => !subject || g.subject === subject)
        // الصفوف مصفوفة: «كل المراحل» = مصفوفة فارغة فتطابق أي بحث
        .filter((g) => !grade || !g.grades.length || g.grades.includes(grade))
        .filter((g) => !needle || String(g.title).toLowerCase().includes(needle))
        .sort(sortGames(sort));
      return {
        total: all.length,
        // القائمة بلا الشفرة ولا الصورة: صفحةٌ من ٢٤ لعبة قد تبلغ عشرات
        // الميغابايت لو حملناهما، والبطاقة لا تحتاج إلا وجودَ الصورة
        items: all.slice(offset, offset + limit).map(({ html, cover, ...g }) => ({
          ...g,
          hasCover: Boolean(cover),
          authorName: db.users[g.ownerId]?.name || '',
          authorDisplayName: db.users[g.ownerId]?.displayName || '',
        })),
      };
    },
    async getGame(id) {
      const g = db.games[id];
      return g
        ? {
            ...g,
            hasCover: Boolean(g.cover),
            authorName: db.users[g.ownerId]?.name || '',
            authorDisplayName: db.users[g.ownerId]?.displayName || '',
          }
        : null;
    },
    async getGameCover(id) {
      return db.games[id]?.cover || '';
    },
    async listGameTeachers() {
      const by = new Map();
      for (const g of Object.values(db.games)) {
        const owner = db.users[g.ownerId];
        const row = by.get(g.ownerId) || {
          id: g.ownerId,
          name: owner?.name || '',
          displayName: owner?.displayName || '',
          hasPhoto: Boolean(owner?.photo),
          games: 0,
          plays: 0,
        };
        row.games += 1;
        row.plays += g.plays || 0;
        by.set(g.ownerId, row);
      }
      return [...by.values()].sort((a, b) => b.games - a.games || b.plays - a.plays);
    },
    async saveGame(game) {
      db.games[game.id] = game;
      schedule();
      return game;
    },
    async deleteGame(id) {
      delete db.games[id];
      schedule();
    },
    async bumpGamePlays(id) {
      const g = db.games[id];
      if (!g) return;
      g.plays = (g.plays || 0) + 1;
      schedule();
    },
    async rateGame(id, stars) {
      const g = db.games[id];
      if (!g) return null;
      g.ratingSum = (g.ratingSum || 0) + stars;
      g.ratingCount = (g.ratingCount || 0) + 1;
      schedule();
      return g;
    },

    async listBankQuestions(ownerId) {
      return Object.values(db.bankQuestions)
        .filter((q) => q.ownerId === ownerId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async getBankQuestion(id) {
      return db.bankQuestions[id] || null;
    },
    async saveBankQuestion(item) {
      db.bankQuestions[item.id] = item;
      schedule();
      return item;
    },
    async deleteBankQuestion(id) {
      delete db.bankQuestions[id];
      schedule();
    },

    async createAuthSession(session) {
      db.authSessions[session.token] = session;
      schedule();
    },
    async getAuthSession(token) {
      const s = db.authSessions[token];
      if (!s) return null;
      if (s.expiresAt < Date.now()) {
        delete db.authSessions[token];
        schedule();
        return null;
      }
      return s;
    },
    async deleteAuthSession(token) {
      delete db.authSessions[token];
      schedule();
    },
    async sweepAuthSessions() {
      const now = Date.now();
      let removed = 0;
      for (const [token, s] of Object.entries(db.authSessions)) {
        if (s.expiresAt < now) {
          delete db.authSessions[token];
          removed++;
        }
      }
      if (removed) schedule();
    },
  };
}

// ---------------------------------------------------------- سائق Postgres

function postgresDriver(connectionString) {
  // نحمّله عند الحاجة فقط حتى يعمل التطبيق بلا Postgres مثبّت
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    // معظم مزوّدي Postgres المُدارين يتطلبون TLS بشهادة وسيطة
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 5,
    // نفشل بسرعة بدل تعليق النشر عند عنوان خاطئ
    connectionTimeoutMillis: 10000,
  });

  // خطأ في اتصال خامل يجب ألا يُسقط العملية
  pool.on('error', (err) => console.error('خطأ في اتصال Postgres خامل:', err.message));

  /**
   * أعمدة صفّ المستخدم — قائمةٌ واحدة تستعملها كل استعلاماته.
   *
   * كانت مكتوبةً يدوياً في كل استعلام، فأُضيف عمودان (`country` و
   * `trial_granted_at`) إلى `userRow` ونُسيا هنا: كان الحفظ ينجح ثم يعود
   * المعلّم فيجد بلده فارغاً، ومنحةُ التسجيل لا تُعرف أصلاً على Postgres.
   * قائمةٌ واحدة تجعل ذلك مستحيلاً بالبناء لا بالانتباه.
   *
   * و`*` غير واردة: الصورة data URI ثقيلة، وهذه الدالة تُنادى مع كل طلبٍ مُصادق.
   */
  const USER_COLUMNS = `id, email, name, display_name, phone, country, google_id,
                        premium_until, trial_granted_at, created_at,
                        games_built, games_month, games_month_key,
                        (photo IS NOT NULL AND photo <> '') AS has_photo`;

  const userRow = (r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    displayName: r.display_name || '',
    phone: r.phone || '',
    hasPhoto: r.has_photo === undefined ? Boolean(r.photo) : Boolean(r.has_photo),
    googleId: r.google_id,
    premiumUntil: r.premium_until == null ? null : Number(r.premium_until),
    trialGrantedAt: r.trial_granted_at == null ? null : Number(r.trial_granted_at),
    country: r.country || '',
    gamesBuilt: Number(r.games_built) || 0,
    gamesMonth: Number(r.games_month) || 0,
    gamesMonthKey: r.games_month_key || '',
    createdAt: Number(r.created_at),
  });

  const rowToActivity = (r) =>
    r && {
      id: r.id,
      ownerId: r.owner_id,
      title: r.title,
      settings: r.settings,
      questions: r.questions,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      published: Boolean(r.published),
      publishedAt: r.published_at == null ? null : Number(r.published_at),
      subject: r.subject || '',
      grade: r.grade || '',
      copies: Number(r.copies || 0),
      ...(r.author_name === undefined ? {} : { authorName: r.author_name || '' }),
    };

  const rowToClass = (r) =>
    r && {
      id: r.id,
      ownerId: r.owner_id,
      name: r.name,
      students: r.students || [],
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };

  const rowToGame = (r) =>
    r && {
      id: r.id,
      ownerId: r.owner_id,
      title: r.title,
      subject: r.subject || '',
      grades: Array.isArray(r.grades) ? r.grades : [],
      description: r.description || '',
      // القوائم لا تختار html ولا cover، فالحقلان قد يغيبان عن الصفّ
      ...(r.html === undefined ? {} : { html: r.html }),
      hasCover: r.has_cover === undefined ? Boolean(r.cover) : Boolean(r.has_cover),
      offlineOk: r.offline_ok !== false,
      bytes: Number(r.bytes || 0),
      plays: Number(r.plays || 0),
      ratingSum: Number(r.rating_sum || 0),
      ratingCount: Number(r.rating_count || 0),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      ...(r.author_name === undefined ? {} : { authorName: r.author_name || '', authorDisplayName: r.author_display_name || '' }),
    };

  const rowToBankQuestion = (r) =>
    r && {
      id: r.id,
      ownerId: r.owner_id,
      question: r.question,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };

  return {
    kind: 'postgres',
    location: connectionString.replace(/:[^:@/]+@/, ':***@'),

    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          google_id TEXT,
          premium_until BIGINT,
          created_at BIGINT NOT NULL
        );
        -- ترقية جدول قديم كان يعتمد بريد+كلمة مرور: نضيف عمود جوجل ونُسقط عمودي كلمة المرور.
        -- إسقاطهما لا يفقد أنشطة أحد — هوية الحساب تبقى نفس البريد، وإعادة الدخول عبر جوجل بنفس البريد يطابق الحساب القديم.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
        ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
        ALTER TABLE users DROP COLUMN IF EXISTS salt;
        -- اشتراك بريميوم: تاريخ الانتهاء بالمللي ثانية، وnull يعني حساباً مجانياً
        ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until BIGINT;
        -- بروفايل اختياري يملؤه المعلّم: اسمٌ يظهر للطلاب بدل اسم حساب جوجل،
        -- وصورة، ورقمٌ للتواصل. الثلاثة اختيارية، وفارغُها لا يُعرض.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;
        -- منحة التسجيل: لحظة منحها. وجودها يميّز التجربة المجانية عن اشتراكٍ
        -- مدفوع، ويمنع منحها مرتين لو أُعيد تشغيل الترقية على حسابٍ قائم.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_granted_at BIGINT;
        -- بلد المعلّم برمز ISO ذي الحرفين. الحسابات التي أُنشئت قبل أن يُسأل
        -- أحدٌ عن بلده كلّها فلسطينية، فنُثبت ذلك بدل تركه فراغاً يُخمَّن لاحقاً.
        -- والشرط الزمني يترك للحساب الجديد نافذةً ليجيب بنفسه قبل أن نفترض عنه.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
        -- حصّة بناء الألعاب: مجموع العمر (حصّة المجاني منه)، وعدّاد الشهر
        -- الجاري ومفتاحه YYYY-MM (حصّة المشترك منه). المفتاح يغني عن مهمّةٍ
        -- دوريّة تصفّر العدّادات: يُقارَن عند القراءة، ويُكتب عند الزيادة.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS games_built BIGINT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS games_month BIGINT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS games_month_key TEXT;
        CREATE TABLE IF NOT EXISTS activities (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          settings JSONB NOT NULL,
          questions JSONB NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS activities_owner_idx ON activities(owner_id);
        -- المكتبة العامة: نشاط يختار صاحبه نشره فيُصبح مرئياً للجميع
        ALTER TABLE activities ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE activities ADD COLUMN IF NOT EXISTS published_at BIGINT;
        ALTER TABLE activities ADD COLUMN IF NOT EXISTS subject TEXT;
        ALTER TABLE activities ADD COLUMN IF NOT EXISTS grade TEXT;
        ALTER TABLE activities ADD COLUMN IF NOT EXISTS copies INTEGER NOT NULL DEFAULT 0;
        -- فهرس جزئي: صفوف المكتبة قليلة بين كل الأنشطة، فلا داعي لفهرسة الباقي
        CREATE INDEX IF NOT EXISTS activities_published_idx ON activities(published, copies DESC) WHERE published;
        CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          subject TEXT,
          grades JSONB NOT NULL DEFAULT '[]'::jsonb,
          description TEXT,
          -- ملف اللعبة كما رفعه المعلّم. يُقدَّم دائماً داخل إطار معزول
          -- بأصل مبهم، فلا يرى حسابات المنصة ولا بيانات الطلاب مهما فعل.
          html TEXT NOT NULL,
          bytes INTEGER NOT NULL DEFAULT 0,
          plays INTEGER NOT NULL DEFAULT 0,
          rating_sum INTEGER NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS games_owner_idx ON games(owner_id);
        CREATE INDEX IF NOT EXISTS games_plays_idx ON games(plays DESC);
        -- صورة مصغّرة تدلّ على اللعبة: data URI مصغَّرةٌ في المتصفّح قبل الرفع.
        -- تُقدَّم عبر مسارها الخاص لا داخل JSON كي تبقى القوائم خفيفة ومخزَّنة.
        ALTER TABLE games ADD COLUMN IF NOT EXISTS cover TEXT;
        -- يسمح صاحب اللعبة بحفظها على جهاز الطالب للّعب بلا إنترنت.
        -- الافتراضي مسموح، ومن يمنع تبقى لعبته على المنصّة وحدها.
        ALTER TABLE games ADD COLUMN IF NOT EXISTS offline_ok BOOLEAN NOT NULL DEFAULT TRUE;
        CREATE TABLE IF NOT EXISTS bank_questions (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          question JSONB NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bank_questions_owner_idx ON bank_questions(owner_id);
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at BIGINT NOT NULL
        );
        -- هياكل الجلسات الحيّة كي تنجو من إعادة نشرٍ أو إعادة تشغيل.
        -- data يحمل الرمز والأسئلة والإعدادات وموضع العرض فقط؛ لا مشارك
        -- ولا إجابة ولا درجة — وعدُ المنصة أن تلك لا تلمس القرص أبداً.
        CREATE TABLE IF NOT EXISTS live_sessions (
          code TEXT PRIMARY KEY,
          owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          data JSONB NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS live_sessions_updated_idx ON live_sessions(updated_at);
        -- فصول المعلّم: أسماءُ طلابه كما يكتبها هو، اختيارية بالكامل.
        -- ليست بيانات جمعتها المنصة من الطلاب، ولا تُربط بإجابة أحد —
        -- الإجابات تبقى في الذاكرة كما كانت ولا تلمس هذا الجدول ولا غيره.
        CREATE TABLE IF NOT EXISTS classes (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          students JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS classes_owner_idx ON classes(owner_id);
        -- علاماتٌ تُكتب مرّةً: ترحيلاتٌ جرت، فلا تُعاد عند كل إقلاع
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // ترحيلٌ يجري **مرّةً واحدة في عمر القاعدة**: كل حسابٍ كان موجوداً لحظة
      // الترقية يصير فلسطينياً — فأولئك هم عملاء المنصة اليوم وكلهم من فلسطين.
      // والعلامة ضرورية لا زينة: بدونها يجري الترحيل عند كل إقلاع، فيختم
      // بفلسطين على حسابٍ سجّل قبل دقائق ولم يُسأل بعد — فلا يُسأل أبداً.
      const done = await pool.query('SELECT 1 FROM app_meta WHERE key = $1', ['country_backfill_at']);
      if (!done.rowCount) {
        await pool.query("UPDATE users SET country = $1 WHERE country IS NULL OR country = ''", [countries.DEFAULT_COUNTRY]);
        await pool.query('INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [
          'country_backfill_at',
          String(Date.now()),
        ]);
      }
    },

    async findUserByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const r = rows[0];
      return r ? userRow(r) : null;
    },
    async findUserById(id) {
      const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
      const r = rows[0];
      return r ? userRow(r) : null;
    },
    /** إنشاء أو تحديث بحسب البريد — بريد جوجل مُتحقَّق منه فهو المفتاح الطبيعي للحساب */
    async listUsers() {
      const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      return rows.map(userRow);
    },
    async setPremiumUntil(userId, until) {
      const { rows } = await pool.query('UPDATE users SET premium_until = $2 WHERE id = $1 RETURNING *', [userId, until]);
      return rows[0] ? userRow(rows[0]) : null;
    },

    /**
     * يسجّل بناء لعبةٍ واحدة — الزيادةُ داخل جملة SQL واحدة.
     *
     * والقراءةُ ثم الكتابة من العُقدة كانتا ستسمحان لطلبين متزامنين بقراءة
     * العدّاد نفسه فيُحسب بناءان بواحد. أمّا هنا فالقاعدة هي التي تجمع، فلا
     * سباق مهما تزامنت الطلبات.
     */
    async bumpGameBuilds(userId, monthKey) {
      const { rows } = await pool.query(
        `UPDATE users
            SET games_built = COALESCE(games_built, 0) + 1,
                games_month = CASE WHEN games_month_key = $2 THEN COALESCE(games_month, 0) + 1 ELSE 1 END,
                games_month_key = $2
          WHERE id = $1
      RETURNING games_built, games_month, games_month_key`,
        [userId, monthKey]
      );
      const r = rows[0];
      return r ? { gamesBuilt: Number(r.games_built) || 0, gamesMonth: Number(r.games_month) || 0, gamesMonthKey: r.games_month_key || '' } : null;
    },

    async updateProfile(userId, patch) {
      const sets = [];
      const params = [userId];
      for (const [key, col] of [['displayName', 'display_name'], ['phone', 'phone'], ['photo', 'photo'], ['country', 'country']]) {
        if (patch[key] === undefined) continue;
        params.push(patch[key] || null);
        sets.push(`${col} = $${params.length}`);
      }
      if (!sets.length) return this.findUserById(userId);
      const { rows } = await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`,
        params
      );
      return rows[0] ? userRow(rows[0]) : null;
    },
    async getUserPhoto(id) {
      const { rows } = await pool.query('SELECT photo FROM users WHERE id = $1', [id]);
      return rows[0]?.photo || '';
    },
    async upsertUser({ email, name, googleId }) {
      const now = Date.now();
      const trial = premium.signupTrialMs();
      // المنحة داخل الـINSERT وحده: فرع DO UPDATE لا يمسّ premium_until، فالحساب
      // القائم لا يُمنح شيئاً مهما تكرّر دخوله. و«xmax = 0» تكشف الإدراج الجديد
      // من التحديث، فنعرف متى نُهنّئ المعلّم ومتى نصمت.
      const { rows } = await pool.query(
        `INSERT INTO users (id, email, name, google_id, created_at, premium_until, trial_granted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (email) DO UPDATE SET name = $3, google_id = $4
         RETURNING *, (xmax = 0) AS inserted`,
        [newId('u_'), email, name, googleId, now, trial ? now + trial : null, trial ? now : null]
      );
      const r = rows[0];
      return { ...userRow(r), isNew: r.inserted === true };
    },

    async listActivities(ownerId) {
      const { rows } = await pool.query('SELECT * FROM activities WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
      return rows.map(rowToActivity);
    },
    /** عددا الأنشطة والألعاب لكل مالك في استعلامٍ واحد — لا استعلامٍ لكل مدرب */
    async ownerCounts() {
      const { rows } = await pool.query(`
        SELECT owner_id, SUM(a) AS activities, SUM(g) AS games FROM (
          SELECT owner_id, 1 AS a, 0 AS g FROM activities
          UNION ALL
          SELECT owner_id, 0 AS a, 1 AS g FROM games
        ) t GROUP BY owner_id
      `);
      return new Map(rows.map((r) => [r.owner_id, { activities: Number(r.activities), games: Number(r.games) }]));
    },
    async getActivity(id) {
      const { rows } = await pool.query('SELECT * FROM activities WHERE id = $1', [id]);
      return rowToActivity(rows[0]);
    },
    async saveActivity(a) {
      await pool.query(
        `INSERT INTO activities (id, owner_id, title, settings, questions, created_at, updated_at, published, published_at, subject, grade, copies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET title = $3, settings = $4, questions = $5, updated_at = $7,
           published = $8, published_at = $9, subject = $10, grade = $11, copies = $12`,
        [
          a.id, a.ownerId, a.title, JSON.stringify(a.settings), JSON.stringify(a.questions), a.createdAt, a.updatedAt,
          Boolean(a.published), a.publishedAt ?? null, a.subject || null, a.grade || null, Number(a.copies || 0),
        ]
      );
      return a;
    },
    async deleteActivity(id) {
      await pool.query('DELETE FROM activities WHERE id = $1', [id]);
    },

    async listPublished({ q = '', subject = '', grade = '', lang = '', limit = 24, offset = 0 } = {}) {
      // البحث بـ ILIKE على العنوان وحده: المكتبة بمئات الصفوف لا ملايينها،
      // وفهرس نصّي كامل بالعربية يحتاج قاموساً لا يستحقه هذا الحجم بعد.
      const where = ['a.published'];
      const params = [];
      const add = (sql, value) => { params.push(value); where.push(sql.replace('$?', '$' + params.length)); };
      if (q.trim()) add('a.title ILIKE $?', '%' + q.trim() + '%');
      if (subject) add('a.subject = $?', subject);
      if (grade) add('a.grade = $?', grade);
      if (lang) add("COALESCE(a.settings->>'lang', 'ar') = $?", lang);
      const clause = where.join(' AND ');
      const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM activities a WHERE ${clause}`, params);
      const { rows } = await pool.query(
        `SELECT a.*, u.name AS author_name FROM activities a
         LEFT JOIN users u ON u.id = a.owner_id
         WHERE ${clause}
         ORDER BY a.copies DESC, a.published_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Number(limit) || 24, Number(offset) || 0]
      );
      return { total: countRows[0]?.n || 0, items: rows.map(rowToActivity) };
    },
    async bumpCopies(id) {
      await pool.query('UPDATE activities SET copies = copies + 1 WHERE id = $1', [id]);
    },

    // ------------------------------------------- هياكل الجلسات الحيّة

    async saveLiveSession(snap) {
      await pool.query(
        `INSERT INTO live_sessions (code, owner_id, data, updated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (code) DO UPDATE SET owner_id = $2, data = $3, updated_at = $4`,
        [snap.code, snap.ownerId || null, JSON.stringify(snap), Date.now()]
      );
    },
    /**
     * دمجٌ سطحي داخل JSONB بدل إعادة كتابة الصفّ كلّه. والفرق ليس تجميلاً:
     * `data` تحمل الأسئلة وصورَها، فإعادةُ كتابتها عند كل انتقالِ شريحة تعني
     * ميغابايتاتٍ تُرسَل إلى القاعدة ستّين مرة في الحصة الواحدة بلا سبب —
     * وما تغيّر فعلاً حقلان أو ثلاثة.
     */
    async patchLiveSession(code, patch) {
      const { rowCount } = await pool.query(
        'UPDATE live_sessions SET data = data || $2::jsonb, updated_at = $3 WHERE code = $1',
        [code, JSON.stringify(patch), Date.now()]
      );
      return rowCount > 0;
    },
    async deleteLiveSession(code) {
      await pool.query('DELETE FROM live_sessions WHERE code = $1', [code]);
    },
    async listLiveSessions() {
      const { rows } = await pool.query('SELECT data FROM live_sessions ORDER BY updated_at DESC');
      return rows.map((r) => r.data);
    },

    // ------------------------------------------------------------- الفصول

    async listClasses(ownerId) {
      const { rows } = await pool.query('SELECT * FROM classes WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
      return rows.map(rowToClass);
    },
    async getClass(id) {
      const { rows } = await pool.query('SELECT * FROM classes WHERE id = $1', [id]);
      return rowToClass(rows[0]);
    },
    async saveClass(item) {
      await pool.query(
        `INSERT INTO classes (id, owner_id, name, students, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name = $3, students = $4, updated_at = $6`,
        [item.id, item.ownerId, item.name, JSON.stringify(item.students), item.createdAt, item.updatedAt]
      );
      return item;
    },
    async deleteClass(id) {
      await pool.query('DELETE FROM classes WHERE id = $1', [id]);
    },

    // ------------------------------------------------------------- الألعاب

    async listGames({ q = '', subject = '', grade = '', ownerId = '', sort = 'popular', limit = 24, offset = 0 } = {}) {
      const where = ['TRUE'];
      const params = [];
      const add = (sql, value) => { params.push(value); where.push(sql.replace('$?', '$' + params.length)); };
      if (ownerId) add('g.owner_id = $?', ownerId);
      if (q.trim()) add('g.title ILIKE $?', '%' + q.trim() + '%');
      if (subject) add('g.subject = $?', subject);
      // «كل المراحل» تُخزَّن مصفوفةً فارغة فتطابق أي صفّ يبحث عنه الطالب
      if (grade) add("(jsonb_array_length(g.grades) = 0 OR g.grades ? $?)", grade);
      const clause = where.join(' AND ');
      // الترجيح البايزي نفسه المستعمل في سائق الملف — كي يتطابق الترتيب
      const order =
        sort === 'new'
          ? 'g.created_at DESC'
          : sort === 'rated'
            ? '((g.rating_sum + 5 * 3.5) / (g.rating_count + 5)) DESC, g.plays DESC'
            : 'g.plays DESC, g.created_at DESC';
      const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM games g WHERE ${clause}`, params);
      // نستثني html وcover صراحةً: صفحةٌ من ٢٤ لعبة بحجمها الأقصى تعني
      // عشرات الميغابايت تُقرأ وتُنقل بلا أن تستعملها البطاقة
      const { rows } = await pool.query(
        `SELECT g.id, g.owner_id, g.title, g.subject, g.grades, g.description, g.bytes,
                g.plays, g.rating_sum, g.rating_count, g.created_at, g.updated_at, g.offline_ok,
                (g.cover IS NOT NULL) AS has_cover, u.name AS author_name, u.display_name AS author_display_name
         FROM games g
         LEFT JOIN users u ON u.id = g.owner_id
         WHERE ${clause} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Number(limit) || 24, Number(offset) || 0]
      );
      return { total: countRows[0]?.n || 0, items: rows.map(rowToGame) };
    },
    async getGame(id) {
      const { rows } = await pool.query(
        `SELECT g.*, u.name AS author_name, u.display_name AS author_display_name
         FROM games g LEFT JOIN users u ON u.id = g.owner_id WHERE g.id = $1`,
        [id]
      );
      return rowToGame(rows[0]);
    },
    async getGameCover(id) {
      const { rows } = await pool.query('SELECT cover FROM games WHERE id = $1', [id]);
      return rows[0]?.cover || '';
    },
    async listGameTeachers() {
      const { rows } = await pool.query(
        `SELECT g.owner_id AS id, COALESCE(u.name, '') AS name,
                COALESCE(u.display_name, '') AS "displayName",
                (u.photo IS NOT NULL AND u.photo <> '') AS "hasPhoto",
                COUNT(*)::int AS games, COALESCE(SUM(g.plays), 0)::int AS plays
         FROM games g LEFT JOIN users u ON u.id = g.owner_id
         GROUP BY g.owner_id, u.name, u.display_name, u.photo ORDER BY games DESC, plays DESC`
      );
      return rows;
    },
    async saveGame(g) {
      await pool.query(
        `INSERT INTO games (id, owner_id, title, subject, grades, description, html, bytes, plays, rating_sum, rating_count, created_at, updated_at, cover, offline_ok)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET title = $3, subject = $4, grades = $5, description = $6, html = $7, bytes = $8, updated_at = $13, cover = $14, offline_ok = $15`,
        [g.id, g.ownerId, g.title, g.subject || null, JSON.stringify(g.grades || []), g.description || null,
         g.html, g.bytes || 0, g.plays || 0, g.ratingSum || 0, g.ratingCount || 0, g.createdAt, g.updatedAt, g.cover || null,
         g.offlineOk !== false]
      );
      return g;
    },
    async deleteGame(id) {
      await pool.query('DELETE FROM games WHERE id = $1', [id]);
    },
    async bumpGamePlays(id) {
      await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [id]);
    },
    async rateGame(id, stars) {
      const { rows } = await pool.query(
        'UPDATE games SET rating_sum = rating_sum + $2, rating_count = rating_count + 1 WHERE id = $1 RETURNING *',
        [id, stars]
      );
      return rowToGame(rows[0]);
    },

    async listBankQuestions(ownerId) {
      const { rows } = await pool.query('SELECT * FROM bank_questions WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
      return rows.map(rowToBankQuestion);
    },
    async getBankQuestion(id) {
      const { rows } = await pool.query('SELECT * FROM bank_questions WHERE id = $1', [id]);
      return rowToBankQuestion(rows[0]);
    },
    async saveBankQuestion(item) {
      await pool.query(
        `INSERT INTO bank_questions (id, owner_id, question, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET question = $3, updated_at = $5`,
        [item.id, item.ownerId, JSON.stringify(item.question), item.createdAt, item.updatedAt]
      );
      return item;
    },
    async deleteBankQuestion(id) {
      await pool.query('DELETE FROM bank_questions WHERE id = $1', [id]);
    },

    async createAuthSession(s) {
      await pool.query('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1,$2,$3)', [s.token, s.userId, s.expiresAt]);
    },
    async getAuthSession(token) {
      const { rows } = await pool.query('SELECT * FROM auth_sessions WHERE token = $1', [token]);
      const r = rows[0];
      if (!r) return null;
      if (Number(r.expires_at) < Date.now()) {
        await pool.query('DELETE FROM auth_sessions WHERE token = $1', [token]);
        return null;
      }
      return { token: r.token, userId: r.user_id, expiresAt: Number(r.expires_at) };
    },
    async deleteAuthSession(token) {
      await pool.query('DELETE FROM auth_sessions WHERE token = $1', [token]);
    },
    async sweepAuthSessions() {
      await pool.query('DELETE FROM auth_sessions WHERE expires_at < $1', [Date.now()]);
    },
  };
}

// ------------------------------------------------------------------ الواجهة

let driver = null;
let lastError = null;

/** ترجمة أخطاء الاتصال الشائعة إلى إرشاد عملي (خصوصاً مع Supabase) */
function explainDbError(err, url) {
  const code = err.code || '';
  const supabase = /supabase\.(co|com)/.test(url);
  const direct = /db\.[a-z0-9]+\.supabase\.co/.test(url);

  if ((code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') && direct) {
    return (
      'تعذّر الوصول إلى قاعدة Supabase عبر الاتصال المباشر. الاتصال المباشر يعمل على IPv6 فقط، ' +
      'ومعظم المنصات (منها Render) لا تدعمه. استخدم رابط الـ Pooler من Supabase: ' +
      'Project Settings ← Database ← Connection string ← Session pooler ' +
      '(المضيف يشبه aws-0-<region>.pooler.supabase.com).'
    );
  }
  if (code === 'ENOTFOUND') return 'اسم مضيف قاعدة البيانات غير صحيح — راجع DATABASE_URL.';
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return 'لا يستجيب خادم قاعدة البيانات — تأكد من المضيف والمنفذ وأن المشروع ليس متوقفاً (paused).';
  if (err.message && /password authentication failed/i.test(err.message)) {
    return (
      'كلمة مرور قاعدة البيانات غير صحيحة.' +
      (supabase ? ' في Supabase استبدل [YOUR-PASSWORD] بكلمة مرور القاعدة، وارمِز الرموز الخاصة (@ تصبح %40).' : '')
    );
  }
  if (err.message && /Tenant or user not found/i.test(err.message)) {
    return 'اسم المستخدم في رابط الـ Pooler غير صحيح — انسخ الرابط كاملاً من Supabase كما هو (يتضمّن معرّف المشروع).';
  }
  return err.message;
}

async function init() {
  const url = process.env.DATABASE_URL;
  const loud = process.env.PORT !== '0' && process.env.NODE_ENV !== 'test';
  lastError = null;

  if (url) {
    const pg = postgresDriver(url);
    // محاولتان إضافيتان: قواعد البيانات المُدارة قد تستيقظ ببطء
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pg.init();
        driver = pg;
        if (loud) console.log(`تخزين الحسابات: postgres (${pg.location})`);
        startSweeper();
        return driver;
      } catch (err) {
        lastError = explainDbError(err, url);
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
    // لا نُسقط التطبيق: الجلسات الحية أهم من الحسابات، لكن نُعلن العطل بوضوح
    if (loud) {
      console.error('⛔ تعذّر الاتصال بقاعدة البيانات، سنتابع بتخزين ملف مؤقت.');
      console.error('   السبب: ' + lastError);
    }
  }

  driver = fileDriver();
  await driver.init();
  if (loud) console.log(`تخزين الحسابات: file (${driver.location})`);
  startSweeper();
  return driver;
}

function startSweeper() {
  const sweep = setInterval(() => driver.sweepAuthSessions().catch(() => {}), 60 * 60 * 1000);
  sweep.unref?.();
}

/** حالة التخزين للتشخيص عبر /api/health */
function status() {
  return {
    kind: driver?.kind || null,
    durable: isDurable(),
    // نعرض سبب فشل قاعدة البيانات إن وُجد ليظهر في الفحص
    error: lastError,
  };
}

function get() {
  if (!driver) throw new Error('لم تُهيّأ طبقة التخزين بعد');
  return driver;
}

/** هل التخزين دائم فعلاً عبر عمليات النشر؟ (ملف على قرص مؤقت ليس كذلك) */
function isDurable() {
  return driver?.kind === 'postgres';
}

module.exports = { init, get, isDurable, status, newId, DATA_FILE };
