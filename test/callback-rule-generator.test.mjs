import assert from "node:assert/strict";
import test from "node:test";
import { generateTestSource, validateRules } from "../scripts/generate-callback-tests.mjs";

function validInput() {
  return {
    schemaVersion: 1,
    lab: { name: "test lab", localOnly: true, description: "bounded local test" },
    rules: [
      {
        id: "mint-limit",
        description: "one mint per address",
        template: "one-time-mint",
        parameters: [{}],
        expectations: { vulnerable: "violate", fixed: "preserve" },
      },
    ],
  };
}

test("accepts a bounded local-only business rule", () => {
  assert.equal(validateRules(validInput()).rules.length, 1);
  assert.match(generateTestSource(validInput()), /registerGeneratedCallbackRules/);
});

test("rejects external network and credential fields at any depth", () => {
  const withRpc = validInput();
  withRpc.lab.rpcUrl = "https://example.invalid";
  assert.throws(() => validateRules(withRpc), /forbidden/);

  const withKey = validInput();
  withKey.rules[0].parameters[0].privateKey = "not-a-real-key";
  assert.throws(() => validateRules(withKey), /forbidden/);
});

test("rejects unknown adapters and out-of-range callback parameters", () => {
  const unknown = validInput();
  unknown.rules[0].template = "arbitrary-code";
  assert.throws(() => validateRules(unknown), /supported callback adapter/);

  const unbounded = validInput();
  unbounded.rules[0] = {
    ...unbounded.rules[0],
    template: "collateral-coverage",
    parameters: [{ borrowAmount: 1_000_000 }],
  };
  assert.throws(() => validateRules(unbounded), /must be an integer from 11 to 20/);
});
