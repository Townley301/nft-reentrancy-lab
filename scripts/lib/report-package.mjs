const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const REVIEW_ID = /^review-[0-9]{2}$/;
const FORBIDDEN_KEYS = /^(rpc|rpcurl|url|network|chainid|privatekey|mnemonic|wallet|account|address|mainnet|testnet|code|script)$/i;
export const BLIND_LABEL_KEYS = new Set([
  "coverage",
  "declaredBy",
  "dynamicEvidence",
  "evidenceLevel",
  "matchEvidence",
  "reasonCode",
  "reviewDisposition",
  "reviewRationale",
]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Invalid report package: ${message}`);
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
    if (FORBIDDEN_KEYS.test(key)) fail(`${trail}.${key} is forbidden in a local review plan`);
    rejectUnsafeFields(child, `${trail}.${key}`);
  }
}

function pathKey(value) {
  return `${value.contract}/${value.outerFunction}/${value.candidateFunction}`;
}

function percentage(value) {
  return `${(value * 100).toFixed(1)}\\%`;
}

export function renderLatexMetrics(expected) {
  const business = expected.business;
  const coverage = expected.coverage;
  const truth = expected.groundTruth;
  if (expected.schemaVersion !== 1 || expected.localOnly !== true || !business || !coverage || !truth) {
    fail("expected summary is not a local schema-v1 result");
  }
  const macros = [
    ["RuleCount", business.rules],
    ["DevelopmentRuleCount", business.developmentRules],
    ["HoldoutRuleCount", business.holdoutRules],
    ["ScenarioCount", business.scenarios],
    ["StaticCandidateCount", coverage.staticCandidates],
    ["DemonstratedCandidateCount", coverage.locallyDemonstratedCandidates],
    ["StaticOnlyCandidateCount", coverage.staticOnlyCandidates],
    ["RejectedCandidateCount", coverage.intentionallyRejectedCandidates],
    ["ReviewedCandidateCount", coverage.reviewedCandidates],
    ["UnreviewedCandidateCount", coverage.unreviewedCandidates],
    ["LabeledPathCount", truth.labeledPaths],
    ["TruePositiveCount", truth.truePositive],
    ["FalsePositiveCount", truth.falsePositive],
    ["FalseNegativeCount", truth.falseNegative],
    ["TrueNegativeCount", truth.trueNegative],
    ["PrecisionPercent", percentage(truth.precision)],
    ["RecallPercent", percentage(truth.recall)],
    ["SpecificityPercent", percentage(truth.specificity)],
    ["DynamicPassedCount", truth.dynamicPassed],
    ["DynamicCheckCount", truth.dynamicChecks],
    ["BaselineDriftCount", truth.baselineDriftFiles],
    ["HoldoutsWithoutChangeCount", truth.holdoutsWithoutExecutorChanges],
  ];
  return [
    "% Generated from evaluation/expected-summary.json; do not edit by hand.",
    ...macros.map(([name, value]) => `\\newcommand{\\${name}}{${value}}`),
    "",
  ].join("\n");
}

export function verifyLatexPackage(expected, metricsText, reportText) {
  const rendered = renderLatexMetrics(expected);
  if (metricsText !== rendered) fail("report/metrics.tex does not match evaluation/expected-summary.json");
  if (!reportText.includes("\\input{report/metrics.tex}")) fail("REPORT.tex must import the generated metrics file");
  for (const name of ["RuleCount", "ScenarioCount", "StaticCandidateCount", "PrecisionPercent", "BaselineDriftCount"]) {
    if (!reportText.includes(`\\${name}`)) fail(`REPORT.tex does not use \\${name}`);
  }
  return true;
}

export function validateBlindReviewPlan(input) {
  rejectUnsafeFields(input);
  onlyKeys(input, ["schemaVersion", "localOnly", "status", "sample"], "root");
  if (input.schemaVersion !== 1) fail("blind review schemaVersion must be 1");
  if (input.localOnly !== true) fail("blind review localOnly must be true");
  if (input.status !== "pending-independent-review") fail("blind review status must remain pending until a reviewer responds");
  if (!Array.isArray(input.sample) || input.sample.length === 0) fail("blind review sample must not be empty");
  const ids = new Set();
  const paths = new Set();
  for (const [index, item] of input.sample.entries()) {
    const label = `sample[${index}]`;
    onlyKeys(item, ["id", "path"], label);
    if (typeof item.id !== "string" || !REVIEW_ID.test(item.id) || ids.has(item.id)) fail(`${label}.id is invalid or duplicated`);
    ids.add(item.id);
    onlyKeys(item.path, ["contract", "outerFunction", "candidateFunction"], `${label}.path`);
    for (const [key, value] of Object.entries(item.path)) {
      if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label}.path.${key} must be a Solidity identifier`);
    }
    const key = pathKey(item.path);
    if (paths.has(key)) fail(`${label}.path is duplicated`);
    paths.add(key);
  }
  return input;
}

export function buildBlindReviewPacket(planInput, staticReport) {
  const plan = validateBlindReviewPlan(planInput);
  const candidates = new Map();
  for (const contract of staticReport.contracts ?? []) {
    for (const candidate of contract.reentryCandidates ?? []) {
      if (candidate.severity === "mitigated") continue;
      const item = { contract: contract.contract, file: contract.file, ...candidate };
      candidates.set(pathKey(item), item);
    }
  }
  const cases = plan.sample.map((sample) => {
    const candidate = candidates.get(pathKey(sample.path));
    if (!candidate) fail(`blind review path is absent from static analysis: ${pathKey(sample.path)}`);
    return {
      id: sample.id,
      path: sample.path,
      file: candidate.file,
      callback: candidate.callback,
      callbackLine: candidate.callbackLine,
      candidateLine: candidate.candidateLine,
      pattern: candidate.pattern,
      severity: candidate.severity,
      sharedStates: candidate.sharedStates,
      statesUsedAfterCallback: candidate.statesUsedAfterCallback,
      guardObservation: candidate.guard,
      questions: [
        "Is the candidate reachable by the callback receiver in this local Toy fixture?",
        "Do caller, ownership, parameter, and mapping-key prerequisites align?",
        "Should the path be locally-demonstrated, static-only, or intentionally-rejected, and why?",
      ],
    };
  });
  const packet = {
    schemaVersion: 1,
    localOnly: true,
    reviewStatus: "pending-independent-review",
    safetyBoundary: { rpcCalls: false, privateKeys: false, realAssets: false, deployment: false },
    omittedLabels: [...BLIND_LABEL_KEYS].sort(),
    cases,
  };
  const serialized = JSON.stringify(packet);
  for (const key of BLIND_LABEL_KEYS) {
    if (Object.hasOwn(packet, key) || cases.some((item) => Object.hasOwn(item, key))) fail(`blind packet leaked ${key}`);
  }
  if (serialized.includes("local-counterexample")) fail("blind packet leaked a review reason");
  return packet;
}
