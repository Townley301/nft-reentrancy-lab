#!/usr/bin/env node

/**
 * Correlates researcher-declared rules with local AST callback candidates.
 * It never promotes a static candidate to "exploitable" without local dynamic evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SPEC = path.join(PROJECT_ROOT, "rules", "research-rule-spec.json");
const DEFAULT_STATIC = path.join(PROJECT_ROOT, "analysis", "shared-state-report.json");
const DEFAULT_DYNAMIC = path.join(PROJECT_ROOT, "analysis", "business-rule-report.json");
const OUTPUT_JSON = path.join(PROJECT_ROOT, "analysis", "rule-coverage-report.json");
const OUTPUT_MD = path.join(PROJECT_ROOT, "analysis", "rule-coverage-report.md");
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TEMPLATE_PATHS = new Map([
  ["HypeBearsVulnerable/mintNFT/mintNFT", "one-time-mint"],
  ["OmniPoolVulnerable/withdraw/liquidate", "collateral-coverage"],
  ["RevestVulnerable/createSeries/depositAdditionalToFNFT", "funded-value"],
]);

function fail(message) {
  throw new Error(`Invalid research rule specification: ${message}`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} is unsupported`);
}

function identifierList(value, label) {
  if (!Array.isArray(value) || value.length > 50) fail(`${label} must be an array with at most 50 items`);
  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !IDENTIFIER.test(item)) fail(`${label} contains an invalid code identifier`);
    if (unique.has(item)) fail(`${label} contains a duplicate identifier`);
    unique.add(item);
  }
}

export function validateResearchSpec(input) {
  if (!object(input)) fail("root must be an object");
  onlyKeys(input, ["schemaVersion", "localOnly", "source", "rules"], "root");
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (input.localOnly !== true) fail("localOnly must be true");
  if (!object(input.source)) fail("source must be an object");
  onlyKeys(input.source, ["kind", "title", "file"], "source");
  if (input.source.kind !== "natural-language") fail("source.kind must be natural-language");
  if (typeof input.source.title !== "string" || input.source.title.trim() === "") fail("source.title is required");
  if (typeof input.source.file !== "string" || input.source.file.trim() === "") fail("source.file is required");
  if (path.isAbsolute(input.source.file) || input.source.file.split(/[\\/]/).includes("..")) {
    fail("source.file must remain inside the project");
  }
  if (!Array.isArray(input.rules) || input.rules.length === 0 || input.rules.length > 50) {
    fail("rules must contain 1 to 50 entries");
  }
  const ids = new Set();
  for (const [index, rule] of input.rules.entries()) {
    const label = `rules[${index}]`;
    if (!object(rule)) fail(`${label} must be an object`);
    onlyKeys(rule, ["id", "statement", "expected", "scope", "dynamicTemplate", "assumptions"], label);
    if (typeof rule.id !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(rule.id)) fail(`${label}.id is invalid`);
    if (ids.has(rule.id)) fail(`${label}.id is duplicated`);
    ids.add(rule.id);
    if (typeof rule.statement !== "string" || rule.statement.trim() === "") fail(`${label}.statement is required`);
    if (rule.expected !== "preserve") fail(`${label}.expected must be preserve`);
    if (!object(rule.scope)) fail(`${label}.scope must be an object`);
    onlyKeys(rule.scope, ["contracts", "functions", "states"], `${label}.scope`);
    identifierList(rule.scope.contracts, `${label}.scope.contracts`);
    identifierList(rule.scope.functions, `${label}.scope.functions`);
    identifierList(rule.scope.states, `${label}.scope.states`);
    if (
      rule.scope.contracts.length + rule.scope.functions.length + rule.scope.states.length === 0
    ) fail(`${label}.scope must bind the natural-language rule to at least one code identifier`);
    if (
      rule.dynamicTemplate !== undefined &&
      !["one-time-mint", "collateral-coverage", "funded-value"].includes(rule.dynamicTemplate)
    ) fail(`${label}.dynamicTemplate is unsupported`);
    if (!Array.isArray(rule.assumptions) || rule.assumptions.length > 20) fail(`${label}.assumptions is invalid`);
    if (rule.assumptions.some((item) => typeof item !== "string" || item.trim() === "")) {
      fail(`${label}.assumptions must contain non-empty strings`);
    }
  }
  return input;
}

function intersects(left, right) {
  const lookup = new Set(right);
  return left.some((item) => lookup.has(item));
}

function matchRule(rule, candidate) {
  const contractMatch = rule.scope.contracts.includes(candidate.contract);
  const functionMatch = intersects(rule.scope.functions, [candidate.outerFunction, candidate.candidateFunction]);
  const stateMatch = intersects(rule.scope.states, [...candidate.sharedStates, ...candidate.statesUsedAfterCallback]);
  const matches = (contractMatch && (functionMatch || stateMatch)) || (stateMatch && functionMatch);
  return { matches, contractMatch, functionMatch, stateMatch };
}

function dynamicEvidence(dynamicReport, template) {
  if (!template || !dynamicReport?.observations) return undefined;
  const observations = dynamicReport.observations.filter(
    (item) => item.template === template && item.variant === "vulnerable" && item.observed === "violate",
  );
  if (observations.length === 0) return undefined;
  return {
    template,
    scenarios: observations.length,
    evidence: observations.map((item) => ({ parameters: item.parameters, evidence: item.evidence })),
  };
}

export function analyzeCoverage(specInput, staticReport, dynamicReport) {
  const spec = validateResearchSpec(specInput);
  const candidates = [];
  for (const contract of staticReport.contracts ?? []) {
    for (const candidate of contract.reentryCandidates ?? []) {
      if (candidate.severity === "mitigated") continue;
      const normalized = { contract: contract.contract, file: contract.file, ...candidate };
      const matches = spec.rules
        .map((rule) => ({ rule, match: matchRule(rule, normalized) }))
        .filter((item) => item.match.matches);
      const key = `${normalized.contract}/${normalized.outerFunction}/${normalized.candidateFunction}`;
      const template = TEMPLATE_PATHS.get(key);
      const proof = dynamicEvidence(dynamicReport, template);
      candidates.push({
        ...normalized,
        coverage: matches.length > 0 ? "declared" : "undeclared",
        declaredBy: matches.map((item) => item.rule.id),
        matchEvidence: matches.map((item) => ({ ruleId: item.rule.id, ...item.match })),
        evidenceLevel: proof ? "local-demonstration" : "static-candidate",
        dynamicEvidence: proof,
      });
    }
  }

  const ruleCoverage = spec.rules.map((rule) => {
    const matched = candidates.filter((candidate) => candidate.declaredBy.includes(rule.id));
    const proof = dynamicEvidence(dynamicReport, rule.dynamicTemplate);
    return {
      id: rule.id,
      statement: rule.statement,
      scope: rule.scope,
      assumptions: rule.assumptions,
      matchedCandidates: matched.map((item) => ({
        contract: item.contract,
        outerFunction: item.outerFunction,
        candidateFunction: item.candidateFunction,
        states: item.statesUsedAfterCallback,
      })),
      dynamicEvidence: proof,
      status: proof ? "locally-demonstrated" : matched.length > 0 ? "static-coverage" : "unmatched",
    };
  });
  const undeclared = candidates.filter((item) => item.coverage === "undeclared");
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: spec.source,
    safetyBoundary: {
      sourceAnalysis: "local-solidity-ast",
      dynamicChain: "ephemeral-hardhat-only",
      rpcCalls: false,
      privateKeys: false,
      realAssets: false,
    },
    evidencePolicy: {
      localDemonstration: "A bounded local callback test observed the business invariant being violated.",
      staticCandidate: "Code structure merits review; exploitability has not been proven.",
    },
    summary: {
      declaredRules: spec.rules.length,
      staticCandidates: candidates.length,
      coveredCandidates: candidates.length - undeclared.length,
      undeclaredCandidates: undeclared.length,
      locallyDemonstratedUndeclared: undeclared.filter((item) => item.evidenceLevel === "local-demonstration").length,
    },
    ruleCoverage,
    candidates,
  };
}

function markdown(report) {
  const lines = [
    "# 自然语言规则覆盖与未声明风险报告",
    "",
    `- 输入：${report.source.title}（${report.source.file}）`,
    `- 已声明规则：${report.summary.declaredRules}`,
    `- 静态回调候选：${report.summary.staticCandidates}`,
    `- 规则未覆盖候选：${report.summary.undeclaredCandidates}`,
    `- 规则未覆盖且已有本地演示：${report.summary.locallyDemonstratedUndeclared}`,
    "",
    "> “本地演示”只表示教学环境中观察到不变量破坏；“静态候选”不等于已证明可利用。",
    "",
    "## 研究者声明规则",
    "",
    "| 规则 | 状态 | 命中的静态路径 | 本地动态演示 |",
    "|---|---|---:|---:|",
  ];
  for (const rule of report.ruleCoverage) {
    lines.push(`| ${rule.id} | ${rule.status} | ${rule.matchedCandidates.length} | ${rule.dynamicEvidence?.scenarios ?? 0} |`);
  }
  lines.push("", "## 规则未覆盖的候选路径", "");
  const undeclared = report.candidates.filter((item) => item.coverage === "undeclared");
  if (undeclared.length === 0) lines.push("未发现规则覆盖范围之外的回调候选。", "");
  else {
    lines.push("| 证据级别 | 合约 | 外层函数 | 可重入函数 | 共享状态 | 静态风险 |", "|---|---|---|---|---|---|");
    for (const item of undeclared) {
      lines.push(`| ${item.evidenceLevel} | ${item.contract} | ${item.outerFunction} | ${item.candidateFunction} | ${item.statesUsedAfterCallback.join(", ")} | ${item.severity} |`);
    }
    lines.push("");
  }
  lines.push(
    "## 解释边界",
    "",
    "规则覆盖由 Agent 将自然语言绑定到合约、函数和状态标识符后计算。未命中可能表示用户漏写了规则，也可能表示静态误报或绑定不完整。只有配套本地测试实际观察到状态破坏时，报告才使用 local-demonstration；其余一律保留为 static-candidate。",
    "",
  );
  return lines.join("\n");
}

function readOptional(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : undefined;
}

export function writeCoverageReports({ specPath = DEFAULT_SPEC, staticPath = DEFAULT_STATIC, dynamicPath = DEFAULT_DYNAMIC } = {}) {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const staticReport = JSON.parse(fs.readFileSync(staticPath, "utf8"));
  const report = analyzeCoverage(spec, staticReport, readOptional(dynamicPath));
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(OUTPUT_MD, markdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = writeCoverageReports();
  console.log(`已对照 ${report.summary.declaredRules} 条研究规则与 ${report.summary.staticCandidates} 条本地静态候选。`);
  console.log(`规则未覆盖候选：${report.summary.undeclaredCandidates}`);
  console.log(`其中已有本地动态演示：${report.summary.locallyDemonstratedUndeclared}`);
  console.log("报告：analysis/rule-coverage-report.json 和 analysis/rule-coverage-report.md");
}
