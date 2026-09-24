import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateGroundTruth, validateGroundTruth } from "../scripts/evaluate-ground-truth.mjs";

function fixture(sha256) {
  return {
    schemaVersion: 1,
    localOnly: true,
    baseline: {
      id: "test-baseline",
      commit: "0f2f275",
      frozenFiles: [{ path: "engine.txt", sha256 }],
    },
    acceptance: {
      minimumPrecision: 0.5,
      minimumRecall: 1,
      minimumSpecificity: 0,
      minimumDynamicPassRate: 1,
      maximumBaselineDriftFiles: 0,
    },
    holdouts: [{ ruleId: "holdout-rule", adapter: "holdout-adapter", executorChanged: false }],
    cases: [
      {
        id: "positive-path",
        dataset: "holdout",
        kind: "positive",
        path: { contract: "Vulnerable", outerFunction: "outer", candidateFunction: "reenter" },
        expectedStatic: "candidate",
        dynamic: { ruleId: "holdout-rule", variant: "vulnerable", expectedOutcome: "violate" },
        rationale: "A labeled positive path.",
      },
      {
        id: "negative-path",
        dataset: "control",
        kind: "negative",
        path: { contract: "Control", outerFunction: "outer", candidateFunction: "restricted" },
        expectedStatic: "absent",
        dynamic: null,
        rationale: "A labeled negative path.",
      },
    ],
  };
}

test("computes labeled static and dynamic metrics against a frozen local baseline", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "callback-ground-truth-"));
  fs.writeFileSync(path.join(root, "engine.txt"), "frozen\n");
  const manifest = fixture(crypto.createHash("sha256").update("frozen\n").digest("hex"));
  const staticReport = {
    contracts: [{
      contract: "Vulnerable",
      reentryCandidates: [{ outerFunction: "outer", candidateFunction: "reenter", severity: "high" }],
    }],
  };
  const dynamicReport = {
    observations: [{ ruleId: "holdout-rule", variant: "vulnerable", observed: "violate", passed: true }],
  };

  const report = evaluateGroundTruth(manifest, staticReport, dynamicReport, root);

  assert.equal(report.metrics.truePositive, 1);
  assert.equal(report.metrics.trueNegative, 1);
  assert.equal(report.metrics.dynamicPassRate, 1);
  assert.equal(report.metrics.baselineDriftFiles, 0);
  assert.equal(report.acceptance.passed, true);
});

test("rejects unsafe fields and inconsistent positive/negative labels", () => {
  const manifest = fixture("0".repeat(64));
  manifest.wallet = "not-allowed";
  assert.throws(() => validateGroundTruth(manifest), /wallet is forbidden/);

  const inconsistent = fixture("0".repeat(64));
  inconsistent.cases[0].expectedStatic = "absent";
  assert.throws(() => validateGroundTruth(inconsistent), /kind must agree/);
});
