'use strict';

/**
 * مسارات المسابقات المفتوحة.
 *
 * ثلاث دوائرَ من الصلاحية:
 *  - **المعلّم**: ينشئ ويغلق ويحذف ويرى كل تسليم. جلسةٌ مطلوبة، والملكية
 *    تُفحص في كل مسار.
 *  - **المتسابق**: يفتح الرابط، يقرأ البطاقة، يأخذ الأسئلة، يسلّم. بلا
 *    حساب — الطالب في الصفّ لا يُسجَّل ليجيب على عشرة أسئلة.
 *  - **العابر**: لوحة الصدارة، وهي كل ما يُنشر.
 *
 * والحارس الأهم: **الإجابات الصحيحة لا تغادر الخادم قبل التسليم**. مسار
 * اللعب يبني الأسئلة بـ`contest.playable` التي لا تحمل `correct` أصلاً،
 * فلا يكفي أن يفتح الطالب أدوات المتصفّح ليرى الحلّ.
 */

const express = require('express');
const auth = require('./auth');
const storage = require('./storage');
const contest = require('./contest');

/** حدُّ إنشاءٍ لكل معلّم — المسابقة تحمل أسئلتها كاملةً في التخزين */
const MAX_PER_TEACHER = 40;
/** كم اسماً يظهر في لوحة الصدارة */
const BOARD_SIZE = 50;

/**
 * منعُ التسليم المتكرّر بلا حساب.
 *
 * المتسابق لا يسجّل دخولاً، فليس بيدنا هويّةٌ نثق بها. نمنع أوضحَ صور
 * التكرار — العنوان نفسه يسلّم في المسابقة نفسها مرّتين — ولا ندّعي أكثر:
 * من أراد الالتفاف التفّ. ولذلك تبقى لوحة الصدارة لعبةَ صفٍّ لا شهادةً،
 * والمعلّم يرى التسليمات كلّها بأسمائها فيحكم بنفسه.
 */
const seen = new Map(); // "ip|contestId" -> وقت الانتهاء
const SEEN_MS = 12 * 60 * 60 * 1000;

function alreadyEntered(req, contestId) {
  const key = `${req.ip || 'x'}|${contestId}`;
  const now = Date.now();
  if (seen.size > 20000) for (const [k, until] of seen) if (until < now) seen.delete(k);
  return (seen.get(key) || 0) > now;
}

function rememberEntry(req, contestId) {
  seen.set(`${req.ip || 'x'}|${contestId}`, Date.now() + SEEN_MS);
}

