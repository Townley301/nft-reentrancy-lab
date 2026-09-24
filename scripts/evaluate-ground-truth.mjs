#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_MANIFEST = path.join(PROJECT_ROOT, "evaluation", "ground-truth.json");
const DEFAULT_STATIC = path.join(PROJECT_ROOT, "analysis", "shared-state-report.json");
const DEFAULT_DYNAMIC = path.join(PROJECT_ROOT, "analysis", "business-rule-report.json");
const OUTPUT_JSON = path.join(PROJECT_ROOT, "analysis", "ground-truth-evaluation.json");
const OUTPUT_MD = path.join(PROJECT_ROOT, "analysis", "ground-truth-evaluation.md");
const ID = /^[a-z][a-z0-9-]{2,63}$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FORBIDDEN_KEYS = /^(rpc|rpcurl|url|network|chainid|privatekey|mnemonic|wallet|account|address|mainnet|testnet|code|script)$/i;

function fail(message) {
  throw new Error(`Invalid ground-truth manifest: ${message}`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unsupported field \`${key}\``);
  }
}

function rejectUnsafeFields(value, trail = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectUnsafeFields(item, `${trail}[${index}]`));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail(`${trail}.${key} is forbidden in a local evaluation manifest`);
    rejectUnsafeFields(child, `${trail}.${key}`);
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
}

function validateMetric(value, label) {
  if (typeof value !== "number" || value < 0 || value > 1) fail(`${label} must be from 0 to 1`);
}

function validatePath(value, label) {
  if (!object(value)) fail(`${label} must be an object`);
  onlyKeys(value, ["contract", "outerFunction", "candidateFunction"], label);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || !IDENTIFIER.test(item)) fail(`${label}.${key} must be a Solidity identifier`);
  }
}

export function validateGroundTruth(input) {
  rejectUnsafeFields(input);
  if (!object(input)) fail("root must be an object");
  onlyKeys(input, ["schemaVersion", "localOnly", "baseline", "acceptance", "holdouts", "cases"], "root");
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (input.localOnly !== true) fail("localOnly must be true");

  if (!object(input.baseline)) fail("baseline must be an object");
  onlyKeys(input.baseline, ["id", "commit", "frozenFiles"], "baseline");
  nonEmpty(input.baseline.id, "baseline.id");
  if (typeof input.baseline.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(input.baseline.commit)) fail("baseline.commit is invalid");
  if (!Array.isArray(input.baseline.frozenFiles) || input.baseline.frozenFiles.length === 0) fail("baseline.frozenFiles must not be empty");
  const frozenPaths = new Set();
  for (const [index, file] of input.baseline.frozenFiles.entries()) {
    const label = `baseline.frozenFiles[${index}]`;
    if (!object(file)) fail(`${label} must be an object`);
    onlyKeys(file, ["path", "sha256"], label);
    nonEmpty(file.path, `${label}.path`);
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes("..")) fail(`${label}.path must remain inside the project`);
    if (frozenPaths.has(file.path)) fail(`${label}.path is duplicated`);
    frozenPaths.add(file.path);
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) fail(`${label}.sha256 is invalid`);
  }

  if (!object(input.acceptance)) fail("acceptance must be an object");
  onlyKeys(input.acceptance, ["minimumPrecision", "minimumRecall", "minimumSpecificity", "minimumDynamicPassRate", "maximumBaselineDriftFiles"], "acceptance");
  for (const name of ["minimumPrecision", "minimumRecall", "minimumSpecificity", "minimumDynamicPassRate"]) {
    validateMetric(input.acceptance[name], `acceptance.${name}`);
  }
  if (!Number.isSafeInteger(input.acceptance.maximumBaselineDriftFiles) || input.acceptance.maximumBaselineDriftFiles < 0) {
    fail("acceptance.maximumBaselineDriftFiles must be a non-negative integer");
  }

  if (!Array.isArray(input.holdouts)) fail("holdouts must be an array");
  const holdoutRules = new Set();
  for (const [index, holdout] of input.holdouts.entries()) {
    const label = `holdouts[${index}]`;
    if (!object(holdout)) fail(`${label} must be an object`);
    onlyKeys(holdout, ["ruleId", "adapter", "executorChanged"], label);
    if (!ID.test(holdout.ruleId) || !ID.test(holdout.adapter)) fail(`${label} identifiers are invalid`);
    if (holdoutRules.has(holdout.ruleId)) fail(`${label}.ruleId is duplicated`);
    holdoutRules.add(holdout.ruleId);
    if (typeof holdout.executorChanged !== "boolean") fail(`${label}.executorChanged must be a boolean`);
  }

  if (!Array.isArray(input.cases) || input.cases.length === 0) fail("cases must not be empty");
  const caseIds = new Set();
  for (const [index, item] of input.cases.entries()) {
    const label = `cases[${index}]`;
    if (!object(item)) fail(`${label} must be an object`);
    onlyKeys(item, ["id", "dataset", "kind", "path", "expectedStatic", "dynamic", "rationale"], label);
    if (!ID.test(item.id) || caseIds.has(item.id)) fail(`${label}.id is invalid or duplicated`);
    caseIds.add(item.id);
    if (!["development", "holdout", "control"].includes(item.dataset)) fail(`${label}.dataset is invalid`);
    if (!["positive", "negative"].includes(item.kind)) fail(`${label}.kind is invalid`);
    if (!["candidate", "absent"].includes(item.expectedStatic)) fail(`${label}.expectedStatic is invalid`);
    if ((item.kind === "positive") !== (item.expectedStatic === "candidate")) fail(`${label}.kind must agree with expectedStatic`);
    validatePath(item.path, `${label}.path`);
    nonEmpty(item.rationale, `${label}.rationale`);
    if (item.dynamic !== null) {
      if (!object(item.dynamic)) fail(`${label}.dynamic must be an object or null`);
      onlyKeys(item.dynamic, ["ruleId", "variant", "expectedOutcome"], `${label}.dynamic`);
      if (!ID.test(item.dynamic.ruleId)) fail(`${label}.dynamic.ruleId is invalid`);
      if (!["vulnerable", "fixed"].includes(item.dynamic.variant)) fail(`${label}.dynamic.variant is invalid`);
      if (!["violate", "preserve"].includes(item.dynamic.expectedOutcome)) fail(`${label}.dynamic.expectedOutcome is invalid`);
    }
  }
  return input;
}

