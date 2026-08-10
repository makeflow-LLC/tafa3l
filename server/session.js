'use strict';

const crypto = require('crypto');

const QUESTION_TYPES = ['mc', 'truefalse', 'poll', 'word', 'scale', 'open'];
/** مهلة «استعد… ٣ ٢ ١» قبل فتح السؤال المؤقّت — تبقي الجميع على نفس الخط */
const READY_MS = 3200;
/** تفاعلات سريعة يرسلها المشاركون أثناء العرض */
const REACTIONS = ['👏', '🔥', '😂', '😮', '❤️', '🤔'];
const REACTION_COOLDOWN_MS = 600;
/** أوضاع التقدّم بين الأسئلة */
const PACES = ['host', 'auto', 'self'];
/** طرق احتساب النقاط */
const SCORING_MODES = ['speed', 'flat', 'none'];
/** مضاعف السلسلة: ١٠٪ لكل إجابة صحيحة متتالية بحد أقصى ٥٠٪ */
const STREAK_STEP = 0.1;
const STREAK_MAX = 0.5;
/** الأنواع التي تُحتسب لها نقاط (لها إجابة صحيحة) */
const SCORED_TYPES = new Set(['mc', 'truefalse']);
/** الأنواع التي لا تُظهر هوية المشارك في النتائج */
const LIMITS = {
  title: 120,
  questionText: 300,
  explanation: 400,
  optionText: 120,
  options: 8,
  questions: 60,
  name: 24,
  wordAnswer: 40,
  openAnswer: 300,
  participants: 300,
};

