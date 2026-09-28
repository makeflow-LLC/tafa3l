'use strict';

/**
 * قاعدةُ بياناتٍ مضبوطة لكنها لا تستجيب.
 *
 * هذا هو العطل الذي بدا للمعلّمين «المنصة تُخرجني من حسابي مع كل زيارة»:
 * الخادم سقط بصمت إلى ملفٍ مؤقت، فلم تُقرأ جلساتُ الدخول المحفوظة في
 * القاعدة، وكُتبت الجديدة في ملفٍ يضيع مع أول إعادة تشغيل. هنا نثبّت أن
 * العطل يُعلَن لا يُخفى، وأن الخادم يعاود الاتصال حين ينفع ذلك ويكفّ حين لا
 * ينفع.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tafa3l-fallback-'));
// منفذٌ لا يستمع عليه أحد: يُرفض الاتصال فوراً كما لو أُوقفت القاعدة
process.env.DATABASE_URL = 'postgres://postgres:secret@127.0.0.1:1/postgres';

const storage = require('../server/storage');
const auth = require('../server/auth');
const { server, ready } = require('../server/index');

let base;

test.before(async () => {
  await ready;
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

test('قاعدةٌ لا تستجيب: ملفٌ مؤقت مع إعلان العطل وإعادة المحاولة', () => {
  const s = storage.status();
  assert.equal(s.kind, 'file', 'سقط إلى الملف بدل أن يتوقف');
  assert.equal(s.durable, false);
  assert.equal(s.configured, true, 'القاعدة مضبوطة — فالملف عطلٌ لا اختيار');
  assert.ok(s.error, 'سبب العطل معروض');
  assert.equal(s.reconnecting, true, 'قاعدةٌ لا تستجيب قد تعود — فتُعاد المحاولة');
});

test('‎/api/auth/me يحمل سبب العطل كي تعرضه صفحة الدخول و«نشاطاتي»', async () => {
  const res = await fetch(base + '/api/auth/me');
  const data = await res.json();
  assert.equal(data.durable, false);
  assert.equal(typeof data.storageError, 'string');
  assert.equal(data.storageError, storage.status().error);
});

test('خطأ الاعتماد لا تُعاد معه المحاولة — يُصلَح بالنشر لا بالانتظار', () => {
  assert.equal(storage.isCredentialError(new Error('password authentication failed for user "postgres"')), true);
  assert.equal(storage.isCredentialError(new Error('Tenant or user not found')), true);
  assert.equal(storage.isCredentialError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), false);
  assert.equal(storage.isCredentialError(null), false);
});

test('كوكي تالفة من طرفٍ ثالث لا تُسقط كوكي الجلسة', () => {
  const cookies = auth.parseCookies({ headers: { cookie: '_third=%E0%A4%A; tafa3l_sid=tok%2Fen; plain=x' } });
  assert.equal(cookies.tafa3l_sid, 'tok/en', 'الكوكي السليمة تُفكّ كما كانت');
  assert.equal(cookies._third, '%E0%A4%A', 'التالفة تُقرأ كما هي بدل أن ترمي');
  assert.equal(cookies.plain, 'x');
  assert.deepEqual(auth.parseCookies({ headers: {} }), {});
});
