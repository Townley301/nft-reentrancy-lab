import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodeEventLog, parseAbiItem } from "viem";
import { network } from "hardhat";

// This script deploys ONLY the local toy contracts from this repository.
// It records emitted events from a fresh in-memory Hardhat chain and embeds
// them into a self-contained HTML file that can be opened without a server.

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();

type Actor = "student" | "protocol" | "nft" | "receiver";
type CaseId = "hypebears" | "omni" | "revest";
type Variant = "vulnerable" | "fixed";
type CodeRef = {
  path: string;
  symbol: string;
  focusLine: number;
  lines: { number: number; text: string }[];
};
type Step = {
  title: string;
  detail: string;
  actor: Actor;
  source: "链上事件" | "脚本观察";
  metrics?: Record<string, string>;
  code?: CodeRef;
  callPath?: string[];
};
type Scenario = {
  caseId: CaseId;
  variant: Variant;
  txHash?: string;
  intro: string;
  outcome: string;
  steps: Step[];
};

// The first two CallbackObserved events have identical type signatures.
// Decode them with the selected case's ABI, or the same log gets the wrong field names.
const eventAbiByCase = {
  hypebears: [
    parseAbiItem("event Step(string message, address actor, uint256 value)"),
    parseAbiItem("event CallbackObserved(uint256 callbackNumber, bool attemptedReentry)"),
  ],
  omni: [
    parseAbiItem("event Step(string message, address user, uint256 collateral, uint256 debtAmount)"),
    parseAbiItem("event CallbackObserved(uint256 tokenId, bool attemptedLiquidation)"),
  ],
  revest: [
    parseAbiItem("event Step(string message, uint256 id, uint256 quantity, uint256 depositPerUnit)"),
    parseAbiItem("event CallbackObserved(uint256 receivedId, uint256 amount, bool attemptedAdditionalDeposit)"),
  ],
} as const;

