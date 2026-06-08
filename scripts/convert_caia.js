#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { parseCsv } = require("./csv_utils");

function mapRow(headers, values, index) {
  const record = Object.fromEntries(headers.map((header, position) => [header.trim(), (values[position] || "").trim()]));
  const options = ["option_a", "option_b", "option_c", "option_d"]
    .map((key) => record[key])
    .filter(Boolean);

  if (options.length) {
    const correctIndex = Number(record.correct_option ?? 0);
    return {
      id: `caia_${String(index + 1).padStart(3, "0")}`,
      module: "caia",
      type: "mcq",
      topic: record.topic || "Imported",
      subtopic: record.subtopic || "Imported",
      curriculum_module: record.curriculum_module || record.curriculumModule || "",
      difficulty: (record.difficulty || "medium").toLowerCase(),
      level: record.level || "L2",
      stem: record.stem || record.front,
      options,
      answer: Number.isNaN(correctIndex) ? 0 : correctIndex,
      explanation: record.explanation || record.back || "Imported from CAIA export.",
      formula_ref: null,
      tolerance_pct: null
    };
  }

  return {
    id: `caia_${String(index + 1).padStart(3, "0")}`,
    module: "caia",
    type: "text",
    topic: record.topic || "Imported",
    subtopic: record.subtopic || "Flashcard recall",
    curriculum_module: record.curriculum_module || record.curriculumModule || "",
    difficulty: (record.difficulty || "medium").toLowerCase(),
    level: record.level || "L2",
    stem: record.front || record.stem || "Imported card",
    options: null,
    answer: record.back || record.answer || "",
    explanation: record.explanation || "Imported from CAIA flashcard export.",
    formula_ref: null,
    tolerance_pct: null
  };
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || path.resolve(__dirname, "..", "data", "caia.json");

  if (!inputPath) {
    throw new Error("Usage: node scripts/convert_caia.js <input.csv> [output.json]");
  }

  const csv = await fs.readFile(path.resolve(inputPath), "utf8");
  const rows = parseCsv(csv);
  const [headers, ...values] = rows;
  const questions = values.map((row, index) => mapRow(headers, row, index));
  await fs.writeFile(path.resolve(outputPath), JSON.stringify(questions, null, 2));
  console.log(`Wrote ${questions.length} questions to ${path.resolve(outputPath)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