function id(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function clean(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** تحويل سؤال قادم من العميل إلى شكل آمن ومُتحقق منه. */
function normalizeQuestion(raw, index) {
  const type = QUESTION_TYPES.includes(raw?.type) ? raw.type : 'mc';
  const q = {
    id: clean(raw?.id, 40) || id('q_'),
    type,
    text: clean(raw?.text, LIMITS.questionText) || `سؤال ${index + 1}`,
    // شرح أو سبب يظهر مع الإجابة الصحيحة (اختياري)
    explanation: clean(raw?.explanation, LIMITS.explanation),
    timeLimit: raw?.timeLimit === 0 || raw?.timeLimit === null ? 0 : clamp(raw?.timeLimit, 5, 600, 30),
    // علامة السؤال — يضعها المدرب بحرية
    points: clamp(raw?.points, 0, 10000, 1000),
    options: [],
    correct: [],
    scale: null,
  };

  if (type === 'mc' || type === 'poll') {
    const options = Array.isArray(raw?.options) ? raw.options.slice(0, LIMITS.options) : [];
    q.options = options
      .map((o, i) => ({
        id: clean(o?.id, 40) || `o${i}`,
        text: clean(typeof o === 'string' ? o : o?.text, LIMITS.optionText),
      }))
      .filter((o) => o.text.length > 0);
    if (q.options.length < 2) {
      q.options = [
        { id: 'o0', text: 'الخيار الأول' },
        { id: 'o1', text: 'الخيار الثاني' },
      ];
    }
  } else if (type === 'truefalse') {
    q.options = [
      { id: 'true', text: 'صحيح' },
      { id: 'false', text: 'خطأ' },
    ];
  } else if (type === 'scale') {
    const min = clamp(raw?.scale?.min, 0, 10, 1);
    const max = clamp(raw?.scale?.max, min + 1, 10, Math.max(min + 1, 5));
    q.scale = {
      min,
      max,
      minLabel: clean(raw?.scale?.minLabel, 40) || 'غير موافق',
      maxLabel: clean(raw?.scale?.maxLabel, 40) || 'موافق تماماً',
    };
  }

  if (SCORED_TYPES.has(type)) {
    const ids = new Set(q.options.map((o) => o.id));
    const correct = Array.isArray(raw?.correct) ? raw.correct : raw?.correct != null ? [raw.correct] : [];
    q.correct = [...new Set(correct.map((c) => clean(c, 40)).filter((c) => ids.has(c)))];
    // سؤال بلا إجابة صحيحة يتحول عملياً إلى استطلاع (بلا نقاط)
  } else {
    q.points = 0;
  }

  return q;
}

function normalizeQuiz(payload) {
  const rawQuestions = Array.isArray(payload?.questions) ? payload.questions.slice(0, LIMITS.questions) : [];
  const questions = rawQuestions.map(normalizeQuestion);
  if (questions.length === 0) {
    throw Object.assign(new Error('أضف سؤالاً واحداً على الأقل'), { status: 400 });
  }
  // ضمان تفرّد المعرفات
  const seen = new Set();
  for (const q of questions) {
    while (seen.has(q.id)) q.id = id('q_');
    seen.add(q.id);
  }
  return {
    title: clean(payload?.title, LIMITS.title) || 'نشاط تفاعلي',
    questions,
    settings: {
      // عندما يكون false يدخل المشاركون دون اسم (وضع الاستطلاع المجهول)
      requireName: payload?.settings?.requireName !== false,
      allowLateJoin: payload?.settings?.allowLateJoin !== false,
      showLeaderboard: payload?.settings?.showLeaderboard !== false,
      // عدّاد «استعد» قبل الأسئلة المؤقتة
      countdown: payload?.settings?.countdown !== false,

      /**
       * وضع التقدّم بين الأسئلة:
       * host — المدرب ينقل الشرائح بنفسه (الافتراضي)
       * auto — الجميع معاً، والانتقال تلقائي بعد عرض النتائج
       * self — كل متدرب يتقدّم بسرعته الخاصة
       */
      pace: PACES.includes(payload?.settings?.pace) ? payload.settings.pace : 'host',
      autoAdvanceSec: clamp(payload?.settings?.autoAdvanceSec, 2, 60, 6),

      /**
       * احتساب النقاط:
       * speed — كاملة للأسرع وتتناقص حتى النصف (الافتراضي)
       * flat  — نقاط ثابتة لكل إجابة صحيحة
       * none  — بلا نقاط ولا ترتيب
       */
      scoring: SCORING_MODES.includes(payload?.settings?.scoring) ? payload.settings.scoring : 'speed',
      // مضاعف يتصاعد مع الإجابات الصحيحة المتتالية
      streakBonus: payload?.settings?.streakBonus !== false,
      // إظهار الإجابة الصحيحة وشرحها للمتدرب فور إجابته
      revealAnswer: payload?.settings?.revealAnswer !== false,
    },
  };
}

class Session {
  constructor(code, payload) {
    const quiz = normalizeQuiz(payload);
    this.code = code;
    this.hostToken = token();
    this.title = quiz.title;
    this.questions = quiz.questions;
    this.settings = quiz.settings;

    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.endedAt = null;

    this.status = 'lobby'; // lobby | live | ended
    this.phase = 'lobby'; // lobby | question | results | leaderboard | final
    this.currentIndex = -1;
    this.questionOpensAt = null; // متى تُقبل الإجابات (بعد عدّاد «استعد»)
    this.questionStartedAt = null;
    this.questionEndsAt = null;
    this.locked = false;
    this._timer = null;
    this._autoTimer = null;
    this._autoAt = null;

    /** @type {Map<string, any>} */
    this.participants = new Map();
    /** @type {Set<any>} sockets للمضيف */
    this.hostSockets = new Set();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.clearAuto();
    for (const socket of this.allSockets()) {
      try {
        socket.close(4000, 'session closed');
      } catch {
        /* تجاهل */
      }
    }
  }

  // ---------------------------------------------------------------- المشاركون

  addParticipant({ name, avatar }) {
    if (this.participants.size >= LIMITS.participants) {
      throw Object.assign(new Error('اكتمل عدد المشاركين في هذه الجلسة'), { status: 429 });
    }
    const participant = {
      id: id('p_'),
      token: token(),
      name: clean(name, LIMITS.name) || 'مشارك',
      avatar: normalizeAvatar(avatar),
      score: 0,
      streak: 0,
      bestStreak: 0,
      firstCount: 0, // كم مرة كان أول من أجاب
      prevRank: null, // ترتيبه قبل السؤال الحالي (لعرض الصعود والهبوط)
      // خاص بوضع «كل متدرب بسرعته»
      index: 0,
      phase: 'question', // question | feedback | done
      openedAt: null,
      endsAt: null,
      finishedAt: null,
      joinedAt: Date.now(),
      connected: true,
      lastReaction: 0,
      sockets: new Set(),
      answers: new Map(), // qid -> { value, at, ms, correct, points }
    };
    this.participants.set(participant.id, participant);
    this.touch();
    return participant;
  }

  removeParticipant(pid) {
    const p = this.participants.get(pid);
    if (!p) return;
    this.participants.delete(pid);
    this.touch();
  }

  // ------------------------------------------------------------- سير العرض

  get currentQuestion() {
    return this.questions[this.currentIndex] || null;
  }

  start() {
    if (this.status === 'ended') return;
    this.status = 'live';
    if (this.settings.pace === 'self') {
      // كل متدرب يبدأ من سؤاله الأول بسرعته الخاصة
      this.currentIndex = 0;
      this.phase = 'self';
      for (const p of this.participants.values()) this.openFor(p);
      this.touch();
      return;
    }
    this.currentIndex = -1;
    this.next();
  }

  // ------------------------------------------- وضع «كل متدرب بسرعته»

  /** فتح السؤال الحالي لمتدرب واحد */
  openFor(participant) {
    const q = this.questions[participant.index];
    if (!q) {
      participant.phase = 'done';
      participant.finishedAt = participant.finishedAt || Date.now();
      return;
    }
    participant.phase = 'question';
    participant.openedAt = Date.now();
    participant.endsAt = q.timeLimit ? participant.openedAt + q.timeLimit * 1000 : null;
  }

  /** انتقال متدرب إلى سؤاله التالي (بعد الإجابة أو انتهاء وقته) */
  advance(participant) {
    if (this.settings.pace !== 'self' || this.status !== 'live') return false;
    if (participant.phase === 'done') return false;
    const q = this.questions[participant.index];
    if (!q) return false;
    const answered = participant.answers.has(q.id);
    const expired = participant.endsAt && Date.now() >= participant.endsAt;
    if (!answered && !expired) return false;
    participant.index += 1;
    this.openFor(participant);
    this.touch();
    return true;
  }

  /** هل أنهى الجميع في الوضع الحر؟ */
  allFinished() {
    if (this.settings.pace !== 'self' || this.participants.size === 0) return false;
    return [...this.participants.values()].every((p) => p.phase === 'done');
  }

  next() {
    if (this.status === 'ended') return;
    if (this.currentIndex + 1 >= this.questions.length) {
      this.finish();
      return;
    }
    this.currentIndex += 1;
    this.openQuestion();
  }

  prev() {
    if (this.currentIndex <= 0) return;
    this.currentIndex -= 1;
    this.openQuestion();
  }

  goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    this.openQuestion();
  }

  openQuestion() {
    const q = this.currentQuestion;
    if (!q) return;
    this.status = 'live';
    this.phase = 'question';
    this.locked = false;
    this.clearAuto();
    // لقطة للترتيب قبل السؤال حتى نُظهر الصعود والهبوط بعده
    const board = this.leaderboard(LIMITS.participants);
    for (const p of this.participants.values()) {
      p.prevRank = board.find((entry) => entry.id === p.id)?.rank ?? null;
    }
    // الأسئلة المؤقتة تبدأ بعد عدّاد قصير حتى ينطلق الجميع معاً
    const ready = q.timeLimit && this.settings.countdown ? READY_MS : 0;
    this.questionOpensAt = Date.now() + ready;
    this.questionStartedAt = this.questionOpensAt;
    this.questionEndsAt = q.timeLimit ? this.questionOpensAt + q.timeLimit * 1000 : null;
    this.armTimer();
    this.touch();
  }

  /** هل انتهى عدّاد «استعد»؟ */
  isOpen() {
    return !this.questionOpensAt || Date.now() >= this.questionOpensAt;
  }

  armTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (!this.questionEndsAt) return;
    const delay = Math.max(0, this.questionEndsAt - Date.now()) + 250;
    this._timer = setTimeout(() => {
      if (this.phase === 'question') {
        this.showResults();
        this.broadcastState();
      }
    }, delay);
    this._timer.unref?.();
  }

  /** إغلاق استقبال الإجابات دون كشف النتيجة */
  lock() {
    if (this.phase !== 'question') return;
    this.locked = true;
    this.questionEndsAt = Date.now();
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.touch();
  }

  showResults() {
    this.locked = true;
    this.phase = 'results';
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.scheduleAuto(() => {
      // في الوضع التلقائي: النتائج ← (الترتيب) ← السؤال التالي
      if (this.settings.showLeaderboard && this.hasScoredQuestions()) this.showLeaderboard();
      else this.next();
    });
    this.touch();
  }

  showLeaderboard() {
    this.locked = true;
    this.phase = 'leaderboard';
    this.scheduleAuto(() => this.next());
    this.touch();
  }

  /** مؤقّت الانتقال التلقائي (وضع auto فقط) */
  scheduleAuto(action) {
    this.clearAuto();
    if (this.settings.pace !== 'auto' || this.status !== 'live') return;
    const delay = this.settings.autoAdvanceSec * 1000;
    this._autoAt = Date.now() + delay;
    this._autoTimer = setTimeout(() => {
      this._autoTimer = null;
      if (this.status !== 'live') return;
      action();
      this.broadcastState();
    }, delay);
    this._autoTimer.unref?.();
  }

  clearAuto() {
    if (this._autoTimer) clearTimeout(this._autoTimer);
    this._autoTimer = null;
  }

  /** متى ينتقل تلقائياً (لعرض عدّاد للمدرب) */
  get autoNextAt() {
    return this._autoTimer && this.settings.pace === 'auto' ? this._autoAt : null;
  }

  finish() {
    this.status = 'ended';
    this.phase = 'final';
    this.locked = true;
    this.endedAt = Date.now();
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.clearAuto();
    for (const p of this.participants.values()) p.phase = 'done';
    this.touch();
  }

  acceptsAnswers() {
    return this.status === 'live' && this.phase === 'question' && !this.locked && this.isOpen();
  }

  /** تفاعل سريع (إيموجي) — يُبث للمضيف مع حد لمنع الإغراق */
  react(participant, emoji) {
    if (!REACTIONS.includes(emoji)) return false;
    if (this.status !== 'live') return false;
    const now = Date.now();
    if (now - (participant.lastReaction || 0) < REACTION_COOLDOWN_MS) return false;
    participant.lastReaction = now;
    this.touch();
    return true;
  }

  // -------------------------------------------------------------- الإجابات

  submitAnswer(participant, qid, rawValue) {
    let q;
    if (this.settings.pace === 'self') {
      if (this.status !== 'live') return { ok: false, error: 'النشاط غير نشط' };
      if (participant.phase !== 'question') return { ok: false, error: 'انتقل إلى السؤال التالي' };
      q = this.questions[participant.index];
      if (!q || q.id !== qid) return { ok: false, error: 'السؤال غير متاح الآن' };
      if (participant.endsAt && Date.now() > participant.endsAt) {
        return { ok: false, error: 'انتهى وقتك على هذا السؤال' };
      }
    } else {
      if (!this.isOpen()) {
        return { ok: false, error: 'انتظر… لم يبدأ السؤال بعد' };
      }
      if (!this.acceptsAnswers()) {
        return { ok: false, error: 'انتهى وقت الإجابة على هذا السؤال' };
      }
      q = this.currentQuestion;
      if (!q || q.id !== qid) {
        return { ok: false, error: 'السؤال غير متاح الآن' };
      }
    }
    if (participant.answers.has(qid)) {
      return { ok: false, error: 'تم تسجيل إجابتك مسبقاً' };
    }

    const value = this.parseAnswerValue(q, rawValue);
    if (value === null) return { ok: false, error: 'إجابة غير صالحة' };

    const now = Date.now();
    const startedAt = this.settings.pace === 'self' ? participant.openedAt : this.questionStartedAt;
    const ms = Math.max(0, now - (startedAt || now));
    let correct = null;
    let points = 0;
    let multiplier = 1;

    // هل هو أول من أجاب على هذا السؤال؟
    const isFirst = ![...this.participants.values()].some((p) => p !== participant && p.answers.has(qid));

    if (SCORED_TYPES.has(q.type) && q.correct.length > 0) {
      const chosen = Array.isArray(value) ? value : [value];
      correct = chosen.length === q.correct.length && chosen.every((c) => q.correct.includes(c));
      if (correct) {
        const scored = this.scorePoints(q, ms, participant);
        points = scored.points;
        multiplier = scored.multiplier;
        participant.streak += 1;
        participant.bestStreak = Math.max(participant.bestStreak, participant.streak);
        if (isFirst) participant.firstCount += 1;
      } else {
        participant.streak = 0;
      }
      participant.score += points;
    }

    participant.answers.set(qid, { value, at: now, ms, correct, points, multiplier });
    if (this.settings.pace === 'self') participant.phase = 'feedback';
    this.touch();
    return { ok: true, correct, points, multiplier, value };
  }

  /** حساب نقاط إجابة صحيحة حسب إعدادات النشاط */
  scorePoints(q, ms, participant) {
    const mode = this.settings.scoring;
    if (mode === 'none' || q.points <= 0) return { points: 0, multiplier: 1 };

    let points = q.points;
    if (mode === 'speed' && q.timeLimit) {
      // كاملة للإجابة الفورية، وتتناقص حتى نصف القيمة عند آخر ثانية
      const ratio = Math.max(0, 1 - ms / (q.timeLimit * 1000));
      points = q.points * (0.5 + 0.5 * ratio);
    }

    // مضاعف السلسلة يعتمد على عدد الصحيحات المتتالية قبل هذه الإجابة
    let multiplier = 1;
    if (this.settings.streakBonus) {
      multiplier = 1 + Math.min(STREAK_MAX, participant.streak * STREAK_STEP);
      points *= multiplier;
    }
    return { points: Math.round(points), multiplier: Math.round(multiplier * 100) / 100 };
  }

  parseAnswerValue(q, raw) {
    switch (q.type) {
      case 'mc':
      case 'poll': {
        const ids = new Set(q.options.map((o) => o.id));
        const arr = (Array.isArray(raw) ? raw : [raw]).map((v) => clean(v, 40)).filter((v) => ids.has(v));
        if (arr.length === 0) return null;
        const unique = [...new Set(arr)];
        // في الاختبار المصحّح يُسمح باختيار متعدد فقط إذا كانت الإجابة الصحيحة متعددة
        if (q.type === 'mc' && q.correct.length <= 1 && unique.length > 1) return [unique[0]];
        return unique;
      }
      case 'truefalse': {
        const v = clean(Array.isArray(raw) ? raw[0] : raw, 10);
        return v === 'true' || v === 'false' ? [v] : null;
      }
      case 'scale': {
        const v = Number(raw);
        if (!Number.isFinite(v)) return null;
        const n = Math.round(v);
        if (n < q.scale.min || n > q.scale.max) return null;
        return n;
      }
      case 'word': {
        const v = clean(raw, LIMITS.wordAnswer);
        return v.length ? v : null;
      }
      case 'open': {
        const v = clean(raw, LIMITS.openAnswer);
        return v.length ? v : null;
      }
      default:
        return null;
    }
  }

  // -------------------------------------------------------------- التجميعات

  /** تجميع نتائج سؤال واحد بشكل صالح للعرض العام (بلا كشف هوية في الاستطلاعات) */
  aggregate(qIndex) {
    const q = this.questions[qIndex];
    if (!q) return null;
    const answers = [];
    for (const p of this.participants.values()) {
      const a = p.answers.get(q.id);
      if (a) answers.push({ p, a });
    }

    const base = {
      questionId: q.id,
      type: q.type,
      total: answers.length,
      participants: this.participants.size,
    };

    if (q.type === 'mc' || q.type === 'poll' || q.type === 'truefalse') {
      const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
      for (const { a } of answers) {
        for (const v of a.value) if (counts[v] !== undefined) counts[v] += 1;
      }
      const totalVotes = Object.values(counts).reduce((s, n) => s + n, 0) || 0;
      return {
        ...base,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          count: counts[o.id],
          percent: totalVotes ? Math.round((counts[o.id] / totalVotes) * 100) : 0,
          correct: q.correct.includes(o.id),
        })),
        correctCount: answers.filter((x) => x.a.correct === true).length,
        avgMs: answers.length ? Math.round(answers.reduce((s, x) => s + x.a.ms, 0) / answers.length) : 0,
      };
    }

    if (q.type === 'scale') {
      const values = answers.map((x) => x.a.value);
      const buckets = [];
      for (let i = q.scale.min; i <= q.scale.max; i++) {
        const count = values.filter((v) => v === i).length;
        buckets.push({ value: i, count, percent: values.length ? Math.round((count / values.length) * 100) : 0 });
      }
      const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
      return { ...base, scale: q.scale, buckets, average: Math.round(avg * 10) / 10 };
    }

    if (q.type === 'word') {
      const map = new Map();
      for (const { a } of answers) {
        const key = String(a.value).toLowerCase();
        const entry = map.get(key) || { text: a.value, count: 0 };
        entry.count += 1;
        map.set(key, entry);
      }
      const words = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 60);
      return { ...base, words };
    }

    // open
    return {
      ...base,
      responses: answers
        .sort((a, b) => a.a.at - b.a.at)
        .slice(-60)
        .map(({ p, a }) => ({
          text: a.value,
          name: this.settings.requireName ? p.name : null,
          avatar: this.settings.requireName ? p.avatar : null,
        })),
    };
  }

  leaderboard(limit = 100) {
    return [...this.participants.values()]
      .filter((p) => p.score > 0 || this.hasScoredQuestions())
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .slice(0, limit)
      .map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        streak: p.streak,
      }));
  }

  hasScoredQuestions() {
    if (this.settings.scoring === 'none') return false;
    return this.questions.some((q) => SCORED_TYPES.has(q.type) && q.correct.length > 0 && q.points > 0);
  }

  /**
   * أوسمة تحفيزية تُحسب من الأداء الفعلي — لكل وسام صاحب واحد على الأكثر،
   * عدا ما يمكن أن يشترك فيه أكثر من متدرب (الدقة الكاملة والمثابرة).
   */
  badges() {
    const people = [...this.participants.values()];
    const result = new Map(people.map((p) => [p.id, []]));
    if (people.length === 0) return result;

    const add = (pid, emoji, label) => result.get(pid)?.push({ emoji, label });
    const answeredCount = (p) => p.answers.size;
    const scoredAnswers = (p) => [...p.answers.values()].filter((a) => a.correct !== null);

    // 🎯 دقة كاملة: أجاب على سؤالين مصححين على الأقل وكلها صحيحة
    for (const p of people) {
      const scored = scoredAnswers(p);
      if (scored.length >= 2 && scored.every((a) => a.correct === true)) {
        add(p.id, '🎯', 'دقة كاملة');
      }
    }

    // 💪 المثابر: أجاب على كل الأسئلة المعروضة
    const asked = this.settings.pace === 'self' ? this.questions.length : Math.max(0, this.currentIndex + 1);
    if (asked >= 2) {
      for (const p of people) if (answeredCount(p) >= asked) add(p.id, '💪', 'أجاب على كل الأسئلة');
    }

    // ⚡ الأسرع: أقل متوسط زمن بين من أجابوا على نصف الأسئلة فأكثر
    const eligible = people.filter((p) => answeredCount(p) >= Math.max(1, Math.ceil(asked / 2)));
    if (eligible.length >= 2) {
      const avg = (p) => [...p.answers.values()].reduce((s, a) => s + a.ms, 0) / p.answers.size;
      const fastest = eligible.reduce((best, p) => (avg(p) < avg(best) ? p : best));
      add(fastest.id, '⚡', 'الأسرع إجابةً');
    }

    // 🔥 أطول سلسلة (٣ فأكثر)
    const bestStreak = Math.max(...people.map((p) => p.bestStreak));
    if (bestStreak >= 3) {
      const holder = people.find((p) => p.bestStreak === bestStreak);
      add(holder.id, '🔥', `أطول سلسلة (${bestStreak})`);
    }

    // 🚀 البادئ: الأكثر سبقاً في الإجابة
    const maxFirst = Math.max(...people.map((p) => p.firstCount));
    if (maxFirst >= 2) {
      const starter = people.find((p) => p.firstCount === maxFirst);
      add(starter.id, '🚀', 'أسرع من بدأ');
    }

    return result;
  }

  badgesFor(pid) {
    return this.badges().get(pid) || [];
  }

  rankOf(pid) {
    const board = this.leaderboard(LIMITS.participants);
    const entry = board.find((e) => e.id === pid);
    return entry ? { rank: entry.rank, of: board.length } : null;
  }

  /** إحصاءات كاملة للوحة تحكم المدرب */
  dashboard() {
    const participants = [...this.participants.values()];
    const scored = this.questions.filter((q) => SCORED_TYPES.has(q.type) && q.correct.length > 0);
    const selfPaced = this.settings.pace === 'self';
    // في الوضع الحر كل الأسئلة متاحة للجميع، وكل متدرب له تقدّمه الخاص
    const asked = selfPaced
      ? this.questions.length
      : this.currentIndex >= 0
        ? Math.min(this.currentIndex + 1, this.questions.length)
        : 0;

    const perQuestion = this.questions.map((q, i) => {
      const answers = participants.map((p) => p.answers.get(q.id)).filter(Boolean);
      const correct = answers.filter((a) => a.correct === true).length;
      const scoredQ = SCORED_TYPES.has(q.type) && q.correct.length > 0;
      // كم متدرباً وصل إلى هذا السؤال (في الوضع الحر)
      const reached = selfPaced
        ? participants.filter((p) => p.phase === 'done' || p.index >= i).length
        : participants.length;
      return {
        index: i,
        id: q.id,
        text: q.text,
        type: q.type,
        asked: selfPaced ? reached > 0 : i <= this.currentIndex,
        reached,
        responses: answers.length,
        responseRate: reached ? Math.round((answers.length / reached) * 100) : 0,
        correct: scoredQ ? correct : null,
        accuracy: scoredQ && answers.length ? Math.round((correct / answers.length) * 100) : null,
        avgMs: answers.length ? Math.round(answers.reduce((s, a) => s + a.ms, 0) / answers.length) : 0,
      };
    });

    const rows = participants
      .map((p) => {
        const answered = [...p.answers.values()];
        const correct = answered.filter((a) => a.correct === true).length;
        const scoredAnswered = answered.filter((a) => a.correct !== null).length;
        // في الوضع الحر: عدد الأسئلة التي وصل إليها هذا المتدرب تحديداً
        const seen = selfPaced ? (p.phase === 'done' ? this.questions.length : p.index + 1) : asked;
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          connected: p.connected,
          score: p.score,
          bestStreak: p.bestStreak,
          done: p.phase === 'done',
          answered: answered.length,
          asked: seen,
          correct,
          accuracy: scoredAnswered ? Math.round((correct / scoredAnswered) * 100) : null,
          avgMs: answered.length ? Math.round(answered.reduce((s, a) => s + a.ms, 0) / answered.length) : 0,
          progress: seen ? Math.round((answered.length / seen) * 100) : 0,
          answers: this.questions.map((q) => {
            const a = p.answers.get(q.id);
            if (!a) return null;
            return { correct: a.correct, points: a.points };
          }),
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ar'));

    const askedQuestions = perQuestion.filter((q) => q.asked);
    const totalResponses = askedQuestions.reduce((s, q) => s + q.responses, 0);
    // المتوقع = مجموع من وصل فعلاً لكل سؤال (يختلف عن الجميع في الوضع الحر)
    const expected = askedQuestions.reduce((s, q) => s + q.reached, 0);

    return {
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      currentIndex: this.currentIndex,
      questionCount: this.questions.length,
      pace: this.settings.pace,
      scoring: this.settings.scoring,
      hasScores: scored.length > 0 && this.settings.scoring !== 'none',
      startedAt: this.createdAt,
      summary: {
        participants: participants.length,
        connected: participants.filter((p) => p.connected).length,
        finished: participants.filter((p) => p.phase === 'done').length,
        asked: askedQuestions.length,
        participation: expected ? Math.round((totalResponses / expected) * 100) : 0,
        avgScore: participants.length
          ? Math.round(participants.reduce((s, p) => s + p.score, 0) / participants.length)
          : 0,
        topScore: participants.reduce((m, p) => Math.max(m, p.score), 0),
        avgAccuracy: (() => {
          const withAcc = askedQuestions.filter((q) => q.accuracy !== null);
          return withAcc.length ? Math.round(withAcc.reduce((s, q) => s + q.accuracy, 0) / withAcc.length) : null;
        })(),
      },
      perQuestion,
      participants: rows,
    };
  }

  /** تصدير النتائج (يبقى مؤقتاً — ينزّله المدرب إن أراد الاحتفاظ به) */
  export() {
    return {
      title: this.title,
      code: this.code,
      exportedAt: new Date().toISOString(),
      questions: this.questions.map((q, i) => ({
        index: i + 1,
        text: q.text,
        type: q.type,
        options: q.options.map((o) => o.text),
        correct: q.correct.map((c) => q.options.find((o) => o.id === c)?.text).filter(Boolean),
        results: this.aggregate(i),
      })),
      participants: [...this.participants.values()].map((p) => ({
        name: this.settings.requireName ? p.name : 'مجهول',
        score: p.score,
        answers: this.questions.map((q) => {
          const a = p.answers.get(q.id);
          if (!a) return null;
          const label = Array.isArray(a.value)
            ? a.value.map((v) => q.options.find((o) => o.id === v)?.text ?? v).join(' + ')
            : a.value;
          return { question: q.text, answer: label, correct: a.correct, points: a.points, seconds: Math.round(a.ms / 100) / 10 };
        }),
      })),
    };
  }

  // ------------------------------------------------------------------- البث

  allSockets() {
    const out = [...this.hostSockets];
    for (const p of this.participants.values()) out.push(...p.sockets);
    return out;
  }

  send(socket, message) {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* تجاهل */
    }
  }

  broadcast(message, filter) {
    for (const socket of this.allSockets()) {
      if (filter && !filter(socket)) continue;
      this.send(socket, message);
    }
  }

  /** الحالة المرئية للمشارك في وضع «كل متدرب بسرعته» */
  selfState(participant) {
    const q = this.questions[participant.index];
    const answer = q ? participant.answers.get(q.id) : null;
    const done = participant.phase === 'done' || this.status === 'ended';
    const state = {
      t: 'state',
      role: 'player',
      pace: 'self',
      code: this.code,
      title: this.title,
      status: this.status,
      phase: done ? 'final' : participant.phase,
      index: participant.index,
      total: this.questions.length,
      locked: false,
      endsAt: participant.endsAt,
      opensAt: null,
      serverNow: Date.now(),
      settings: this.settings,
      me: {
        id: participant.id,
        name: participant.name,
        avatar: participant.avatar,
        score: participant.score,
        streak: participant.streak,
      },
      participants: this.participants.size,
      answered: answer ? { value: answer.value, correct: answer.correct, points: answer.points, multiplier: answer.multiplier } : null,
    };

    if (this.status === 'lobby') {
      state.phase = 'lobby';
      return state;
    }
    if (done) {
      state.rank = this.rankOf(participant.id);
      state.badges = this.badgesFor(participant.id);
      if (this.settings.showLeaderboard) state.leaderboard = this.leaderboard(10);
      return state;
    }
    if (q) {
      // نكشف الإجابة الصحيحة والشرح بعد أن يجيب، إن سمح المدرب بذلك
      state.question = publicQuestion(q, participant.phase === 'feedback' && this.settings.revealAnswer);
      if (participant.phase === 'feedback') state.results = this.aggregate(participant.index);
    }
    return state;
  }

  /** الحالة المرئية للمشارك */
  participantState(participant) {
    if (this.settings.pace === 'self') return this.selfState(participant);
    const q = this.currentQuestion;
    const answer = q ? participant.answers.get(q.id) : null;
    const state = {
      t: 'state',
      role: 'player',
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      index: this.currentIndex,
      total: this.questions.length,
      locked: this.locked,
      endsAt: this.questionEndsAt,
      opensAt: this.questionOpensAt,
      serverNow: Date.now(),
      settings: this.settings,
      me: {
        id: participant.id,
        name: participant.name,
        avatar: participant.avatar,
        score: participant.score,
        streak: participant.streak,
      },
      participants: this.participants.size,
      answered: answer
        ? { value: answer.value, correct: answer.correct, points: answer.points, multiplier: answer.multiplier }
        : null,
    };

    if (q && (this.phase === 'question' || this.phase === 'results')) {
      // بعد عرض النتائج تُكشف للجميع؛ وقبلها تُكشف لمن أجاب فقط إن فعّل المدرب الخيار
      const reveal = this.phase === 'results' || (this.settings.revealAnswer && !!answer);
      state.question = publicQuestion(q, reveal);
    }
    if (this.phase === 'results' && q) {
      state.results = this.aggregate(this.currentIndex);
    }
    if (this.phase === 'leaderboard' || this.phase === 'final') {
      state.rank = this.rankOf(participant.id);
      // كم مركزاً صعد أو هبط منذ السؤال السابق
      if (participant.prevRank && state.rank) state.rankDelta = participant.prevRank - state.rank.rank;
      if (this.settings.showLeaderboard) state.leaderboard = this.leaderboard(10);
      if (this.phase === 'final') state.badges = this.badgesFor(participant.id);
    }
    return state;
  }

  /** الحالة المرئية للمضيف (المدرب) */
  hostState() {
    const q = this.currentQuestion;
    const state = {
      t: 'state',
      role: 'host',
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      index: this.currentIndex,
      total: this.questions.length,
      locked: this.locked,
      endsAt: this.questionEndsAt,
      opensAt: this.questionOpensAt,
      serverNow: Date.now(),
      settings: this.settings,
      questions: this.questions.map((item) => ({ id: item.id, text: item.text, type: item.type })),
      participants: [...this.participants.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        connected: p.connected,
        answeredCurrent: q ? p.answers.has(q.id) : false,
        // في الوضع الحر: أين وصل كل متدرب
        at: p.phase === 'done' ? this.questions.length : p.index + 1,
        done: p.phase === 'done',
      })),
      answeredCount: q ? [...this.participants.values()].filter((p) => p.answers.has(q.id)).length : 0,
      pace: this.settings.pace,
      autoNextAt: this._autoTimer ? this._autoAt : null,
      finishedCount: [...this.participants.values()].filter((p) => p.phase === 'done').length,
    };
    if (q) {
      state.question = publicQuestion(q, true);
      state.results = this.aggregate(this.currentIndex);
    }
    if (this.phase === 'leaderboard' || this.phase === 'final' || this.settings.pace === 'self') {
      state.leaderboard = this.leaderboard(20);
    }
    if (this.phase === 'final') {
      const badges = this.badges();
      state.badgeList = [...this.participants.values()]
        .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, badges: badges.get(p.id) || [] }))
        .filter((entry) => entry.badges.length > 0);
    }
    return state;
  }

  broadcastState() {
    const dashboard = this.hostSockets.size ? { t: 'dashboard', data: this.dashboard() } : null;
    for (const socket of this.hostSockets) {
      this.send(socket, this.hostState());
      if (dashboard) this.send(socket, dashboard);
    }
    for (const p of this.participants.values()) {
      const payload = this.participantState(p);
      for (const socket of p.sockets) this.send(socket, payload);
    }
  }

  broadcastHost() {
    const payload = this.hostState();
    for (const socket of this.hostSockets) this.send(socket, payload);
  }
}

/** نسخة السؤال المرسلة للعملاء — تُخفي الإجابة الصحيحة أثناء الإجابة */
function publicQuestion(q, revealCorrect) {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    // الشرح لا يُرسل إلا مع كشف الإجابة
    explanation: revealCorrect ? q.explanation || '' : '',
    timeLimit: q.timeLimit,
    points: q.points,
    options: q.options.map((o) => ({
      id: o.id,
      text: o.text,
      ...(revealCorrect ? { correct: q.correct.includes(o.id) } : {}),
    })),
    scale: q.scale,
    scored: SCORED_TYPES.has(q.type) && q.correct.length > 0,
    multi: q.correct.length > 1,
  };
}

function normalizeAvatar(avatar) {
  return {
    seed: clean(avatar?.seed, 32) || id(''),
    bg: clamp(avatar?.bg, 0, 11, 0),
    body: clamp(avatar?.body, 0, 11, 0),
    face: clamp(avatar?.face, 0, 11, 0),
    accessory: clamp(avatar?.accessory, 0, 11, 0),
  };
}

module.exports = { Session, normalizeQuiz, QUESTION_TYPES, LIMITS, REACTIONS, READY_MS, publicQuestion };
