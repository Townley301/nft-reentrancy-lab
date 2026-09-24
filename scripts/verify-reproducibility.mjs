#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const EXPECTED_PATH = path.join(PROJECT_ROOT, "evaluation", "expected-summary.json");
const BUSINESS_PATH = path.join(PROJECT_ROOT, "analysis", "business-rule-report.json");
const COVERAGE_PATH = path.join(PROJECT_ROOT, "analysis", "rule-coverage-report.json");
const EVALUATION_PATH = path.join(PROJECT_ROOT, "analysis", "ground-truth-evaluation.json");
const HTML_PATH = path.join(PROJECT_ROOT, "business-rule-report.html");
const EPSILON = 1e-12;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Reproducibility verification failed: ${message}`);
}

function onlyKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unsupported field \`${key}\``);
  }
}

function compareSummary(expected, actual, label) {
  if (!object(actual)) fail(`${label} is missing from a generated report`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    const matches = typeof expectedValue === "number" && !Number.isInteger(expectedValue)
      ? typeof actualValue === "number" && Math.abs(expectedValue - actualValue) <= EPSILON
      : Object.is(expectedValue, actualValue);
    if (!matches) fail(`${label}.${key} expected ${expectedValue}, observed ${actualValue}`);
  }
}

function requireLocalSafety(boundary, label, extra = {}) {
  if (!object(boundary)) fail(`${label} safety boundary is missing`);
  for (const key of ["rpcCalls", "privateKeys", "realAssets"]) {
    if (boundary[key] !== false) fail(`${label}.safetyBoundary.${key} must be false`);
  }
  for (const [key, expected] of Object.entries(extra)) {
    if (boundary[key] !== expected) fail(`${label}.safetyBoundary.${key} must be ${expected}`);
  }
}

export function validateExpectedSummary(expected) {
  onlyKeys(expected, ["schemaVersion", "localOnly", "business", "coverage", "groundTruth"], "expected summary");
  if (expected.schemaVersion !== 1) fail("expected summary schemaVersion must be 1");
  if (expected.localOnly !== true) fail("expected summary localOnly must be true");

  const sections = {
    business: ["rules", "developmentRules", "holdoutRules", "scenarios", "passed", "failed"],
    coverage: ["declaredRules", "developmentRules", "holdoutRules", "staticCandidates", "coveredCandidates", "undeclaredCandidates", "locallyDemonstratedCandidates", "staticOnlyCandidates", "intentionallyRejectedCandidates", "reviewedCandidates", "unreviewedCandidates", "locallyDemonstratedUndeclared"],
    groundTruth: ["labeledPaths", "truePositive", "falsePositive", "falseNegative", "trueNegative", "precision", "recall", "specificity", "dynamicChecks", "dynamicPassed", "dynamicPassRate", "baselineDriftFiles", "holdoutRules", "holdoutsWithoutExecutorChanges"],
  };
  for (const [section, keys] of Object.entries(sections)) {
    onlyKeys(expected[section], keys, `expected summary.${section}`);
    for (const key of keys) {
      const value = expected[section][key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        fail(`expected summary.${section}.${key} must be a non-negative finite number`);
      }
      const isRatio = ["precision", "recall", "specificity", "dynamicPassRate"].includes(key);
      if (isRatio && value > 1) fail(`expected summary.${section}.${key} must be from 0 to 1`);
      if (!isRatio && !Number.isSafeInteger(value)) {
        fail(`expected summary.${section}.${key} must be a non-negative integer`);
      }
    }
  }
  return expected;
}

export function verifyReproducibility(expectedInput, business, coverage, evaluation, options = {}) {
  const expected = validateExpectedSummary(expectedInput);
  compareSummary(expected.business, business.summary, "business.summary");
  compareSummary(expected.coverage, coverage.summary, "coverage.summary");
  compareSummary(expected.groundTruth, evaluation.metrics, "evaluation.metrics");

  requireLocalSafety(business.safetyBoundary, "business", { arbitraryAdapterCode: false });
  requireLocalSafety(coverage.safetyBoundary, "coverage");
  requireLocalSafety(evaluation.safetyBoundary, "evaluation", { toyAssetsOnly: true });
  if (evaluation.acceptance?.passed !== true) fail("ground-truth acceptance must pass");
  if (options.htmlExists !== true) fail("offline HTML report was not generated");

  return {
    rules: business.summary.rules,
    scenarios: business.summary.scenarios,
    staticCandidates: coverage.summary.staticCandidates,
    labeledPaths: evaluation.metrics.labeledPaths,
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) fail(`missing generated file ${path.relative(PROJECT_ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const result = verifyReproducibility(
    readJson(EXPECTED_PATH),
    readJson(BUSINESS_PATH),
    readJson(COVERAGE_PATH),
    readJson(EVALUATION_PATH),
    { htmlExists: fs.existsSync(HTML_PATH) },
  );
  console.log(
    `Reproducibility PASS: ${result.rules} rules, ${result.scenarios} local scenarios, `
    + `${result.staticCandidates} static candidates, ${result.labeledPaths} labeled paths.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
