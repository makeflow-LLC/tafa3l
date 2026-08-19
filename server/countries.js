'use strict';

/**
 * قائمة البلدان التي يختار منها المعلّم بلده.
 *
 * الأسماء **لا تُخزَّن هنا**: نخزّن رمز ISO ذا الحرفين، ويترجمه المتصفّح بـ
 * `Intl.DisplayNames` إلى لغة القارئ. فلا قاموسَ بلدانٍ نصونه بلغتين، ولا
 * اسمَ بلدٍ يتغيّر عندنا ولا يتغيّر عند الناس.
 *
 * والقائمة هنا في الخادم لا في الواجهة لأنها **تحقُّق** لا عرض: الواجهة تعرض
 * ما نرسله، والخادم يرفض ما ليس في هذه القائمة مهما أرسل المتصفّح.
 */

/** البلدان العربية أولاً — جمهور المنصة، فلا يُمرَّر مئتا بلدٍ قبل بلده */
const ARAB = [
  'PS', 'JO', 'LB', 'SY', 'IQ', 'SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'YE',
  'EG', 'SD', 'LY', 'TN', 'DZ', 'MA', 'MR', 'SO', 'DJ', 'KM',
];

/**
 * بقية بلدان العالم بترتيب رموزها.
 *
 * أُسقطت الرموز التاريخية (سوفييت، يوغسلافيا…) والرمزية (الاتحاد الأوروبي،
 * الأمم المتحدة…) والجزر غير المأهولة — فليس فيها معلّمون يسجّلون. وأُسقطت
 * **إسرائيل**: المنصة غير مدعومة هناك، فلا معنى لعرضها في قائمة اختيار.
 */
const REST = [
  'AD', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ',
  'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CY', 'CZ',
  'DE', 'DK', 'DM', 'DO', 'EC', 'EE', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN',
  'GP', 'GQ', 'GR', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IM', 'IN', 'IR', 'IS', 'IT', 'JE', 'JM', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KN', 'KP', 'KR', 'KY', 'KZ',
  'LA', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
  'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MS', 'MT', 'MU', 'MV',
  'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PR', 'PT', 'PW', 'PY',
  'RE', 'RO', 'RS', 'RU', 'RW', 'SB', 'SC', 'SE', 'SG', 'SI', 'SK', 'SL', 'SM', 'SN', 'SR', 'SS', 'ST',
  'SV', 'SX', 'SZ', 'TC', 'TD', 'TG', 'TH', 'TJ', 'TL', 'TM', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WS', 'XK', 'YT', 'ZA', 'ZM', 'ZW',
];

const ALLOWED = new Set([...ARAB, ...REST]);

/** بلد الحسابات التي أُنشئت قبل أن يُسأل أحدٌ عن بلده */
const DEFAULT_COUNTRY = 'PS';

/**
 * أسماءٌ نفرضها على ما يقوله ICU.
 * «الأراضي الفلسطينية» ليست اسم بلد — والقائمة يقرؤها معلّمون فلسطينيون.
 */
const NAME_OVERRIDES = {
  ar: { PS: 'فلسطين' },
  en: { PS: 'Palestine' },
};

/** رمز صالح؟ يُستدعى على كل حفظ — الواجهة تُقترح، والخادم يقرّر */
function isValid(code) {
  return typeof code === 'string' && ALLOWED.has(code.toUpperCase());
}

/** ينظّف ما وصل من المتصفّح: رمزٌ صالح أو فراغ. لا استثناء ولا تخمين */
function clean(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return isValid(code) ? code : '';
}

/** اسم البلد بلغةٍ ما — للتقارير ولوحة المالك في الخادم */
function nameOf(code, lang = 'ar') {
  if (!isValid(code)) return '';
  const key = code.toUpperCase();
  const override = NAME_OVERRIDES[lang === 'en' ? 'en' : 'ar'][key];
  if (override) return override;
  try {
    return new Intl.DisplayNames([lang === 'en' ? 'en' : 'ar'], { type: 'region', fallback: 'code' }).of(key);
  } catch {
    return key;
  }
}

module.exports = { ARAB, REST, ALLOWED, DEFAULT_COUNTRY, NAME_OVERRIDES, isValid, clean, nameOf };
