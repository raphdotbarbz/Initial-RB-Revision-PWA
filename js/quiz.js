const GMAT_TIMER_BY_SUBTOPIC = {
  cr: 90,
  rc: 90,
  sc: 90,
  ps: 120,
  ds: 120
};

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function buildSessionQuestions(questions, { shuffleQuestions = true, size = "5" } = {}) {
  const ordered = shuffleQuestions ? shuffle(questions) : [...questions];
  const count = Math.min(Number(size) || 5, 5);
  return ordered.slice(0, Math.min(count, ordered.length));
}

export function createSession({ module, questions, answerMode = "instant" }) {
  return {
    id: `${module}_${Date.now()}`,
    module,
    questions,
    currentIndex: 0,
    answers: [],
    score: 0,
    speedBonus: 0,
    startedAt: Date.now(),
    questionStartedAt: Date.now(),
    finishedAt: null,
    answerMode,
    ui: {
      showTrickFor: {},
      revealedAnswerFor: {},
      awaitingContinueFor: {}
    }
  };
}

export function getCurrentQuestion(session) {
  return session.questions[session.currentIndex] || null;
}

export function getCurrentElapsedSec(session) {
  return Math.max(0, Math.round((Date.now() - session.questionStartedAt) / 1000));
}

export function getQuestionTimer(question, module) {
  if (module !== "gmat") {
    return null;
  }

  if (question.timer_sec) {
    return question.timer_sec;
  }

  const key = (question.subtopic || "").trim().toLowerCase();
  return GMAT_TIMER_BY_SUBTOPIC[key] || 120;
}

function evaluateNumeric(question, rawValue) {
  const submitted = Number.parseFloat(rawValue);
  if (Number.isNaN(submitted)) {
    return { valid: false, message: "Enter a valid number before submitting." };
  }

  const answer = Number(question.answer);
  const tolerancePct = Number(question.tolerance_pct ?? 0);
  const toleranceValue = Math.abs(answer) * (tolerancePct / 100);
  const correct = Math.abs(submitted - answer) <= toleranceValue;

  return {
    valid: true,
    correct,
    submitted,
    correctAnswer: answer,
    tolerancePct
  };
}

function evaluateText(question, rawValue) {
  const submitted = rawValue.trim().toLowerCase();
  const correctValue = `${question.answer}`.trim().toLowerCase();
  return {
    valid: Boolean(submitted),
    correct: submitted === correctValue,
    submitted: rawValue,
    correctAnswer: question.answer
  };
}

function evaluateMcq(question, selectedIndex) {
  return {
    valid: true,
    correct: Number(selectedIndex) === Number(question.answer),
    submitted: Number(selectedIndex),
    correctAnswer: Number(question.answer)
  };
}

export function evaluateAnswer(question, response) {
  if (question.type === "numeric") {
    return evaluateNumeric(question, response);
  }

  if (question.type === "text") {
    return evaluateText(question, response);
  }

  return evaluateMcq(question, response);
}

function computeSpeedBonus(question, elapsedSec) {
  const target = Number(question.timer_sec || 60);
  if (elapsedSec <= Math.round(target * 0.5)) {
    return 2;
  }
  if (elapsedSec <= target) {
    return 1;
  }
  return 0;
}

export function submitAnswer(session, response) {
  const question = getCurrentQuestion(session);
  const elapsedSec = getCurrentElapsedSec(session);
  const evaluation = evaluateAnswer(question, response);

  if (!evaluation.valid) {
    return { ok: false, evaluation };
  }

  const answerRecord = {
    questionId: question.id,
    question,
    response,
    correct: evaluation.correct,
    elapsedSec,
    timestamp: Date.now()
  };

  session.answers.push(answerRecord);
  if (evaluation.correct) {
    session.score += 1;
    if (session.module === "pe") {
      session.speedBonus += computeSpeedBonus(question, elapsedSec);
    }
  }

  return { ok: true, evaluation, answerRecord };
}

export function advanceSession(session) {
  session.currentIndex += 1;
  session.questionStartedAt = Date.now();

  if (session.currentIndex >= session.questions.length) {
    session.finishedAt = Date.now();
  }
}

export function skipQuestion(session) {
  const question = getCurrentQuestion(session);
  session.answers.push({
    questionId: question.id,
    question,
    response: null,
    correct: false,
    skipped: true,
    elapsedSec: getCurrentElapsedSec(session),
    timestamp: Date.now()
  });
  advanceSession(session);
}

export function revealAnswer(session) {
  const question = getCurrentQuestion(session);
  session.ui.revealedAnswerFor[question.id] = true;
}

export function toggleTrick(session) {
  const question = getCurrentQuestion(session);
  session.ui.showTrickFor[question.id] = !session.ui.showTrickFor[question.id];
  return session.ui.showTrickFor[question.id];
}

export function isFinished(session) {
  return Boolean(session.finishedAt);
}

export function getDurationSec(session) {
  const finish = session.finishedAt || Date.now();
  return Math.max(1, Math.round((finish - session.startedAt) / 1000));
}

export function getSummary(session) {
  return {
    score: session.score,
    total: session.questions.length,
    durationSec: getDurationSec(session),
    speedBonus: session.speedBonus
  };
}
