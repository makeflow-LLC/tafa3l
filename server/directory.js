'use strict';

/**
 * دليلُ المعلّمين — يتصفّحه الطالب ليجد معلّمه.
 *
 * الطالب لا يعرف رابط صفحة معلّمه ولا رمز نشاطه دائماً؛ يعرف اسمه ومادّته
 * وصفّه وبلده. فالدليل يُصفّى بهذه الأربعة، ويُظهر لكل معلّمٍ ما يكفي
 * ليعرفه الطالب ويقرّر: الاسم والصورة والمواد والصفوف والبلد، وكم نشر،
 * وهل يستقبل حجوزات.
 *
 * ومن **ليس له وجهٌ عامّ** لا يُعرض: حسابٌ سجّل وجرّب ولم يملأ بروفايلاً
 * ولم ينشر شيئاً ليس معلّماً يبحث عنه طالب — وإدراجه يملأ الدليل بأسماءٍ
 * لا تقود إلى شيء.
 */

/** ما يجعل المعلّم ظاهراً في الدليل: بروفايلٌ مملوء أو محتوًى منشور */
function isListed(user, counts) {
  if (!user || !user.name) return false;
  const filled = Boolean(user.displayName) || Boolean(user.hasPhoto) || (user.subjects || []).length > 0 || Boolean(user.bio);
  return filled || (counts?.published || 0) > 0 || (counts?.games || 0) > 0;
}

/**
 * مفتاح البحث: يوحّد ما يُكتب بأشكالٍ عدّة — الهمزات والتاء المربوطة والياء
 * والتشكيل — فمن كتب «احمد» وجد «أحمد». وهو المطبَّق في دليل الألعاب نفسه.
 */
function searchKey(text) {
  return String(text || '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * الترشيح والترتيب. الاسم يُطابَق على الاسم العامّ **و**الاسم الكامل — فمن
 * بحث بلقب المعلّم كاملاً وجده وإن كانت صفحته تعرض اسمه الأوّل — ولا يُكشف
 * الاسم الكامل بذلك: المطابقة في الخادم، والمعروض هو العامّ.
 */
function filter(items, { q = '', country = '', subject = '', grade = '', booking = false } = {}) {
  const needle = searchKey(q);
  const c = String(country || '').trim().toUpperCase();
  const s = String(subject || '').trim();
  const g = String(grade || '').trim();
  return items
    .filter((it) => !c || it.country === c)
    .filter((it) => !s || (it.subjects || []).includes(s))
    .filter((it) => !g || (it.grades || []).includes(g))
    .filter((it) => !booking || it.booking)
    .filter((it) => !needle || searchKey(it.name).includes(needle) || searchKey(it.fullName).includes(needle))
    .sort((a, b) => b.published + b.games - (a.published + a.games) || b.plays - a.plays || a.name.localeCompare(b.name, 'ar'));
}

module.exports = { isListed, searchKey, filter };
