import { chatAboutQuestion, getAIAvailability, getApiKey, clearApiKey, explainQuestion, generateSimilarQuestion, setApiKey, workedSolution } from "./ai.js";
import {
  getFlashcardStats,
  getModuleCalendar,
  getModuleAccuracy,
  getModuleAttemptCount,
  getModuleCorrectCount,
  getModuleIncorrectCount,
  getModuleStudyDay,
  getRecentSessions,
  getTodayKey,
  getWeakTopics,
  isFlagged,
  loadProgress,
  rankQuestionsForSession,
  recordAttempt,
  recordFlashcardReview,
  recordSession,
  resetProgress,
  saveProgress,
  toggleFlag
} from "./progress.js";
import { advanceSession, buildSessionQuestions, createSession, getCurrentElapsedSec, getCurrentQuestion, getQuestionTimer, getSummary, isFinished, revealAnswer, skipQuestion, submitAnswer, toggleTrick } from "./quiz.js";
import { buildHash, navigate, startRouter } from "./router.js";
import { ensureProfile, fetchUserSnapshot, getCloudSession, getSupabaseAvailability, onCloudAuthStateChange, saveUserSnapshot, sendMagicLink, signOutCloud } from "./supabase.js";

const SETTINGS_KEY = "rb_settings";
const INSTALL_BANNER_KEY = "rb_install_dismissed";
const MILESTONE_STREAKS = new Set([3, 7, 14, 30]);

const MODULES = {
  home: { title: "Dashboard", accent: "#3BA4F9", icon: "⌂" },
  pe: {
    key: "pe",
    title: "Private Equity",
    icon: "PE",
    accent: "#F4C95D",
    description: "Timed mental math drills for live investing and interview speed."
  },
  energy: {
    key: "energy",
    title: "Energy",
    icon: "EN",
    accent: "#28C76F",
    description: "Calculation-heavy engineering questions with formula reference cards."
  },
  caia: {
    key: "caia",
    title: "CAIA",
    icon: "CA",
    accent: "#57D9C3",
    description: "Level II-aligned revision with curriculum-module, reading-area, and review filters."
  },
  gmat: {
    key: "gmat",
    title: "GMAT",
    icon: "GM",
    accent: "#FF8C42",
    description: "Verbal and quant drills with timed question flow."
  }
};

const MODULE_KEYS = ["pe", "energy", "caia", "gmat"];

