const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FORBIDDEN_KEYS = /^(rpc|rpcurl|url|network|chainid|privatekey|mnemonic|wallet|account|address|mainnet|testnet|code|script)$/i;

export const REASON_DISPOSITIONS = Object.freeze({
  "local-counterexample": "locally-demonstrated",
  "no-reviewed-local-scenario": "static-only",
  "callback-reachability-unproven": "static-only",
  "authorization-unproven": "static-only",
  "state-prerequisites-unproven": "static-only",
  "state-index-alias-unproven": "static-only",
  "authorization-blocked": "intentionally-rejected",
  "state-index-or-ownership-blocked": "intentionally-rejected",
});

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Invalid candidate review: ${message}`);
}

function onlyKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unsupported field \`${key}\``);
  }
}

function rejectUnsafeFields(value, trail = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectUnsafeFields(item, `${trail}[${index}]`));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail(`${trail}.${key} is forbidden in a local review manifest`);
    rejectUnsafeFields(child, `${trail}.${key}`);
  }
}

export function candidatePathKey(path) {
  return `${path.contract}/${path.outerFunction}/${path.candidateFunction}`;
}

export function validateCandidateReview(input) {
  rejectUnsafeFields(input);
  onlyKeys(input, ["schemaVersion", "localOnly", "reviews"], "root");
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (input.localOnly !== true) fail("localOnly must be true");
  if (!Array.isArray(input.reviews) || input.reviews.length === 0) fail("reviews must not be empty");

  const paths = new Set();
  for (const [index, review] of input.reviews.entries()) {
    const label = `reviews[${index}]`;
    onlyKeys(review, ["path", "disposition", "reasonCode", "rationale"], label);
    onlyKeys(review.path, ["contract", "outerFunction", "candidateFunction"], `${label}.path`);
    for (const [key, value] of Object.entries(review.path)) {
      if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label}.path.${key} must be a Solidity identifier`);
    }
    const path = candidatePathKey(review.path);
    if (paths.has(path)) fail(`${label}.path is duplicated`);
    paths.add(path);
    if (!Object.values(REASON_DISPOSITIONS).includes(review.disposition)) fail(`${label}.disposition is invalid`);
    if (REASON_DISPOSITIONS[review.reasonCode] !== review.disposition) {
      fail(`${label}.reasonCode is invalid for disposition ${review.disposition}`);
    }
    if (typeof review.rationale !== "string" || review.rationale.trim() === "") fail(`${label}.rationale must not be empty`);
  }
  return input;
}
