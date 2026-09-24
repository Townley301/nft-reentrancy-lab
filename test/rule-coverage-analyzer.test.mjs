import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCoverage, validateResearchSpec } from "../scripts/audit-rule-coverage.mjs";

const spec = {
  schemaVersion: 2,
  localOnly: true,
  source: { kind: "natural-language", title: "mint rule", file: "rules/input.txt" },
  lab: { name: "coverage lab", description: "test coverage bindings" },
  rules: [{
    id: "one-mint",
    dataset: "development",
    statement: "one address may mint once",
    expected: "preserve",
    scope: {
      contracts: ["HypeBearsVulnerable", "HypeBearsFixed"],
      functions: ["mintNFT", "onERC721Received"],
      states: ["addressMinted", "balanceOf"],
    },
    model: {
      actors: ["receiver"],
      preconditions: [],
      actions: [
        { phase: "entry", actor: "receiver", function: "mintNFT" },
        { phase: "callback", actor: "token", function: "onERC721Received" },
      ],
      observables: ["addressMinted", "balanceOf"],
      invariant: { category: "uniqueness", relation: "lte", statement: "balance increase <= 1" },
    },
    bindingConfidence: "high",
    assumptions: [],
    evidenceRequired: ["static-state-conflict", "local-counterexample"],
    dynamic: {
      adapter: "one-time-mint",
      path: { contract: "HypeBearsVulnerable", outerFunction: "mintNFT", reentryFunction: "mintNFT" },
      variants: { vulnerableContract: "HypeBearsVulnerable", fixedContract: "HypeBearsFixed" },
      parameters: [{}],
      expectations: { vulnerable: "violate", fixed: "preserve" },
    },
  }],
};

const staticReport = {
  contracts: [
    { contract: "HypeBearsVulnerable", file: "Hype.sol", reentryCandidates: [{
      outerFunction: "mintNFT", candidateFunction: "mintNFT", severity: "high", pattern: "same-function",
      sharedStates: ["addressMinted"], statesUsedAfterCallback: ["addressMinted"], callback: "ERC-721",
    }] },
    { contract: "UnknownPool", file: "Pool.sol", reentryCandidates: [{
      outerFunction: "withdraw", candidateFunction: "liquidate", severity: "high", pattern: "cross-function",
      sharedStates: ["debt"], statesUsedAfterCallback: ["debt"], callback: "ERC-721",
    }] },
  ],
};

const dynamicReport = {
  observations: [{ template: "one-time-mint", variant: "vulnerable", observed: "violate", parameters: {}, evidence: { balance: 2 } }],
};

test("binds unified rules and separates undeclared candidates", () => {
  const report = analyzeCoverage(spec, staticReport, dynamicReport);
  assert.equal(report.summary.coveredCandidates, 1);
  assert.equal(report.summary.undeclaredCandidates, 1);
  assert.equal(report.summary.locallyDemonstratedCandidates, 1);
  assert.equal(report.summary.staticOnlyCandidates, 1);
  assert.equal(report.ruleCoverage[0].status, "locally-demonstrated");
  assert.equal(report.ruleCoverage[0].bindingConfidence, "high");
  assert.equal(report.candidates.find((item) => item.contract === "UnknownPool").evidenceLevel, "static-candidate");
});

test("rejects unbound rules and paths outside the project", () => {
  const unbound = structuredClone(spec);
  unbound.rules[0].scope = { contracts: [], functions: [], states: [] };
  assert.throws(() => validateResearchSpec(unbound), /bind/);
  const escaped = structuredClone(spec);
  escaped.source.file = "../outside.txt";
  assert.throws(() => validateResearchSpec(escaped), /inside the project/);
});

test("never labels an unproven path as dynamically demonstrated", () => {
  const report = analyzeCoverage(spec, staticReport, undefined);
  assert.equal(report.candidates.every((item) => item.evidenceLevel === "static-candidate"), true);
});
