import path from "node:path";
import { loadAdapterRegistry, validateAdapterParameters } from "./adapter-spec.mjs";

const OUTCOMES = new Set(["preserve", "violate"]);
const PHASES = new Set(["setup", "entry", "callback", "reentry", "assertion"]);
const CATEGORIES = new Set(["uniqueness", "solvency", "conservation", "authorization", "consistency"]);
const RELATIONS = new Set(["lte", "gte", "eq", "predicate"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const EVIDENCE = new Set(["static-state-conflict", "local-counterexample", "regression-confirmed"]);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FORBIDDEN_KEYS = /^(rpc|rpcurl|url|network|chainid|privatekey|mnemonic|wallet|account|address|mainnet|testnet)$/i;

function fail(message) {
  throw new Error(`Invalid research rule specification: ${message}`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unsupported field \`${key}\``);
  }
}

function rejectExternalExecutionFields(value, trail = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectExternalExecutionFields(item, `${trail}[${index}]`));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail(`${trail}.${key} is forbidden in this local-only format`);
    rejectExternalExecutionFields(child, `${trail}.${key}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
}

function stringList(value, label, { min = 0, max = 50, unique = false } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain ${min} to ${max} items`);
  }
  const seen = new Set();
  for (const item of value) {
    nonEmptyString(item, label);
    if (unique && seen.has(item)) fail(`${label} contains a duplicate value`);
    seen.add(item);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label} must be a Solidity identifier`);
}

function identifierList(value, label) {
  stringList(value, label, { max: 50, unique: true });
  value.forEach((item) => identifier(item, label));
}

function validateDynamic(dynamic, rule, label) {
  if (!object(dynamic)) fail(`${label}.dynamic must be an object`);
  onlyKeys(dynamic, ["adapter", "path", "variants", "parameters", "expectations"], `${label}.dynamic`);
  const adapter = loadAdapterRegistry().get(dynamic.adapter);
  if (adapter === undefined) fail(`${label}.dynamic.adapter is not a reviewed callback adapter`);
  if (adapter.dataset !== rule.dataset) fail(`${label}.dataset must match the adapter dataset`);

  if (!object(dynamic.path)) fail(`${label}.dynamic.path must be an object`);
  onlyKeys(dynamic.path, ["contract", "outerFunction", "reentryFunction"], `${label}.dynamic.path`);
  identifier(dynamic.path.contract, `${label}.dynamic.path.contract`);
  identifier(dynamic.path.outerFunction, `${label}.dynamic.path.outerFunction`);
  identifier(dynamic.path.reentryFunction, `${label}.dynamic.path.reentryFunction`);

  if (!object(dynamic.variants)) fail(`${label}.dynamic.variants must be an object`);
  onlyKeys(dynamic.variants, ["vulnerableContract", "fixedContract"], `${label}.dynamic.variants`);
  identifier(dynamic.variants.vulnerableContract, `${label}.dynamic.variants.vulnerableContract`);
  identifier(dynamic.variants.fixedContract, `${label}.dynamic.variants.fixedContract`);

  const reviewed = adapter.binding;
  for (const [field, expected] of Object.entries(reviewed.path)) {
    if (dynamic.path[field] !== expected) fail(`${label}.dynamic.path does not match the reviewed ${dynamic.adapter} adapter`);
  }
  for (const [field, expected] of Object.entries(reviewed.variants)) {
    if (dynamic.variants[field] !== expected) fail(`${label}.dynamic.variants do not match the reviewed ${dynamic.adapter} adapter`);
  }

  if (!object(dynamic.expectations)) fail(`${label}.dynamic.expectations must be an object`);
  onlyKeys(dynamic.expectations, ["vulnerable", "fixed"], `${label}.dynamic.expectations`);
  if (!OUTCOMES.has(dynamic.expectations.vulnerable) || !OUTCOMES.has(dynamic.expectations.fixed)) {
    fail(`${label}.dynamic.expectations values must be \`preserve\` or \`violate\``);
  }
  validateAdapterParameters(adapter, dynamic.parameters, `${label}.dynamic.parameters`);

  const requiredContracts = [
    dynamic.path.contract,
    dynamic.variants.vulnerableContract,
    dynamic.variants.fixedContract,
  ];
  if (requiredContracts.some((name) => !rule.scope.contracts.includes(name))) {
    fail(`${label}.dynamic contract bindings must also appear in scope.contracts`);
  }
  if (![dynamic.path.outerFunction, dynamic.path.reentryFunction].every((name) => rule.scope.functions.includes(name))) {
    fail(`${label}.dynamic function bindings must also appear in scope.functions`);
  }
}

