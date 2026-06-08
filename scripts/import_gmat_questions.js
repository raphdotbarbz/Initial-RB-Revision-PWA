#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { parseCsv } = require("./csv_utils");

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || path.resolve(__dirname, "..", "data", "gmat.json");

  if (!inputPath) {
    throw new Error("Usage: node scripts/import_gmat_questions.js <input.csv> [output.json]");
  }

  const csv = await fs.readFile(path.resolve(inputPath), "utf8");
  const rows = parseCsv(csv);
  const [headers, ...values] = rows;
  const existing = JSON.parse(await fs.readFile(path.resolve(outputPath), "utf8"));

  const questions = values.map((row, index) => {
    const record = Object.fromEntries(headers.map((header, position) => [header.trim(), (row[position] || "").trim()]));
    const options = ["option_a", "option_b", "option_c", "option_d"]
      .map((key) => record[key])
      .filter(Boolean);
    const topic = (record.topic || "CR").toUpperCase();

    return {
      id: record.id || `gmat_${Date.now()}_${index + 1}`,
      module: "gmat",
      type: "mcq",
      topic,
      subtopic: (record.subtopic || topic).toLowerCase(),
      difficulty: (record.difficulty || "medium").toLowerCase(),
      level: record.level || (["PS", "DS"].includes(topic) ? "Quant" : "Verbal"),
      stem: record.stem || "",
      options,
      answer: Number(record.answer ?? 0),
      explanation: record.explanation || "",
      formula_ref: null,
      tolerance_pct: null,
      timer_sec: Number(record.timer_sec || (["PS", "DS"].includes(topic) ? 120 : 90))
    };
  });

  await fs.writeFile(path.resolve(outputPath), JSON.stringify([...existing, ...questions], null, 2));
  console.log(`Appended ${questions.length} GMAT questions to ${path.resolve(outputPath)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