const caseFiles: Record<CaseId, string> = {
  hypebears: "contracts/hypebears/HypeBearsLab.sol",
  omni: "contracts/omni/OmniLab.sol",
  revest: "contracts/revest/RevestLab.sol",
};
const sourceFiles: Record<string, string[]> = {};
for (const path of Object.values(caseFiles)) {
  sourceFiles[path] = (await readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"))
    .split(/\r?\n/);
}

function codeRef(
  path: string,
  symbol: string,
  marker: string,
  before = 4,
  after = 8,
  scopeMarker?: string,
): CodeRef {
  const source = sourceFiles[path];
  if (!source) throw new Error(`Source file is unavailable: ${path}`);
  const scopeStart = scopeMarker === undefined ? 0 : source.findIndex((line) => line.includes(scopeMarker));
  if (scopeStart < 0) throw new Error(`Source scope is unavailable: ${scopeMarker}`);
  const matching = source.flatMap((line, index) =>
    index >= scopeStart && line.includes(marker) ? [index] : [],
  );
  if (matching.length !== 1) {
    throw new Error(`Expected one source anchor for ${path}: ${marker}; found ${matching.length}`);
  }
  const focus = matching[0];
  const start = Math.max(0, focus - before);
  const end = Math.min(source.length, focus + after + 1);
  return {
    path,
    symbol,
    focusLine: focus + 1,
    lines: source.slice(start, end).map((text, offset) => ({ number: start + offset + 1, text })),
  };
}

function symbolForMessage(caseId: CaseId, variant: Variant, message: string): string {
  if (caseId === "hypebears") {
    return message.startsWith("NFT state") ? "HypeBearsToyBase._safeMint" :
      `${variant === "vulnerable" ? "HypeBearsVulnerable" : "HypeBearsFixed"}.mintNFT`;
  }
  if (caseId === "omni") {
    if (message === "state finalized before callback") return "OmniPoolFixed.withdraw";
    if (message === "liquidation state finalized before callback") return "OmniPoolFixed.liquidate";
    if (message.includes("liquidation")) return "OmniPoolVulnerable.liquidate";
    if (message.includes("withdraw")) return "OmniPoolVulnerable.withdraw";
    if (message.includes("collateral supplied")) return "OmniToyPoolBase.supply";
    return "OmniToyPoolBase.borrow";
  }
  if (message === "series redeemed") return "RevestToyBase.redeem";
  if (message.includes("additional deposit") || message.includes("overwritten")) {
    return `${variant === "vulnerable" ? "RevestVulnerable" : "RevestFixed"}.depositAdditionalToFNFT`;
  }
  return `${variant === "vulnerable" ? "RevestVulnerable" : "RevestFixed"}.createSeries`;
}

const messages: Record<string, { title: string; detail: string; actor: Actor }> = {
  "eligibility check passed": {
    title: "铸造资格检查通过",
    detail: "协议查看一次性资格标记；此时它还显示‘未使用’。",
    actor: "protocol",
  },
  "NFT state written; receiver callback is next": {
    title: "Toy NFT 已写入，马上触发回调",
    detail: "铸造已发生，但外层 mintNFT 尚未结束；控制权即将交给接收合约。",
    actor: "nft",
  },
  "mint flag written too late": {
    title: "资格标记现在才更新",
    detail: "回调和嵌套铸造都已经完成，此时再写入资格标记已经太晚。",
    actor: "protocol",
  },
  "mint flag written before callback": {
    title: "先消耗铸造资格",
    detail: "修复版在交出执行权以前就把一次性资格标记为已使用。",
    actor: "protocol",
  },
  "withdraw half-finished; callback is next": {
    title: "第一枚抵押 NFT 正在转出",
    detail: "抵押数量已经降为 1，但外层提现流程和健康度检查尚未完成。",
    actor: "protocol",
  },
  "liquidation half-finished; callback is next": {
    title: "回调中进入了清算函数",
    detail: "这是另一条业务路径。它继续改变同一借款人的抵押数量和债务。",
    actor: "protocol",
  },
  "liquidation finished": {
    title: "清算路径先结束",
    detail: "嵌套调用返回外层提现之前，抵押标记和共享状态已被改变。",
    actor: "protocol",
  },
  "withdraw finished": {
    title: "外层提现继续执行",
    detail: "它看到的共享状态已不同于进入 NFT 回调之前，最终没有挡住剩余债务。",
    actor: "protocol",
  },
  "state finalized before callback": {
    title: "修复版先完成状态与健康度检查",
    detail: "只有取回 NFT 后仍健康，才会进行安全转账和接收回调。",
    actor: "protocol",
  },
  "liquidation state finalized before callback": {
    title: "修复版清算先完成记账",
    detail: "清算路径也必须在 NFT 外部转移以前处理相关状态。",
    actor: "protocol",
  },
  "collateral supplied": {
    title: "Toy NFT 被存作抵押",
    detail: "这是建立实验初始状态的准备交易。",
    actor: "protocol",
  },
  "toy loan issued": {
    title: "借出虚拟代币",
    detail: "这只是本地 Toy Token，不是现实中的 WETH。",
    actor: "protocol",
  },
  "series configured; nextId still stale": {
    title: "FNFT 系列已创建，但下一个编号没更新",
    detail: "如果此时发生回调，另一条函数还能读到这个旧编号。",
    actor: "protocol",
  },
  "stale ID configuration overwritten": {
    title: "回调路径复用了旧 ID",
    detail: "追加存款函数取得已被占用的编号，并覆盖了它的资产配置。",
    actor: "protocol",
  },
  "nextId advanced after callback": {
    title: "回调结束后才递增 FNFT 编号",
    detail: "这次回调已经执行；如回调进入其他路径，对方可能已读取过期编号。",
    actor: "protocol",
  },
  "series redeemed": {
    title: "FNFT 份额被赎回",
    detail: "观察可赎回份额与金库真实资产之间是否保持一致。",
    actor: "protocol",
  },
  "unique ID reserved before callback": {
    title: "先预留唯一 FNFT ID",
    detail: "修复版在 ERC-1155 铸造与回调之前就递增下一个编号。",
    actor: "protocol",
  },
  "additional deposit gets a distinct ID": {
    title: "追加存款取得不同的 ID",
    detail: "外层系列的配置不会被回调路径覆盖。",
    actor: "protocol",
  },
};

function eventToStep(
  caseId: CaseId,
  variant: Variant,
  eventName: string,
  args: Record<string, unknown>,
): Step | undefined {
  if (eventName === "Step") {
    const message = String(args.message ?? "");
    const presentation = messages[message];
    if (!presentation) return undefined;

    let metrics: Record<string, string>;
    if (args.collateral !== undefined) {
      metrics = {
        "有效抵押数": String(args.collateral),
        "未还 Toy 债务": String(args.debtAmount),
      };
    } else if (args.id !== undefined) {
      metrics = {
        "FNFT ID": String(args.id),
        "本次份额": String(args.quantity),
        "每份对应代币": String(args.depositPerUnit),
      };
    } else {
      metrics = { "事件值": String(args.value) };
    }

    return {
      ...presentation,
      source: "链上事件",
      metrics,
      code: codeRef(
        caseFiles[caseId],
        symbolForMessage(caseId, variant, message),
        `emit Step("${message}"`,
        4,
        message === "NFT state written; receiver callback is next" ? 10 : 8,
      ),
    };
  }

  if (eventName === "CallbackObserved") {
    const callbackSymbol = caseId === "hypebears"
      ? "HypeBearsCallbackStudent.onERC721Received"
      : caseId === "omni"
        ? "OmniLiquidatorCallbackStudent.onERC721Received"
        : "RevestCallbackStudent.onERC1155Received";
    const callbackCode = codeRef(caseFiles[caseId], callbackSymbol, "emit CallbackObserved(", 5, 10);

    if (caseId === "hypebears") {
      const attempt = Boolean(args.attemptedReentry);
      return {
        title: attempt ? "接收回调：再次调用 mintNFT" : "第二层 NFT 接收回调",
        detail: attempt
          ? variant === "vulnerable"
            ? "接收合约收到 NFT 后，趁一次性资格还没更新，再次进入同一个铸造函数。"
            : "接收合约尝试再次调用同一个函数，但资格已在回调前消耗，重入会被拒绝。"
          : "这是嵌套铸造得到的 NFT；演示合约在这一层停止继续重入。",
        actor: "receiver",
        source: "链上事件",
        metrics: { "回调次数": String(args.callbackNumber), "尝试重入": attempt ? "是" : "否" },
        code: callbackCode,
      };
    }

    if (caseId === "omni") {
      const attempt = Boolean(args.attemptedLiquidation);
      return {
        title: attempt ? "接收回调：转入另一清算函数" : "清算所得 NFT 的接收回调",
        detail: attempt
          ? "攻击者合约收到第一枚 NFT，立即调用 liquidate，而不是再次调用 withdraw。"
          : "第二层回调只确认收到 NFT，不再继续进入协议。",
        actor: "receiver",
        source: "链上事件",
        metrics: { "Toy NFT ID": String(args.tokenId), "尝试跨函数进入": attempt ? "是" : "否" },
        code: callbackCode,
      };
    }

    const attempt = Boolean(args.attemptedAdditionalDeposit);
    return {
      title: attempt ? "ERC-1155 回调：进入追加存款函数" : "FNFT 接收回调",
      detail: attempt
        ? variant === "vulnerable"
          ? "接收合约趁 nextId 尚未递增，调用 depositAdditionalToFNFT。"
          : "接收合约也进入 depositAdditionalToFNFT，但 nextId 已预留新编号，不会覆盖外层系列。"
        : "接收方确认 FNFT 到账；这一层不会再触发追加调用。",
      actor: "receiver",
      source: "链上事件",
      metrics: {
        "收到 FNFT ID": String(args.receivedId),
        "收到份额": String(args.amount),
        "尝试跨函数进入": attempt ? "是" : "否",
      },
      code: callbackCode,
    };
  }
  return undefined;
}

async function stepsFromTransaction(hash: `0x${string}`, caseId: CaseId, variant: Variant): Promise<Step[]> {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const steps: Step[] = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: eventAbiByCase[caseId], data: log.data, topics: log.topics });
      const step = eventToStep(caseId, variant, decoded.eventName, decoded.args as Record<string, unknown>);
      if (step) steps.push(step);
    } catch {
      // Toy assets intentionally emit no Step/CallbackObserved event for every internal operation.
    }
  }
  return steps;
}

