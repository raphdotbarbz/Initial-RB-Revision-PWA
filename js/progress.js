const PROGRESS_KEY = "rb_progress";

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function createProgressState() {
  return {
    sessionHistory: [],
    questionStates: {},
    attemptLog: [],
    flashcardStates: {},
    flashcardReviewLog: [],
    streak: 0,
    lastStudyDate: null
  };
}

function parseProgress(value) {
  try {
    const parsed = JSON.parse(value);
    return {
      ...createProgressState(),
      ...parsed,
      questionStates: parsed?.questionStates || {},
      sessionHistory: parsed?.sessionHistory || [],
      attemptLog: parsed?.attemptLog || [],
      flashcardStates: parsed?.flashcardStates || {},
      flashcardReviewLog: parsed?.flashcardReviewLog || []
    };
  } catch {
    return createProgressState();
  }
}

export function loadProgress() {
  const stored = localStorage.getItem(PROGRESS_KEY);
  return stored ? parseProgress(stored) : createProgressState();
}

export function saveProgress(progress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export function getTodayKey() {
  return todayKey();
}

function ensureQuestionState(progress, question) {
  if (!progress.questionStates[question.id]) {
    progress.questionStates[question.id] = {
      module: question.module,
      topic: question.topic,
      correct_count: 0,
      attempt_count: 0,
      flagged: false,
      last_seen: null
    };
  }
  return progress.questionStates[question.id];
}

function updateStreak(progress) {
  const today = todayKey();
  if (progress.lastStudyDate === today) {
    return;
  }

  if (!progress.lastStudyDate) {
    progress.streak = 1;
    progress.lastStudyDate = today;
    return;
  }

  const last = new Date(`${progress.lastStudyDate}T00:00:00`);
  const current = new Date(`${today}T00:00:00`);
  const deltaDays = Math.round((current - last) / 86400000);

  progress.streak = deltaDays === 1 ? progress.streak + 1 : 1;
  progress.lastStudyDate = today;
}

export function recordAttempt(progress, { question, correct, durationSec = 0 }) {
  const state = ensureQuestionState(progress, question);
  state.attempt_count += 1;
  state.correct_count += correct ? 1 : 0;
  state.last_seen = Date.now();
  state.module = question.module;
  state.topic = question.topic;

  progress.attemptLog.push({
    question_id: question.id,
    module: question.module,
    topic: question.topic,
    correct,
    duration_sec: durationSec,
    date: todayKey(),
    timestamp: Date.now()
  });

  progress.attemptLog = progress.attemptLog.slice(-600);
  updateStreak(progress);
  saveProgress(progress);
}

export function recordSession(progress, { module, score, total, durationSec }) {
  updateStreak(progress);
  progress.sessionHistory.unshift({
    date: new Date().toISOString(),
    module,
    score,
    total,
    duration_sec: durationSec
  });
  progress.sessionHistory = progress.sessionHistory.slice(0, 100);
  saveProgress(progress);
}

export function toggleFlag(progress, question) {
  const state = ensureQuestionState(progress, question);
  state.flagged = !state.flagged;
  saveProgress(progress);
  return state.flagged;
}

export function isFlagged(progress, questionId) {
  return Boolean(progress.questionStates[questionId]?.flagged);
}

export function getQuestionAccuracy(progress, questionId) {
  const state = progress.questionStates[questionId];
  if (!state || state.attempt_count === 0) {
    return null;
  }
  return state.correct_count / state.attempt_count;
}

export function getModuleAccuracy(progress, module) {
  const states = Object.values(progress.questionStates).filter((entry) => entry.module === module);
  const attempts = states.reduce((sum, entry) => sum + entry.attempt_count, 0);
  if (!attempts) {
    return 0;
  }
  const correct = states.reduce((sum, entry) => sum + entry.correct_count, 0);
  return correct / attempts;
}

export function getModuleAttemptCount(progress, module) {
  return Object.values(progress.questionStates)
    .filter((entry) => entry.module === module)
    .reduce((sum, entry) => sum + entry.attempt_count, 0);
}

export function getModuleCorrectCount(progress, module) {
  return Object.values(progress.questionStates)
    .filter((entry) => entry.module === module)
    .reduce((sum, entry) => sum + entry.correct_count, 0);
}

export function getModuleIncorrectCount(progress, module) {
  return getModuleAttemptCount(progress, module) - getModuleCorrectCount(progress, module);
}

export function getWeakTopics(progress, limit = 3) {
  const grouped = new Map();

  for (const attempt of progress.attemptLog) {
    const key = `${attempt.module}:${attempt.topic}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(attempt);
  }

  return [...grouped.entries()]
    .map(([key, attempts]) => {
      const recent = attempts.slice(-20);
      const correct = recent.filter((item) => item.correct).length;
      const accuracy = recent.length ? correct / recent.length : 0;
      const [module, topic] = key.split(":");
      return { module, topic, attempts: recent.length, accuracy };
    })
    .filter((entry) => entry.attempts > 0)
    .sort((left, right) => left.accuracy - right.accuracy || right.attempts - left.attempts)
    .slice(0, limit);
}

export function getRecentSessions(progress, limit = 8) {
  return progress.sessionHistory.slice(0, limit);
}

function ensureFlashcardState(progress, card) {
  if (!progress.flashcardStates[card.id]) {
    progress.flashcardStates[card.id] = {
      module: card.module,
      topic: card.topic,
      review_count: 0,
      confidence_sum: 0,
      correct_count: 0,
      incorrect_count: 0,
      last_rating: null,
      last_seen: null
    };
  }

  return progress.flashcardStates[card.id];
}

export function recordFlashcardReview(progress, { card, rating }) {
  const state = ensureFlashcardState(progress, card);
  state.review_count += 1;
  state.confidence_sum += rating;
  state.last_rating = rating;
  state.last_seen = Date.now();
  state.module = card.module;
  state.topic = card.topic;

  if (rating >= 4) {
    state.correct_count += 1;
  }
  if (rating <= 2) {
    state.incorrect_count += 1;
  }

  progress.flashcardReviewLog.push({
    flashcard_id: card.id,
    module: card.module,
    topic: card.topic,
    rating,
    date: todayKey(),
    timestamp: Date.now()
  });

  progress.flashcardReviewLog = progress.flashcardReviewLog.slice(-600);
  updateStreak(progress);
  saveProgress(progress);
}

export function getFlashcardStats(progress, module) {
  const states = Object.values(progress.flashcardStates).filter((entry) => entry.module === module);
  const reviewCount = states.reduce((sum, entry) => sum + entry.review_count, 0);
  const confidenceSum = states.reduce((sum, entry) => sum + entry.confidence_sum, 0);
  const correctCount = states.reduce((sum, entry) => sum + entry.correct_count, 0);
  const incorrectCount = states.reduce((sum, entry) => sum + entry.incorrect_count, 0);

  return {
    reviewCount,
    avgRating: reviewCount ? confidenceSum / reviewCount : 0,
    correctCount,
    incorrectCount
  };
}

export function getModuleStudyDay(progress, module, dateKey = todayKey()) {
  const questionAttempts = progress.attemptLog.filter((entry) => entry.module === module && entry.date === dateKey);
  const flashcardReviews = progress.flashcardReviewLog.filter((entry) => entry.module === module && entry.date === dateKey);

  return {
    dateKey,
    questionAttempts: questionAttempts.length,
    correctCount: questionAttempts.filter((entry) => entry.correct).length,
    incorrectCount: questionAttempts.filter((entry) => !entry.correct).length,
    flashcardReviews: flashcardReviews.length,
    totalItems: questionAttempts.length + flashcardReviews.length
  };
}

export function getModuleCalendar(progress, module, monthKey = todayKey()) {
  const monthStart = parseDateKey(monthKey);
  const firstOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const lastOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  const today = todayKey();

  const days = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    const dateKey = dateKeyFromDate(cursor);
    const day = getModuleStudyDay(progress, module, dateKey);
    days.push({
      ...day,
      dayNumber: cursor.getDate(),
      inMonth: cursor.getMonth() === firstOfMonth.getMonth(),
      isToday: dateKey === today
    });
  }

  return {
    monthKey: dateKeyFromDate(firstOfMonth),
    monthLabel: firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    days
  };
}

export function rankQuestionsForSession(questions, progress) {
  return [...questions].sort((left, right) => {
    const leftState = progress.questionStates[left.id];
    const rightState = progress.questionStates[right.id];

    const leftFlagged = leftState?.flagged ? 1 : 0;
    const rightFlagged = rightState?.flagged ? 1 : 0;
    if (leftFlagged !== rightFlagged) {
      return rightFlagged - leftFlagged;
    }

    const leftAccuracy = leftState?.attempt_count ? leftState.correct_count / leftState.attempt_count : -1;
    const rightAccuracy = rightState?.attempt_count ? rightState.correct_count / rightState.attempt_count : -1;
    if (leftAccuracy !== rightAccuracy) {
      return leftAccuracy - rightAccuracy;
    }

    const leftSeen = leftState?.last_seen || 0;
    const rightSeen = rightState?.last_seen || 0;
    if (leftSeen !== rightSeen) {
      return leftSeen - rightSeen;
    }

    return Math.random() - 0.5;
  });
}

export function resetProgress() {
  const state = createProgressState();
  saveProgress(state);
  return state;
}
