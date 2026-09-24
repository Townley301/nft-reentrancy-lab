import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../scripts/analyze-shared-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function candidates(report, contractName) {
  return report.contracts.find((item) => item.contract === contractName)?.reentryCandidates ?? [];
}

function hasPath(paths, outerFunction, candidateFunction, state) {
  return paths.some(
    (path) =>
      path.outerFunction === outerFunction &&
      path.candidateFunction === candidateFunction &&
      path.statesUsedAfterCallback.includes(state),
  );
}

test("finds the five deliberately vulnerable teaching patterns", () => {
  const report = analyzeProject(root);

  assert.equal(
    hasPath(candidates(report, "HypeBearsVulnerable"), "mintNFT", "mintNFT", "addressMinted"),
    true,
  );
  assert.equal(
    hasPath(candidates(report, "OmniPoolVulnerable"), "withdraw", "liquidate", "usingAsCollateral"),
    true,
  );
  assert.equal(
    hasPath(
      candidates(report, "RevestVulnerable"),
      "createSeries",
      "depositAdditionalToFNFT",
      "nextId",
    ),
    true,
  );
  assert.equal(
    hasPath(candidates(report, "MarketplaceVulnerable"), "buy", "refundListing", "listings"),
    true,
  );
  assert.equal(
    hasPath(candidates(report, "BatchVoucherVulnerable"), "distributePair", "claimBonus", "credits"),
    true,
  );
});

test("does not raise the same post-callback ordering candidates for fixed contracts", () => {
  const report = analyzeProject(root);
  for (const contractName of [
    "HypeBearsFixed",
    "OmniPoolFixed",
    "RevestFixed",
    "MarketplaceFixed",
    "BatchVoucherFixed",
  ]) {
    assert.equal(
      candidates(report, contractName).some((candidate) => candidate.severity !== "mitigated"),
      false,
      `${contractName} unexpectedly contains an unmitigated candidate`,
    );
  }
});

test("keeps safe and permission-limited controls visible as evaluation controls", () => {
  const report = analyzeProject(root);

  assert.equal(candidates(report, "SafeCallbackControl").length, 0);
  assert.equal(
    hasPath(candidates(report, "PermissionedCallbackControl"), "deliver", "adminCancel", "finalized"),
    true,
  );
});

test("records the local-only safety boundary", () => {
  const report = analyzeProject(root);
  assert.equal(report.safetyBoundary.rpcCalls, false);
  assert.equal(report.safetyBoundary.privateKeys, false);
  assert.equal(report.safetyBoundary.realAssets, false);
});