function observation(
  title: string,
  detail: string,
  metrics?: Record<string, string>,
  code?: CodeRef,
): Step {
  return { title, detail, actor: "student", source: "脚本观察", metrics, code };
}

async function hypeBears(variant: "vulnerable" | "fixed"): Promise<Scenario> {
  const target = await viem.deployContract(
    variant === "vulnerable" ? "HypeBearsVulnerable" : "HypeBearsFixed",
  );
  const receiver = await viem.deployContract("HypeBearsCallbackStudent", [target.address]);
  const hash = await receiver.write.runLesson();
  const balance = await target.read.balanceOf([receiver.address]);
  const reentered = await receiver.read.reentrySucceeded();

  return {
    caseId: "hypebears",
    variant,
    txHash: hash,
    intro: "一地址只允许铸造一次；演示接收方是可执行代码的合约。",
    outcome: variant === "vulnerable"
      ? "一次外层交易得到 2 枚 Toy NFT；一次性资格被重复使用。"
      : "一次外层交易只得到 1 枚 Toy NFT；回调中的第二次铸造被拒绝。",
    steps: [
      observation("提交一次铸造交易", "本地临时账户调用教学接收合约，再由它进入铸造合约。", { "初始 NFT": "0" },
        codeRef(caseFiles.hypebears, "HypeBearsCallbackStudent.runLesson", "target.mintNFT();", 3, 3)),
      ...(await stepsFromTransaction(hash, "hypebears", variant)),
      observation("读取交易后的状态", variant === "vulnerable"
        ? "第二次铸造发生在资格写入之前。"
        : "回调虽然发生，但无法再次使用已经消耗的资格。", {
        "最终 Toy NFT": String(balance),
        "重入成功": reentered ? "是" : "否",
      }),
    ],
  };
}

