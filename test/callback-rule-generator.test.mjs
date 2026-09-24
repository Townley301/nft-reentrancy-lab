import assert from "node:assert/strict";
import test from "node:test";
import { generateTestSource, validateRules } from "../scripts/generate-callback-tests.mjs";

function validInput() {
  return {
    schemaVersion: 2,
    localOnly: true,
    source: { kind: "natural-language", title: "test rules", file: "rules/input.txt" },
    lab: { name: "test lab", description: "bounded local test" },
    rules: [{
      id: "mint-limit",
      statement: "one mint per address",
      expected: "preserve",
      scope: {
        contracts: ["HypeBearsVulnerable", "HypeBearsFixed"],
        functions: ["mintNFT", "onERC721Received"],
        states: ["addressMinted", "balanceOf"],
      },
      model: {
        actors: ["receiver"],
        preconditions: ["the entitlement is unused"],
        actions: [
          { phase: "entry", actor: "receiver", function: "mintNFT" },
          { phase: "callback", actor: "token", function: "onERC721Received" },
          { phase: "reentry", actor: "receiver", function: "mintNFT" },
        ],
        observables: ["addressMinted", "balanceOf"],
        invariant: { category: "uniqueness", relation: "lte", statement: "balance increase <= 1" },
      },
      bindingConfidence: "high",
      assumptions: [],
      evidenceRequired: ["static-state-conflict", "local-counterexample", "regression-confirmed"],
      dynamic: {
        adapter: "one-time-mint",
        path: { contract: "HypeBearsVulnerable", outerFunction: "mintNFT", reentryFunction: "mintNFT" },
        variants: { vulnerableContract: "HypeBearsVulnerable", fixedContract: "HypeBearsFixed" },
        parameters: [{}],
        expectations: { vulnerable: "violate", fixed: "preserve" },
      },
    }],
  };
}

test("accepts one unified invariant rule for binding and dynamic generation", () => {
  assert.equal(validateRules(validInput()).rules.length, 1);
  assert.match(generateTestSource(validInput()), /registerGeneratedCallbackRules/);
});

test("rejects external network and credential fields at any depth", () => {
  const withRpc = validInput();
  withRpc.lab.rpcUrl = "https://example.invalid";
  assert.throws(() => validateRules(withRpc), /forbidden/);

  const withKey = validInput();
  withKey.rules[0].dynamic.parameters[0].privateKey = "not-a-real-key";
  assert.throws(() => validateRules(withKey), /forbidden/);
});

test("rejects unknown adapters and out-of-range callback parameters", () => {
  const unknown = validInput();
  unknown.rules[0].dynamic.adapter = "arbitrary-code";
  assert.throws(() => validateRules(unknown), /supported callback adapter/);

  const unbounded = validInput();
  unbounded.rules[0].dynamic.adapter = "collateral-coverage";
  unbounded.rules[0].dynamic.path = {
    contract: "OmniPoolVulnerable",
    outerFunction: "withdraw",
    reentryFunction: "liquidate",
  };
  unbounded.rules[0].dynamic.variants = {
    vulnerableContract: "OmniPoolVulnerable",
    fixedContract: "OmniPoolFixed",
  };
  unbounded.rules[0].dynamic.parameters = [{ borrowAmount: 1_000_000 }];
  unbounded.rules[0].scope.contracts.push("OmniPoolVulnerable", "OmniPoolFixed");
  unbounded.rules[0].scope.functions.push("withdraw", "liquidate");
  assert.throws(() => validateRules(unbounded), /must be an integer from 11 to 20/);
});

test("requires model actions and observables to be bound to inspected code", () => {
  const unknownState = validInput();
  unknownState.rules[0].model.observables.push("unboundState");
  assert.throws(() => validateRules(unknownState), /observables must also appear/);

  const unknownFunction = validInput();
  unknownFunction.rules[0].model.actions[0].function = "unboundFunction";
  assert.throws(() => validateRules(unknownFunction), /must appear in scope.functions/);
});

test("does not attach reviewed dynamic evidence to a different path", () => {
  const mismatched = validInput();
  mismatched.rules[0].dynamic.path.reentryFunction = "onERC721Received";
  assert.throws(() => validateRules(mismatched), /does not match the reviewed/);
});
