#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";
const OUTPUT_PATH = path.resolve(__dirname, "..", "data", "gmat.json");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--")) {
      args[key.slice(2)] = value;
    }
  }
  return args;
}

function buildPrompt({ type, difficulty, count }) {
  return [
    `Generate ${count} GMAT questions.`,
    `Question type: ${type}. Difficulty: ${difficulty}.`,
    "Return only valid JSON as an array.",
    "Each item must follow this schema:",
    "{ id, module, type, topic, subtopic, difficulty, level, stem, options, answer, explanation, formula_ref, tolerance_pct, timer_sec }",
    "Use module='gmat' and type='mcq'.",
    "Set topic to one of PS, DS, CR, RC, or SC.",
    "Set subtopic to lowercase code matching the topic.",
    "For DS questions use the standard GMAT answer choice set.",
    "Keep explanations concise and accurate."
  ].join("\n");
}

async function generateQuestions({ apiKey, type, difficulty, count }) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0.7,
      system: "You create high-quality GMAT practice questions and return strict JSON.",
      messages: [{ role: "user", content: buildPrompt({ type, difficulty, count }) }]
    })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  const text = (payload.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const type = (args.type || "cr").toUpperCase();
  const difficulty = (args.difficulty || "medium").toLowerCase();
  const count = Number(args.count || 20);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Set ANTHROPIC_API_KEY before running this script.");
  }

  const existing = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  const generated = await generateQuestions({ apiKey, type, difficulty, count });
  const normalised = generated.map((question, index) => ({
    module: "gmat",
    type: "mcq",
    topic: type,
    subtopic: type.toLowerCase(),
    difficulty,
    level: ["PS", "DS"].includes(type) ? "Quant" : "Verbal",
    formula_ref: null,
    tolerance_pct: null,
    timer_sec: ["PS", "DS"].includes(type) ? 120 : 90,
    ...question,
    id: question.id || `gmat_${Date.now()}_${index + 1}`
  }));

  await fs.writeFile(OUTPUT_PATH, JSON.stringify([...existing, ...normalised], null, 2));
  console.log(`Appended ${normalised.length} questions to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
