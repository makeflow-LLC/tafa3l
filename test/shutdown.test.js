'use strict';

/**
 * إغلاق مرتّب عند SIGTERM — سلوك حرج وقت النشر.
 *
 * الفخّ: `server.close()` وحده ينتظر كل اتصال مفتوح، ومقابس الويب مفتوحة
 * عمداً طوال الحصة. فما دام هناك مدرب أو بروجكتر أو طالب متصل، لا يُستدعى
 * ردّ `close()` أبداً، وتقتل المنصة العملية بـSIGKILL بعد مهلتها — فيرى
 * الصفّ انقطاعاً غامضاً بلا إطار إغلاق.
 *
 * هذا الملف يُشغّل الخادم الحقيقي في عملية منفصلة (لأننا نقيس خروجها فعلاً)
 * ويقارن السلوكين: المعالج القديم يعلق، ومعالجنا يخرج فوراً ويُعلم العملاء.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const SERVER = path.join(__dirname, '..', 'server', 'index.js');
const HANG_MS = 4000;

/**
 * يُقلع الخادم في عملية ابنة، يفتح مقبس مضيف حقيقي، يرسل SIGTERM،
 * ويعيد كم استغرق الخروج ورمز إغلاق المقبس.
 * @param {'current'|'legacy'} variant
 */
async function probeShutdown(variant) {
  const dataDir = path.join(os.tmpdir(), `tapio-shutdown-${variant}-${process.pid}`);
  const bootstrap = `
    process.env.PORT = '0';
    process.env.DATA_DIR = ${JSON.stringify(dataDir)};
    const { server, ready } = require(${JSON.stringify(SERVER)});
    ${
      variant === 'legacy'
        ? `process.removeAllListeners('SIGTERM');
           process.on('SIGTERM', () => server.close(() => process.exit(0)));`
        : ''
    }
    ready.then(() => console.log('READY ' + server.address().port));
  `;

  const child = spawn(process.execPath, ['-e', bootstrap], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      const bail = setTimeout(() => reject(new Error('لم يُقلع الخادم')), 15000);
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const match = /READY (\d+)/.exec(buf);
        if (match) {
          clearTimeout(bail);
          resolve(Number(match[1]));
        }
      });
      child.on('exit', () => reject(new Error('خرج الخادم قبل أن يجهز')));
    });

    // جلسة ومقبس مضيف: أقرب ما يكون لحصة قائمة لحظة النشر
    const created = await (
      await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'حصة جارية',
          questions: [{ type: 'mc', text: 'س', options: ['أ', 'ب'], correct: ['أ'] }],
        }),
      })
    ).json();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let closeCode = null;
    socket.on('close', (code) => (closeCode = code));
    await new Promise((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', reject);
    });
    socket.send(JSON.stringify({ t: 'host:hello', code: created.code, hostToken: created.hostToken }));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const startedAt = Date.now();
    child.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((resolve) => child.on('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), HANG_MS)),
    ]);
    const ms = Date.now() - startedAt;
    // مهلة قصيرة كي يصل إطار الإغلاق قبل أن نقرأ رمزه
    await new Promise((resolve) => setTimeout(resolve, 150));
    socket.terminate();
    return { exited, ms, closeCode };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

test('SIGTERM يُنهي العملية فوراً رغم وجود مقبس ويب مفتوح', async () => {
  const result = await probeShutdown('current');
  assert.equal(result.exited, true, `لم تخرج العملية خلال ${HANG_MS}ms — المنصة كانت ستقتلها قسراً`);
  assert.ok(result.ms < 2000, `الخروج بطيء: ${result.ms}ms`);
});

test('العملاء يُعلَمون بالإغلاق (1001) لا ينقطعون فجأة', async () => {
  const result = await probeShutdown('current');
  assert.equal(result.closeCode, 1001, `توقعنا رمز 1001 «الخادم يُغلق»، وجاء ${result.closeCode}`);
});

test('المعالج القديم (server.close وحده) يعلق فعلاً — إثبات أن الإصلاح لازم', async () => {
  const result = await probeShutdown('legacy');
  assert.equal(
    result.exited,
    false,
    'خرج المعالج القديم — لو صار هذا سلوك العقدة الافتراضي فالإصلاح لم يعد لازماً، راجع هذا الاختبار'
  );
});
