'use strict';

/**
 * مسارات تحليل الفصل — للباقة الاحترافية.
 *
 *   GET  /classes/:id/analysis?group=   آخرُ تقريرٍ محفوظ لهذا النطاق (أو لا شيء)
 *   POST /classes/:id/analysis          يبني تقريراً جديداً ويحفظه
 *
 * والتقرير **يُحفظ مع الفصل**: نداءُ النموذج يستغرق نصف دقيقة ويكلّف، والمعلّم
 * يفتح التقرير ليطبعه أو ليعرضه، لا ليُعاد بناؤه مع كل فتح. فالمحفوظُ يُعرض
 * فوراً، ويُقال له إن كانت هناك نتائجُ أحدث منه، والتجديد بضغطة.
 */

const express = require('express');
const ai = require('./ai');
const analysis = require('./analysis');
const auth = require('./auth');
const premium = require('./premium');
const storage = require('./storage');

/** حدٌّ خاصّ بهذا المسار: التقرير أثقل نداءات النموذج، وعشرةٌ في الساعة تكفي أيّ معلّم */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 10;
const usage = new Map();

function rateLimited(userId) {
  const now = Date.now();
  if (usage.size > 2000) for (const [k, v] of usage) if (now >= v.resetAt) usage.delete(k);
  const entry = usage.get(userId);
  if (!entry || now >= entry.resetAt) {
    usage.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  if (entry.count >= RATE_MAX) return Math.ceil((entry.resetAt - now) / 60000);
  entry.count += 1;
  return null;
}

const MAX_OUTPUT_TOKENS = 6000;

/** مفتاح النطاق داخل الفصل: الفصل كلّه «*»، والمجموعة باسمها */
const keyOf = (group) => String(group || '').trim() || '*';

/** ما يُقاس به قِدم التقرير: عددُ النتائج وأحدثُها في النطاق */
function freshness(rows) {
  return { count: rows.length, latest: rows.reduce((m, r) => Math.max(m, r.at || 0), 0) };
}

function analysisRoutes() {
  const router = express.Router();

  /** فصلٌ يملكه هذا المعلّم وإلا 404 — لا فرق بين «غير موجود» و«ليس لك» */
  async function ownClass(req, res) {
    const item = await storage.get().getClass(req.params.id);
    if (!item || item.ownerId !== req.user.id) {
      res.status(404).json({ error: 'الفصل غير موجود' });
      return null;
    }
    return item;
  }

  /** النطاق وسجلّه — أو خطأٌ يقول لماذا لا تقرير */
  async function scopeOf(req, res, cls, group) {
    if (!cls.record) {
      res.status(409).json({ error: 'شغّل «سجلّ الطلاب» على هذا الفصل أولاً — التحليل يُبنى من النتائج المسجّلة' });
      return null;
    }
    const pupils = analysis.scopePupils(cls, group);
    if (!pupils.length) {
      res.status(404).json({ error: 'لا مجموعة بهذا الاسم في الفصل' });
      return null;
    }
    const ids = new Set(pupils.map((p) => p.id));
    const rows = (await storage.get().listRecords(cls.id)).filter((r) => ids.has(r.studentId));
    return { pupils, rows };
  }

  router.get('/classes/:id/analysis', auth.requireUser, premium.requireTier('pro'), async (req, res) => {
    try {
      const cls = await ownClass(req, res);
      if (!cls) return;
      const group = String(req.query.group || '').trim();
      const scope = await scopeOf(req, res, cls, group);
      if (!scope) return;
      const saved = cls.analysis?.[keyOf(group)] || null;
      const now = freshness(scope.rows);
      res.json({
        class: { id: cls.id, name: cls.name, demo: Boolean(cls.demo) },
        group,
        results: now.count,
        report: saved,
        // «أحدث» لا «أقدم»: نتائجُ دخلت بعد التقرير تُقال صراحةً لا تُخمَّن
        stale: Boolean(saved && (saved.count !== now.count || saved.latest !== now.latest)),
        ai: ai.isConfigured(),
      });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب التحليل' });
    }
  });

  router.post('/classes/:id/analysis', auth.requireUser, premium.requireTier('pro'), async (req, res) => {
    try {
      if (!ai.isConfigured()) return res.status(503).json({ error: 'خدمة الذكاء الاصطناعي غير مُفعّلة على هذا الخادم' });
      const cls = await ownClass(req, res);
      if (!cls) return;
      const group = String(req.body?.group || '').trim();
      const scope = await scopeOf(req, res, cls, group);
      if (!scope) return;
      if (!scope.rows.length) return res.status(409).json({ error: 'لا نتائج مسجّلة بعد لهذا النطاق — التحليل يُبنى من نتائج سابقة' });

      const minutes = rateLimited(req.user.id);
      if (minutes) return res.status(429).json({ error: `بلغت حدّ التحليلات لهذه الساعة — حاول بعد ${minutes} دقيقة` });

      const assignments = (await storage.get().listAssignments(req.user.id)).filter((a) => a.classId === cls.id);
      const d = analysis.digest({ cls, records: scope.rows, assignments, group });
      const text = await ai.complete({
        system: analysis.SYSTEM_PROMPT,
        messages: [{ role: 'user', content: analysis.promptFor(d) }],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,
      });
      const report = analysis.parseReport(text, d);

      const entry = { at: Date.now(), ...freshness(scope.rows), stats: d.stats, report };
      const next = { ...cls, analysis: { ...(cls.analysis || {}), [keyOf(group)]: entry } };
      await storage.get().saveClass(next);

      res.json({ class: { id: cls.id, name: cls.name, demo: Boolean(cls.demo) }, group, results: entry.count, report: entry, stale: false, ai: true });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error('class analysis:', err.message);
      res.status(status).json({ error: err.message || 'تعذّر بناء التحليل' });
    }
  });

  return router;
}

module.exports = { analysisRoutes };
