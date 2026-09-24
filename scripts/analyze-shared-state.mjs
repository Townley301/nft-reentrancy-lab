#!/usr/bin/env node

/**
 * Local-only defensive Solidity callback/shared-state analyzer.
 *
 * It consumes Hardhat's compiler AST, never connects to a chain, and reports
 * candidate paths for review. A candidate is not proof of exploitability.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

function childrenOf(node) {
  const children = [];
  for (const [key, value] of Object.entries(node ?? {})) {
    if (key === "scope" || key === "referencedDeclaration") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && item.nodeType) children.push(item);
      }
    } else if (value && typeof value === "object" && value.nodeType) {
      children.push(value);
    }
  }
  return children;
}

function parseStart(src) {
  return Number(String(src ?? "0:0:0").split(":", 1)[0]);
}

function lineAt(source, byteOffset) {
  return Buffer.from(source, "utf8").subarray(0, byteOffset).toString("utf8").split("\n").length;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function functionKey(node) {
  const types = (node.parameters?.parameters ?? []).map(
    (parameter) => parameter.typeDescriptions?.typeString ?? parameter.typeName?.name ?? "?",
  );
  return `${node.name}(${types.join(",")})`;
}

function modifierNames(node) {
  return (node.modifiers ?? []).map((modifier) =>
    modifier.modifierName?.name ?? modifier.modifierName?.memberName ?? "unknown",
  );
}

function callbackKind(call) {
  const expression = call.expression ?? {};
  const name = expression.memberName ?? expression.name ?? "";
  const receiverType = expression.expression?.typeDescriptions?.typeString ?? "";

  if (name === "onERC721Received") return "ERC-721 receiver callback";
  if (name === "onERC1155Received" || name === "onERC1155BatchReceived") {
    return "ERC-1155 receiver callback";
  }
  if (name === "safeTransferFrom") {
    return receiverType.includes("1155") ? "ERC-1155 safe-transfer callback" : "ERC-721 safe-transfer callback";
  }
  if (name === "safeBatchTransferFrom") return "ERC-1155 batch callback";
  if ((name === "mint" || name === "safeMint") && receiverType.includes("1155")) {
    return "ERC-1155 mint callback";
  }
  return null;
}

function buildInfoFiles(root) {
  const directory = path.join(root, "artifacts", "build-info");
  const outputs = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".output.json"))
    .map((name) => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.time - left.time);
  if (outputs.length === 0) {
    throw new Error("No Hardhat build-info output found. Run `pnpm compile` first.");
  }
  return outputs.map(({ name }) => {
    const outputPath = path.join(directory, name);
    const inputPath = outputPath.replace(/\.output\.json$/, ".json");
    if (!fs.existsSync(inputPath)) throw new Error(`Missing matching compiler input: ${inputPath}`);
    return { inputPath, outputPath };
  });
}

function buildModel(inputPath, outputPath) {
  const inputBundle = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const outputBundle = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const input = inputBundle.input;
  const output = outputBundle.output;
  const displayNames = new Map(
    Object.entries(inputBundle.userSourceNameMap ?? {}).map(([display, internal]) => [internal, display]),
  );

  const contracts = new Map();
  const functions = new Map();
  const functionOwner = new Map();
  const modifiers = new Map();
  const modifierOwner = new Map();
  const stateVariables = new Map();

  for (const [internalName, sourceOutput] of Object.entries(output.sources)) {
    const source = input.sources[internalName]?.content ?? "";
    const file = displayNames.get(internalName) ?? internalName.replace(/^project\//, "");
    for (const contract of (sourceOutput.ast?.nodes ?? []).filter(
      (node) => node.nodeType === "ContractDefinition",
    )) {
      const record = { node: contract, source, file, internalName };
      contracts.set(contract.id, record);
      for (const child of contract.nodes ?? []) {
        if (child.nodeType === "FunctionDefinition") {
          functions.set(child.id, { node: child, source, file, contractId: contract.id });
          functionOwner.set(child.id, contract.id);
        }
        if (child.nodeType === "ModifierDefinition") {
          modifiers.set(child.id, { node: child, source, file, contractId: contract.id });
          modifierOwner.set(child.id, contract.id);
        }
        if (
          child.nodeType === "VariableDeclaration" &&
          child.stateVariable &&
          !child.constant &&
          child.mutability !== "immutable"
        ) {
          stateVariables.set(child.id, {
            id: child.id,
            name: child.name,
            contractId: contract.id,
            file,
            line: lineAt(source, parseStart(child.src)),
          });
        }
      }
    }
  }

  return {
    compiler: inputBundle.solcLongVersion ?? inputBundle.solcVersion,
    contracts,
    functions,
    functionOwner,
    modifiers,
    modifierOwner,
    stateVariables,
  };
}

function directAnalysis(record, stateVariables) {
  const events = [];
  const calls = [];
  const callbacks = [];

  function scan(node, mode = "read") {
    if (!node || typeof node !== "object") return;
    const position = parseStart(node.src);

    if (node.nodeType === "Identifier" && stateVariables.has(node.referencedDeclaration)) {
      events.push({ stateId: node.referencedDeclaration, mode, position });
      return;
    }
    if (node.nodeType === "Assignment") {
      scan(node.leftHandSide, "write");
      scan(node.rightHandSide, "read");
      return;
    }
    if (node.nodeType === "UnaryOperation" && ["++", "--", "delete"].includes(node.operator)) {
      scan(node.subExpression, "write");
      return;
    }
    if (node.nodeType === "FunctionCall") {
      const reference = node.expression?.referencedDeclaration;
      if (Number.isInteger(reference)) calls.push({ functionId: reference, position });
      const kind = callbackKind(node);
      if (kind) {
        callbacks.push({
          kind,
          position,
          file: record.file,
          line: lineAt(record.source, position),
          originFunction: record.node.name,
          call: node.expression?.memberName ?? node.expression?.name ?? "external call",
          innerPostStateIds: [],
        });
      }
    }
    for (const child of childrenOf(node)) scan(child, mode);
  }

  scan(record.node.body);
  return { events, calls, callbacks };
}

function analyzeModel(model) {
  const direct = new Map();
  for (const [id, record] of model.functions) {
    if (record.node.body) direct.set(id, directAnalysis(record, model.stateVariables));
  }

  const results = [];
  for (const [contractId, contractRecord] of model.contracts) {
    if (contractRecord.node.contractKind === "interface") continue;
    const lineage = new Set(contractRecord.node.linearizedBaseContracts ?? [contractId]);

    const effective = new Map();
    for (const ownerId of contractRecord.node.linearizedBaseContracts ?? [contractId]) {
      for (const [functionId, record] of model.functions) {
        if (record.contractId !== ownerId) continue;
        const node = record.node;
        if (!node.body || node.kind !== "function") continue;
        const key = functionKey(node);
        if (!effective.has(key)) effective.set(key, functionId);
      }
    }

    const cache = new Map();
    function resolve(functionId, stack = new Set()) {
      if (cache.has(functionId)) return cache.get(functionId);
      if (stack.has(functionId)) return { events: [], callbacks: [], reads: [], writes: [] };
      const record = model.functions.get(functionId);
      const own = direct.get(functionId) ?? { events: [], calls: [], callbacks: [] };
      const nextStack = new Set(stack).add(functionId);
      const events = [...own.events];
      const callbacks = own.callbacks.map((callback) => ({ ...callback }));

      for (const call of own.calls) {
        const calleeOwner = model.functionOwner.get(call.functionId);
        if (!lineage.has(calleeOwner) || !direct.has(call.functionId)) continue;
        const nested = resolve(call.functionId, nextStack);
        for (const event of nested.events) events.push({ ...event, position: call.position });
        for (const callback of nested.callbacks) {
          callbacks.push({
            ...callback,
            position: call.position,
            file: record.file,
            line: lineAt(record.source, call.position),
            originFunction: callback.originFunction,
            call: `${record.node.name} -> ${callback.originFunction}`,
            innerPostStateIds: callback.postStateIds ?? callback.innerPostStateIds ?? [],
          });
        }
      }

      const resolvedCallbacks = callbacks.map((callback) => ({
        ...callback,
        postStateIds: unique([
          ...(callback.innerPostStateIds ?? []),
          ...events.filter((event) => event.position > callback.position).map((event) => event.stateId),
        ]),
      }));
      const result = {
        events,
        callbacks: resolvedCallbacks,
        reads: unique(events.filter((event) => event.mode === "read").map((event) => event.stateId)),
        writes: unique(events.filter((event) => event.mode === "write").map((event) => event.stateId)),
      };
      cache.set(functionId, result);
      return result;
    }

    const entryFunctionIds = [...effective.values()].filter((id) => {
      const visibility = model.functions.get(id).node.visibility;
      return visibility === "public" || visibility === "external";
    });
    const functionReports = [];
    const hypotheses = [];

    for (const entryId of entryFunctionIds) {
      const entry = model.functions.get(entryId);
      const effects = resolve(entryId);
      if (effects.callbacks.length === 0) continue;
      const entryModifiers = modifierNames(entry.node);
      functionReports.push({
        function: entry.node.name,
        signature: functionKey(entry.node),
        file: entry.file,
        line: lineAt(entry.source, parseStart(entry.node.src)),
        callbacks: effects.callbacks.map((callback) => ({
          kind: callback.kind,
          call: callback.call,
          file: callback.file,
          line: callback.line,
          originFunction: callback.originFunction,
          statesAccessedAfterCallback: callback.postStateIds
            .map((id) => model.stateVariables.get(id)?.name)
            .filter(Boolean),
        })),
      });

      for (const callback of effects.callbacks) {
        const postStateIds = new Set(callback.postStateIds);
        if (postStateIds.size === 0) continue;
        for (const candidateId of entryFunctionIds) {
          const candidate = model.functions.get(candidateId);
          const candidateEffects = resolve(candidateId);
          const relevantIds = candidateEffects.writes.filter((id) => postStateIds.has(id));
          if (relevantIds.length === 0) continue;
          const candidateModifiers = modifierNames(candidate.node);
          const guarded =
            entryModifiers.some((name) => /nonreentrant/i.test(name)) &&
            candidateModifiers.some((name) => /nonreentrant/i.test(name));
          const sharedIds = unique([
            ...effects.reads,
            ...effects.writes,
          ]).filter((id) => candidateEffects.reads.includes(id) || candidateEffects.writes.includes(id));
          const relevantStates = relevantIds.map((id) => model.stateVariables.get(id)?.name).filter(Boolean);
          const sharedStates = sharedIds.map((id) => model.stateVariables.get(id)?.name).filter(Boolean);
          const sameFunction = entryId === candidateId;
          hypotheses.push({
            outerFunction: entry.node.name,
            callback: callback.kind,
            callbackLine: callback.line,
            candidateFunction: candidate.node.name,
            candidateLine: lineAt(candidate.source, parseStart(candidate.node.src)),
            pattern: sameFunction ? "same-function" : "cross-function",
            severity: guarded ? "mitigated" : relevantStates.length >= 2 ? "high" : "medium",
            sharedStates: unique(sharedStates),
            statesUsedAfterCallback: unique(relevantStates),
            guard: guarded ? "观察到共享 nonReentrant 修饰器" : "未观察到共享 nonReentrant 修饰器",
            rationale: `${candidate.node.name} 可写入 ${unique(relevantStates).join(", ")}；${entry.node.name} 会在回调后继续访问这些状态。`,
          });
        }
      }
    }

    results.push({
      contract: contractRecord.node.name,
      file: contractRecord.file,
      callbackFunctions: functionReports,
      reentryCandidates: hypotheses.sort((left, right) => {
        const weight = { high: 3, medium: 2, mitigated: 1 };
        return weight[right.severity] - weight[left.severity];
      }),
    });
  }

  return results;
}

function markdownReport(report) {
  const lines = [
    "# 共享状态回调分析报告（本地防御实验）",
    "",
    "本报告由本地 Solidity 编译器 AST 生成，不进行 RPC 调用，也不证明候选路径一定可利用。候选函数仍需结合访问控制、参数约束和业务逻辑人工复核。",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- Solidity 编译器：${report.compiler}`,
    `- 已检查合约：${report.summary.contractsInspected}`,
    `- 含回调的入口函数：${report.summary.callbackFunctions}`,
    `- 未缓解的候选路径：${report.summary.unmitigatedCandidates}`,
    "",
    "## 回调点",
    "",
    "| 合约 | 入口函数 | 回调类型 | 位置 | 回调后继续访问的状态 |",
    "|---|---|---|---|---|",
  ];
  for (const contract of report.contracts) {
    for (const fn of contract.callbackFunctions) {
      for (const callback of fn.callbacks) {
        lines.push(
          `| ${contract.contract} | ${fn.function} | ${callback.kind} | ${callback.file}:${callback.line} | ${callback.statesAccessedAfterCallback.join(", ") || "无"} |`,
        );
      }
    }
  }

  lines.push("", "## 按风险排序的重入审查候选", "");
  for (const contract of report.contracts.filter((item) => item.reentryCandidates.length > 0)) {
    lines.push(`### ${contract.contract}`, "");
    lines.push("| 风险 | 外层函数 | 候选重入函数 | 模式 | 相关共享状态 | 锁检查 |"
    );
    lines.push("|---|---|---|---|---|---|");
    for (const candidate of contract.reentryCandidates) {
      lines.push(
        `| ${candidate.severity} | ${candidate.outerFunction} | ${candidate.candidateFunction} | ${candidate.pattern} | ${candidate.statesUsedAfterCallback.join(", ")} | ${candidate.guard} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## 如何解释结果",
    "",
    "只有当回调发生后，外层函数仍会访问某项状态，并且另一个 public/external 函数能够写入该状态时，路径才会被列出。`high` 和 `medium` 表示审查优先级，不是可利用性结论；`mitigated` 表示两条路径可见地共享重入锁。",
    "",
    "配套业务不变量测试只在 Hardhat 临时内存链中执行。",
    "",
  );
  return lines.join("\n");
}

export function analyzeProject(root = PROJECT_ROOT) {
  const models = buildInfoFiles(root).map(({ inputPath, outputPath }) =>
    buildModel(inputPath, outputPath),
  );
  const contractsBySource = new Map();
  for (const model of models) {
    for (const contract of analyzeModel(model)) {
      const key = `${contract.file}\0${contract.contract}`;
      if (!contractsBySource.has(key)) contractsBySource.set(key, contract);
    }
  }
  const contracts = [...contractsBySource.values()];
  const callbackFunctions = contracts.reduce((sum, item) => sum + item.callbackFunctions.length, 0);
  const unmitigatedCandidates = contracts.reduce(
    (sum, item) => sum + item.reentryCandidates.filter((candidate) => candidate.severity !== "mitigated").length,
    0,
  );
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    compiler: unique(models.map((model) => model.compiler)).join(", "),
    safetyBoundary: {
      source: "仅本地 Hardhat 编译器 AST",
      rpcCalls: false,
      privateKeys: false,
      realAssets: false,
      conclusion: "候选路径需要人工验证",
    },
    summary: {
      contractsInspected: contracts.length,
      callbackFunctions,
      unmitigatedCandidates,
    },
    contracts,
  };
}

export function writeReports(root = PROJECT_ROOT) {
  const report = analyzeProject(root);
  const directory = path.join(root, "analysis");
  fs.mkdirSync(directory, { recursive: true });
  const jsonPath = path.join(directory, "shared-state-report.json");
  const markdownPath = path.join(directory, "shared-state-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdownReport(report));
  return { report, jsonPath, markdownPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { report, jsonPath, markdownPath } = writeReports();
  console.log(`已检查 ${report.summary.contractsInspected} 个本地合约。`);
  console.log(`找到 ${report.summary.callbackFunctions} 个含回调的入口函数。`);
  console.log(`列出 ${report.summary.unmitigatedCandidates} 条未缓解的审查候选路径。`);
  console.log(`JSON 报告：${path.relative(PROJECT_ROOT, jsonPath)}`);
  console.log(`Markdown 报告：${path.relative(PROJECT_ROOT, markdownPath)}`);
}