function pathKey(value) {
  return `${value.contract}/${value.outerFunction}/${value.candidateFunction}`;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function evaluateGroundTruth(manifestInput, staticReport, dynamicReport, root = PROJECT_ROOT) {
  const manifest = validateGroundTruth(manifestInput);
  const detected = new Set();
  for (const contract of staticReport.contracts ?? []) {
    for (const candidate of contract.reentryCandidates ?? []) {
      if (candidate.severity === "mitigated") continue;
      detected.add(pathKey({
        contract: contract.contract,
        outerFunction: candidate.outerFunction,
        candidateFunction: candidate.candidateFunction,
      }));
    }
  }

  const results = manifest.cases.map((item) => {
    const observedStatic = detected.has(pathKey(item.path)) ? "candidate" : "absent";
    let dynamic;
    if (item.dynamic === null) {
      dynamic = { expected: "not-evaluated", observed: [], scenarios: 0, passed: true };
    } else {
      const observations = (dynamicReport.observations ?? []).filter(
        (observation) => observation.ruleId === item.dynamic.ruleId && observation.variant === item.dynamic.variant,
      );
      const observed = [...new Set(observations.map((observation) => observation.observed))].sort();
      dynamic = {
        expected: item.dynamic.expectedOutcome,
        observed,
        scenarios: observations.length,
        passed: observations.length > 0 && observations.every(
          (observation) => observation.passed && observation.observed === item.dynamic.expectedOutcome,
        ),
      };
    }
    return {
      ...item,
      observedStatic,
      staticMatchedGroundTruth: observedStatic === item.expectedStatic,
      dynamic,
    };
  });

  const truePositive = results.filter((item) => item.kind === "positive" && item.observedStatic === "candidate").length;
  const falseNegative = results.filter((item) => item.kind === "positive" && item.observedStatic === "absent").length;
  const falsePositive = results.filter((item) => item.kind === "negative" && item.observedStatic === "candidate").length;
  const trueNegative = results.filter((item) => item.kind === "negative" && item.observedStatic === "absent").length;
  const dynamicChecks = results.filter((item) => item.dynamic.expected !== "not-evaluated");
  const drift = manifest.baseline.frozenFiles.map((file) => {
    const absolute = path.join(root, file.path);
    const actual = fs.existsSync(absolute) ? sha256(absolute) : null;
    return { ...file, actual, unchanged: actual === file.sha256 };
  });
  const metrics = {
    labeledPaths: results.length,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
    specificity: ratio(trueNegative, trueNegative + falsePositive),
    dynamicChecks: dynamicChecks.length,
    dynamicPassed: dynamicChecks.filter((item) => item.dynamic.passed).length,
    dynamicPassRate: ratio(dynamicChecks.filter((item) => item.dynamic.passed).length, dynamicChecks.length),
    baselineDriftFiles: drift.filter((item) => !item.unchanged).length,
    holdoutRules: manifest.holdouts.length,
    holdoutsWithoutExecutorChanges: manifest.holdouts.filter((item) => !item.executorChanged).length,
  };
  const acceptance = {
    precision: metrics.precision >= manifest.acceptance.minimumPrecision,
    recall: metrics.recall >= manifest.acceptance.minimumRecall,
    specificity: metrics.specificity >= manifest.acceptance.minimumSpecificity,
    dynamicPassRate: metrics.dynamicPassRate >= manifest.acceptance.minimumDynamicPassRate,
    baselineDrift: metrics.baselineDriftFiles <= manifest.acceptance.maximumBaselineDriftFiles,
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: { id: manifest.baseline.id, commit: manifest.baseline.commit, files: drift },
    safetyBoundary: {
      dynamicChain: "ephemeral-hardhat-only",
      toyAssetsOnly: true,
      rpcCalls: false,
      privateKeys: false,
      realAssets: false,
    },
    thresholds: manifest.acceptance,
    metrics,
    acceptance: { ...acceptance, passed: Object.values(acceptance).every(Boolean) },
    holdouts: manifest.holdouts,
    cases: results,
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function markdown(report) {
  const lines = [
    "# Ground-Truth Evaluation Report",
    "",
    `- Frozen baseline: \`${report.baseline.id}\` at \`${report.baseline.commit}\``,
    "- Boundary: ephemeral Hardhat chain and project-defined Toy assets only",
    `- Acceptance: **${report.acceptance.passed ? "PASS" : "FAIL"}**`,
    `- Precision: ${percent(report.metrics.precision)} (${report.metrics.truePositive} TP / ${report.metrics.falsePositive} FP)`,
    `- Recall: ${percent(report.metrics.recall)} (${report.metrics.falseNegative} FN)`,
    `- Specificity: ${percent(report.metrics.specificity)} (${report.metrics.trueNegative} TN)`,
    `- Dynamic checks: ${report.metrics.dynamicPassed}/${report.metrics.dynamicChecks}`,
    `- Frozen engine files changed: ${report.metrics.baselineDriftFiles}`,
    `- Holdouts without executor changes: ${report.metrics.holdoutsWithoutExecutorChanges}/${report.metrics.holdoutRules}`,
    "",
    "## Labeled paths",
    "",
    "| Dataset | Case | Ground truth | Static result | Dynamic result |",
    "|---|---|---|---|---|",
  ];
  for (const item of report.cases) {
    const dynamic = item.dynamic.expected === "not-evaluated"
      ? "not evaluated"
      : `${item.dynamic.observed.join(", ") || "missing"} (${item.dynamic.scenarios} scenarios)`;
    lines.push(`| ${item.dataset} | ${item.id} | ${item.expectedStatic} | ${item.observedStatic} | ${dynamic} |`);
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    "Metrics are calculated only over the hand-labeled paths in `evaluation/ground-truth.json`. The permission-limited control intentionally records the current structural analyzer's known authorization and state-index/ownership false positives. A local dynamic violation is evidence for this Toy fixture only; it is not a claim about real assets or production exploitability.",
    "",
  );
  return lines.join("\n");
}

export function writeGroundTruthReports({ manifestPath = DEFAULT_MANIFEST, staticPath = DEFAULT_STATIC, dynamicPath = DEFAULT_DYNAMIC } = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const staticReport = JSON.parse(fs.readFileSync(staticPath, "utf8"));
  const dynamicReport = JSON.parse(fs.readFileSync(dynamicPath, "utf8"));
  const report = evaluateGroundTruth(manifest, staticReport, dynamicReport);
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(OUTPUT_MD, markdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = writeGroundTruthReports();
  console.log(`Ground-truth evaluation: ${report.acceptance.passed ? "PASS" : "FAIL"}`);
  console.log(`Precision ${percent(report.metrics.precision)}, recall ${percent(report.metrics.recall)}, specificity ${percent(report.metrics.specificity)}.`);
  console.log(`Dynamic checks ${report.metrics.dynamicPassed}/${report.metrics.dynamicChecks}; baseline drift ${report.metrics.baselineDriftFiles}.`);
  console.log("Report: analysis/ground-truth-evaluation.json and analysis/ground-truth-evaluation.md");
  if (!report.acceptance.passed) process.exitCode = 1;
}
