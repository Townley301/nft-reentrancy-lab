import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "../..");
const DEFAULT_ADAPTER_DIR = path.join(PROJECT_ROOT, "rules", "adapters");
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ID = /^[a-z][a-z0-9-]{2,63}$/;
const FORBIDDEN_KEYS = /^(rpc|rpcurl|url|network|chainid|privatekey|mnemonic|wallet|account|address|mainnet|testnet|code|script)$/i;

function fail(message) {
  throw new Error(`Invalid callback adapter specification: ${message}`);
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
    if (FORBIDDEN_KEYS.test(key)) fail(`${trail}.${key} is forbidden in a local adapter`);
    rejectExternalExecutionFields(child, `${trail}.${key}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label} must be a Solidity identifier`);
}

function adapterId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} must be a lowercase kebab-case identifier`);
}

function validateExpression(expression, context, label, { allowObservation = false } = {}) {
  if (!object(expression)) fail(`${label} must be an expression object`);
  if (expression.kind === "uint") {
    onlyKeys(expression, ["kind", "value"], label);
    if (typeof expression.value !== "string" || !/^[0-9]+$/.test(expression.value)) fail(`${label}.value must be an unsigned integer string`);
    return;
  }
  if (expression.kind === "bool") {
    onlyKeys(expression, ["kind", "value"], label);
    if (typeof expression.value !== "boolean") fail(`${label}.value must be a boolean`);
    return;
  }
  if (expression.kind === "contract") {
    onlyKeys(expression, ["kind", "id"], label);
    adapterId(expression.id, `${label}.id`);
    if (!context.deployments.has(expression.id)) fail(`${label} references an unknown deployment`);
    return;
  }
  if (expression.kind === "param") {
    onlyKeys(expression, ["kind", "name"], label);
    identifier(expression.name, `${label}.name`);
    if (!context.parameters.has(expression.name)) fail(`${label} references an undeclared parameter`);
    return;
  }
  if (expression.kind === "observation") {
    onlyKeys(expression, ["kind", "id"], label);
    if (!allowObservation) fail(`${label} cannot read observations in this phase`);
    adapterId(expression.id, `${label}.id`);
    if (!context.observations.has(expression.id)) fail(`${label} references an unknown observation`);
    return;
  }
  if (["add", "sub", "mul"].includes(expression.kind)) {
    onlyKeys(expression, ["kind", "left", "right"], label);
    validateExpression(expression.left, context, `${label}.left`, { allowObservation });
    validateExpression(expression.right, context, `${label}.right`, { allowObservation });
    return;
  }
  fail(`${label}.kind is unsupported`);
}

function validateCall(call, context, label) {
  if (!object(call)) fail(`${label} must be an object`);
  onlyKeys(call, ["target", "function", "args", "allowRevert"], label);
  adapterId(call.target, `${label}.target`);
  if (!context.deployments.has(call.target)) fail(`${label}.target references an unknown deployment`);
  identifier(call.function, `${label}.function`);
  if (!Array.isArray(call.args) || call.args.length > 12) fail(`${label}.args must contain at most 12 items`);
  call.args.forEach((item, index) => validateExpression(item, context, `${label}.args[${index}]`));
  if (call.allowRevert !== undefined) {
    if (typeof call.allowRevert === "boolean") return;
    if (!object(call.allowRevert)) fail(`${label}.allowRevert must be a boolean or variant map`);
    onlyKeys(call.allowRevert, ["vulnerable", "fixed"], `${label}.allowRevert`);
    if (typeof call.allowRevert.vulnerable !== "boolean" || typeof call.allowRevert.fixed !== "boolean") {
      fail(`${label}.allowRevert variants must be booleans`);
    }
  }
}

export function validateAdapterSpec(input) {
  rejectExternalExecutionFields(input);
  if (!object(input)) fail("root must be an object");
  onlyKeys(
    input,
    ["schemaVersion", "id", "dataset", "description", "callbackStandard", "binding", "parameterBounds", "deployments", "setup", "entry", "observations", "assertion"],
    "root",
  );
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1");
  adapterId(input.id, "id");
  if (!["development", "holdout"].includes(input.dataset)) fail("dataset must be development or holdout");
  nonEmptyString(input.description, "description");
  if (!["ERC721", "ERC1155"].includes(input.callbackStandard)) fail("callbackStandard is unsupported");

  if (!object(input.binding)) fail("binding must be an object");
  onlyKeys(input.binding, ["path", "variants"], "binding");
  if (!object(input.binding.path)) fail("binding.path must be an object");
  onlyKeys(input.binding.path, ["contract", "outerFunction", "reentryFunction"], "binding.path");
  Object.entries(input.binding.path).forEach(([key, value]) => identifier(value, `binding.path.${key}`));
  if (!object(input.binding.variants)) fail("binding.variants must be an object");
  onlyKeys(input.binding.variants, ["vulnerableContract", "fixedContract"], "binding.variants");
  Object.entries(input.binding.variants).forEach(([key, value]) => identifier(value, `binding.variants.${key}`));

  if (!object(input.parameterBounds) || Object.keys(input.parameterBounds).length > 12) fail("parameterBounds must be an object with at most 12 entries");
  const parameters = new Set();
  for (const [name, bounds] of Object.entries(input.parameterBounds)) {
    identifier(name, `parameterBounds.${name}`);
    if (!object(bounds)) fail(`parameterBounds.${name} must be an object`);
    onlyKeys(bounds, ["minimum", "maximum"], `parameterBounds.${name}`);
    if (!Number.isSafeInteger(bounds.minimum) || !Number.isSafeInteger(bounds.maximum) || bounds.minimum > bounds.maximum) {
      fail(`parameterBounds.${name} must have ordered safe integer bounds`);
    }
    parameters.add(name);
  }

  if (!Array.isArray(input.deployments) || input.deployments.length === 0 || input.deployments.length > 20) {
    fail("deployments must contain 1 to 20 entries");
  }
  const deployments = new Set();
  const context = { deployments, parameters, observations: new Set() };
  for (const [index, deployment] of input.deployments.entries()) {
    const label = `deployments[${index}]`;
    if (!object(deployment)) fail(`${label} must be an object`);
    onlyKeys(deployment, ["id", "contract", "constructorArgs"], label);
    adapterId(deployment.id, `${label}.id`);
    if (deployments.has(deployment.id)) fail(`${label}.id is duplicated`);
    if (typeof deployment.contract === "string") identifier(deployment.contract, `${label}.contract`);
    else {
      if (!object(deployment.contract)) fail(`${label}.contract must be a contract name or variant map`);
      onlyKeys(deployment.contract, ["vulnerable", "fixed"], `${label}.contract`);
      identifier(deployment.contract.vulnerable, `${label}.contract.vulnerable`);
      identifier(deployment.contract.fixed, `${label}.contract.fixed`);
    }
    if (!Array.isArray(deployment.constructorArgs) || deployment.constructorArgs.length > 10) {
      fail(`${label}.constructorArgs must contain at most 10 items`);
    }
    deployment.constructorArgs.forEach((item, argIndex) => validateExpression(item, context, `${label}.constructorArgs[${argIndex}]`));
    deployments.add(deployment.id);
  }

  if (!Array.isArray(input.setup) || input.setup.length > 30) fail("setup must contain at most 30 calls");
  input.setup.forEach((call, index) => validateCall(call, context, `setup[${index}]`));
  validateCall(input.entry, context, "entry");

  if (!Array.isArray(input.observations) || input.observations.length === 0 || input.observations.length > 20) {
    fail("observations must contain 1 to 20 entries");
  }
  for (const [index, observation] of input.observations.entries()) {
    const label = `observations[${index}]`;
    if (!object(observation)) fail(`${label} must be an object`);
    onlyKeys(observation, ["id", "target", "function", "args"], label);
    adapterId(observation.id, `${label}.id`);
    if (context.observations.has(observation.id)) fail(`${label}.id is duplicated`);
    adapterId(observation.target, `${label}.target`);
    if (!deployments.has(observation.target)) fail(`${label}.target references an unknown deployment`);
    identifier(observation.function, `${label}.function`);
    if (!Array.isArray(observation.args) || observation.args.length > 12) fail(`${label}.args must contain at most 12 items`);
    observation.args.forEach((item, argIndex) => validateExpression(item, context, `${label}.args[${argIndex}]`));
    context.observations.add(observation.id);
  }

  if (!object(input.assertion)) fail("assertion must be an object");
  onlyKeys(input.assertion, ["operator", "left", "right"], "assertion");
  if (!["lte", "gte", "eq"].includes(input.assertion.operator)) fail("assertion.operator is unsupported");
  validateExpression(input.assertion.left, context, "assertion.left", { allowObservation: true });
  validateExpression(input.assertion.right, context, "assertion.right", { allowObservation: true });
  return input;
}

let cachedRegistry;

export function loadAdapterRegistry(directory = DEFAULT_ADAPTER_DIR) {
  if (directory === DEFAULT_ADAPTER_DIR && cachedRegistry !== undefined) return cachedRegistry;
  const registry = new Map();
  for (const name of fs.readdirSync(directory).filter((item) => item.endsWith(".json") && item !== "adapter-spec.schema.json").sort()) {
    const spec = validateAdapterSpec(JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
    if (registry.has(spec.id)) fail(`adapter id ${spec.id} is duplicated`);
    registry.set(spec.id, spec);
  }
  if (directory === DEFAULT_ADAPTER_DIR) cachedRegistry = registry;
  return registry;
}

export function validateAdapterParameters(spec, parameters, label) {
  if (!Array.isArray(parameters) || parameters.length === 0 || parameters.length > 12) {
    fail(`${label} must contain 1 to 12 bounded cases`);
  }
  const expected = Object.keys(spec.parameterBounds).sort();
  for (const [index, item] of parameters.entries()) {
    if (!object(item)) fail(`${label}[${index}] must be an object`);
    const actual = Object.keys(item).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}[${index}] parameters do not match adapter bounds`);
    for (const [name, bounds] of Object.entries(spec.parameterBounds)) {
      const value = item[name];
      if (!Number.isSafeInteger(value) || value < bounds.minimum || value > bounds.maximum) {
        fail(`${label}[${index}].${name} must be an integer from ${bounds.minimum} to ${bounds.maximum}`);
      }
    }
  }
}