async function omni(variant: "vulnerable" | "fixed"): Promise<Scenario> {
  const nft = await viem.deployContract("ToyERC721");
  const token = await viem.deployContract("ToyERC20");
  const pool = await viem.deployContract(
    variant === "vulnerable" ? "OmniPoolVulnerable" : "OmniPoolFixed",
    [nft.address, token.address],
  );
  const borrower = await viem.deployContract("OmniBorrowerStudent", [pool.address, nft.address]);
  const liquidator = await viem.deployContract("OmniLiquidatorCallbackStudent", [pool.address, token.address]);

  await nft.write.mint([borrower.address, 1n]);
  await nft.write.mint([borrower.address, 2n]);
  await token.write.mint([pool.address, 100n]);
  await token.write.mint([liquidator.address, 1n]);
  await borrower.write.prepare([1n, 2n, 15n]);
  await liquidator.write.arm([borrower.address, 2n]);

  const initial = observation(
    "建立借贷初始状态",
    "借款人存入 2 枚 Toy NFT，借出 15 个 Toy Token；接收方准备在收到 NFT 时进入清算函数。",
    { "有效抵押数": "2", "未还 Toy 债务": "15" },
    codeRef(caseFiles.omni, "OmniBorrowerStudent.prepare", "pool.supply(firstId);", 3, 3),
  );

  if (variant === "fixed") {
    let rejected = false;
    try {
      await borrower.write.startWithdraw([1n, liquidator.address]);
    } catch {
      rejected = true;
    }
    const collateral = await pool.read.collateralCount([borrower.address]);
    const debt = await pool.read.debt([borrower.address]);
    const callbacks = await liquidator.read.callbacks();
    if (!rejected) throw new Error("The fixed OMNI toy unexpectedly accepted an unhealthy withdrawal");

    return {
      caseId: "omni",
      variant,
      intro: "取回抵押 NFT 前必须保证剩余抵押足以覆盖 Toy 债务。",
      outcome: "不健康的取回请求回滚；2 枚抵押 NFT 留在池中，接收回调没有发生。",
      steps: [
        initial,
        observation("申请取回第一枚 NFT", "修复版先减少抵押并检查取回后的健康度；检查发生在 NFT 转账之前。", undefined,
          codeRef(caseFiles.omni, "OmniPoolFixed.withdraw", "require(_isHealthy(msg.sender), \"withdraw leaves unhealthy debt\");", 5, 3, "contract OmniPoolFixed is")),
        observation("交易回滚，未触发回调", "取回后只有 1 枚抵押品，不足以覆盖 15 个单位的虚拟债务，因而整笔交易撤销。", {
          "有效抵押数": String(collateral),
          "未还 Toy 债务": String(debt),
          "接收回调次数": String(callbacks),
        }),
      ],
    };
  }

  const hash = await borrower.write.startWithdraw([1n, liquidator.address]);
  const collateral = await pool.read.collateralCount([borrower.address]);
  const debt = await pool.read.debt([borrower.address]);
  const reentered = await liquidator.read.reentrySucceeded();

  return {
    caseId: "omni",
    variant,
    txHash: hash,
    intro: "取回抵押 NFT 前必须保证剩余抵押足以覆盖 Toy 债务。",
    outcome: "两枚 Toy NFT 都离开池子，借款人仍欠 14 个 Toy Token；抵押约束被破坏。",
    steps: [
      initial,
      ...(await stepsFromTransaction(hash, "omni", variant)),
      observation("读取交易后的状态", "外层取回与回调中的清算都结束了；两条路径共享的状态已不再满足借贷规则。", {
        "有效抵押数": String(collateral),
        "未还 Toy 债务": String(debt),
        "跨函数重入成功": reentered ? "是" : "否",
      }),
    ],
  };
}