export function validateResearchSpec(input) {
  rejectExternalExecutionFields(input);
  if (!object(input)) fail("root must be an object");
  onlyKeys(input, ["schemaVersion", "localOnly", "source", "lab", "rules"], "root");
  if (input.schemaVersion !== 2) fail("schemaVersion must be 2");
  if (input.localOnly !== true) fail("localOnly must be true");

  if (!object(input.source)) fail("source must be an object");
  onlyKeys(input.source, ["kind", "title", "file"], "source");
  if (input.source.kind !== "natural-language") fail("source.kind must be natural-language");
  nonEmptyString(input.source.title, "source.title");
  nonEmptyString(input.source.file, "source.file");
  if (path.isAbsolute(input.source.file) || input.source.file.split(/[\\/]/).includes("..")) {
    fail("source.file must remain inside the project");
  }

  if (!object(input.lab)) fail("lab must be an object");
  onlyKeys(input.lab, ["name", "description"], "lab");
  nonEmptyString(input.lab.name, "lab.name");
  nonEmptyString(input.lab.description, "lab.description");

  if (!Array.isArray(input.rules) || input.rules.length === 0 || input.rules.length > 50) {
    fail("rules must contain 1 to 50 entries");
  }
  const ids = new Set();
  for (const [index, rule] of input.rules.entries()) {
    const label = `rules[${index}]`;
    if (!object(rule)) fail(`${label} must be an object`);
    onlyKeys(
      rule,
      ["id", "dataset", "statement", "expected", "scope", "model", "bindingConfidence", "assumptions", "evidenceRequired", "dynamic"],
      label,
    );
    if (typeof rule.id !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(rule.id)) fail(`${label}.id is invalid`);
    if (ids.has(rule.id)) fail(`${label}.id is duplicated`);
    ids.add(rule.id);
    if (!["development", "holdout"].includes(rule.dataset)) fail(`${label}.dataset must be development or holdout`);
    nonEmptyString(rule.statement, `${label}.statement`);
    if (rule.expected !== "preserve") fail(`${label}.expected must be preserve`);

    if (!object(rule.scope)) fail(`${label}.scope must be an object`);
    onlyKeys(rule.scope, ["contracts", "functions", "states"], `${label}.scope`);
    identifierList(rule.scope.contracts, `${label}.scope.contracts`);
    identifierList(rule.scope.functions, `${label}.scope.functions`);
    identifierList(rule.scope.states, `${label}.scope.states`);
    if (rule.scope.contracts.length + rule.scope.functions.length + rule.scope.states.length === 0) {
      fail(`${label}.scope must bind the natural-language rule to at least one code identifier`);
    }

    if (!object(rule.model)) fail(`${label}.model must be an object`);
    onlyKeys(rule.model, ["actors", "preconditions", "actions", "observables", "invariant"], `${label}.model`);
    stringList(rule.model.actors, `${label}.model.actors`, { min: 1, max: 10, unique: true });
    stringList(rule.model.preconditions, `${label}.model.preconditions`, { max: 20 });
    identifierList(rule.model.observables, `${label}.model.observables`);
    if (rule.model.observables.some((name) => !rule.scope.states.includes(name))) {
      fail(`${label}.model.observables must also appear in scope.states`);
    }
    if (!Array.isArray(rule.model.actions) || rule.model.actions.length === 0 || rule.model.actions.length > 20) {
      fail(`${label}.model.actions must contain 1 to 20 items`);
    }
    for (const [actionIndex, action] of rule.model.actions.entries()) {
      const actionLabel = `${label}.model.actions[${actionIndex}]`;
      if (!object(action)) fail(`${actionLabel} must be an object`);
      onlyKeys(action, ["phase", "actor", "function"], actionLabel);
      if (!PHASES.has(action.phase)) fail(`${actionLabel}.phase is unsupported`);
      nonEmptyString(action.actor, `${actionLabel}.actor`);
      identifier(action.function, `${actionLabel}.function`);
      if (!rule.scope.functions.includes(action.function)) fail(`${actionLabel}.function must appear in scope.functions`);
    }
    if (!object(rule.model.invariant)) fail(`${label}.model.invariant must be an object`);
    onlyKeys(rule.model.invariant, ["category", "relation", "statement"], `${label}.model.invariant`);
    if (!CATEGORIES.has(rule.model.invariant.category)) fail(`${label}.model.invariant.category is unsupported`);
    if (!RELATIONS.has(rule.model.invariant.relation)) fail(`${label}.model.invariant.relation is unsupported`);
    nonEmptyString(rule.model.invariant.statement, `${label}.model.invariant.statement`);

    if (!CONFIDENCE.has(rule.bindingConfidence)) fail(`${label}.bindingConfidence is unsupported`);
    stringList(rule.assumptions, `${label}.assumptions`, { max: 20 });
    stringList(rule.evidenceRequired, `${label}.evidenceRequired`, { min: 1, max: 3, unique: true });
    if (rule.evidenceRequired.some((item) => !EVIDENCE.has(item))) fail(`${label}.evidenceRequired is unsupported`);
    if (rule.dynamic !== undefined) validateDynamic(rule.dynamic, rule, label);
  }
  return input;
}

export function runtimeSuite(input) {
  const spec = validateResearchSpec(input);
  const rules = spec.rules.filter((rule) => rule.dynamic !== undefined).map((rule) => ({
    id: rule.id,
    dataset: rule.dataset,
    description: rule.statement,
    template: rule.dynamic.adapter,
    adapter: loadAdapterRegistry().get(rule.dynamic.adapter),
    variants: {
      vulnerable: rule.dynamic.variants.vulnerableContract,
      fixed: rule.dynamic.variants.fixedContract,
    },
    parameters: rule.dynamic.parameters,
    expectations: rule.dynamic.expectations,
  }));
  if (rules.length === 0) fail("at least one rule must provide a reviewed dynamic adapter");
  return {
    schemaVersion: spec.schemaVersion,
    lab: { ...spec.lab, localOnly: true },
    rules,
  };
}

export function dynamicPathKey(pathBinding) {
  return `${pathBinding.contract}/${pathBinding.outerFunction}/${pathBinding.reentryFunction}`;
}
