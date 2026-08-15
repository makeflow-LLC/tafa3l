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

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'tafa3l.json');

function newId(prefix) {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

// ------------------------------------------------------------- سائق الملف

function fileDriver() {
  /** @type {{users:Object, activities:Object, authSessions:Object, bankQuestions:Object}} */
  let db = { users: {}, activities: {}, authSessions: {}, bankQuestions: {} };
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
          authSessions: parsed.authSessions || {},
          bankQuestions: parsed.bankQuestions || {},
        };
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('ملف البيانات غير قابل للقراءة، سنبدأ فارغاً:', err.message);
      }
    },

    async findUserByEmail(email) {
      return Object.values(db.users).find((u) => u.email === email) || null;
    },
    async findUserById(id) {
      return db.users[id] || null;
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
    /** إنشاء أو تحديث بحسب البريد — بريد جوجل مُتحقَّق منه فهو المفتاح الطبيعي للحساب */
    async upsertUser({ email, name, googleId }) {
      const existing = Object.values(db.users).find((u) => u.email === email);
      if (existing) {
        existing.name = name;
        existing.googleId = googleId;
        schedule();
        return existing;
      }
      const user = { id: newId('u_'), email, name, googleId, premiumUntil: null, createdAt: Date.now() };
      db.users[user.id] = user;
      schedule();
      return user;
    },

    async listActivities(ownerId) {
      return Object.values(db.activities)
        .filter((a) => a.ownerId === ownerId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
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

  const userRow = (r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    googleId: r.google_id,
    premiumUntil: r.premium_until == null ? null : Number(r.premium_until),
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
      `);
    },

    async findUserByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const r = rows[0];
      return r ? userRow(r) : null;
    },
    async findUserById(id) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
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

    async upsertUser({ email, name, googleId }) {
      const { rows } = await pool.query(
        `INSERT INTO users (id, email, name, google_id, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO UPDATE SET name = $3, google_id = $4
         RETURNING *`,
        [newId('u_'), email, name, googleId, Date.now()]
      );
      const r = rows[0];
      return userRow(r);
    },

    async listActivities(ownerId) {
      const { rows } = await pool.query('SELECT * FROM activities WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
      return rows.map(rowToActivity);
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
