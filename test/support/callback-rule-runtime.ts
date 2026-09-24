import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { network } from "hardhat";

type Outcome = "preserve" | "violate";
type Variant = "vulnerable" | "fixed";
type Parameters = Record<string, number>;
type RuntimeValue = bigint | boolean | string;
type Expression =
  | { kind: "uint"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "contract"; id: string }
  | { kind: "param"; name: string }
  | { kind: "observation"; id: string }
  | { kind: "add" | "sub" | "mul"; left: Expression; right: Expression };
type CallSpec = {
  target: string;
  function: string;
  args: Expression[];
  allowRevert?: boolean | Record<Variant, boolean>;
};
type AdapterSpec = {
  id: string;
  dataset: "development" | "holdout";
  deployments: {
    id: string;
    contract: string | Record<Variant, string>;
    constructorArgs: Expression[];
  }[];
  setup: CallSpec[];
  entry: CallSpec;
  observations: { id: string; target: string; function: string; args: Expression[] }[];
  assertion: { operator: "lte" | "gte" | "eq"; left: Expression; right: Expression };
};
type Rule = {
  id: string;
  dataset: "development" | "holdout";
  description: string;
  template: string;
  adapter: AdapterSpec;
  variants: Record<Variant, string>;
  parameters: Parameters[];
  expectations: Record<Variant, Outcome>;
};
type RuleSuite = {
  source: string;
  digest: string;
  schemaVersion: number;
  lab: { name: string; localOnly: true; description: string };
  rules: Rule[];
};
type Observation = {
  ruleId: string;
  dataset: Rule["dataset"];
  template: string;
  variant: Variant;
  parameters: Parameters;
  expected: Outcome;
  observed: Outcome;
  passed: boolean;
  evidence: Record<string, string | number | boolean>;
};

function markdownReport(suite: RuleSuite, observations: Observation[]) {
  const passed = observations.filter((item) => item.passed).length;
  const lines = [
    "# 业务规则回调验证报告",
    "",
    `- 规则文件：${suite.source}`,
    `- 规则摘要：${suite.digest}`,
    `- 执行边界：Hardhat 临时内存链；无 RPC、钱包、私钥或真实资产`,
    `- 结果：${passed}/${observations.length} 个声明式 Adapter 场景符合研究者预期`,
    "",
    "| 数据集 | 规则 | Adapter | 版本 | 参数 | 预期 | 观察 | 通过 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const item of observations) {
    lines.push(
      `| ${item.dataset} | ${item.ruleId} | ${item.template} | ${item.variant} | \`${JSON.stringify(item.parameters)}\` | ${item.expected} | ${item.observed} | ${item.passed ? "是" : "否"} |`,
    );
  }
  lines.push("", "## 观察证据", "");
  for (const item of observations) {
    lines.push(`- **${item.ruleId} / ${item.variant}**：\`${JSON.stringify(item.evidence)}\``);
  }
  lines.push("");
  return lines.join("\n");
}

function asBigInt(value: RuntimeValue, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error(`${label} must evaluate to an integer`);
}

function resolveExpression(
  expression: Expression,
  parameters: Parameters,
  deployments: Map<string, any>,
  observations: Map<string, RuntimeValue>,
): RuntimeValue {
  if (expression.kind === "uint") return BigInt(expression.value);
  if (expression.kind === "bool") return expression.value;
  if (expression.kind === "contract") {
    const contract = deployments.get(expression.id);
    if (contract === undefined) throw new Error(`Unknown deployment: ${expression.id}`);
    return contract.address;
  }
  if (expression.kind === "param") {
    const value = parameters[expression.name];
    if (!Number.isSafeInteger(value)) throw new Error(`Unknown or unsafe parameter: ${expression.name}`);
    return BigInt(value);
  }
  if (expression.kind === "observation") {
    const value = observations.get(expression.id);
    if (value === undefined) throw new Error(`Unknown observation: ${expression.id}`);
    return value;
  }
  const left = asBigInt(resolveExpression(expression.left, parameters, deployments, observations), `${expression.kind}.left`);
  const right = asBigInt(resolveExpression(expression.right, parameters, deployments, observations), `${expression.kind}.right`);
  if (expression.kind === "add") return left + right;
  if (expression.kind === "sub") return left - right;
  return left * right;
}

function normalized(value: RuntimeValue): string | number | boolean {
  if (typeof value === "bigint") return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  return value;
}

function allowRevert(call: CallSpec, variant: Variant) {
  if (typeof call.allowRevert === "boolean") return call.allowRevert;
  return call.allowRevert?.[variant] ?? false;
}

async function invoke(
  call: CallSpec,
  variant: Variant,
  parameters: Parameters,
  deployments: Map<string, any>,
) {
  const target = deployments.get(call.target);
  if (target === undefined) throw new Error(`Unknown call target: ${call.target}`);
  const args = call.args.map((item) => resolveExpression(item, parameters, deployments, new Map()));
  try {
    if (args.length === 0) await target.write[call.function]();
    else await target.write[call.function](args);
    return false;
  } catch (error) {
    if (!allowRevert(call, variant)) throw error;
    return true;
  }
}

