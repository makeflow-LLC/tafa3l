'use strict';

const crypto = require('crypto');

const QUESTION_TYPES = ['mc', 'truefalse', 'poll', 'word', 'scale', 'open'];
/** مهلة «استعد… ٣ ٢ ١» قبل فتح السؤال المؤقّت — تبقي الجميع على نفس الخط */
const READY_MS = 3200;
/** تفاعلات سريعة يرسلها المشاركون أثناء العرض */
const REACTIONS = ['👏', '🔥', '😂', '😮', '❤️', '🤔'];
const REACTION_COOLDOWN_MS = 600;
/** الأنواع التي تُحتسب لها نقاط (لها إجابة صحيحة) */
const SCORED_TYPES = new Set(['mc', 'truefalse']);
/** الأنواع التي لا تُظهر هوية المشارك في النتائج */
const LIMITS = {
  title: 120,
  questionText: 300,
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
    timeLimit: raw?.timeLimit === 0 || raw?.timeLimit === null ? 0 : clamp(raw?.timeLimit, 5, 600, 30),
    points: clamp(raw?.points, 0, 2000, 1000),
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
    this.currentIndex = -1;
    this.next();
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
    this.touch();
  }

  showLeaderboard() {
    this.locked = true;
    this.phase = 'leaderboard';
    this.touch();
  }

  finish() {
    this.status = 'ended';
    this.phase = 'final';
    this.locked = true;
    this.endedAt = Date.now();
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
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
    if (!this.isOpen()) {
      return { ok: false, error: 'انتظر… لم يبدأ السؤال بعد' };
    }
    if (!this.acceptsAnswers()) {
      return { ok: false, error: 'انتهى وقت الإجابة على هذا السؤال' };
    }
    const q = this.currentQuestion;
    if (!q || q.id !== qid) {
      return { ok: false, error: 'السؤال غير متاح الآن' };
    }
    if (participant.answers.has(qid)) {
      return { ok: false, error: 'تم تسجيل إجابتك مسبقاً' };
    }

    const value = this.parseAnswerValue(q, rawValue);
    if (value === null) return { ok: false, error: 'إجابة غير صالحة' };

    const now = Date.now();
    const ms = Math.max(0, now - (this.questionStartedAt || now));
    let correct = null;
    let points = 0;

    if (SCORED_TYPES.has(q.type) && q.correct.length > 0) {
      const chosen = Array.isArray(value) ? value : [value];
      correct =
        chosen.length === q.correct.length && chosen.every((c) => q.correct.includes(c));
      if (correct) {
        points = q.points;
        // مكافأة السرعة: حتى ٥٠٪ إضافية عند وجود مؤقّت
        if (q.timeLimit) {
          const ratio = Math.max(0, 1 - ms / (q.timeLimit * 1000));
          points = Math.round(q.points * (0.5 + 0.5 * ratio));
        }
        participant.streak += 1;
      } else {
        participant.streak = 0;
      }
      participant.score += points;
    }

    participant.answers.set(qid, { value, at: now, ms, correct, points });
    this.touch();
    return { ok: true, correct, points, value };
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
    return this.questions.some((q) => SCORED_TYPES.has(q.type) && q.correct.length > 0);
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
    const asked = this.currentIndex >= 0 ? Math.min(this.currentIndex + 1, this.questions.length) : 0;

    const perQuestion = this.questions.map((q, i) => {
      const answers = participants.map((p) => p.answers.get(q.id)).filter(Boolean);
      const correct = answers.filter((a) => a.correct === true).length;
      const scoredQ = SCORED_TYPES.has(q.type) && q.correct.length > 0;
      return {
        index: i,
        id: q.id,
        text: q.text,
        type: q.type,
        asked: i <= this.currentIndex,
        responses: answers.length,
        responseRate: participants.length ? Math.round((answers.length / participants.length) * 100) : 0,
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
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          connected: p.connected,
          score: p.score,
          answered: answered.length,
          asked,
          correct,
          accuracy: scoredAnswered ? Math.round((correct / scoredAnswered) * 100) : null,
          avgMs: answered.length ? Math.round(answered.reduce((s, a) => s + a.ms, 0) / answered.length) : 0,
          progress: asked ? Math.round((answered.length / asked) * 100) : 0,
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
    const expected = askedQuestions.length * participants.length;

    return {
      code: this.code,
      title: this.title,
      status: this.status,
      phase: this.phase,
      currentIndex: this.currentIndex,
      questionCount: this.questions.length,
      hasScores: scored.length > 0,
      startedAt: this.createdAt,
      summary: {
        participants: participants.length,
        connected: participants.filter((p) => p.connected).length,
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

  /** الحالة المرئية للمشارك */
  participantState(participant) {
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
        ? { value: answer.value, correct: answer.correct, points: answer.points }
        : null,
    };

    if (q && (this.phase === 'question' || this.phase === 'results')) {
      state.question = publicQuestion(q, this.phase === 'results');
    }
    if (this.phase === 'results' && q) {
      state.results = this.aggregate(this.currentIndex);
    }
    if (this.phase === 'leaderboard' || this.phase === 'final') {
      state.rank = this.rankOf(participant.id);
      if (this.settings.showLeaderboard) state.leaderboard = this.leaderboard(10);
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
      })),
      answeredCount: q ? [...this.participants.values()].filter((p) => p.answers.has(q.id)).length : 0,
    };
    if (q) {
      state.question = publicQuestion(q, true);
      state.results = this.aggregate(this.currentIndex);
    }
    if (this.phase === 'leaderboard' || this.phase === 'final') {
      state.leaderboard = this.leaderboard(20);
    }
    return state;
  }

  broadcastState() {
    for (const socket of this.hostSockets) this.send(socket, this.hostState());
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