function createEmptyAIChat() {
  return {
    open: false,
    loading: false,
    error: "",
    messages: [],
    contextId: ""
  };
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-01`;
}

function shiftMonthKey(monthKey, delta) {
  const current = new Date(`${monthKey}T00:00:00`);
  const shifted = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  return `${shifted.getFullYear()}-${`${shifted.getMonth() + 1}`.padStart(2, "0")}-01`;
}

function createCalendarCursorState() {
  const monthKey = currentMonthKey();
  return MODULE_KEYS.reduce((accumulator, moduleKey) => {
    accumulator[moduleKey] = monthKey;
    return accumulator;
  }, {});
}

const DEFAULT_SETTINGS = {
  shuffle: true,
  size: "5",
  answerMode: "instant",
  dailyGoals: {
    pe: 0,
    energy: 0,
    caia: 0,
    gmat: 0
  },
  flashcardDailyGoals: {
    caia: 0
  },
  flashcardEdits: {},
  filters: {
    pe: { topic: "all" },
    energy: { topic: "all" },
    caia: { topic: "all", level: "all", questionCurriculumModule: "all", curriculumModule: "all", flaggedOnly: false, uncertainOnly: false },
    gmat: { topic: "all", difficulty: "all" }
  }
};

const state = {
  banks: {},
  flashcardBanks: {},
  referenceTables: [],
  progress: loadProgress(),
  settings: loadSettings(),
  route: { view: "home", module: null, query: {} },
  session: null,
  flashcardSession: null,
  flashcardEditor: { open: false, cardId: "", draft: "" },
  aiPanel: { loading: false, text: "", error: "", title: "" },
  aiChat: createEmptyAIChat(),
  calendarCursorByModule: createCalendarCursorState(),
  cloud: {
    user: null,
    loading: false,
    syncing: false,
    error: "",
    lastSyncedAt: "",
    syncTimer: null
  },
  sheet: { open: false, title: "", body: "", html: "" },
  toast: "",
  celebration: "",
  adminMode: false,
  headerTapTimes: [],
  timerInterval: null
};

const appRoot = document.getElementById("app");

function normalizeSettings(parsed = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...parsed,
    dailyGoals: {
      ...structuredClone(DEFAULT_SETTINGS).dailyGoals,
      ...(parsed.dailyGoals || {})
    },
    flashcardDailyGoals: {
      ...structuredClone(DEFAULT_SETTINGS).flashcardDailyGoals,
      ...(parsed.flashcardDailyGoals || {})
    },
    flashcardEdits: {
      ...structuredClone(DEFAULT_SETTINGS).flashcardEdits,
      ...(parsed.flashcardEdits || {})
    },
    filters: {
      ...structuredClone(DEFAULT_SETTINGS).filters,
      ...(parsed.filters || {}),
      pe: {
        ...structuredClone(DEFAULT_SETTINGS).filters.pe,
        ...parsed.filters?.pe
      },
      energy: {
        ...structuredClone(DEFAULT_SETTINGS).filters.energy,
        ...parsed.filters?.energy
      },
      caia: {
        ...structuredClone(DEFAULT_SETTINGS).filters.caia,
        ...parsed.filters?.caia
      },
      gmat: {
        ...structuredClone(DEFAULT_SETTINGS).filters.gmat,
        ...parsed.filters?.gmat
      }
    }
  };
}

function loadSettings() {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (!stored) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  try {
    return normalizeSettings(JSON.parse(stored));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings({ skipCloud = false } = {}) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  if (!skipCloud) {
    scheduleCloudSync();
  }
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function multilineHtml(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function moduleConfig(moduleKey) {
  return MODULES[moduleKey] || MODULES.pe;
}

function appAccent() {
  if (state.route.view === "module" || state.route.view === "quiz" || state.route.view === "flashcards") {
    return moduleConfig(state.route.module).accent;
  }
  return MODULES.home.accent;
}

function resetAIChat({ keepOpen = false, questionId = "" } = {}) {
  state.aiChat = {
    ...createEmptyAIChat(),
    open: keepOpen,
    contextId: questionId
  };
}

function closeFlashcardEditor() {
  state.flashcardEditor = { open: false, cardId: "", draft: "" };
}

function getEditedFlashcardFront(card) {
  const edited = `${state.settings.flashcardEdits?.[card?.id] || ""}`.trim();
  return edited || card?.front || "";
}

function hasEditedFlashcardFront(card) {
  const edited = `${state.settings.flashcardEdits?.[card?.id] || ""}`.trim();
  return Boolean(card && edited && edited !== `${card.front || ""}`.trim());
}

function syncAIChatQuestionContext() {
  const question = getCurrentQuestion(state.session);
  if (!question) {
    resetAIChat();
    return null;
  }
  if (state.aiChat.contextId && state.aiChat.contextId !== question.id) {
    resetAIChat();
  }
  if (!state.aiChat.contextId) {
    state.aiChat.contextId = question.id;
  }
  return question;
}

function setCalendarMonth(moduleKey, delta) {
  state.calendarCursorByModule[moduleKey] = shiftMonthKey(
    state.calendarCursorByModule[moduleKey] || currentMonthKey(),
    delta
  );
}

function hasLocalStudyData() {
  return Boolean(
    state.progress.attemptLog.length
    || state.progress.flashcardReviewLog.length
    || state.progress.sessionHistory.length
  );
}

function applyCloudSnapshot(snapshot) {
  if (snapshot?.progress && typeof snapshot.progress === "object") {
    saveProgress(snapshot.progress);
    state.progress = loadProgress();
  }

  if (snapshot?.settings && typeof snapshot.settings === "object") {
    state.settings = normalizeSettings(snapshot.settings);
    saveSettings({ skipCloud: true });
  }

  state.cloud.lastSyncedAt = snapshot?.synced_at || snapshot?.updated_at || new Date().toISOString();
}

async function pullCloudSnapshot({ silent = false } = {}) {
  if (!state.cloud.user) {
    showToast("Sign in to cloud sync first.");
    return;
  }

  state.cloud.loading = true;
  state.cloud.error = "";
  render();

  try {
    const snapshot = await fetchUserSnapshot(state.cloud.user.id);
    if (!snapshot) {
      if (!silent) {
        showToast("No cloud snapshot found yet.");
      }
      state.cloud.loading = false;
      render();
      return;
    }

    applyCloudSnapshot(snapshot);
    state.cloud.loading = false;
    if (!silent) {
      showToast("Pulled progress and settings from cloud.");
    }
  } catch (error) {
    state.cloud.loading = false;
    state.cloud.error = error.message || "Cloud pull failed.";
  }
  render();
}

async function pushCloudSnapshot({ silent = false } = {}) {
  if (!state.cloud.user) {
    if (!silent) {
      showToast("Sign in to cloud sync first.");
    }
    return;
  }

  state.cloud.syncing = true;
  state.cloud.error = "";
  if (!silent) {
    render();
  }

  try {
    await ensureProfile(state.cloud.user);
    await saveUserSnapshot(state.cloud.user.id, {
      progress: state.progress,
      settings: state.settings
    });
    state.cloud.syncing = false;
    state.cloud.lastSyncedAt = new Date().toISOString();
    if (!silent) {
      showToast("Pushed progress and settings to cloud.");
    }
  } catch (error) {
    state.cloud.syncing = false;
    state.cloud.error = error.message || "Cloud push failed.";
  }
  render();
}

function scheduleCloudSync() {
  if (!state.cloud.user) {
    return;
  }

  window.clearTimeout(state.cloud.syncTimer);
  state.cloud.syncTimer = window.setTimeout(() => {
    pushCloudSnapshot({ silent: true });
  }, 1200);
}

async function applyCloudSession(session, { silent = false } = {}) {
  state.cloud.user = session?.user || null;
  state.cloud.error = "";

  if (!state.cloud.user) {
    state.cloud.lastSyncedAt = "";
    render();
    return;
  }

  try {
    await ensureProfile(state.cloud.user);
    const snapshot = await fetchUserSnapshot(state.cloud.user.id);
    if (snapshot && !hasLocalStudyData()) {
      applyCloudSnapshot(snapshot);
      if (!silent) {
        showToast("Pulled your cloud data.");
      }
    } else if (!snapshot && !silent) {
      showToast("Cloud sync connected. Push your first snapshot from Settings.");
    } else if (!silent) {
      showToast("Cloud sync connected.");
    }
  } catch (error) {
    state.cloud.error = error.message || "Cloud session setup failed.";
  }

  render();
}

async function initCloudAuth() {
  const availability = getSupabaseAvailability();
  if (availability.label === "Fill js/config.js first") {
    render();
    return;
  }

  try {
    const session = await getCloudSession();
    await applyCloudSession(session, { silent: true });
    await onCloudAuthStateChange((nextSession) => {
      applyCloudSession(nextSession);
    });
  } catch (error) {
    state.cloud.error = error.message || "Cloud auth failed to initialize.";
    render();
  }
}

async function loadBank(moduleKey) {
  const response = await fetch(new URL(`../data/${moduleKey}.json`, import.meta.url));
  if (!response.ok) {
    throw new Error(`Unable to load ${moduleKey} bank.`);
  }
  return response.json();
}

async function boot() {
  try {
    const [pe, energy, caia, gmat, caiaFlashcards, mentalMathTables] = await Promise.all([
      loadBank("pe"),
      loadBank("energy"),
      loadBank("caia"),
      loadBank("gmat"),
      loadBank("caia_flashcards"),
      loadBank("mental_math_tables")
    ]);
    state.banks = { pe, energy, caia, gmat };
    state.flashcardBanks = { caia: caiaFlashcards };
    state.referenceTables = mentalMathTables;
    bindEvents();
    startRouter((route) => {
      state.route = route;
      if (route.view === "quiz" && (!state.session || state.session.module !== route.module)) {
        startSession(route.module, {
          source: route.query.source || "direct",
          skipNavigate: true
        });
        return;
      }
      if (route.view === "flashcards" && (!state.flashcardSession || state.flashcardSession.module !== route.module)) {
        startFlashcardSession(route.module, {
          skipNavigate: true
        });
        return;
      }
      render();
    });
    render();
    initCloudAuth();
  } catch (error) {
    appRoot.innerHTML = `
      <div class="boot-screen">
        <div class="boot-mark">RB</div>
        <h1>Unable to load RB Revision</h1>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

function bindEvents() {
  appRoot.addEventListener("click", handleClick);
  appRoot.addEventListener("submit", handleSubmit);
  appRoot.addEventListener("touchstart", handleTouchStart, { passive: true });
  appRoot.addEventListener("touchend", handleTouchEnd, { passive: true });
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
}

let touchStartX = 0;
let touchStartY = 0;

function handleTouchStart(event) {
  const card = event.target.closest("[data-swipeable='question']");
  if (!card) {
    return;
  }
  const touch = event.changedTouches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}

function handleTouchEnd(event) {
  const card = event.target.closest("[data-swipeable='question']");
  if (!card || !state.session || isFinished(state.session)) {
    return;
  }
  if (isCurrentQuestionLocked()) {
    return;
  }

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = Math.abs(touch.clientY - touchStartY);
  if (deltaY > 48 || Math.abs(deltaX) < 70) {
    return;
  }

  if (deltaX < 0) {
    skipCurrentQuestion("Skipped with swipe.");
  } else {
    flagCurrentQuestion();
  }
}

function handleClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  const action = trigger.dataset.action;

  if (action === "header-tap") {
    registerHeaderTap();
    return;
  }

  if (action === "dismiss-install-banner") {
    localStorage.setItem(INSTALL_BANNER_KEY, "1");
    render();
    return;
  }

  if (action === "go-home") {
    navigate("home");
    return;
  }

  if (action === "go-settings") {
    navigate("settings");
    return;
  }

  if (action === "open-module") {
    navigate("module", trigger.dataset.module);
    return;
  }

  if (action === "open-flashcards") {
    startFlashcardSession(trigger.dataset.module, {
      skipNavigate: state.route.view === "flashcards" && state.route.module === trigger.dataset.module
    });
    return;
  }

  if (action === "start-session") {
    startSession(trigger.dataset.module, {
      size: "5",
      source: trigger.dataset.source || "manual",
      topic: trigger.dataset.topic || null,
      flaggedOnly: trigger.dataset.flaggedOnly === "true"
    });
    return;
  }

  if (action === "set-filter") {
    state.settings.filters[trigger.dataset.module][trigger.dataset.filter] =
      trigger.dataset.value === "true" ? true : trigger.dataset.value === "false" ? false : trigger.dataset.value;
    saveSettings();
    render();
    return;
  }

  if (action === "toggle-shuffle") {
    state.settings.shuffle = !state.settings.shuffle;
    saveSettings();
    render();
    return;
  }

  if (action === "toggle-answer-mode") {
    state.settings.answerMode = state.settings.answerMode === "instant" ? "session_end" : "instant";
    saveSettings();
    render();
    return;
  }

  if (action === "answer-option") {
    submitCurrentAnswer(trigger.dataset.value);
    return;
  }

  if (action === "grade-open-question") {
    submitCurrentAnswer(trigger.dataset.correct === "true" ? "correct" : "incorrect");
    return;
  }

  if (action === "continue-question") {
    moveAfterAnswer();
    return;
  }

  if (action === "skip-question") {
    skipCurrentQuestion("Question skipped.");
    return;
  }

  if (action === "flag-question") {
    flagCurrentQuestion();
    return;
  }

  if (action === "open-formula") {
    const question = getCurrentQuestion(state.session);
    state.sheet = {
      open: true,
      title: `${question.topic} formula`,
      body: question.formula_ref || "No formula reference stored for this question.",
      html: ""
    };
    render();
    return;
  }

  if (action === "open-mental-math") {
    openMentalMathTables(trigger.dataset.module);
    return;
  }

  if (action === "close-sheet") {
    state.sheet = { open: false, title: "", body: "", html: "" };
    render();
    return;
  }

  if (action === "show-trick") {
    toggleTrick(state.session);
    render();
    return;
  }

  if (action === "reveal-answer") {
    revealAnswer(state.session);
    render();
    return;
  }

  if (action === "ai-explain") {
    runAI("Explain", explainQuestion);
    return;
  }

  if (action === "ai-generate") {
    runAI("Generate Similar", generateSimilarQuestion, true);
    return;
  }

  if (action === "ai-worked") {
    runAI("Worked Solution", workedSolution);
    return;
  }

  if (action === "toggle-ai-chat") {
    const question = syncAIChatQuestionContext();
    if (!question) {
      return;
    }
    if (state.aiChat.open) {
      resetAIChat({ questionId: question.id });
    } else {
      resetAIChat({ keepOpen: true, questionId: question.id });
    }
    render();
    return;
  }

  if (action === "reset-ai-chat") {
    const question = syncAIChatQuestionContext();
    resetAIChat({
      keepOpen: true,
      questionId: question?.id || ""
    });
    render();
    return;
  }

  if (action === "calendar-prev") {
    setCalendarMonth(trigger.dataset.module, -1);
    render();
    return;
  }

  if (action === "calendar-next") {
    setCalendarMonth(trigger.dataset.module, 1);
    render();
    return;
  }

  if (action === "cloud-sign-out") {
    signOutCloud().catch((error) => {
      state.cloud.error = error.message || "Cloud sign-out failed.";
      render();
    });
    return;
  }

  if (action === "cloud-pull") {
    pullCloudSnapshot();
    return;
  }

  if (action === "cloud-push") {
    pushCloudSnapshot();
    return;
  }

  if (action === "clear-api-key") {
    clearApiKey();
    showToast("API key cleared.");
    render();
    return;
  }

  if (action === "reset-progress") {
    state.progress = resetProgress();
    state.session = null;
    state.flashcardSession = null;
    state.aiPanel = { loading: false, text: "", error: "", title: "" };
    resetAIChat();
    scheduleCloudSync();
    showToast("Progress reset.");
    render();
    return;
  }

  if (action === "flip-flashcard") {
    if (state.flashcardSession) {
      state.flashcardSession.revealed = true;
      render();
    }
    return;
  }

  if (action === "toggle-flashcard-front-edit") {
    const card = getCurrentFlashcard();
    if (!card) {
      return;
    }
    if (state.flashcardEditor.open && state.flashcardEditor.cardId === card.id) {
      closeFlashcardEditor();
    } else {
      state.flashcardEditor = {
        open: true,
        cardId: card.id,
        draft: getEditedFlashcardFront(card)
      };
    }
    render();
    return;
  }

  if (action === "cancel-flashcard-front-edit") {
    closeFlashcardEditor();
    render();
    return;
  }

  if (action === "reset-flashcard-front-edit") {
    const card = getCurrentFlashcard();
    if (!card) {
      return;
    }
    delete state.settings.flashcardEdits[card.id];
    saveSettings();
    closeFlashcardEditor();
    showToast("Flashcard front reset.");
    render();
    return;
  }

  if (action === "rate-flashcard") {
    gradeFlashcard(Number(trigger.dataset.rating));
    return;
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (event.target.matches("[data-form='numeric-answer']")) {
    const form = event.target;
    const formData = new FormData(form);
    submitCurrentAnswer(formData.get("answer"));
    return;
  }

  if (event.target.matches("[data-form='api-key']")) {
    const formData = new FormData(event.target);
    const apiKey = `${formData.get("apiKey") || ""}`;
    if (!apiKey.trim()) {
      showToast("Enter a key or use Clear.");
      return;
    }
    setApiKey(apiKey);
    showToast("API key saved locally.");
    render();
    return;
  }

  if (event.target.matches("[data-form='flashcard-daily-goal']")) {
    const formData = new FormData(event.target);
    const moduleKey = `${formData.get("module") || ""}`;
    const goalValue = Number(formData.get("goal") || 0);
    if (!moduleKey) {
      return;
    }
    state.settings.flashcardDailyGoals[moduleKey] = Number.isFinite(goalValue) && goalValue > 0 ? Math.round(goalValue) : 0;
    saveSettings();
    showToast(state.settings.flashcardDailyGoals[moduleKey] ? "Flashcard daily goal saved." : "Flashcard daily goal cleared.");
    render();
    return;
  }

  if (event.target.matches("[data-form='flashcard-front-edit']")) {
    const card = getCurrentFlashcard();
    if (!card) {
      return;
    }

    const formData = new FormData(event.target);
    const nextFront = `${formData.get("front") || ""}`.trim();
    if (!nextFront) {
      showToast("Front text cannot be empty.");
      return;
    }

    if (nextFront === `${card.front || ""}`.trim()) {
      delete state.settings.flashcardEdits[card.id];
    } else {
      state.settings.flashcardEdits[card.id] = nextFront;
    }

    saveSettings();
    closeFlashcardEditor();
    showToast("Flashcard front updated.");
    render();
    return;
  }

  if (event.target.matches("[data-form='module-daily-goal']")) {
    const formData = new FormData(event.target);
    const moduleKey = `${formData.get("module") || ""}`;
    const goalValue = Number(formData.get("goal") || 0);
    if (!moduleKey) {
      return;
    }
    state.settings.dailyGoals[moduleKey] = Number.isFinite(goalValue) && goalValue > 0 ? Math.round(goalValue) : 0;
    saveSettings();
    showToast(state.settings.dailyGoals[moduleKey] ? "Daily goal saved." : "Daily goal cleared.");
    render();
    return;
  }

  if (event.target.matches("[data-form='ai-chat']")) {
    await submitAIChat(event.target);
    return;
  }

  if (event.target.matches("[data-form='cloud-auth']")) {
    const formData = new FormData(event.target);
    const email = `${formData.get("email") || ""}`.trim();
    if (!email) {
      showToast("Enter your email first.");
      return;
    }

    state.cloud.loading = true;
    state.cloud.error = "";
    render();

    try {
      await sendMagicLink(email);
      state.cloud.loading = false;
      showToast("Magic link sent. Open it on this device.");
    } catch (error) {
      state.cloud.loading = false;
      state.cloud.error = error.message || "Magic link failed.";
      render();
    }
  }
}

function registerHeaderTap() {
  const now = Date.now();
  state.headerTapTimes = [...state.headerTapTimes.filter((time) => now - time < 900), now];
  if (state.headerTapTimes.length >= 3) {
    state.adminMode = !state.adminMode;
    state.headerTapTimes = [];
    showToast(state.adminMode ? "Admin mode unlocked." : "Admin mode hidden.");
    render();
  }
}

function getQuestions(moduleKey) {
  return Array.isArray(state.banks[moduleKey]) ? state.banks[moduleKey] : [];
}

function getFlashcards(moduleKey) {
  return Array.isArray(state.flashcardBanks[moduleKey]) ? state.flashcardBanks[moduleKey] : [];
}

function getMentalMathTables(moduleKey) {
  return (state.referenceTables || []).filter((table) => table.subjects?.includes("all") || table.subjects?.includes(moduleKey));
}

function formatMentalMathSubject(subject) {
  if (subject === "all") {
    return "All";
  }
  return moduleConfig(subject).title;
}

function renderMentalMathTablesHtml(moduleKey, tables) {
  return `
    <div class="sheet-copy">
      <p class="muted-copy">Reference tables labeled for ${escapeHtml(moduleConfig(moduleKey).title)}. Shared all-module tables are included too.</p>
      <div class="mental-table-stack">
        ${tables.map((table) => `
          <article class="mental-table-card">
            <div class="question-meta">
              ${table.subjects.map((subject) => `<span class="pill">${escapeHtml(formatMentalMathSubject(subject))}</span>`).join("")}
            </div>
            <h4>${escapeHtml(table.title)}</h4>
            ${table.description ? `<p class="muted-copy">${escapeHtml(table.description)}</p>` : ""}
            <div class="mental-table-wrap">
              <table class="mental-table">
                <thead>
                  <tr>${table.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                  ${table.rows.map((row) => `
                    <tr>${table.headers.map((_, index) => `<td>${escapeHtml(row[index] || "")}</td>`).join("")}</tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function openMentalMathTables(moduleKey) {
  const tables = getMentalMathTables(moduleKey);
  if (!tables.length) {
    showToast("No mental math tables are loaded for this module yet.");
    return;
  }

  state.sheet = {
    open: true,
    title: `${moduleConfig(moduleKey).title} mental math tables`,
    body: "",
    html: renderMentalMathTablesHtml(moduleKey, tables)
  };
  render();
}

function getFlashcardDeckStats(moduleKey) {
  const cards = getFlashcards(moduleKey);
  return {
    total: cards.length,
    uncertain: cards.filter((card) => card.uncertain).length
  };
}

function getTopicOptions(moduleKey) {
  const source = getQuestions(moduleKey);
  const topics = new Set(source.map((question) => question.topic));
  return ["all", ...topics];
}

function getLevelOptions(moduleKey) {
  const source = getQuestions(moduleKey);
  const levels = new Set(
    source
      .map((question) => question.level)
      .filter(Boolean)
  );
  return ["all", ...levels];
}

function getCurriculumModuleOptions(moduleKey) {
  const values = new Set(
    getFlashcards(moduleKey)
      .map((card) => card.curriculum_module)
      .filter(Boolean)
  );
  return ["all", ...values];
}

function getQuestionCurriculumModuleOptions(moduleKey) {
  const values = new Set(
    getQuestions(moduleKey)
      .map((question) => question.curriculum_module)
      .filter(Boolean)
  );
  return ["all", ...values];
}

function getDifficultyOptions(moduleKey) {
  const values = new Set(
    getQuestions(moduleKey)
      .map((question) => question.difficulty)
      .filter(Boolean)
  );
  return ["all", ...values];
}

function applyFilters(moduleKey, questions, options = {}) {
  const filters = state.settings.filters[moduleKey];
  const hasExplicitTopic = Boolean(options.topic && options.topic !== "all");
  return questions.filter((question) => {
    if (hasExplicitTopic && question.topic !== options.topic) {
      return false;
    }
    if (moduleKey === "caia") {
      if (filters.questionCurriculumModule !== "all" && question.curriculum_module !== filters.questionCurriculumModule) {
        return false;
      }
      if (!hasExplicitTopic && filters.topic !== "all" && question.topic !== filters.topic) {
        return false;
      }
      if (filters.level !== "all" && question.level !== filters.level) {
        return false;
      }
      if ((options.flaggedOnly || filters.flaggedOnly) && !isFlagged(state.progress, question.id)) {
        return false;
      }
    }
    if (moduleKey === "gmat") {
      if (!hasExplicitTopic && filters.topic !== "all" && question.topic !== filters.topic) {
        return false;
      }
      if (filters.difficulty !== "all" && question.difficulty !== filters.difficulty) {
        return false;
      }
    }
    if ((moduleKey === "pe" || moduleKey === "energy") && !hasExplicitTopic && filters.topic !== "all" && question.topic !== filters.topic) {
      return false;
    }
    return true;
  });
}

function applyFlashcardFilters(moduleKey, cards, options = {}) {
  const filters = state.settings.filters[moduleKey];
  const hasExplicitModule = Boolean(options.curriculumModule && options.curriculumModule !== "all");
  return cards.filter((card) => {
    if (hasExplicitModule && card.curriculum_module !== options.curriculumModule) {
      return false;
    }
    if (!hasExplicitModule && filters.curriculumModule !== "all" && card.curriculum_module !== filters.curriculumModule) {
      return false;
    }
    if (filters.level !== "all" && card.level !== filters.level) {
      return false;
    }
    if (filters.uncertainOnly && !card.uncertain) {
      return false;
    }
    return true;
  });
}

function startSession(moduleKey, options = {}) {
  const ranked = rankQuestionsForSession(
    applyFilters(moduleKey, getQuestions(moduleKey), options),
    state.progress
  );

  const questions = buildSessionQuestions(ranked, {
    shuffleQuestions: state.settings.shuffle,
    size: options.size || state.settings.size
  });

  if (!questions.length) {
    showToast("No questions match that filter yet.");
    navigate("module", moduleKey);
    return;
  }

  state.session = createSession({
    module: moduleKey,
    questions,
    answerMode: moduleKey === "caia" ? state.settings.answerMode : "instant"
  });

  state.aiPanel = { loading: false, text: "", error: "", title: "" };
  resetAIChat();
  state.sheet = { open: false, title: "", body: "", html: "" };
  const quizHash = buildHash("quiz", moduleKey, { source: options.source || "manual" });
  if (options.skipNavigate || window.location.hash === quizHash) {
    render();
    return;
  }
  window.location.hash = quizHash;
}

function startFlashcardSession(moduleKey, options = {}) {
  const cards = applyFlashcardFilters(moduleKey, getFlashcards(moduleKey), options);
  const ordered = state.settings.shuffle ? [...cards].sort(() => Math.random() - 0.5) : [...cards];

  if (!ordered.length) {
    showToast("No flashcards match that filter yet.");
    navigate("module", moduleKey);
    return;
  }

  state.flashcardSession = {
    id: `${moduleKey}_flashcards_${Date.now()}`,
    module: moduleKey,
    cards: ordered,
    currentIndex: 0,
    startedAt: Date.now(),
    finishedAt: null,
    revealed: false,
    reviews: []
  };

  closeFlashcardEditor();
  resetAIChat();
  const flashcardHash = buildHash("flashcards", moduleKey);
  if (options.skipNavigate || window.location.hash === flashcardHash) {
    render();
    return;
  }
  window.location.hash = flashcardHash;
}

function getCurrentFlashcard() {
  return state.flashcardSession?.cards[state.flashcardSession.currentIndex] || null;
}

function finishFlashcardSession() {
  if (state.flashcardSession) {
    state.flashcardSession.finishedAt = Date.now();
  }
  closeFlashcardEditor();
  render();
}

function gradeFlashcard(rating) {
  if (!state.flashcardSession || !Number.isFinite(rating) || rating < 1 || rating > 5) {
    return;
  }

  const card = getCurrentFlashcard();
  const previousStreak = state.progress.streak;
  recordFlashcardReview(state.progress, { card, rating });
  scheduleCloudSync();
  maybeCelebrate(previousStreak);

  state.flashcardSession.reviews.push({
    card,
    rating,
    correctLike: rating >= 4,
    incorrectLike: rating <= 2
  });
  state.flashcardSession.currentIndex += 1;
  state.flashcardSession.revealed = false;
  closeFlashcardEditor();

  if (state.flashcardSession.currentIndex >= state.flashcardSession.cards.length) {
    finishFlashcardSession();
    return;
  }

  render();
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function maybeCelebrate(previousStreak) {
  if (state.progress.streak > previousStreak && MILESTONE_STREAKS.has(state.progress.streak)) {
    state.celebration = `${state.progress.streak}-day streak unlocked`;
    render();
    window.clearTimeout(maybeCelebrate.timeout);
    maybeCelebrate.timeout = window.setTimeout(() => {
      state.celebration = "";
      render();
    }, 2200);
  }
}

function finishSession() {
  const before = state.progress.streak;
  const summary = getSummary(state.session);
  recordSession(state.progress, {
    module: state.session.module,
    score: summary.score,
    total: summary.total,
    durationSec: summary.durationSec
  });
  scheduleCloudSync();
  maybeCelebrate(before);
  render();
}

function isAwaitingContinue(questionId) {
  return Boolean(state.session?.ui.awaitingContinueFor[questionId]);
}

function isCurrentQuestionLocked() {
  const question = getCurrentQuestion(state.session);
  return question ? isAwaitingContinue(question.id) : false;
}

function moveAfterAnswer() {
  const current = getCurrentQuestion(state.session);
  if (current) {
    delete state.session.ui.awaitingContinueFor[current.id];
  }
  resetAIChat();
  advanceSession(state.session);
  if (isFinished(state.session)) {
    finishSession();
  } else {
    render();
  }
}

function submitCurrentAnswer(rawValue) {
  const current = getCurrentQuestion(state.session);
  if (!current) {
    return;
  }
  if (isCurrentQuestionLocked()) {
    showToast("Tap Continue when you're ready for the next question.");
    return;
  }

  const result = submitAnswer(state.session, rawValue);
  if (!result.ok) {
    showToast(result.evaluation.message);
    return;
  }

  const previousStreak = state.progress.streak;
  recordAttempt(state.progress, {
    question: current,
    correct: result.evaluation.correct,
    durationSec: result.answerRecord.elapsedSec
  });
  scheduleCloudSync();
  maybeCelebrate(previousStreak);

  state.session.lastEvaluation = result.evaluation;
  state.session.lastQuestionId = current.id;
  state.aiPanel = { loading: false, text: "", error: "", title: "" };

  const instant = state.session.answerMode === "instant";
  if (instant) {
    state.session.ui.awaitingContinueFor[current.id] = true;
    state.session.ui.revealedAnswerFor[current.id] = true;
    render();
  } else {
    moveAfterAnswer();
  }
}

function skipCurrentQuestion(message) {
  if (!state.session || isFinished(state.session)) {
    return;
  }
  if (isCurrentQuestionLocked()) {
    showToast("Tap Continue when you're ready for the next question.");
    return;
  }
  resetAIChat();
  skipQuestion(state.session);
  showToast(message);
  if (isFinished(state.session)) {
    finishSession();
  } else {
    render();
  }
}

function flagCurrentQuestion() {
  const current = getCurrentQuestion(state.session);
  if (!current) {
    return;
  }
  const flagged = toggleFlag(state.progress, current);
  scheduleCloudSync();
  showToast(flagged ? "Flagged for review." : "Removed from review.");
  render();
}

async function runAI(title, action, appendQuestion = false) {
  const availability = getAIAvailability();
  if (!availability.enabled) {
    showToast(availability.label);
    return;
  }

  const question = getCurrentQuestion(state.session);
  if (!question) {
    return;
  }
  state.aiPanel = { loading: true, text: "", error: "", title };
  render();

  try {
    const response = await action(question);
    if (appendQuestion) {
      state.session.questions.push(response);
      state.aiPanel = {
        loading: false,
        text: "Added a similar question to the current session queue.",
        error: "",
        title
      };
      showToast("Similar question added.");
    } else {
      state.aiPanel = { loading: false, text: response, error: "", title };
    }
  } catch (error) {
    state.aiPanel = {
      loading: false,
      text: "",
      error: error.message || "AI request failed.",
      title
    };
  }
  render();
}

async function submitAIChat(form) {
  const availability = getAIAvailability();
  if (!availability.enabled) {
    showToast(availability.label);
    return;
  }

  const question = syncAIChatQuestionContext();
  if (!question) {
    return;
  }

  const formData = new FormData(form);
  const prompt = `${formData.get("prompt") || ""}`.trim();
  if (!prompt) {
    showToast("Type a question for AI first.");
    return;
  }

  const answerVisible = Boolean(state.session?.ui.revealedAnswerFor[question.id])
    || state.session?.lastQuestionId === question.id;

  const nextMessages = [...state.aiChat.messages, { role: "user", text: prompt }];
  state.aiChat = {
    ...state.aiChat,
    open: true,
    loading: true,
    error: "",
    contextId: question.id,
    messages: nextMessages
  };
  render();

  try {
    const response = await chatAboutQuestion(question, nextMessages, { answerVisible });
    state.aiChat = {
      ...state.aiChat,
      loading: false,
      error: "",
      messages: [...nextMessages, { role: "assistant", text: response }]
    };
  } catch (error) {
    state.aiChat = {
      ...state.aiChat,
      loading: false,
      error: error.message || "AI chat failed.",
      messages: nextMessages
    };
  }
  render();
}

function render() {
  if (!Object.keys(state.banks).length) {
    return;
  }

  window.clearInterval(state.timerInterval);
  const routeModule = state.route.module || "pe";
  const currentModule = state.route.view === "home" || state.route.view === "settings" ? "home" : routeModule;

  appRoot.innerHTML = `
    <div class="app-frame" style="--module-accent: ${appAccent()}">
      ${renderHeader(currentModule)}
      ${renderScreen()}
      ${renderBottomNav()}
      ${renderFormulaSheet()}
      ${renderToast()}
      ${renderCelebration()}
    </div>
  `;

  setupTimer();
}

function renderHeader(currentModule) {
  const config = moduleConfig(currentModule);
  return `
    <header class="app-header">
      <button class="brand-lockup" data-action="header-tap" aria-label="RB Revision header">
        <span class="brand-mark">${config.icon}</span>
        <span>
          <h1>RB Revision</h1>
          <p>${escapeHtml(config.title)}</p>
        </span>
      </button>
      <div class="header-actions">
        <span class="connection-pill ${navigator.onLine ? "is-online" : "is-offline"}">
          ${navigator.onLine ? "Online" : "Offline"}
        </span>
        <button class="icon-button" data-action="go-settings" aria-label="Open settings">⚙</button>
      </div>
    </header>
  `;
}

function renderScreen() {
  if (state.route.view === "settings") {
    return `<main class="screen">${renderSettingsScreen()}</main>`;
  }

  if (state.route.view === "flashcards") {
    return `<main class="screen">${renderFlashcardScreen()}</main>`;
  }

  if (state.route.view === "module") {
    return `<main class="screen">${renderModuleScreen(state.route.module)}</main>`;
  }

  if (state.route.view === "quiz") {
    return `<main class="screen">${renderQuizScreen()}</main>`;
  }

  return `<main class="screen">${renderHomeScreen()}</main>`;
}

function getModuleDailyGoal(moduleKey) {
  return Number(state.settings.dailyGoals?.[moduleKey] || 0);
}

function getModuleDailyGoalProgress(moduleKey, dateKey = getTodayKey()) {
  const goal = getModuleDailyGoal(moduleKey);
  const studyDay = getModuleStudyDay(state.progress, moduleKey, dateKey);
  const completed = studyDay.totalItems;
  const ratio = goal > 0 ? Math.min(completed / goal, 1) : 0;
  return {
    goal,
    completed,
    ratio,
    remaining: goal > 0 ? Math.max(goal - completed, 0) : 0,
    studyDay
  };
}

function getFlashcardDailyGoal(moduleKey) {
  return Number(state.settings.flashcardDailyGoals?.[moduleKey] || 0);
}

function getFlashcardDailyGoalProgress(moduleKey, dateKey = getTodayKey()) {
  const goal = getFlashcardDailyGoal(moduleKey);
  const completed = getModuleStudyDay(state.progress, moduleKey, dateKey).flashcardReviews;
  const ratio = goal > 0 ? Math.min(completed / goal, 1) : 0;
  return {
    goal,
    completed,
    ratio,
    remaining: goal > 0 ? Math.max(goal - completed, 0) : 0
  };
}

function getOverallCorrectCount() {
  return MODULE_KEYS
    .reduce((sum, moduleKey) => sum + getModuleCorrectCount(state.progress, moduleKey), 0);
}

function getOverallIncorrectCount() {
  return MODULE_KEYS
    .reduce((sum, moduleKey) => sum + getModuleIncorrectCount(state.progress, moduleKey), 0);
}

function renderPerformancePieCard() {
  const correct = getOverallCorrectCount();
  const incorrect = getOverallIncorrectCount();
  const total = correct + incorrect;
  const correctRatio = total ? correct / total : 0;
  const angle = `${(correctRatio * 360).toFixed(2)}deg`;
  const summary = total
    ? `${percent(correctRatio)} accuracy across ${total} answered`
    : "Answer a few questions and your split will appear here.";

  return `
    <article class="stat-card performance-card is-wide">
      <div>
        <p class="stat-label">Performance Split</p>
        <p class="support-copy">${escapeHtml(summary)}</p>
      </div>
      <div class="performance-chart-shell">
        <div class="performance-pie ${total ? "" : "is-empty"}" style="--pie-angle: ${angle}">
          <div class="performance-pie-center">
            <strong>${total || 0}</strong>
            <span>answered</span>
          </div>
        </div>
        <div class="performance-legend">
          <div class="performance-legend-row">
            <span class="performance-dot is-correct"></span>
            <strong>${correct}</strong>
            <span class="muted-copy">Correct</span>
          </div>
          <div class="performance-legend-row">
            <span class="performance-dot is-incorrect"></span>
            <strong>${incorrect}</strong>
            <span class="muted-copy">Incorrect</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderHomeScreen() {
  const weakTopics = getWeakTopics(state.progress, 3);
  const sessions = getRecentSessions(state.progress, 5);

  return `
    ${renderInstallBanner()}
    <section class="hero-card">
      <div class="module-meta">
        <span class="pill">Offline-first PWA</span>
        <span class="pill">Anthropic-ready</span>
      </div>
      <h2>One study shell for CAIA, GMAT, Energy, and PE drills.</h2>
      <p class="muted-copy">Home screen install, local progress, and question banks that keep working even when the signal drops.</p>
      <div class="hero-actions">
        <button class="primary-button" data-action="start-session" data-module="pe" data-size="5" data-source="home">Quick PE 5</button>
        <button class="secondary-button" data-action="open-module" data-module="energy">Explore Energy</button>
      </div>
    </section>
    <section class="stat-grid">
      ${renderStatCard("Streak", `${state.progress.streak}d`, "Daily completion streak")}
      ${renderStatCard("API Key", getApiKey() ? "Saved" : "Missing", navigator.onLine ? "Ready for AI actions" : "Offline mode active")}
      ${renderPerformancePieCard()}
    </section>
    <section>
      <h3 class="section-heading">Modules</h3>
      <div class="module-grid">
        ${["pe", "energy", "caia", "gmat"].map((moduleKey) => renderModuleCard(moduleKey)).join("")}
      </div>
    </section>
    <section class="stat-card">
      <h3 class="section-heading">Weak Topics</h3>
      ${weakTopics.length ? `
        <div class="summary-list">
          ${weakTopics.map((entry) => `
            <div class="weak-topic-item">
              <strong>${escapeHtml(MODULES[entry.module].title)} · ${escapeHtml(entry.topic)}</strong>
              <p class="muted-copy">${percent(entry.accuracy)} accuracy across ${entry.attempts} recent attempts.</p>
              <button
                class="ghost-button"
                data-action="start-session"
                data-module="${entry.module}"
                data-topic="${escapeHtml(entry.topic)}"
                data-size="5"
                data-source="weak-topic"
              >Drill this topic</button>
            </div>
          `).join("")}
        </div>
      ` : `<p class="empty-copy">Complete a few sessions and your weakest topics will surface here.</p>`}
    </section>
    <section class="stat-card">
      <h3 class="section-heading">Recent Sessions</h3>
      ${sessions.length ? `
        <div class="history-list">
          ${sessions.map((session) => `
            <div class="history-item">
              <strong>${escapeHtml(MODULES[session.module].title)}</strong>
              <span class="muted-copy">${session.score}/${session.total} · ${Math.round(session.duration_sec / 60)} min · ${new Date(session.date).toLocaleDateString()}</span>
            </div>
          `).join("")}
        </div>
      ` : `<p class="empty-copy">Your completed sessions will land here.</p>`}
    </section>
  `;
}

function renderModuleCard(moduleKey) {
  const config = MODULES[moduleKey];
  const questionCount = getQuestions(moduleKey).length;
  const flashcardDeckStats = moduleKey === "caia" ? getFlashcardDeckStats("caia") : null;
  const accuracy = getModuleAccuracy(state.progress, moduleKey);
  const correct = getModuleCorrectCount(state.progress, moduleKey);
  const incorrect = getModuleIncorrectCount(state.progress, moduleKey);
  const dailyGoal = getModuleDailyGoalProgress(moduleKey);
  const flashcardDailyGoal = moduleKey === "caia" ? getFlashcardDailyGoalProgress("caia") : null;
  const goalSummary = dailyGoal.goal
    ? `Today ${dailyGoal.completed}/${dailyGoal.goal}`
    : dailyGoal.completed
      ? `Today ${dailyGoal.completed} studied`
      : "No daily goal set";
  const flashcardDailySummary = flashcardDailyGoal?.goal
    ? `Flashcards today ${flashcardDailyGoal.completed}/${flashcardDailyGoal.goal}`
    : flashcardDailyGoal?.completed
      ? `Flashcards today ${flashcardDailyGoal.completed} reviewed`
      : "No flashcard daily goal set";
  return `
    <article class="module-card" style="--module-accent: ${config.accent}">
      <div class="module-meta">
        <span class="pill">${config.icon}</span>
        <span class="pill">${questionCount} questions</span>
        ${flashcardDeckStats ? `<span class="pill">${flashcardDeckStats.total} cards</span>` : ""}
      </div>
      <h2>${escapeHtml(config.title)}</h2>
      <p class="muted-copy">${escapeHtml(config.description)}</p>
      <div class="progress-bar"><span style="width: ${Math.max(accuracy * 100, 6)}%"></span></div>
      <p class="support-copy">${percent(accuracy)} accuracy · ${correct} correct · ${incorrect} incorrect</p>
      <p class="support-copy">${goalSummary}</p>
      ${moduleKey === "caia" ? `<p class="support-copy">${flashcardDailySummary}</p>` : ""}
      <div class="module-actions">
        <button class="primary-button" data-action="start-session" data-module="${moduleKey}" data-size="5" data-source="card">Quick 5</button>
        <button class="secondary-button" data-action="open-module" data-module="${moduleKey}">Open</button>
      </div>
    </article>
  `;
}

function renderModuleScreen(moduleKey) {
  const config = moduleConfig(moduleKey);
  const questions = getQuestions(moduleKey);
  const filters = state.settings.filters[moduleKey];
  const flashcardStats = moduleKey === "caia" ? getFlashcardStats(state.progress, "caia") : null;
  const flashcardDeckStats = moduleKey === "caia" ? getFlashcardDeckStats("caia") : null;
  const mentalMathTables = getMentalMathTables(moduleKey);

  return `
    <section class="hero-card">
      <div class="module-meta">
        <span class="pill">${config.icon}</span>
        <span class="pill">${questions.length} questions live</span>
        ${flashcardDeckStats ? `<span class="pill">${flashcardDeckStats.total} flashcards live</span>` : ""}
        ${mentalMathTables.length ? `<span class="pill">${mentalMathTables.length} mental math tables</span>` : ""}
      </div>
      <h2>${escapeHtml(config.title)}</h2>
      <p class="muted-copy">${escapeHtml(config.description)}</p>
      <div class="hero-actions">
        <button class="primary-button" data-action="start-session" data-module="${moduleKey}" data-size="5" data-source="module">Start 5-question session</button>
        ${mentalMathTables.length ? `<button class="secondary-button" data-action="open-mental-math" data-module="${moduleKey}">Mental Math Tables</button>` : ""}
        ${moduleKey === "caia" ? `<button class="ghost-button" data-action="open-flashcards" data-module="caia">Flashcards</button>` : ""}
      </div>
    </section>
    ${renderModuleStatsPanel(moduleKey, flashcardStats, flashcardDeckStats)}
    <section class="settings-card">
      <h3 class="section-heading">Session Setup</h3>
      <div class="filter-row">
        <button class="filter-chip ${state.settings.shuffle ? "is-active" : ""}" data-action="toggle-shuffle">Shuffle ${state.settings.shuffle ? "On" : "Off"}</button>
        ${moduleKey === "caia"
          ? `<button class="filter-chip ${state.settings.answerMode === "session_end" ? "is-active" : ""}" data-action="toggle-answer-mode">CAIA answers ${state.settings.answerMode === "instant" ? "instant" : "end of session"}</button>`
          : ""
        }
        <span class="filter-chip is-active">5 q sessions only</span>
      </div>
      ${renderGoalForms(moduleKey)}
      ${renderModuleFilters(moduleKey, filters)}
    </section>
    ${renderModuleCalendar(moduleKey)}
    ${state.adminMode ? renderAdminPanel(moduleKey) : ""}
  `;
}

function renderModuleStatsPanel(moduleKey, flashcardStats = null, flashcardDeckStats = null) {
  const dailyGoal = getModuleDailyGoalProgress(moduleKey);
  const flashcardDailyGoal = moduleKey === "caia" ? getFlashcardDailyGoalProgress("caia") : null;
  const correct = getModuleCorrectCount(state.progress, moduleKey);
  const incorrect = getModuleIncorrectCount(state.progress, moduleKey);
  const attempts = getModuleAttemptCount(state.progress, moduleKey);
  const deckStats = moduleKey === "caia" ? (flashcardDeckStats || getFlashcardDeckStats("caia")) : null;

  return `
    <section class="stat-grid">
      ${renderStatCard("Correct", `${correct}`, `${moduleConfig(moduleKey).title} correct`)}
      ${renderStatCard("Incorrect", `${incorrect}`, `${moduleConfig(moduleKey).title} incorrect`)}
      ${renderStatCard("Attempts", `${attempts}`, "Total answered")}
      ${renderStatCard("Daily Goal", dailyGoal.goal ? `${dailyGoal.completed}/${dailyGoal.goal}` : "None", dailyGoal.goal ? `${dailyGoal.remaining} left today` : "Set a daily target")}
      ${moduleKey === "caia" ? renderStatCard("Flashcards", `${deckStats.total}`, `${flashcardStats.reviewCount} reviews · ${deckStats.uncertain} need review tags`) : ""}
      ${moduleKey === "caia" ? renderStatCard("Flashcard Daily", flashcardDailyGoal.goal ? `${flashcardDailyGoal.completed}/${flashcardDailyGoal.goal}` : "None", flashcardDailyGoal.goal ? `${flashcardDailyGoal.remaining} reviews left today` : "Set a CAIA flashcard daily goal") : ""}
    </section>
  `;
}

function renderGoalForms(moduleKey) {
  const dailyGoal = getModuleDailyGoal(moduleKey);
  const flashcardDailyGoal = moduleKey === "caia" ? getFlashcardDailyGoal("caia") : 0;
  return `
    <div class="goal-form-grid">
      <form class="settings-form goal-form-card" data-form="module-daily-goal">
        <input type="hidden" name="module" value="${moduleKey}">
        <label for="${moduleKey}-daily-goal">Daily Goal for ${moduleConfig(moduleKey).title}</label>
        <input
          class="text-input"
          id="${moduleKey}-daily-goal"
          name="goal"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          value="${dailyGoal || ""}"
          placeholder="Example: 20"
        >
        <button class="primary-button is-block" type="submit">${dailyGoal ? "Update daily goal" : "Save daily goal"}</button>
      </form>
      ${moduleKey === "caia" ? `
        <form class="settings-form goal-form-card" data-form="flashcard-daily-goal">
          <input type="hidden" name="module" value="caia">
          <label for="caia-flashcard-daily-goal">CAIA Flashcard Daily Goal</label>
          <input
            class="text-input"
            id="caia-flashcard-daily-goal"
            name="goal"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            value="${flashcardDailyGoal || ""}"
            placeholder="Example: 25"
          >
          <button class="primary-button is-block" type="submit">${flashcardDailyGoal ? "Update flashcard daily goal" : "Save flashcard daily goal"}</button>
        </form>
      ` : ""}
    </div>
  `;
}

function renderModuleCalendar(moduleKey) {
  const cursor = state.calendarCursorByModule[moduleKey] || currentMonthKey();
  const calendar = getModuleCalendar(state.progress, moduleKey, cursor);
  const dailyGoal = getModuleDailyGoal(moduleKey);
  const today = getModuleDailyGoalProgress(moduleKey);
  const activeDays = calendar.days.filter((day) => day.inMonth && day.totalItems > 0).length;
  const goalHitDays = dailyGoal
    ? calendar.days.filter((day) => day.inMonth && day.totalItems >= dailyGoal).length
    : 0;
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return `
    <section class="settings-card">
      <div class="calendar-toolbar">
        <div>
          <h3 class="section-heading">Study Calendar</h3>
          <p class="muted-copy">${escapeHtml(calendar.monthLabel)} · ${escapeHtml(moduleConfig(moduleKey).title)}</p>
        </div>
        <div class="calendar-nav">
          <button class="ghost-button" data-action="calendar-prev" data-module="${moduleKey}" aria-label="Previous month">Prev</button>
          <button class="ghost-button" data-action="calendar-next" data-module="${moduleKey}" aria-label="Next month">Next</button>
        </div>
      </div>
      <div class="calendar-summary">
        <div class="history-item">
          <strong>Today</strong>
          <span class="muted-copy">
            ${dailyGoal ? `${today.completed}/${dailyGoal} items` : `${today.completed} items studied`}
          </span>
        </div>
        <div class="history-item">
          <strong>Active Days</strong>
          <span class="muted-copy">${activeDays} day(s) with study activity</span>
        </div>
        <div class="history-item">
          <strong>Goal Hits</strong>
          <span class="muted-copy">${dailyGoal ? `${goalHitDays} day(s) hit the goal` : "Set a daily goal to track hits"}</span>
        </div>
      </div>
      <div class="calendar-shell">
        <div class="calendar-weekdays">
          ${weekdayLabels.map((label) => `<span>${label}</span>`).join("")}
        </div>
        <div class="calendar-grid">
          ${calendar.days.map((day) => {
            const status = dailyGoal
              ? day.totalItems >= dailyGoal
                ? "Goal hit"
                : `${Math.max(dailyGoal - day.totalItems, 0)} left`
              : day.totalItems
                ? "Studied"
                : "Rest";
            return `
              <article class="calendar-cell ${day.inMonth ? "" : "is-outside"} ${day.isToday ? "is-today" : ""} ${day.totalItems ? "has-activity" : ""} ${dailyGoal && day.totalItems >= dailyGoal ? "is-goal-hit" : ""}">
                <div class="calendar-cell-top">
                  <span class="calendar-day-number">${day.dayNumber}</span>
                  ${day.isToday ? `<span class="calendar-pill">Today</span>` : ""}
                </div>
                <p class="calendar-total">${day.totalItems}</p>
                <div class="calendar-badges">
                  ${day.questionAttempts ? `<span>${day.questionAttempts}Q</span>` : ""}
                  ${day.flashcardReviews ? `<span>${day.flashcardReviews}F</span>` : ""}
                </div>
                <p class="calendar-note">${escapeHtml(status)}</p>
              </article>
            `;
          }).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderModuleFilters(moduleKey, filters) {
  if (moduleKey === "caia") {
    return `
      <div class="stack-row">
        <div>
          <p class="small-heading">Question Module</p>
          <div class="inline-list">
            ${getQuestionCurriculumModuleOptions(moduleKey).map((curriculumModule) => renderFilterChip(moduleKey, "questionCurriculumModule", filters.questionCurriculumModule, curriculumModule)).join("")}
          </div>
        </div>
        <div>
          <p class="small-heading">Reading Area</p>
          <div class="inline-list">
            ${getTopicOptions(moduleKey).map((topic) => renderFilterChip(moduleKey, "topic", filters.topic, topic)).join("")}
          </div>
        </div>
        <div>
          <p class="small-heading">Level</p>
          <div class="inline-list">
            ${getLevelOptions(moduleKey).map((level) => renderFilterChip(moduleKey, "level", filters.level, level)).join("")}
          </div>
        </div>
        <div>
          <p class="small-heading">Question Review</p>
          <button class="filter-chip ${filters.flaggedOnly ? "is-active" : ""}" data-action="set-filter" data-module="caia" data-filter="flaggedOnly" data-value="${(!filters.flaggedOnly).toString()}">
            ${filters.flaggedOnly ? "Flagged only" : "All questions"}
          </button>
        </div>
        <div>
          <p class="small-heading">Flashcard Module</p>
          <div class="inline-list">
            ${getCurriculumModuleOptions(moduleKey).map((curriculumModule) => renderFilterChip(moduleKey, "curriculumModule", filters.curriculumModule, curriculumModule)).join("")}
          </div>
        </div>
        <div>
          <p class="small-heading">Flashcard Tags</p>
          <button class="filter-chip ${filters.uncertainOnly ? "is-active" : ""}" data-action="set-filter" data-module="caia" data-filter="uncertainOnly" data-value="${(!filters.uncertainOnly).toString()}">
            ${filters.uncertainOnly ? "Needs review only" : "All flashcards"}
          </button>
        </div>
      </div>
    `;
  }

  if (moduleKey === "gmat") {
    return `
      <div class="stack-row">
        <div>
          <p class="small-heading">Question Type</p>
          <div class="inline-list">
            ${getTopicOptions(moduleKey).map((topic) => renderFilterChip(moduleKey, "topic", filters.topic, topic)).join("")}
          </div>
        </div>
        <div>
          <p class="small-heading">Difficulty</p>
          <div class="inline-list">
            ${getDifficultyOptions(moduleKey).map((difficulty) => renderFilterChip(moduleKey, "difficulty", filters.difficulty, difficulty)).join("")}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div>
      <p class="small-heading">Topic</p>
      <div class="inline-list">
        ${getTopicOptions(moduleKey).map((topic) => renderFilterChip(moduleKey, "topic", filters.topic, topic)).join("")}
      </div>
    </div>
  `;
}

function renderFilterChip(moduleKey, filterName, activeValue, value) {
  const label = value === "all" ? "All" : value;
  return `
    <button
      class="filter-chip ${activeValue === value ? "is-active" : ""}"
      data-action="set-filter"
      data-module="${moduleKey}"
      data-filter="${filterName}"
      data-value="${escapeHtml(value)}"
    >${escapeHtml(label)}</button>
  `;
}

function renderQuizScreen() {
  if (!state.session) {
    return `<section class="stat-card"><p class="empty-copy">No active session yet.</p></section>`;
  }

  if (isFinished(state.session)) {
    return renderSummaryScreen();
  }

  const question = getCurrentQuestion(state.session);
  const config = moduleConfig(state.session.module);
  const currentNumber = state.session.currentIndex + 1;
  const total = state.session.questions.length;
  const accuracy = getModuleAccuracy(state.progress, state.session.module);
  const flagged = isFlagged(state.progress, question.id);
  const availability = getAIAvailability();
  const dailyGoal = getModuleDailyGoalProgress(state.session.module);
  const trickVisible = Boolean(state.session.ui.showTrickFor[question.id]);
  const answerVisible = Boolean(state.session.ui.revealedAnswerFor[question.id]);
  const lastEvaluation = state.session.lastQuestionId === question.id ? state.session.lastEvaluation : null;
  const awaitingContinue = isAwaitingContinue(question.id);

  return `
    <section class="question-card ${lastEvaluation ? `is-${lastEvaluation.correct ? "correct" : "incorrect"}` : ""}" data-swipeable="question">
      <div class="question-meta">
        <span class="pill">${config.title}</span>
        <span class="pill">${currentNumber}/${total}</span>
        ${state.session.module === "caia" && question.curriculum_module ? `<span class="pill">${escapeHtml(question.curriculum_module)}</span>` : ""}
        <span class="pill">${escapeHtml(question.topic)}</span>
        ${state.session.module === "caia" && question.subtopic ? `<span class="pill">${escapeHtml(question.subtopic)}</span>` : ""}
        <span class="pill">${escapeHtml(question.difficulty || "mixed")}</span>
      </div>
      <div class="progress-bar"><span style="width: ${(currentNumber / total) * 100}%"></span></div>
      <div class="question-meta">
        <span class="tag">Module accuracy ${percent(accuracy)}</span>
        ${dailyGoal.goal ? `<span class="tag">Today ${dailyGoal.completed}/${dailyGoal.goal}</span>` : ""}
        ${renderTimerPill(question)}
        ${flagged ? `<span class="tag">Flagged</span>` : ""}
        ${awaitingContinue ? `<span class="tag">Ready to continue</span>` : ""}
      </div>
      <h2 class="question-stem">${escapeHtml(question.stem)}</h2>
      ${renderQuestionInput(question, awaitingContinue)}
      ${lastEvaluation && state.session.answerMode === "instant" ? renderEvaluation(question, lastEvaluation) : ""}
      ${question.module === "pe" && trickVisible ? `
        <div class="result-banner is-correct">
          <strong>Shortcut</strong>
          <div>${escapeHtml(question.trick || question.explanation)}</div>
        </div>
      ` : ""}
      ${state.aiPanel.title ? renderAIPanel() : ""}
      <div class="question-actions">
        ${awaitingContinue ? `<button class="primary-button" data-action="continue-question">Continue</button>` : `<button class="ghost-button" data-action="skip-question">Skip</button>`}
        <button class="ghost-button" data-action="flag-question">${flagged ? "Unflag" : "Flag"}</button>
        ${question.module === "energy" ? `<button class="ghost-button" data-action="open-formula">Formula</button>` : ""}
        ${question.module === "pe" ? `<button class="ghost-button" data-action="show-trick">${trickVisible ? "Hide Trick" : "Show Trick"}</button>` : ""}
        ${question.module === "pe" ? `<button class="ghost-button" data-action="reveal-answer">Reveal Answer</button>` : ""}
      </div>
      ${answerVisible && !lastEvaluation ? `
        <div class="result-banner is-correct">
          <strong>Answer</strong>
          <div>${formatCorrectAnswer(question)}</div>
        </div>
      ` : ""}
      <div class="question-actions">
        <button class="secondary-button" data-action="ai-explain" ${availability.enabled ? "" : "disabled"}>${availability.enabled ? "AI Explain" : availability.label}</button>
        <button class="secondary-button" data-action="ai-generate" ${availability.enabled ? "" : "disabled"}>${availability.enabled ? "Generate Similar" : availability.label}</button>
        ${question.type === "numeric"
          ? `<button class="secondary-button" data-action="ai-worked" ${availability.enabled ? "" : "disabled"}>${availability.enabled ? "Worked Solution" : availability.label}</button>`
          : ""
        }
        <button class="ghost-button" data-action="toggle-ai-chat">${state.aiChat.open ? "Hide Ask AI" : "Ask AI"}</button>
      </div>
      ${state.aiChat.open ? renderAIChatPanel(question, answerVisible || Boolean(lastEvaluation)) : ""}
      <p class="support-copy">Swipe left to skip, swipe right to flag for review.</p>
    </section>
    ${state.adminMode ? renderAdminPanel(state.session.module) : ""}
  `;
}

function renderFlashcardScreen() {
  if (!state.flashcardSession) {
    return `<section class="stat-card"><p class="empty-copy">No flashcard session yet.</p></section>`;
  }

  if (state.flashcardSession.finishedAt) {
    return renderFlashcardSummary();
  }

  const card = getCurrentFlashcard();
  const currentNumber = state.flashcardSession.currentIndex + 1;
  const total = state.flashcardSession.cards.length;
  const flashcardStats = getFlashcardStats(state.progress, "caia");
  const flashcardDailyGoal = getFlashcardDailyGoalProgress("caia");
  const curriculumModule = card.curriculum_module || card.topic || "CAIA";
  const front = getEditedFlashcardFront(card);
  const editOpen = state.flashcardEditor.open && state.flashcardEditor.cardId === card.id;
  const frontEdited = hasEditedFlashcardFront(card);

  return `
    <section class="question-card">
      <div class="question-meta">
        <span class="pill">CAIA Flashcards</span>
        <span class="pill">${currentNumber}/${total}</span>
        <span class="pill">${escapeHtml(curriculumModule)}</span>
        <span class="pill">${escapeHtml(card.level || "All levels")}</span>
        ${card.source_number ? `<span class="pill">Card ${card.source_number}</span>` : ""}
      </div>
      <div class="progress-bar"><span style="width: ${(currentNumber / total) * 100}%"></span></div>
      <div class="question-meta">
        <span class="tag">${flashcardStats.reviewCount} total reviews</span>
        <span class="tag">Avg ${flashcardStats.avgRating ? flashcardStats.avgRating.toFixed(1) : "0.0"}/5</span>
        ${flashcardDailyGoal.goal ? `<span class="tag">Today ${flashcardDailyGoal.completed}/${flashcardDailyGoal.goal}</span>` : ""}
        ${frontEdited ? `<span class="tag">Front edited</span>` : ""}
        ${card.uncertain ? `<span class="tag">Needs tag review</span>` : ""}
      </div>
      <h2 class="question-stem">${escapeHtml(front)}</h2>
      <div class="question-actions">
        <button class="ghost-button" data-action="toggle-flashcard-front-edit">${editOpen ? "Hide edit" : "Edit front text"}</button>
        ${frontEdited ? `<button class="ghost-button" data-action="reset-flashcard-front-edit">Reset front</button>` : ""}
      </div>
      ${editOpen ? `
        <form class="settings-form" data-form="flashcard-front-edit">
          <label for="flashcard-front-edit">Edit the front prompt</label>
          <textarea class="text-input" id="flashcard-front-edit" name="front" rows="4" placeholder="Rewrite the front text so it is complete and readable.">${escapeHtml(state.flashcardEditor.draft)}</textarea>
          <div class="question-actions">
            <button class="primary-button" type="submit">Save front</button>
            <button class="ghost-button" type="button" data-action="cancel-flashcard-front-edit">Cancel</button>
          </div>
        </form>
      ` : ""}
      <div class="result-banner ${state.flashcardSession.revealed ? "is-correct" : ""}">
        ${state.flashcardSession.revealed
          ? `<strong>Back</strong><div>${escapeHtml(card.back)}</div>`
          : `<strong>Front</strong><div>Think it through, then reveal the answer.</div>`
        }
      </div>
      ${card.uncertain ? `
        <div class="result-banner is-incorrect">
          <strong>Review tag</strong>
          <div>This card was auto-tagged and may need a quick manual check against the curriculum module.</div>
        </div>
      ` : ""}
      ${state.flashcardSession.revealed ? `
        <div class="option-list">
          ${[
            { value: 1, label: "1 · Missed it" },
            { value: 2, label: "2 · Hard recall" },
            { value: 3, label: "3 · Partial" },
            { value: 4, label: "4 · Good recall" },
            { value: 5, label: "5 · Easy recall" }
          ].map((item) => `
            <button class="option-button" data-action="rate-flashcard" data-rating="${item.value}">${item.label}</button>
          `).join("")}
        </div>
      ` : `
        <button class="primary-button is-block" data-action="flip-flashcard">Reveal Answer</button>
      `}
      <p class="support-copy">Ratings 4-5 count as strong recall, 1-2 count as misses, and 3 captures partial recall.</p>
    </section>
    ${state.adminMode ? renderFlashcardAdminPanel() : ""}
  `;
}

function renderFlashcardSummary() {
  const reviews = state.flashcardSession.reviews;
  const correctLike = reviews.filter((entry) => entry.correctLike).length;
  const incorrectLike = reviews.filter((entry) => entry.incorrectLike).length;
  const avgRating = reviews.length
    ? reviews.reduce((sum, entry) => sum + entry.rating, 0) / reviews.length
    : 0;
  const flashcardDailyGoal = getFlashcardDailyGoalProgress("caia");

  return `
    <section class="summary-card">
      <div class="module-meta">
        <span class="pill">CAIA Flashcards</span>
        <span class="pill">${reviews.length} cards</span>
      </div>
      <h2 class="summary-score">${avgRating.toFixed(1)}/5</h2>
      <p class="muted-copy">${correctLike} strong recall · ${incorrectLike} misses · ${state.progress.streak} day streak</p>
      ${flashcardDailyGoal.goal ? `<p class="muted-copy">Flashcards today: ${flashcardDailyGoal.completed}/${flashcardDailyGoal.goal}</p>` : ""}
      <div class="summary-actions">
        <button class="primary-button" data-action="open-flashcards" data-module="caia">Run another deck</button>
        <button class="secondary-button" data-action="open-module" data-module="caia">Back to CAIA</button>
      </div>
    </section>
    <section class="session-review">
      <h3 class="section-heading">Flashcard Review</h3>
      <div class="review-list">
        ${reviews.map((entry, index) => `
          <div class="review-item">
            <strong>Card ${index + 1} · ${escapeHtml(entry.card.curriculum_module || entry.card.topic || "CAIA")}</strong>
            <span class="muted-copy">Rating ${entry.rating}/5</span>
            <p class="muted-copy">${escapeHtml(getEditedFlashcardFront(entry.card))}</p>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderTimerPill(question) {
  if (state.session.module === "gmat") {
    return `<span class="tag js-timer" data-mode="countdown" data-limit="${getQuestionTimer(question, "gmat")}">Timer</span>`;
  }
  if (state.session.module === "pe") {
    return `<span class="tag js-timer" data-mode="elapsed" data-limit="${question.timer_sec || 60}">Speed</span>`;
  }
  return "";
}

function renderQuestionInput(question, locked = false) {
  if (locked) {
    return `
      <div class="result-banner is-correct">
        <strong>Answer submitted.</strong>
        <div>Read through the feedback, then tap Continue when you are ready.</div>
      </div>
    `;
  }

  if (question.type === "numeric") {
    return `
      <form class="numeric-form" data-form="numeric-answer">
        <label for="answer-input" class="small-heading">Your answer</label>
        <input class="text-input" id="answer-input" name="answer" inputmode="decimal" autocomplete="off" placeholder="Enter numeric answer">
        <button class="primary-button is-block" type="submit">Submit Answer</button>
      </form>
    `;
  }

  if (question.type === "text") {
    return `
      <form class="numeric-form" data-form="numeric-answer">
        <label for="answer-input" class="small-heading">Your answer</label>
        <input class="text-input" id="answer-input" name="answer" autocomplete="off" placeholder="Type your answer">
        <button class="primary-button is-block" type="submit">Submit Answer</button>
      </form>
    `;
  }

  if (question.type === "open") {
    const answerVisible = Boolean(state.session?.ui.revealedAnswerFor[question.id]);
    if (!answerVisible) {
      return `
        <button class="primary-button is-block" data-action="reveal-answer">Reveal Suggested Answer</button>
      `;
    }

    return `
      <div class="option-list">
        <button class="option-button" data-action="grade-open-question" data-correct="true">I got it</button>
        <button class="option-button" data-action="grade-open-question" data-correct="false">I missed it</button>
      </div>
    `;
  }

  return `
    <div class="option-list">
      ${(question.options || []).map((option, index) => `
        <button class="option-button" data-action="answer-option" data-value="${index}">
          <strong>${String.fromCharCode(65 + index)}.</strong> ${escapeHtml(option)}
        </button>
      `).join("")}
    </div>
  `;
}

function renderEvaluation(question, evaluation) {
  if (question.type === "open") {
    return `
      <div class="result-banner ${evaluation.correct ? "is-correct" : "is-incorrect"}">
        <strong>${evaluation.correct ? "Marked correct." : "Marked for review."}</strong>
        <div>${formatCorrectAnswer(question)}</div>
        <div>${escapeHtml(question.explanation)}</div>
      </div>
    `;
  }

  if (evaluation.correct) {
    return `
      <div class="result-banner is-correct">
        <strong>Correct.</strong>
        <div>${formatCorrectAnswer(question)}</div>
        <div>${escapeHtml(question.explanation)}</div>
      </div>
    `;
  }

  return `
    <div class="result-banner is-incorrect">
      <strong>Not quite.</strong>
      <div>${formatCorrectAnswer(question)}</div>
      <div>${escapeHtml(question.explanation)}</div>
    </div>
  `;
}

function formatCorrectAnswer(question) {
  if (question.type === "numeric") {
    return `Correct answer: ${escapeHtml(question.answer)}${question.tolerance_pct ? ` (tolerance ±${question.tolerance_pct}%)` : ""}`;
  }
  if (question.type === "open") {
    return `Suggested answer: ${escapeHtml(question.answer)}`;
  }
  if (question.type === "text") {
    return `Correct answer: ${escapeHtml(question.answer)}`;
  }
  return `Correct answer: ${escapeHtml(question.options[question.answer])}`;
}

function renderAIPanel() {
  const panel = state.aiPanel;
  return `
    <section class="ai-panel">
      <p class="small-heading">${escapeHtml(panel.title)}</p>
      ${panel.loading ? `<p class="muted-copy">Working...</p>` : ""}
      ${panel.error ? `<div class="result-banner is-incorrect">${escapeHtml(panel.error)}</div>` : ""}
      ${panel.text ? `<div class="muted-copy">${multilineHtml(panel.text)}</div>` : ""}
    </section>
  `;
}

function renderAIChatPanel(question, answerVisible) {
  const availability = getAIAvailability();
  return `
    <section class="ai-panel chat-panel">
      <div class="chat-toolbar">
      <div>
          <p class="small-heading">Ask AI</p>
          <p class="muted-copy">
            ${answerVisible
              ? `AI can discuss the answer directly for ${escapeHtml(question.topic)}.`
              : `AI will stay hint-first for ${escapeHtml(question.topic)} until you reveal or submit the answer.`}
          </p>
        </div>
        <button class="ghost-button" data-action="reset-ai-chat">Clear Chat</button>
      </div>
      ${state.aiChat.messages.length ? `
        <div class="chat-log">
          ${state.aiChat.messages.map((message) => `
            <article class="chat-bubble ${message.role === "user" ? "is-user" : "is-assistant"}">
              <strong>${message.role === "user" ? "You" : "Claude"}</strong>
              <div>${multilineHtml(message.text)}</div>
            </article>
          `).join("")}
        </div>
      ` : `
        <div class="result-banner is-correct">
          <strong>Question chat is ready.</strong>
          <div>Ask for a hint, ask why an option is wrong, or paste your own wording of the question.</div>
        </div>
      `}
      ${!availability.enabled ? `<div class="result-banner is-incorrect">${escapeHtml(availability.label)}</div>` : ""}
      ${state.aiChat.error ? `<div class="result-banner is-incorrect">${escapeHtml(state.aiChat.error)}</div>` : ""}
      <form class="chat-form" data-form="ai-chat">
        <label for="ai-chat-prompt" class="small-heading">Your prompt</label>
        <textarea
          class="text-input textarea-input"
          id="ai-chat-prompt"
          name="prompt"
          rows="4"
          placeholder="Ask for a hint, a step-by-step check, or type the exact question you want help with."
          ${availability.enabled && !state.aiChat.loading ? "" : "disabled"}
        ></textarea>
        <button class="primary-button is-block" type="submit" ${availability.enabled && !state.aiChat.loading ? "" : "disabled"}>
          ${state.aiChat.loading ? "Asking Claude..." : availability.enabled ? "Send to Claude" : availability.label}
        </button>
      </form>
    </section>
  `;
}

function renderSummaryScreen() {
  const summary = getSummary(state.session);
  const config = moduleConfig(state.session.module);

  return `
    <section class="summary-card">
      <div class="module-meta">
        <span class="pill">${config.title}</span>
        <span class="pill">${summary.total} questions</span>
      </div>
      <h2 class="summary-score">${summary.score}/${summary.total}${state.session.module === "pe" ? ` +${summary.speedBonus} speed` : ""}</h2>
      <p class="muted-copy">Finished in ${Math.round(summary.durationSec / 60)} minute(s). Streak is now ${state.progress.streak} day(s).</p>
      <div class="summary-actions">
        <button class="primary-button" data-action="start-session" data-module="${state.session.module}" data-size="5" data-source="restart">Run another session</button>
        <button class="secondary-button" data-action="open-module" data-module="${state.session.module}">Back to module</button>
      </div>
    </section>
    <section class="session-review">
      <h3 class="section-heading">Session Review</h3>
      <div class="review-list">
        ${state.session.answers.map((answer, index) => `
          <div class="review-item">
            <strong>Q${index + 1} · ${escapeHtml(answer.question.topic)}</strong>
            <span class="muted-copy">${answer.correct ? "Correct" : answer.skipped ? "Skipped" : "Incorrect"} · ${answer.elapsedSec}s</span>
            ${state.session.answerMode === "session_end" || !answer.correct ? `
              <p class="muted-copy">${formatCorrectAnswer(answer.question)}</p>
              <p class="muted-copy">${escapeHtml(answer.question.explanation)}</p>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCloudSyncCard() {
  const availability = getSupabaseAvailability();
  const userEmail = state.cloud.user?.email || "";
  const lastSynced = state.cloud.lastSyncedAt
    ? new Date(state.cloud.lastSyncedAt).toLocaleString()
    : "Not synced yet";

  return `
    <section class="settings-card">
      <h3 class="section-heading">Cloud Sync</h3>
      <p class="muted-copy">Use Supabase to sync progress and settings between your laptop and phone.</p>
      <div class="result-banner ${availability.enabled ? "is-correct" : "is-incorrect"}">
        ${escapeHtml(availability.label)}
      </div>
      ${!availability.enabled && availability.label === "Fill js/config.js first"
        ? `<p class="support-copy">Add your Supabase project URL and anon key in js/config.js first.</p>`
        : ""
      }
      ${state.cloud.error ? `<div class="result-banner is-incorrect">${escapeHtml(state.cloud.error)}</div>` : ""}
      ${state.cloud.user ? `
        <div class="summary-list">
          <div class="history-item">
            <strong>${escapeHtml(userEmail || "Signed in")}</strong>
            <span class="muted-copy">Last cloud sync: ${escapeHtml(lastSynced)}</span>
          </div>
        </div>
        <div class="settings-actions">
          <button class="secondary-button" data-action="cloud-pull" ${state.cloud.loading || !availability.enabled ? "disabled" : ""}>Pull from cloud</button>
          <button class="secondary-button" data-action="cloud-push" ${state.cloud.syncing || !availability.enabled ? "disabled" : ""}>Push to cloud</button>
          <button class="ghost-button" data-action="cloud-sign-out">Sign out</button>
        </div>
      ` : `
        <form class="settings-form" data-form="cloud-auth">
          <label for="cloud-email">Email for magic-link sign in</label>
          <input class="text-input" id="cloud-email" name="email" type="email" placeholder="you@example.com" ${availability.enabled ? "" : "disabled"}>
          <button class="primary-button is-block" type="submit" ${state.cloud.loading || !availability.enabled ? "disabled" : ""}>
            ${state.cloud.loading ? "Sending magic link..." : "Send magic link"}
          </button>
        </form>
      `}
      <p class="support-copy">Current beta sync covers progress and settings. Your AI key still stays local on each device for now.</p>
    </section>
  `;
}

function renderSettingsScreen() {
  const availability = getAIAvailability();
  return `
    ${renderCloudSyncCard()}
    <section class="settings-card">
      <h2 class="screen-title">Settings</h2>
      <p class="muted-copy">Local settings only. Your API key stays in this browser under an rb_ key.</p>
      <form class="settings-form" data-form="api-key">
        <label for="api-key">Anthropic API Key</label>
        <input class="text-input" id="api-key" name="apiKey" value="${escapeHtml(getApiKey())}" placeholder="sk-ant-...">
        <button class="primary-button is-block" type="submit">Save API Key</button>
      </form>
      <div class="settings-actions">
        <button class="secondary-button" data-action="clear-api-key">Clear API Key</button>
        <button class="ghost-button" data-action="reset-progress">Reset Progress</button>
      </div>
      <div class="result-banner ${availability.enabled ? "is-correct" : "is-incorrect"}">
        ${availability.enabled ? "AI is ready when you are online." : escapeHtml(availability.label)}
      </div>
    </section>
    <section class="settings-card">
      <h3 class="section-heading">Offline Strategy</h3>
      <p class="muted-copy">Question banks, styles, icons, and JS modules are precached by the Service Worker. AI actions are gated offline and the quiz engine keeps running.</p>
      <div class="summary-list">
        <div class="history-item"><strong>Install</strong><span class="muted-copy">Safari Share Sheet → Add to Home Screen</span></div>
        <div class="history-item"><strong>Progress</strong><span class="muted-copy">Saved in localStorage under rb_progress</span></div>
        <div class="history-item"><strong>Theme</strong><span class="muted-copy">Dark-only palette tuned for iPhone usage</span></div>
      </div>
    </section>
  `;
}

function renderInstallBanner() {
  const dismissed = localStorage.getItem(INSTALL_BANNER_KEY);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (!isIOS || isStandalone || dismissed) {
    return "";
  }

  return `
    <section class="install-banner">
      <div>
        <strong>Add RB Revision to your home screen.</strong>
        <p class="muted-copy">Open this page in Safari, tap Share, then choose Add to Home Screen.</p>
      </div>
      <div class="banner-actions">
        <button class="secondary-button" data-action="dismiss-install-banner">Hide</button>
      </div>
    </section>
  `;
}

function renderFormulaSheet() {
  return `
    <div class="sheet ${state.sheet.open ? "is-visible" : ""}">
      <button class="sheet-backdrop" data-action="close-sheet" aria-label="Close formula sheet"></button>
      <section class="sheet-panel">
        <h3>${escapeHtml(state.sheet.title)}</h3>
        ${state.sheet.html || `<div class="sheet-copy muted-copy">${multilineHtml(state.sheet.body)}</div>`}
        <button class="primary-button is-block" data-action="close-sheet">Close</button>
      </section>
    </div>
  `;
}

function renderToast() {
  return `<div class="toast ${state.toast ? "is-visible" : ""}">${escapeHtml(state.toast)}</div>`;
}

function renderCelebration() {
  if (!state.celebration) {
    return "";
  }
  return `
    <div class="celebration">
      <div class="celebration-card">
        <div class="brand-mark">★</div>
        <h2>${escapeHtml(state.celebration)}</h2>
        <p class="muted-copy">Momentum compounds. Keep the streak alive.</p>
      </div>
    </div>
  `;
}

function renderBottomNav() {
  const currentModule = state.route.module;
  const currentView = state.route.view;
  const navItems = [
    { key: "home", label: "Home", hash: buildHash("home"), active: currentView === "home" || currentView === "settings" },
    { key: "pe", label: "PE", hash: buildHash("module", "pe"), active: currentModule === "pe" },
    { key: "energy", label: "Energy", hash: buildHash("module", "energy"), active: currentModule === "energy" },
    { key: "caia", label: "CAIA", hash: buildHash("module", "caia"), active: currentModule === "caia" },
    { key: "gmat", label: "GMAT", hash: buildHash("module", "gmat"), active: currentModule === "gmat" }
  ];

  return `
    <nav class="bottom-nav" aria-label="Primary">
      <div class="bottom-nav__rail">
        ${navItems.map((item) => `
          <a class="nav-link ${item.active ? "is-active" : ""}" href="${item.hash}">
            <strong>${item.key === "home" ? "⌂" : MODULES[item.key].icon}</strong>
            <span>${item.label}</span>
          </a>
        `).join("")}
      </div>
    </nav>
  `;
}

function renderStatCard(title, value, label) {
  return `
    <article class="stat-card">
      <p class="stat-value">${escapeHtml(value)}</p>
      <p class="stat-label">${escapeHtml(title)}</p>
      <p class="support-copy">${escapeHtml(label)}</p>
    </article>
  `;
}

function renderAdminPanel(moduleKey) {
  return `
    <section class="admin-panel">
      <h3 class="section-heading">Admin JSON</h3>
      <p class="muted-copy">Hidden via triple tap on the header.</p>
      <pre>${escapeHtml(JSON.stringify(getQuestions(moduleKey), null, 2))}</pre>
    </section>
  `;
}

function renderFlashcardAdminPanel() {
  return `
    <section class="admin-panel">
      <h3 class="section-heading">Admin JSON</h3>
      <p class="muted-copy">Hidden via triple tap on the header.</p>
      <pre>${escapeHtml(JSON.stringify(getFlashcards("caia"), null, 2))}</pre>
    </section>
  `;
}

function setupTimer() {
  if (!state.session || isFinished(state.session)) {
    return;
  }

  const timerElement = appRoot.querySelector(".js-timer");
  if (!timerElement) {
    return;
  }

  const update = () => {
    const question = getCurrentQuestion(state.session);
    const elapsed = getCurrentElapsedSec(state.session);
    if (!question) {
      return;
    }

    if (timerElement.dataset.mode === "countdown") {
      const limit = Number(timerElement.dataset.limit);
      const remaining = Math.max(0, limit - elapsed);
      timerElement.textContent = `Timer ${formatSeconds(remaining)}`;
      if (remaining <= 0) {
        skipCurrentQuestion("Time expired.");
      }
      return;
    }

    const target = Number(timerElement.dataset.limit);
    timerElement.textContent = `Speed ${formatSeconds(elapsed)} / ${formatSeconds(target)}`;
  };

  update();
  state.timerInterval = window.setInterval(update, 1000);
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

boot();
