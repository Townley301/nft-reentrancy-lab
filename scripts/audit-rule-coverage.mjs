#!/usr/bin/env node

/**
 * Correlates researcher-declared rules with local AST callback candidates.
 * It never promotes a static candidate to "exploitable" without local dynamic evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dynamicPathKey, validateResearchSpec } from "./lib/research-rule-spec.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SPEC = path.join(PROJECT_ROOT, "rules", "research-rule-spec.json");
const DEFAULT_STATIC = path.join(PROJECT_ROOT, "analysis", "shared-state-report.json");
const DEFAULT_DYNAMIC = path.join(PROJECT_ROOT, "analysis", "business-rule-report.json");
const OUTPUT_JSON = path.join(PROJECT_ROOT, "analysis", "rule-coverage-report.json");
const OUTPUT_MD = path.join(PROJECT_ROOT, "analysis", "rule-coverage-report.md");

export { validateResearchSpec };

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
  const adapterByPath = new Map(
    spec.rules
      .filter((rule) => rule.dynamic !== undefined)
      .map((rule) => [dynamicPathKey(rule.dynamic.path), rule.dynamic.adapter]),
  );
  const candidates = [];
  for (const contract of staticReport.contracts ?? []) {
    for (const candidate of contract.reentryCandidates ?? []) {
      if (candidate.severity === "mitigated") continue;
      const normalized = { contract: contract.contract, file: contract.file, ...candidate };
      const matches = spec.rules
        .map((rule) => ({ rule, match: matchRule(rule, normalized) }))
        .filter((item) => item.match.matches);
      const key = `${normalized.contract}/${normalized.outerFunction}/${normalized.candidateFunction}`;
      const template = adapterByPath.get(key);
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
    const proof = dynamicEvidence(dynamicReport, rule.dynamic?.adapter);
    return {
      id: rule.id,
      statement: rule.statement,
      scope: rule.scope,
      model: rule.model,
      bindingConfidence: rule.bindingConfidence,
      evidenceRequired: rule.evidenceRequired,
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
      locallyDemonstratedCandidates: candidates.filter((item) => item.evidenceLevel === "local-demonstration").length,
      staticOnlyCandidates: candidates.filter((item) => item.evidenceLevel === "static-candidate").length,
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
    `- 已有本地动态证据的候选路径：${report.summary.locallyDemonstratedCandidates}`,
    `- 仍只有静态证据的候选路径：${report.summary.staticOnlyCandidates}`,
    `- 规则未覆盖且已有本地演示：${report.summary.locallyDemonstratedUndeclared}`,
    "",
    "> “本地演示”只表示教学环境中观察到不变量破坏；“静态候选”不等于已证明可利用。",
    "",
    "## 研究者声明规则",
    "",
    "| 规则 | 类别 | 绑定置信度 | 状态 | 命中的静态路径 | 本地动态场景 |",
    "|---|---|---|---|---:|---:|",
  ];
  for (const rule of report.ruleCoverage) {
    lines.push(`| ${rule.id} | ${rule.model.invariant.category} | ${rule.bindingConfidence} | ${rule.status} | ${rule.matchedCandidates.length} | ${rule.dynamicEvidence?.scenarios ?? 0} |`);
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
  console.log(`已有本地动态证据的候选：${report.summary.locallyDemonstratedCandidates}`);
  console.log(`仍只有静态证据的候选：${report.summary.staticOnlyCandidates}`);
  console.log(`规则未覆盖候选：${report.summary.undeclaredCandidates}`);
  console.log("报告：analysis/rule-coverage-report.json 和 analysis/rule-coverage-report.md");
}
