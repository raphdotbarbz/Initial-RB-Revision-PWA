#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { parseCsv } = require("./csv_utils");

const SUBJECT_TO_MODULE = {
  "Private Equity": "pe",
  Energy: "energy",
  GMAT: "gmat",
  "CAIA L2": "caia"
};

const MODULE_OUTPUTS = {
  pe: path.resolve(__dirname, "..", "data", "pe.json"),
  energy: path.resolve(__dirname, "..", "data", "energy.json"),
  gmat: path.resolve(__dirname, "..", "data", "gmat.json"),
  caia: path.resolve(__dirname, "..", "data", "caia.json")
};

const DIFFICULTY_TIMERS = {
  easy: 45,
  medium: 60,
  hard: 75
};

const GMAT_TIMERS = {
  ps: 120,
  ds: 120,
  cr: 90,
  rc: 90,
  sc: 90
};

const MCQ_LABEL_PATTERN = /^[A-Z]\s*[\)\.\:\-]\s*/i;
const NUMBER_PATTERN = /[-+]?\d*\.?\d+(?:\/\d+)?/g;

function normalizeCell(value) {
  return `${value || ""}`.replace(/\s+/g, " ").trim();
}

function normalizeDifficulty(value) {
  return (normalizeCell(value) || "medium").toLowerCase();
}

function normalizeOptionText(value) {
  return normalizeCell(value).replace(MCQ_LABEL_PATTERN, "");
}

function canonicalCompare(value) {
  return normalizeOptionText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseOptions(value) {
  return normalizeCell(value)
    .split(/\s*\|\s*|\n+/)
    .map((item) => normalizeOptionText(item))
    .filter(Boolean);
}

function parseMcqAnswerIndex(answer, options) {
  const normalized = normalizeCell(answer);
  if (!normalized) {
    return 0;
  }

  const letterMatch = normalized.match(/^([A-Z])(?:\s*[\)\.\:\-]\s*(.*))?$/i);
  if (letterMatch) {
    const index = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < options.length) {
      const answerText = canonicalCompare(letterMatch[2] || "");
      if (!answerText || answerText === canonicalCompare(options[index])) {
        return index;
      }
    }
  }

  const optionIndex = options.findIndex((option) => canonicalCompare(option) === canonicalCompare(normalized));
  if (optionIndex >= 0) {
    return optionIndex;
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    if (numeric >= 0 && numeric < options.length) {
      return numeric;
    }
    if (numeric >= 1 && numeric <= options.length) {
      return numeric - 1;
    }
  }

  return 0;
}

function parseNumberToken(token) {
  if (!token) {
    return null;
  }
  if (/^-?\d+\/\d+$/.test(token)) {
    const [left, right] = token.split("/").map(Number);
    return right ? left / right : null;
  }
  const parsed = Number(token.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSingleNumericValue(answerText) {
  const matches = normalizeCell(answerText).match(NUMBER_PATTERN) || [];
  if (matches.length !== 1) {
    return null;
  }
  return parseNumberToken(matches[0]);
}

function shouldImportAsNumeric(moduleKey, answerText) {
  if (moduleKey === "caia") {
    return false;
  }

  const normalized = normalizeCell(answerText);
  const matches = normalized.match(NUMBER_PATTERN) || [];
  if (matches.length !== 1) {
    return false;
  }

  const stripped = normalized
    .replace(NUMBER_PATTERN, " ")
    .replace(/[$€£¥,%~≈<>]/g, " ")
    .replace(/[()]/g, " ")
    .replace(
      /\b(?:years?|yrs?|year|days?|day|hours?|hrs?|minutes?|mins?|seconds?|secs?|months?|mos?|weeks?|wk|kva|kw|kvar|mw|mwh|w|v|a|amp|amps|pf|db|thd|x|times|m|mm|bn|b|l|km|ratio|degrees?)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  return !stripped;
}

function getTolerance(answerText) {
  const normalized = normalizeCell(answerText).toLowerCase();
  if (normalized.startsWith("~") || normalized.includes("approx") || normalized.includes("roughly")) {
    return 10;
  }
  return 2;
}

function getTimerSec(moduleKey, topic, difficulty) {
  if (moduleKey === "gmat") {
    return GMAT_TIMERS[(topic || "").trim().toLowerCase()] || 90;
  }
  return DIFFICULTY_TIMERS[difficulty] || 60;
}

function buildBaseQuestion(record, moduleKey) {
  const difficulty = normalizeDifficulty(record.difficulty);
  const topic = normalizeCell(record.topic) || "Imported";

  return {
    id: normalizeCell(record.id) || `${moduleKey}_${Date.now()}`,
    module: moduleKey,
    topic,
    subtopic: moduleKey === "gmat" ? topic.toLowerCase() : topic,
    difficulty,
    level:
      moduleKey === "caia"
        ? "L2"
        : moduleKey === "gmat"
          ? (["PS", "DS"].includes(topic.toUpperCase()) ? "Quant" : "Verbal")
          : null,
    stem: normalizeCell(record.question) || "Imported question",
    options: null,
    answer: "",
    explanation: normalizeCell(record.explanation) || "Imported from revision bank.",
    formula_ref: null,
    tolerance_pct: null,
    timer_sec: getTimerSec(moduleKey, topic, difficulty)
  };
}

function mapRecord(record) {
  const moduleKey = SUBJECT_TO_MODULE[normalizeCell(record.subject)];
  if (!moduleKey) {
    return null;
  }

  const base = buildBaseQuestion(record, moduleKey);
  if (moduleKey === "caia") {
    base.curriculum_module = base.topic;
  }

  const rowType = normalizeCell(record.type).toLowerCase();
  const options = parseOptions(record.options);

  if (rowType === "mcq" || options.length) {
    return {
      ...base,
      type: "mcq",
      options,
      answer: parseMcqAnswerIndex(record.answer, options)
    };
  }

  if (shouldImportAsNumeric(moduleKey, record.answer)) {
    return {
      ...base,
      type: "numeric",
      answer: extractSingleNumericValue(record.answer),
      tolerance_pct: getTolerance(record.answer)
    };
  }

  return {
    ...base,
    type: "open",
    answer: normalizeCell(record.answer) || "See explanation."
  };
}

async function loadJsonArray(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: node scripts/import_revision_questions.js <input.csv>");
  }

  const csv = await fs.readFile(path.resolve(inputPath), "utf8");
  const rows = parseCsv(csv);
  const [headers, ...values] = rows;
  const records = values.map((row) =>
    Object.fromEntries(headers.map((header, index) => [normalizeCell(header), normalizeCell(row[index])]))
  );

  const importedByModule = {
    pe: [],
    energy: [],
    gmat: [],
    caia: []
  };

  for (const record of records) {
    const question = mapRecord(record);
    if (question) {
      importedByModule[question.module].push(question);
    }
  }

  for (const [moduleKey, outputPath] of Object.entries(MODULE_OUTPUTS)) {
    const existing = await loadJsonArray(outputPath);
    const nextItems = importedByModule[moduleKey];
    const nextIds = new Set(nextItems.map((item) => item.id));
    const merged = [...existing.filter((item) => !nextIds.has(item.id)), ...nextItems];
    await fs.writeFile(outputPath, JSON.stringify(merged, null, 2));
    console.log(`${moduleKey}: wrote ${nextItems.length} imported questions to ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
