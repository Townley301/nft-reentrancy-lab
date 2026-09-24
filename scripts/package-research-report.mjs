#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderLatexMetrics, verifyLatexPackage } from "./lib/report-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = path.join(ROOT, "evaluation", "expected-summary.json");
const METRICS = path.join(ROOT, "report", "metrics.tex");
const REPORT = path.join(ROOT, "REPORT.tex");

const expected = JSON.parse(fs.readFileSync(EXPECTED, "utf8"));
if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(METRICS), { recursive: true });
  fs.writeFileSync(METRICS, renderLatexMetrics(expected));
  console.log("Generated report/metrics.tex from the versioned expected summary.");
} else if (process.argv.includes("--check")) {
  verifyLatexPackage(expected, fs.readFileSync(METRICS, "utf8"), fs.readFileSync(REPORT, "utf8"));
  console.log("LaTeX report metrics PASS: REPORT.tex matches the versioned expected summary.");
} else {
  throw new Error("Use --write to update metrics or --check to verify the report package.");
}
