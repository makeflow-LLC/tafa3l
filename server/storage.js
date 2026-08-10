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
  /** @type {{users:Object, activities:Object, authSessions:Object}} */
  let db = { users: {}, activities: {}, authSessions: {} };
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
    async createUser(user) {
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

  const rowToActivity = (r) =>
    r && {
      id: r.id,
      ownerId: r.owner_id,
      title: r.title,
      settings: r.settings,
      questions: r.questions,
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
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );
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
      return r ? { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, salt: r.salt, createdAt: Number(r.created_at) } : null;
    },
    async findUserById(id) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      const r = rows[0];
      return r ? { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, salt: r.salt, createdAt: Number(r.created_at) } : null;
    },
    async createUser(user) {
      await pool.query(
        'INSERT INTO users (id, email, name, password_hash, salt, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [user.id, user.email, user.name, user.passwordHash, user.salt, user.createdAt]
      );
      return user;
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
        `INSERT INTO activities (id, owner_id, title, settings, questions, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET title = $3, settings = $4, questions = $5, updated_at = $7`,
        [a.id, a.ownerId, a.title, JSON.stringify(a.settings), JSON.stringify(a.questions), a.createdAt, a.updatedAt]
      );
      return a;
    },
    async deleteActivity(id) {
      await pool.query('DELETE FROM activities WHERE id = $1', [id]);
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
