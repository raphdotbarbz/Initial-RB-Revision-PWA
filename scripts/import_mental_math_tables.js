#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { parseCsv } = require("./csv_utils");

const SUBJECT_MAP = {
  PE: "pe",
  CAIA: "caia",
  GMAT: "gmat",
  ENERGY: "energy",
  ALL: "all"
};

function normalizeCell(value) {
  return `${value || ""}`.replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}

function compactRow(row) {
  return row.map(normalizeCell).filter(Boolean);
}

function parseSubjects(raw) {
  return normalizeCell(raw)
    .replace(/^Relevant to:\s*/i, "")
    .split(/\s*,\s*/)
    .map((item) => SUBJECT_MAP[item.toUpperCase()] || item.toLowerCase())
    .filter(Boolean);
}

function parseSectionId(marker) {
  return normalizeCell(marker)
    .replace(/^###\s*/, "")
    .replace(/\s*###$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || path.resolve(__dirname, "..", "data", "mental_math_tables.json");

  if (!inputPath) {
    throw new Error("Usage: node scripts/import_mental_math_tables.js <input.csv> [output.json]");
  }

  const csv = await fs.readFile(path.resolve(inputPath), "utf8");
  const rows = parseCsv(csv).map((row) => row.map(normalizeCell));

  const sections = [];
  let current = null;

  for (const row of rows) {
    const first = row[0] || "";
    if (!first) {
      continue;
    }

    if (/^###\s+Index\s+###$/i.test(first)) {
      current = null;
      continue;
    }

    if (/^###\s+.+\s+###$/.test(first)) {
      if (current) {
        sections.push(current);
      }
      current = {
        id: parseSectionId(first),
        heading: first,
        title: "",
        subjects: [],
        description: "",
        headers: [],
        rows: []
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const compact = compactRow(row);
    if (!compact.length) {
      continue;
    }

    const line = compact.join(" ");
    if (!current.title) {
      current.title = compact[0];
      continue;
    }

    if (!current.subjects.length && /^Relevant to:/i.test(line)) {
      current.subjects = parseSubjects(line);
      continue;
    }

    if (!current.description) {
      current.description = line;
      continue;
    }

    if (!current.headers.length) {
      current.headers = compact;
      continue;
    }

    current.rows.push(compact.slice(0, current.headers.length));
  }

  if (current) {
    sections.push(current);
  }

  const cleaned = sections
    .filter((section) => section.headers.length && section.rows.length)
    .map((section) => ({
      ...section,
      subjects: section.subjects.length ? section.subjects : ["all"]
    }));

  await fs.writeFile(path.resolve(outputPath), JSON.stringify(cleaned, null, 2));
  console.log(`Wrote ${cleaned.length} mental math tables to ${path.resolve(outputPath)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