async function revest(variant: "vulnerable" | "fixed"): Promise<Scenario> {
  const asset = await viem.deployContract("ToyERC20");
  const fnft = await viem.deployContract("ToyERC1155");
  const protocol = await viem.deployContract(
    variant === "vulnerable" ? "RevestVulnerable" : "RevestFixed",
    [asset.address, fnft.address],
  );
  const receiver = await viem.deployContract("RevestCallbackStudent", [protocol.address, asset.address, fnft.address]);
  await asset.write.mint([protocol.address, 100n]);
  await asset.write.mint([receiver.address, 1n]);

  const hash = await receiver.write.runLesson();
  const outerId = await receiver.read.createdId();
  const callbackId = await receiver.read.additionalId();
  const receiverBalance = await asset.read.balanceOf([receiver.address]);
  const treasuryBalance = await asset.read.balanceOf([protocol.address]);

  return {
    caseId: "revest",
    variant,
    txHash: hash,
    intro: "每个 FNFT 系列应有唯一 ID，且可赎回总额不能超过真实存入的 Toy Token。",
    outcome: variant === "vulnerable"
      ? "外层与回调路径同用 ID 2；接收方从 1 个 Toy Token 变成 6 个，金库从 100 降为 95。"
      : "外层 ID 2、回调路径 ID 3；接收方仍有 1 个 Toy Token，金库仍有 100。",
    steps: [
      observation("建立 FNFT 初始状态", "金库有 100 个 Toy Token；接收方持有 1 个，并准备创建零存款的 FNFT 系列。", {
        "初始接收方余额": "1",
        "初始金库余额": "100",
      }, codeRef(caseFiles.revest, "RevestCallbackStudent.runLesson", "baseId = protocol.createSeries(2, 0, address(this));", 3, 4)),
      ...(await stepsFromTransaction(hash, "revest", variant)),
      observation("读取交易后的状态", variant === "vulnerable"
        ? "旧 ID 被重复使用，使零存款的多个份额获得了错误的赎回价值。"
        : "编号在回调前预留，两个系列互不覆盖，资产守恒。", {
        "外层系列 ID": String(outerId),
        "回调系列 ID": String(callbackId),
        "接收方 Toy 余额": String(receiverBalance),
        "金库 Toy 余额": String(treasuryBalance),
      }),
    ],
  };
}

