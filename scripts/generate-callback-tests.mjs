#!/usr/bin/env node

/**
 * Generates bounded Hardhat callback tests from researcher-authored JSON rules.
 * The accepted schema intentionally has no RPC, account, address, or arbitrary-code fields.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_RULES = path.join(PROJECT_ROOT, "rules", "callback-rules.json");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "test", "generated", "callback-rules.test.ts");
const TEMPLATES = new Set(["one-time-mint", "collateral-coverage", "funded-value"]);
const OUTCOMES = new Set(["preserve", "violate"]);
const FORBIDDEN_KEYS = /^(rpc|rpcurl|url|network|chainid|privatekey|mnemonic|wallet|account|address|mainnet|testnet)$/i;

function fail(message) {
  throw new Error(`Invalid callback rule file: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unsupported field \`${key}\``);
  }
}

function rejectExternalExecutionFields(value, trail = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectExternalExecutionFields(item, `${trail}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail(`${trail}.${key} is forbidden in this local-only format`);
    rejectExternalExecutionFields(child, `${trail}.${key}`);
  }
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function validateParameters(template, parameters, label) {
  if (!Array.isArray(parameters) || parameters.length === 0 || parameters.length > 12) {
    fail(`${label}.parameters must contain 1 to 12 bounded cases`);
  }
  for (const [index, item] of parameters.entries()) {
    const itemLabel = `${label}.parameters[${index}]`;
    if (!isPlainObject(item)) fail(`${itemLabel} must be an object`);
    if (template === "one-time-mint") {
      assertOnlyKeys(item, [], itemLabel);
    } else if (template === "collateral-coverage") {
      assertOnlyKeys(item, ["borrowAmount"], itemLabel);
      boundedInteger(item.borrowAmount, 11, 20, `${itemLabel}.borrowAmount`);
    } else {
      assertOnlyKeys(
        item,
        ["outerQuantity", "depositPerUnit", "additionalQuantity"],
        itemLabel,
      );
      boundedInteger(item.outerQuantity, 1, 10, `${itemLabel}.outerQuantity`);
      boundedInteger(item.depositPerUnit, 1, 5, `${itemLabel}.depositPerUnit`);
      boundedInteger(item.additionalQuantity, 1, 3, `${itemLabel}.additionalQuantity`);
    }
  }
}

export function validateRules(input) {
  rejectExternalExecutionFields(input);
  if (!isPlainObject(input)) fail("root must be an object");
  assertOnlyKeys(input, ["schemaVersion", "lab", "rules"], "root");
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!isPlainObject(input.lab)) fail("lab must be an object");
  assertOnlyKeys(input.lab, ["name", "localOnly", "description"], "lab");
  if (typeof input.lab.name !== "string" || input.lab.name.trim() === "") fail("lab.name is required");
  if (input.lab.localOnly !== true) fail("lab.localOnly must be true");
  if (typeof input.lab.description !== "string") fail("lab.description must be a string");
  if (!Array.isArray(input.rules) || input.rules.length === 0 || input.rules.length > 25) {
    fail("rules must contain 1 to 25 entries");
  }

  const ids = new Set();
  for (const [index, rule] of input.rules.entries()) {
    const label = `rules[${index}]`;
    if (!isPlainObject(rule)) fail(`${label} must be an object`);
    assertOnlyKeys(rule, ["id", "description", "template", "parameters", "expectations"], label);
    if (typeof rule.id !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(rule.id)) {
      fail(`${label}.id must be a lowercase kebab-case identifier`);
    }
    if (ids.has(rule.id)) fail(`${label}.id is duplicated`);
    ids.add(rule.id);
    if (typeof rule.description !== "string" || rule.description.trim() === "") {
      fail(`${label}.description is required`);
    }
    if (!TEMPLATES.has(rule.template)) fail(`${label}.template is not a supported callback adapter`);
    if (!isPlainObject(rule.expectations)) fail(`${label}.expectations must be an object`);
    assertOnlyKeys(rule.expectations, ["vulnerable", "fixed"], `${label}.expectations`);
    if (!OUTCOMES.has(rule.expectations.vulnerable) || !OUTCOMES.has(rule.expectations.fixed)) {
      fail(`${label}.expectations values must be \`preserve\` or \`violate\``);
    }
    validateParameters(rule.template, rule.parameters, label);
  }

  return input;
}

export function generateTestSource(input, sourceLabel = "rules/callback-rules.json") {
  const rules = validateRules(input);
  const canonical = JSON.stringify(rules);
  const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `// Generated by scripts/generate-callback-tests.mjs. Do not edit by hand.\n` +
    `import { registerGeneratedCallbackRules } from "../support/callback-rule-runtime.js";\n\n` +
    `registerGeneratedCallbackRules(${JSON.stringify({ source: sourceLabel, digest, ...rules }, null, 2)});\n`;
}

export function generateFromFile(rulesPath = DEFAULT_RULES, outputPath = DEFAULT_OUTPUT) {
  const absoluteRules = path.resolve(rulesPath);
  const absoluteOutput = path.resolve(outputPath);
  const input = JSON.parse(fs.readFileSync(absoluteRules, "utf8"));
  const sourceLabel = path.relative(PROJECT_ROOT, absoluteRules) || path.basename(absoluteRules);
  const source = generateTestSource(input, sourceLabel);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, source);
  return { input, outputPath: absoluteOutput, sourceLabel };
}

function cliArguments(argv) {
  let rulesPath = DEFAULT_RULES;
  let outputPath = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rules" && argv[index + 1]) rulesPath = argv[++index];
    else if (argument === "--output" && argv[index + 1]) outputPath = argv[++index];
    else fail(`unknown or incomplete argument \`${argument}\``);
  }
  return { rulesPath, outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { rulesPath, outputPath } = cliArguments(process.argv.slice(2));
  const result = generateFromFile(rulesPath, outputPath);
  console.log(`已验证本地规则文件：${result.sourceLabel}`);
  console.log(`已生成回调测试：${path.relative(PROJECT_ROOT, result.outputPath)}`);
  console.log(`规则数量：${result.input.rules.length}`);
}