function evaluateAssertion(
  adapter: AdapterSpec,
  parameters: Parameters,
  deployments: Map<string, any>,
  observations: Map<string, RuntimeValue>,
) {
  const left = resolveExpression(adapter.assertion.left, parameters, deployments, observations);
  const right = resolveExpression(adapter.assertion.right, parameters, deployments, observations);
  if (adapter.assertion.operator === "eq") return left === right;
  const leftNumber = asBigInt(left, "assertion.left");
  const rightNumber = asBigInt(right, "assertion.right");
  return adapter.assertion.operator === "lte" ? leftNumber <= rightNumber : leftNumber >= rightNumber;
}

export function registerGeneratedCallbackRules(suite: RuleSuite) {
  const observations: Observation[] = [];

  function record(
    rule: Rule,
    variant: Variant,
    parameters: Parameters,
    preserved: boolean,
    evidence: Observation["evidence"],
  ) {
    const expected = rule.expectations[variant];
    const observed: Outcome = preserved ? "preserve" : "violate";
    const observation = {
      ruleId: rule.id,
      dataset: rule.dataset,
      template: rule.template,
      variant,
      parameters,
      expected,
      observed,
      passed: observed === expected,
      evidence,
    } satisfies Observation;
    observations.push(observation);
    assert.equal(observed, expected, `${rule.id}/${variant} did not match the researcher expectation`);
  }

  after(() => {
    const directory = path.join(process.cwd(), "analysis");
    fs.mkdirSync(directory, { recursive: true });
    const report = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      source: suite.source,
      digest: suite.digest,
      safetyBoundary: {
        chain: "ephemeral-hardhat",
        rpcCalls: false,
        privateKeys: false,
        realAssets: false,
        arbitraryAdapterCode: false,
      },
      summary: {
        rules: suite.rules.length,
        developmentRules: suite.rules.filter((rule) => rule.dataset === "development").length,
        holdoutRules: suite.rules.filter((rule) => rule.dataset === "holdout").length,
        scenarios: observations.length,
        passed: observations.filter((item) => item.passed).length,
        failed: observations.filter((item) => !item.passed).length,
      },
      observations,
    };
    fs.writeFileSync(path.join(directory, "business-rule-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, "business-rule-report.md"), markdownReport(suite, observations));
  });

  describe(`generated callback rules: ${suite.lab.name}`, async function () {
    const { viem } = await network.create();

    async function runAdapter(rule: Rule, variant: Variant, parameters: Parameters) {
      const adapter = rule.adapter;
      assert.equal(adapter.id, rule.template, "embedded adapter id mismatch");
      assert.equal(adapter.dataset, rule.dataset, "embedded adapter dataset mismatch");
      const deployments = new Map<string, any>();
      const emptyObservations = new Map<string, RuntimeValue>();

      for (const deployment of adapter.deployments) {
        const contractName = typeof deployment.contract === "string"
          ? deployment.contract
          : deployment.contract[variant];
        const constructorArgs = deployment.constructorArgs.map((item) =>
          resolveExpression(item, parameters, deployments, emptyObservations));
        const contract = constructorArgs.length === 0
          ? await viem.deployContract(contractName as any)
          : await viem.deployContract(contractName as any, constructorArgs as any);
        deployments.set(deployment.id, contract);
      }

      for (const call of adapter.setup) await invoke(call, variant, parameters, deployments);
      const entryReverted = await invoke(adapter.entry, variant, parameters, deployments);

      const values = new Map<string, RuntimeValue>();
      for (const observation of adapter.observations) {
        const target = deployments.get(observation.target);
        if (target === undefined) throw new Error(`Unknown observation target: ${observation.target}`);
        const args = observation.args.map((item) => resolveExpression(item, parameters, deployments, values));
        const value = args.length === 0
          ? await target.read[observation.function]()
          : await target.read[observation.function](args);
        if (!["bigint", "boolean", "string"].includes(typeof value)) {
          throw new Error(`Observation ${observation.id} returned an unsupported value`);
        }
        values.set(observation.id, value as RuntimeValue);
      }

      const evidence = Object.fromEntries(
        [...values.entries()].map(([key, value]) => [key, normalized(value)]),
      );
      record(rule, variant, parameters, evaluateAssertion(adapter, parameters, deployments, values), {
        entryReverted,
        ...evidence,
      });
    }

    for (const rule of suite.rules) {
      for (const parameters of rule.parameters) {
        for (const variant of ["vulnerable", "fixed"] as const) {
          const label = Object.keys(parameters).length === 0 ? "default" : JSON.stringify(parameters);
          it(`${rule.dataset} / ${rule.id} / ${variant} / ${label}`, async function () {
            await runAdapter(rule, variant, parameters);
          });
        }
      }
    }
  });
}
