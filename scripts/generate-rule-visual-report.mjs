#!/usr/bin/env node

/** Build an offline HTML dashboard from the latest generated-rule test report. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRules } from "./generate-callback-tests.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RULES_PATH = path.join(PROJECT_ROOT, "rules", "research-rule-spec.json");
const REPORT_PATH = path.join(PROJECT_ROOT, "analysis", "business-rule-report.json");
const COVERAGE_PATH = path.join(PROJECT_ROOT, "analysis", "rule-coverage-report.json");
const EVALUATION_PATH = path.join(PROJECT_ROOT, "analysis", "ground-truth-evaluation.json");
const TEMPLATE_PATH = path.join(PROJECT_ROOT, "viewer", "business-rule-template.html");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "business-rule-report.html");

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label}不存在：${path.relative(PROJECT_ROOT, filePath)}。请先运行 pnpm verify:rules。`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const rules = validateRules(readJson(RULES_PATH, "业务规则文件"));
const report = readJson(REPORT_PATH, "业务规则验证报告");
const coverageReport = fs.existsSync(COVERAGE_PATH)
  ? JSON.parse(fs.readFileSync(COVERAGE_PATH, "utf8"))
  : undefined;
const evaluationReport = fs.existsSync(EVALUATION_PATH)
  ? JSON.parse(fs.readFileSync(EVALUATION_PATH, "utf8"))
  : undefined;

function readLocalSource(source) {
  if (!source?.file) return "";
  const resolved = path.resolve(PROJECT_ROOT, source.file);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return "";
  return fs.readFileSync(resolved, "utf8").trim();
}

const naturalLanguageText = readLocalSource(coverageReport?.source);
const declaredCoverage = coverageReport?.ruleCoverage ?? [];
const uniqueBindings = (field) => new Set(declaredCoverage.flatMap((rule) => rule.scope?.[field] ?? [])).size;
const declaredAssumptions = declaredCoverage.reduce((total, rule) => total + (rule.assumptions?.length ?? 0), 0);
const digest = crypto
  .createHash("sha256")
  .update(JSON.stringify(rules))
  .digest("hex")
  .slice(0, 16);

if (report.digest !== digest) {
  throw new Error("验证报告与当前业务规则不一致。请先运行 pnpm verify:rules，再生成可视化报告。");
}
if (!Array.isArray(report.observations)) {
  throw new Error("业务规则验证报告缺少 observations。请重新运行 pnpm verify:rules。");
}

const payload = {
  generatedAt: report.generatedAt,
  digest,
  safetyBoundary: report.safetyBoundary,
  summary: report.summary,
  coverage: coverageReport,
  evaluation: evaluationReport,
  workflow: {
    command: "pnpm audit:agent",
    automaticThrough: "result",
    autoFix: false,
    naturalLanguageText,
    stages: [
      {
        id: "input",
        title: "自然语言",
        actor: "研究者",
        status: "ready",
        statusLabel: "已接入",
        artifact: coverageReport?.source?.file ?? "rules/research-brief.txt",
        detail: "研究者只描述业务不变量与预期，不需要编写测试代码。原文会保留在项目中，便于复核。",
        metrics: [
          { label: "原文文件", value: naturalLanguageText ? "1" : "0" },
          { label: "声明规则", value: String(coverageReport?.summary?.declaredRules ?? 0) },
          { label: "待确认假设", value: String(declaredAssumptions) },
          { label: "外部网络", value: "0", tone: "good" },
        ],
      },
      {
        id: "skill",
        title: "Skill 理解",
        actor: "Codex Skill",
        status: "agent",
        statusLabel: "Agent 执行",
        artifact: ".agents/skills/nft-callback-auditor/SKILL.md",
        detail: "Skill 约束 Agent 的工作方式：只在本地分析，把自然语言绑定到真实的合约、函数和状态，并明确记录假设。",
        metrics: [
          { label: "项目 Skill", value: "1" },
          { label: "待转译规则", value: String(coverageReport?.summary?.declaredRules ?? 0) },
          { label: "记录假设", value: String(declaredAssumptions) },
          { label: "执行方式", value: "Agent" },
        ],
      },
      {
        id: "rule",
        title: "受限规则",
        actor: "Agent + 校验器",
        status: "agent",
        statusLabel: "需 Agent 转译",
        artifact: "rules/research-rule-spec.json",
        detail: "Agent 将文字转为可审查的结构化规则；程序校验字段和值域。命令本身不会直接理解任意自然语言。",
        metrics: [
          { label: "结构化规则", value: String(coverageReport?.summary?.declaredRules ?? 0) },
          { label: "合约绑定", value: String(uniqueBindings("contracts")) },
          { label: "函数绑定", value: String(uniqueBindings("functions")) },
          { label: "状态绑定", value: String(uniqueBindings("states")) },
        ],
      },
      {
        id: "detect",
        title: "检测代码",
        actor: "AST 程序 + Agent",
        status: "mixed",
        statusLabel: "部分自动",
        artifact: "analysis/shared-state-report.json",
        detail: "程序自动扫描回调点、共享状态和跨函数候选；声明式执行器只运行通过 schema 和注册表校验的本地 Adapter。Agent 仍需结合规则、权限与可达性解释结果，静态候选不等于已证明可利用。",
        metrics: [
          { label: "静态候选", value: String(coverageReport?.summary?.staticCandidates ?? 0) },
          { label: "已人工复核", value: String(coverageReport?.summary?.reviewedCandidates ?? 0), tone: "good" },
          { label: "仍需本地验证", value: String(coverageReport?.summary?.staticOnlyCandidates ?? 0) },
          { label: "有理由排除", value: String(coverageReport?.summary?.intentionallyRejectedCandidates ?? 0) },
        ],
      },
      {
        id: "evaluate",
        title: "Ground truth 评估",
        actor: "标注集 + 程序",
        status: evaluationReport?.acceptance?.passed ? "automatic" : "mixed",
        statusLabel: evaluationReport?.acceptance?.passed ? "基线通过" : "需要复核",
        artifact: "analysis/ground-truth-evaluation.json",
        detail: "程序只在人工标注的本地路径上计算 precision、recall、specificity 和动态通过率，并检查通用执行器是否偏离冻结 baseline。已知误报会保留在结果中。",
        metrics: [
          { label: "Precision", value: evaluationReport ? `${(evaluationReport.metrics.precision * 100).toFixed(1)}%` : "未生成" },
          { label: "Recall", value: evaluationReport ? `${(evaluationReport.metrics.recall * 100).toFixed(1)}%` : "未生成" },
          { label: "Specificity", value: evaluationReport ? `${(evaluationReport.metrics.specificity * 100).toFixed(1)}%` : "未生成" },
          { label: "Baseline 漂移", value: String(evaluationReport?.metrics?.baselineDriftFiles ?? "未生成"), tone: evaluationReport?.metrics?.baselineDriftFiles === 0 ? "good" : "bad" },
        ],
      },
      {
        id: "result",
        title: "分级结果",
        actor: "程序生成",
        status: "automatic",
        statusLabel: "程序自动",
        artifact: "analysis/rule-coverage-report.json",
        detail: "结果区分已声明规则、规则外候选、本地已演示、仅静态候选和有理由排除的教学负样本，并保留人工 reason code。",
        metrics: [
          { label: "动态规则", value: String(report.summary.rules) },
          { label: "测试场景", value: String(report.summary.scenarios) },
          { label: "符合预期", value: `${report.summary.passed} / ${report.summary.scenarios}`, tone: "good" },
          { label: "已复核候选", value: `${coverageReport?.summary?.reviewedCandidates ?? 0} / ${coverageReport?.summary?.staticCandidates ?? 0}`, tone: "good" },
        ],
      },
      {
        id: "approval",
        title: "修改确认",
        actor: "研究者",
        status: "gate",
        statusLabel: "必须确认",
        artifact: "用户明确授权",
        detail: "这是必要的决策门：研究者选择是否修改、修改范围和验收目标。审计命令不会擅自改动源码。",
        metrics: [
          { label: "规则外候选", value: String(coverageReport?.summary?.undeclaredCandidates ?? 0), tone: "bad" },
          { label: "优先复核", value: String(coverageReport?.summary?.locallyDemonstratedUndeclared ?? 0), tone: "bad" },
          { label: "自动改码", value: "0", tone: "good" },
          { label: "当前状态", value: "待确认" },
        ],
      },
      {
        id: "fix",
        title: "Agent 修改",
        actor: "Codex Agent",
        status: "manual",
        statusLabel: "按需执行",
        artifact: "源码 + 回归测试",
        detail: "获得授权后，Agent 修改实现或补充适配器，再重跑检测与本地回调测试形成闭环；此步骤尚未串入 audit:agent 自动命令。",
        metrics: [
          { label: "本轮修改文件", value: "0" },
          { label: "新增回归测试", value: "0" },
          { label: "自动改码", value: "0", tone: "good" },
          { label: "当前状态", value: "未执行" },
        ],
      },
    ],
  },
  rules: rules.rules.filter((rule) => rule.dynamic !== undefined).map((rule) => ({
    id: rule.id,
    dataset: rule.dataset,
    description: rule.statement,
    template: rule.dynamic.adapter,
    variants: rule.dynamic.variants,
    parameters: rule.dynamic.parameters,
    expectations: rule.dynamic.expectations,
    scope: rule.scope,
    model: rule.model,
    bindingConfidence: rule.bindingConfidence,
    evidenceRequired: rule.evidenceRequired,
    observations: report.observations.filter((item) => item.ruleId === rule.id),
  })),
};
const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
const encoded = JSON.stringify(payload).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
const page = template.replace("/* __RULE_REPORT_DATA__ */ null", encoded);
if (page === template) throw new Error("可视化模板缺少数据占位符");
fs.writeFileSync(OUTPUT_PATH, page, "utf8");

console.log(`已生成业务规则可视化报告：${OUTPUT_PATH}`);
console.log(`包含 ${report.summary.rules} 条规则、${report.summary.scenarios} 个回调场景。`);
console.log("直接用浏览器打开；无需服务器，也不会连接外部网络。");
