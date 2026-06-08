#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { parseCsv } = require("./csv_utils");

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || path.resolve(__dirname, "..", "data", "caia_flashcards.json");

  if (!inputPath) {
    throw new Error("Usage: node scripts/import_caia_flashcards.js <input.csv> [output.json]");
  }

  const csv = await fs.readFile(path.resolve(inputPath), "utf8");
  const rows = parseCsv(csv);
  const [headers, ...values] = rows;

  const cards = values.map((row, index) => {
    const record = Object.fromEntries(headers.map((header, position) => [header.trim(), (row[position] || "").trim()]));
    return {
      id: record.id || `caia_fc_${String(index + 1).padStart(3, "0")}`,
      module: "caia",
      topic: record.topic || record.curriculum_module || "Imported",
      subtopic: record.subtopic || record.front || record.side_1_content_file || "Imported",
      level: record.level || "L1",
      front: record.front || record.side_1_content_file || "Imported flashcard",
      back: record.back || record.side_2_content_file || "",
      curriculum_module: record.curriculum_module || record.curriculumModule || "",
      uncertain: ["1", "true", "yes"].includes((record.uncertain || "").trim().toLowerCase()),
      source: record.source || "Imported CSV",
      source_number: record.source_number ? Number(record.source_number) : index + 1
    };
  });

  await fs.writeFile(path.resolve(outputPath), JSON.stringify(cards, null, 2));
  console.log(`Wrote ${cards.length} flashcards to ${path.resolve(outputPath)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