const scenarios = [
  await hypeBears("vulnerable"),
  await hypeBears("fixed"),
  await omni("vulnerable"),
  await omni("fixed"),
  await revest("vulnerable"),
  await revest("fixed"),
];

// Event order comes from real local receipts; the nested call paths below are
// pedagogical annotations checked against the known toy-contract control flow.
// They are not an opcode-level EVM execution trace.
const hRun = ["runLesson"];
const hOuter = [...hRun, "mintNFT"];
const hMint = [...hOuter, "_safeMint"];
const hCallback = [...hMint, "onERC721Received"];
const hInner = [...hCallback, "mintNFT（重入）"];
const hInnerMint = [...hInner, "_safeMint"];

const oRun = ["prepare：存入抵押并借款"];
const oOuter = ["startWithdraw", "withdraw"];
const oCallback = [...oOuter, "ToyERC721.safeTransferFrom", "onERC721Received"];
const oLiquidate = [...oCallback, "liquidate（跨函数）"];

const rRun = ["runLesson"];
const rBase = [...rRun, "createSeries（基础系列）"];
const rBaseCallback = [...rBase, "ToyERC1155.mint", "onERC1155Received"];
const rOuter = [...rRun, "createSeries（目标系列）"];
const rCallback = [...rOuter, "ToyERC1155.mint", "onERC1155Received"];
const rAdditional = [...rCallback, "depositAdditionalToFNFT（跨函数）"];
const rNestedCallback = [...rAdditional, "ToyERC1155.mint", "onERC1155Received（第二层）"];

const callPaths: Record<CaseId, Record<Variant, string[][]>> = {
  hypebears: {
    vulnerable: [
      hRun, hOuter, hMint, hCallback, hInner, hInnerMint,
      [...hInnerMint, "onERC721Received（第二层）"], hInner, hOuter, ["读取最终状态"],
    ],
    fixed: [hRun, hOuter, hMint, hCallback, ["读取最终状态"]],
  },
  omni: {
    vulnerable: [
      oRun, oOuter, oCallback, oLiquidate,
      [...oLiquidate, "ToyERC721.safeTransferFrom", "onERC721Received（第二层）"],
      oLiquidate, oOuter, ["读取最终状态"],
    ],
    fixed: [oRun, oOuter, [...oOuter, "健康度检查失败 → 回滚"]],
  },
  revest: {
    vulnerable: [
      rRun, rBase, rBaseCallback, rBase, rOuter, rCallback,
      rAdditional, rNestedCallback, rOuter, [...rRun, "redeem"], ["读取最终状态"],
    ],
    fixed: [
      rRun, rBase, rBaseCallback, rOuter, rCallback, rAdditional,
      rNestedCallback, [...rRun, "redeem（目标系列）"],
      [...rRun, "redeem（追加系列）"], ["读取最终状态"],
    ],
  },
};

for (const scenario of scenarios) {
  if (scenario.steps.length < 3) throw new Error(`No trace for ${scenario.caseId}/${scenario.variant}`);
  const paths = callPaths[scenario.caseId][scenario.variant];
  if (paths.length !== scenario.steps.length) {
    throw new Error(`Call-path annotations diverged from local events: ${scenario.caseId}/${scenario.variant}`);
  }
  scenario.steps.forEach((step, index) => { step.callPath = paths[index]; });
}

const templatePath = fileURLToPath(new URL("../viewer/template.html", import.meta.url));
const outputPath = fileURLToPath(new URL("../visual-report.html", import.meta.url));
const template = await readFile(templatePath, "utf8");
const payload = JSON.stringify({ generatedAt: new Date().toISOString(), scenarios })
  .replaceAll("<", "\\u003c")
  .replaceAll(">", "\\u003e");
const page = template.replace("/* __LAB_DATA__ */ null", payload);
if (page === template) throw new Error("The visual report template is missing its data placeholder");
await writeFile(outputPath, page, "utf8");

console.log(`已生成本地可视化报告：${outputPath}`);
console.log("包含 3 个案例、漏洞版/修复版共 6 条场景，以及真实本地交易事件的步骤记录。");
console.log("直接用 PyCharm 或浏览器打开 visual-report.html；无需启动服务器或连接外部网络。");
