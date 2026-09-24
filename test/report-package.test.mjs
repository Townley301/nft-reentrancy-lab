import assert from "node:assert/strict";
import test from "node:test";
import expected from "../evaluation/expected-summary.json" with { type: "json" };
import plan from "../evaluation/blind-review-plan.json" with { type: "json" };
import {
  BLIND_LABEL_KEYS,
  buildBlindReviewPacket,
  renderLatexMetrics,
  validateBlindReviewPlan,
  verifyLatexPackage,
} from "../scripts/lib/report-package.mjs";

const reportText = String.raw`\input{report/metrics.tex}
\RuleCount \ScenarioCount \StaticCandidateCount \PrecisionPercent \BaselineDriftCount`;

test("keeps the LaTeX metrics synchronized with the versioned summary", () => {
  const metrics = renderLatexMetrics(expected);
  assert.match(metrics, /\\newcommand\{\\RuleCount\}\{6\}/);
  assert.match(metrics, /\\newcommand\{\\PrecisionPercent\}\{75\.0\\%\}/);
  assert.equal(verifyLatexPackage(expected, metrics, reportText), true);
  assert.throws(() => verifyLatexPackage(expected, metrics.replace("{23}", "{24}"), reportText), /does not match/);
});

test("builds a label-free packet from local static facts and rejects unsafe plans", () => {
  const contracts = plan.sample.map((item, index) => ({
    contract: item.path.contract,
    file: `contracts/Toy${index}.sol`,
    reentryCandidates: [{
      outerFunction: item.path.outerFunction,
      candidateFunction: item.path.candidateFunction,
      callback: "local Toy callback",
      callbackLine: 10,
      candidateLine: 20,
      pattern: "cross-function",
      severity: "medium",
      sharedStates: ["toyState"],
      statesUsedAfterCallback: ["toyState"],
      guard: "no shared local guard observed",
    }],
  }));
  const packet = buildBlindReviewPacket(plan, { contracts });
  assert.equal(packet.cases.length, 6);
  assert.equal(packet.reviewStatus, "pending-independent-review");
  assert.deepEqual(packet.safetyBoundary, { rpcCalls: false, privateKeys: false, realAssets: false, deployment: false });
  for (const item of packet.cases) {
    for (const key of BLIND_LABEL_KEYS) assert.equal(Object.hasOwn(item, key), false);
  }

  const unsafe = structuredClone(plan);
  unsafe.wallet = "not-allowed";
  assert.throws(() => validateBlindReviewPlan(unsafe), /wallet is forbidden/);

  const missing = structuredClone(plan);
  missing.sample[0].path.contract = "MissingToyContract";
  assert.throws(() => buildBlindReviewPacket(missing, { contracts }), /absent from static analysis/);
});
