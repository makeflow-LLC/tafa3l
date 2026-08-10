'use strict';

/**
 * القوالب مصدرها ملف واحد مشترك مع المتصفح، حتى لا تختلف النسختان.
 * المتصفح يحمّله كسكربت عادي (window.TEMPLATES) بلا أي طلب شبكة.
 */
module.exports = require('../public/assets/js/templates.js');
