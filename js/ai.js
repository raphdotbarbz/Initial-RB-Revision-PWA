const API_KEY_STORAGE = "rb_api_key";
const MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";

function cleanJsonFence(text) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractText(payload) {
  return (payload.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n\n")
    .trim();
}

function buildSystemPrompt(module, { question = null, answerVisible = true } = {}) {
  return [
    `You are a professional tutor for ${module}. Be concise, precise, and teach the underlying principle, not just the answer.`,
    answerVisible
      ? "The learner can already see the answer, so you may discuss it openly."
      : "The learner has not yet been shown the answer. Do not reveal the final answer or correct option unless they explicitly ask for a spoiler. Prefer hints, checks on reasoning, and the next best step.",
    question ? `Current question context:\n${buildQuestionContext(question)}` : ""
  ].filter(Boolean).join("\n\n");
}

function buildQuestionContext(question) {
  return JSON.stringify(
    {
      id: question.id,
      module: question.module,
      type: question.type,
      topic: question.topic,
      subtopic: question.subtopic,
      difficulty: question.difficulty,
      level: question.level,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      explanation: question.explanation,
      trick: question.trick,
      formula_ref: question.formula_ref,
      tolerance_pct: question.tolerance_pct
    },
    null,
    2
  );
}

export function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

export function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

export function clearApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
}

export function getAIAvailability() {
  if (!navigator.onLine) {
    return { enabled: false, label: "AI — requires connection" };
  }
  if (!getApiKey()) {
    return { enabled: false, label: "Set API key" };
  }
  return { enabled: true, label: "AI ready" };
}

function normalizeMessages(messages) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: `${message.text || message.content || ""}`.trim()
  })).filter((message) => message.content);
}

async function callAnthropic({ module, prompt, messages = null, temperature, question = null, answerVisible = true }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Add your Anthropic API key in Settings first.");
  }

  const normalizedMessages = messages?.length
    ? normalizeMessages(messages)
    : [
      {
        role: "user",
        content: prompt
      }
    ];

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        temperature,
        system: buildSystemPrompt(module, { question, answerVisible }),
        messages: normalizedMessages
      })
    });
  } catch (error) {
    throw new Error("Network request failed. Check your connection, confirm the API key is valid, and make sure your Anthropic account has billing enabled.");
  }

  if (!response.ok) {
    const message = await response.text();
    try {
      const parsed = JSON.parse(message);
      throw new Error(parsed.error?.message || parsed.message || "Anthropic request failed.");
    } catch {
      throw new Error(message || "Anthropic request failed.");
    }
  }

  const payload = await response.json();
  return extractText(payload);
}

export async function explainQuestion(question) {
  return callAnthropic({
    module: question.module,
    question,
    temperature: 0.3,
    prompt: [
      "Explain this question.",
      "Cover why the correct answer is right, why each distractor is wrong if options exist, and the underlying concept.",
      buildQuestionContext(question)
    ].join("\n\n")
  });
}

export async function workedSolution(question) {
  return callAnthropic({
    module: question.module,
    question,
    temperature: 0.3,
    prompt: [
      "Show a worked solution for this numeric question.",
      "If there is a shortcut or trick, include that too and explain why it works.",
      buildQuestionContext(question)
    ].join("\n\n")
  });
}

export async function generateSimilarQuestion(question) {
  const text = await callAnthropic({
    module: question.module,
    question,
    temperature: 0.7,
    prompt: [
      "Generate one new question of the same type, topic, and difficulty.",
      "Return only valid JSON matching this schema:",
      "{ id, module, type, topic, subtopic, difficulty, level, stem, options, answer, explanation, formula_ref, tolerance_pct, trick }",
      "Allowed types are mcq, numeric, text, and open.",
      "For numeric and open questions set options to null. For open questions, store the suggested answer in answer. Keep the same module as the source question.",
      buildQuestionContext(question)
    ].join("\n\n")
  });

  const parsed = JSON.parse(cleanJsonFence(text));
  return {
    ...question,
    ...parsed,
    id: parsed.id || `${question.module}_${Date.now()}`,
    module: question.module
  };
}

export async function chatAboutQuestion(question, messages, { answerVisible = false } = {}) {
  return callAnthropic({
    module: question.module,
    question,
    answerVisible,
    temperature: 0.5,
    messages
  });
}
