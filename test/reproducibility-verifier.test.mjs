import assert from "node:assert/strict";
import test from "node:test";
import expected from "../evaluation/expected-summary.json" with { type: "json" };
import { verifyReproducibility } from "../scripts/verify-reproducibility.mjs";

function reports() {
  return {
    business: {
      summary: structuredClone(expected.business),
      safetyBoundary: { rpcCalls: false, privateKeys: false, realAssets: false, arbitraryAdapterCode: false },
    },
    coverage: {
      summary: structuredClone(expected.coverage),
      safetyBoundary: { rpcCalls: false, privateKeys: false, realAssets: false },
    },
    evaluation: {
      metrics: structuredClone(expected.groundTruth),
      safetyBoundary: { rpcCalls: false, privateKeys: false, realAssets: false, toyAssetsOnly: true },
      acceptance: { passed: true },
    },
  };
}

test("accepts the versioned local-only reproducibility summary", () => {
  const { business, coverage, evaluation } = reports();
  assert.deepEqual(
    verifyReproducibility(expected, business, coverage, evaluation, { htmlExists: true }),
    { rules: 6, scenarios: 26, staticCandidates: 23, labeledPaths: 15 },
  );
});

test("rejects metric drift and a weakened local safety boundary", () => {
  const drifted = reports();
  drifted.business.summary.scenarios += 1;
  assert.throws(
    () => verifyReproducibility(expected, drifted.business, drifted.coverage, drifted.evaluation, { htmlExists: true }),
    /business\.summary\.scenarios expected 26, observed 27/,
  );

  const unsafe = reports();
  unsafe.evaluation.safetyBoundary.realAssets = true;
  assert.throws(
    () => verifyReproducibility(expected, unsafe.business, unsafe.coverage, unsafe.evaluation, { htmlExists: true }),
    /realAssets must be false/,
  );
});