function contestRoutes() {
  const router = express.Router();

  /** يجلب المسابقة ويتحقّق أنها للمعلّم صاحب الجلسة */
  async function mine(req, res) {
    const found = await storage.get().getContest(req.params.id);
    if (!found || found.ownerId !== req.user.id) {
      res.status(404).json({ error: 'المسابقة غير موجودة' });
      return null;
    }
    return found;
  }

  // --------------------------------------------------------- المعلّم

  router.get('/contests', auth.requireUser, async (req, res) => {
    try {
      const items = await storage.get().listContests(req.user.id);
      res.json({ items: items.map((c) => contest.card(c)) });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب المسابقات' });
    }
  });

  router.post('/contests', auth.requireUser, async (req, res) => {
    try {
      const existing = await storage.get().listContests(req.user.id);
      if (existing.length >= MAX_PER_TEACHER) {
        return res.status(409).json({ error: `بلغت الحدّ الأقصى (${MAX_PER_TEACHER} مسابقة) — احذف مسابقةً قديمة` });
      }
      const { dropped, ...built } = contest.build(req.body, req.user.id);
      const saved = { id: storage.newId('ct_'), ...built };
      await storage.get().saveContest(saved);
      // ما أُسقط يعود مع البطاقة: الواجهة تقوله للمعلّم بدل أن يعدّ أسئلته
      res.status(201).json({ contest: contest.card(saved), dropped });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر إنشاء المسابقة' });
    }
  });

  /** الإغلاق والفتح: قرارُ المعلّم يعلو على الموعد */
  router.patch('/contests/:id', auth.requireUser, async (req, res) => {
    try {
      const found = await mine(req, res);
      if (!found) return;
      const patch = { updatedAt: Date.now() };
      if (req.body?.closed !== undefined) patch.closed = req.body.closed === true;
      // تمديدُ مسابقةٍ انتهت أرحمُ من إنشاء أخرى: الرابط نفسه واللوحة نفسها
      if (req.body?.days !== undefined) {
        const days = Math.min(contest.MAX_DAYS, Math.max(1, Math.round(Number(req.body.days)) || 7));
        patch.days = days;
        patch.closesAt = Date.now() + days * 86400000;
        patch.closed = false;
      }
      const updated = { ...found, ...patch };
      await storage.get().saveContest(updated);
      res.json({ contest: contest.card(updated) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تحديث المسابقة' });
    }
  });

  router.delete('/contests/:id', auth.requireUser, async (req, res) => {
    try {
      const found = await mine(req, res);
      if (!found) return;
      await storage.get().deleteContest(found.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر حذف المسابقة' });
    }
  });

  // ------------------------------------------------------- المتسابق

  /** البطاقة: عامّة، وبلا سؤالٍ واحد */
  router.get('/contests/:id/card', async (req, res) => {
    try {
      const found = await storage.get().getContest(req.params.id);
      if (!found) return res.status(404).json({ error: 'المسابقة غير موجودة' });
      res.json({ contest: { ...contest.card(found), teacher: found.ownerName || '' } });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب المسابقة' });
    }
  });

  /**
   * الأسئلة. بذرةُ الخلط تصل من المتصفّح فيثبت ترتيبُ المتسابق لو حدّث
   * الصفحة — ولا ضرر: الخلط يمنع النقل عن الجار لا يحرس سرّاً.
   */
  router.get('/contests/:id/play', async (req, res) => {
    try {
      const found = await storage.get().getContest(req.params.id);
      if (!found) return res.status(404).json({ error: 'المسابقة غير موجودة' });
      if (!contest.isOpen(found)) {
        return res.status(409).json({ error: 'المسابقة مغلقة', status: contest.statusOf(found) });
      }
      const seed = contest.clean(req.query.seed, 40) || 'x';
      res.json({ questions: contest.playable(found, seed), max: contest.maxScore(found) });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر بدء المسابقة' });
    }
  });

  router.post('/contests/:id/entries', async (req, res) => {
    try {
      const found = await storage.get().getContest(req.params.id);
      if (!found) return res.status(404).json({ error: 'المسابقة غير موجودة' });
      if (!contest.isOpen(found)) return res.status(409).json({ error: 'المسابقة مغلقة', status: contest.statusOf(found) });

      const name = contest.clean(req.body?.name, contest.MAX_NAME);
      if (!name) return res.status(400).json({ error: 'اكتب اسمك أولاً' });
      if (!found.retries && alreadyEntered(req, found.id)) {
        return res.status(409).json({ error: 'سلّمتَ في هذه المسابقة من قبل — المحاولة واحدة' });
      }

      const result = contest.grade(found, req.body?.answers);
      const entry = {
        id: storage.newId('ce_'),
        contestId: found.id,
        name,
        score: result.score,
        max: result.max,
        correct: result.correct,
        total: result.total,
        // الزمن فاصلُ تعادلٍ لا مكافأة — ويُحصر كي لا تفسده قيمةٌ ملفّقة
        ms: Math.min(6 * 3600000, Math.max(0, Math.round(Number(req.body?.ms) || 0))),
        at: Date.now(),
      };
      await storage.get().addContestEntry(entry);
      if (!found.retries) rememberEntry(req, found.id);

      const entries = await storage.get().listContestEntries(found.id);
      res.status(201).json({
        result: { score: entry.score, max: entry.max, correct: entry.correct, total: entry.total },
        ...contest.rankOf(entries, entry.id),
        board: contest.board(entries, BOARD_SIZE),
        // الشرح والصواب بعد التسليم لا قبله — هنا موضعُهما الوحيد
        review: (found.questions || []).map((q) => ({
          id: q.id,
          text: q.text,
          explanation: q.explanation || '',
          merit: result.detail.find((d) => d.id === q.id)?.merit ?? 0,
        })),
      });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'تعذّر تسليم إجاباتك' });
    }
  });

  /** لوحة الصدارة — عامّة، فهي المقصود من المسابقة */
  router.get('/contests/:id/board', async (req, res) => {
    try {
      const found = await storage.get().getContest(req.params.id);
      if (!found) return res.status(404).json({ error: 'المسابقة غير موجودة' });
      const entries = await storage.get().listContestEntries(found.id);
      res.json({ board: contest.board(entries, BOARD_SIZE), total: entries.length, status: contest.statusOf(found) });
    } catch (err) {
      res.status(500).json({ error: 'تعذّر جلب لوحة الصدارة' });
    }
  });

  return router;
}

module.exports = { contestRoutes, MAX_PER_TEACHER, BOARD_SIZE };
