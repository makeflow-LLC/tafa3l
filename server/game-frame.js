'use strict';

/**
 * تقديم مستند لعبةٍ داخل الإطار المعزول — بترويسةٍ واحدة لا نسختين.
 *
 * تُستعمل من موضعين: اللعبة المنشورة في قسم الألعاب، ومعاينةُ لعبةٍ بناها
 * المساعد قبل نشرها. ولو كُتبت الترويسة في كل موضعٍ على حدة لانحرفت إحداهما
 * يوماً عن الأخرى — فيلعب المعلّم معاينةً أوسع صلاحيةً من اللعبة التي سينشرها،
 * فتعمل عنده وتنكسر عند طالبه. القاعدة: ما يُعاين هو ما يُنشر بالضبط.
 *
 * و`sandbox` في الترويسة لا في الوسم وحده: يجعل الأصل مبهماً حتى لو فُتح
 * المستند في تبويبٍ مستقلّ خارج إطارنا.
 */

const CSP = [
  'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob: data:",
  "style-src 'unsafe-inline' https: data:",
  'img-src https: data: blob:',
  'media-src https: data: blob:',
  'font-src https: data:',
  // لا اتصال ولا إرسال نموذج: ما يكتبه الطالب داخل اللعبة لا يغادرها
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

/**
 * يرسل مستند اللعبة بترويسات العزل.
 * @param {import('express').Response} res
 * @param {string} html
 * @param {string} cacheControl تخزينُ المتصفّح — المنشورة دقيقة، والمعاينة لا
 */
function sendGameFrame(res, html, cacheControl = 'private, max-age=60') {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Security-Policy', CSP);
  res.send(html);
}

module.exports = { sendGameFrame, CSP };
