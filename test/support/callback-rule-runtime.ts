import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { network } from "hardhat";

type Outcome = "preserve" | "violate";
type Variant = "vulnerable" | "fixed";
type Parameters = Record<string, number>;
type Rule = {
  id: string;
  description: string;
  template: "one-time-mint" | "collateral-coverage" | "funded-value";
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
  template: Rule["template"];
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
    `- 结果：${passed}/${observations.length} 个生成场景符合研究者预期`,
    "",
    "| 规则 | 模板 | 版本 | 参数 | 预期 | 观察 | 通过 |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const item of observations) {
    lines.push(
      `| ${item.ruleId} | ${item.template} | ${item.variant} | \`${JSON.stringify(item.parameters)}\` | ${item.expected} | ${item.observed} | ${item.passed ? "是" : "否"} |`,
    );
  }
  lines.push("", "## 观察证据", "");
  for (const item of observations) {
    lines.push(`- **${item.ruleId} / ${item.variant}**：\`${JSON.stringify(item.evidence)}\``);
  }
  lines.push("");
  return lines.join("\n");
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
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: suite.source,
      digest: suite.digest,
      safetyBoundary: {
        chain: "ephemeral-hardhat",
        rpcCalls: false,
        privateKeys: false,
        realAssets: false,
      },
      summary: {
        rules: suite.rules.length,
        scenarios: observations.length,
        passed: observations.filter((item) => item.passed).length,
        failed: observations.filter((item) => !item.passed).length,
      },
      observations,
    };
    fs.writeFileSync(
      path.join(directory, "business-rule-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(directory, "business-rule-report.md"),
      markdownReport(suite, observations),
    );
  });

  describe(`generated callback rules: ${suite.lab.name}`, async function () {
    const { viem } = await network.create();

    async function runOneTimeMint(rule: Rule, variant: Variant, parameters: Parameters) {
      const contractName = variant === "vulnerable" ? "HypeBearsVulnerable" : "HypeBearsFixed";
      const target = await viem.deployContract(contractName);
      const receiver = await viem.deployContract("HypeBearsCallbackStudent", [target.address]);
      await receiver.write.runLesson();
      const balance = await target.read.balanceOf([receiver.address]);
      const callbacks = await receiver.read.callbacks();
      record(rule, variant, parameters, balance <= 1n, {
        finalNftBalance: Number(balance),
        callbacks: Number(callbacks),
        reentrySucceeded: await receiver.read.reentrySucceeded(),
      });
    }

    async function runCollateralCoverage(rule: Rule, variant: Variant, parameters: Parameters) {
      const contractName = variant === "vulnerable" ? "OmniPoolVulnerable" : "OmniPoolFixed";
      const nft = await viem.deployContract("ToyERC721");
      const token = await viem.deployContract("ToyERC20");
      const pool = await viem.deployContract(contractName, [nft.address, token.address]);
      const borrower = await viem.deployContract("OmniBorrowerStudent", [pool.address, nft.address]);
      const receiver = await viem.deployContract("OmniLiquidatorCallbackStudent", [
        pool.address,
        token.address,
      ]);
      await nft.write.mint([borrower.address, 1n]);
      await nft.write.mint([borrower.address, 2n]);
      await token.write.mint([pool.address, 100n]);
      await token.write.mint([receiver.address, 1n]);
      await borrower.write.prepare([1n, 2n, BigInt(parameters.borrowAmount)]);
      await receiver.write.arm([borrower.address, 2n]);
      let rejected = false;
      try {
        await borrower.write.startWithdraw([1n, receiver.address]);
      } catch {
        rejected = true;
      }
      const collateral = await pool.read.collateralCount([borrower.address]);
      const debt = await pool.read.debt([borrower.address]);
      record(rule, variant, parameters, debt <= collateral * 10n, {
        withdrawalRejected: rejected,
        remainingCollateral: Number(collateral),
        remainingDebt: Number(debt),
        callbacks: Number(await receiver.read.callbacks()),
      });
    }

    async function runFundedValue(rule: Rule, variant: Variant, parameters: Parameters) {
      const contractName = variant === "vulnerable" ? "RevestVulnerable" : "RevestFixed";
      const asset = await viem.deployContract("ToyERC20");
      const fnft = await viem.deployContract("ToyERC1155");
      const protocol = await viem.deployContract(contractName, [asset.address, fnft.address]);
      const receiver = await viem.deployContract("RevestCallbackStudent", [
        protocol.address,
        asset.address,
        fnft.address,
      ]);
      const fundedValue = BigInt(parameters.depositPerUnit * parameters.additionalQuantity);
      await asset.write.mint([protocol.address, 100n]);
      await asset.write.mint([receiver.address, fundedValue]);
      await receiver.write.runLessonWithParameters([
        BigInt(parameters.outerQuantity),
        BigInt(parameters.depositPerUnit),
        BigInt(parameters.additionalQuantity),
      ]);
      const finalBalance = await asset.read.balanceOf([receiver.address]);
      record(rule, variant, parameters, finalBalance <= fundedValue, {
        fundedValue: Number(fundedValue),
        finalBalance: Number(finalBalance),
        outerSeriesId: Number(await receiver.read.createdId()),
        callbackSeriesId: Number(await receiver.read.additionalId()),
      });
    }

    for (const rule of suite.rules) {
      for (const parameters of rule.parameters) {
        for (const variant of ["vulnerable", "fixed"] as const) {
          const label = Object.keys(parameters).length === 0 ? "default" : JSON.stringify(parameters);
          it(`${rule.id} / ${variant} / ${label}`, async function () {
            if (rule.template === "one-time-mint") await runOneTimeMint(rule, variant, parameters);
            else if (rule.template === "collateral-coverage") {
              await runCollateralCoverage(rule, variant, parameters);
            } else {
              await runFundedValue(rule, variant, parameters);
            }
          });
        }
      }
    }
  });
}
