# NFT Callback Reentrancy Local Lab

一个完全在本地运行的 NFT 回调重入教学项目，对三个历史案例的**核心逻辑**进行最小化模拟，并使用三个独立 holdout 检验工作流的泛化能力：

1. HypeBears：ERC-721 `_safeMint` 回调导致同函数重入；
2. OMNI Protocol：ERC-721 转账回调进入另一条清算函数；
3. Revest Finance：ERC-1155 铸造回调读取过期的 FNFT 编号。
4. Marketplace holdout：ERC-721 接收回调进入退款路径，使同一笔 Toy Token listing bond 被重复返还。
5. Batch voucher holdout：ERC-1155 batch callback 在 credit 记录完成前进入 bonus 路径，使 Toy voucher 数量超过记录额度。
6. Temporary authorization holdout：ERC-721 callback 在临时授权撤销前领取第二枚 Toy NFT。

本项目不是原协议复刻，也不包含真实攻击所需的主网地址、RPC、私钥、闪电贷、价格操纵或资产兑换代码。所有交易都发生在一次性的 Hardhat 本地内存链上，只涉及项目内的 Toy NFT 和 Toy Token；它没有连接、部署或交易真实资产的能力。

## 安全边界

- 只使用 Hardhat 临时本地区块链；
- 所有账户均由本地节点临时生成；
- 所有 NFT 和代币均为项目内定义的 `Toy` 资产；
- 配置中没有主网或测试网 RPC；
- `.env` 被排除在 Git 之外，代码也不会读取私钥；
- 每次运行测试都会创建一条新的临时链，运行结束后状态消失。
- 声明式 Adapter 禁止网络、RPC、账户、地址、钱包、密钥和任意脚本字段。

不要把 `contracts/common/ToyAssets.sol` 中的简化资产合约用于生产环境。

## 环境要求

- Node.js 22 或更高版本；
- pnpm 12.4.1（由 `package.json` 声明并由 CI 固定安装）。

## 安装和运行

```bash
pnpm install --frozen-lockfile
pnpm verify:ci
```

## 第一阶段：统一的不变量驱动审计流程

第一阶段解决的是“自然语言规则”和“动态测试规则”分离的问题。现在 `rules/research-rule-spec.json` 是唯一事实来源，同时服务于静态覆盖分析、动态测试生成和可视化报告；旧的 `callback-rules.json` 已移除。

每条统一规则都包含：

- 研究者原始业务不变量与预期状态；
- 精确的合约、函数和状态变量绑定；
- actors、preconditions、callback/reentry actions 和 observables；
- 不变量类别、关系和便于人工审查的表达；
- 绑定置信度、解释假设和所需证据级别；
- 可选的已审核动态适配器、候选路径、有界参数和漏洞版/修复版预期。

权威格式定义在 `rules/research-rule-spec.schema.json`。程序还会执行跨字段检查，例如 action function 必须出现在绑定函数中、observable 必须出现在绑定状态中、动态候选路径必须属于声明 scope。规则禁止 RPC、网络、账户、地址、钱包、助记词、私钥和任意可执行代码字段。

### Agent 与确定性程序的分工

```text
研究者自然语言
    ↓
Skill 指导 Agent 检查源码并建立语义绑定
    ↓
统一不变量 IR：rules/research-rule-spec.json
    ↓
确定性校验 + AST callback/shared-state 分析
    ↓
已审核适配器的有界本地测试
    ↓
静态候选 / 本地反例 / 修复回归证据
    ↓
研究者确认后才允许修改合约
```

Agent 负责理解自然语言、检查源码、拆分复合规则、记录假设并选择是否存在语义匹配的动态适配器。命令行程序不会自行理解任意自然语言，也不会自动修改合约；它只校验统一 IR、分析 Solidity AST、生成已审核测试并汇总证据。

### 第一阶段的三个开发基准

| 基准案例 | 不变量类别 | 动态适配器 | 本地参数 |
|---|---|---|---|
| HypeBears | uniqueness | `one-time-mint` | 1 组默认场景 |
| OMNI | solvency | `collateral-coverage` | 3 个有界借款值 |
| Revest | conservation | `funded-value` | 3 组数量/存款组合 |

这三个案例是第一阶段的开发基准，不是通用漏洞库。静态分析器可以发现其他 callback/shared-state 候选；但新规则没有已审核适配器时，只能得到静态覆盖证据，不能声称已经动态证明可利用。

### 第二阶段：声明式 Adapter 与留出案例

第二阶段把原来写在测试运行器中的三个案例分支拆成 `rules/adapters/*.json`。`test/support/callback-rule-runtime.ts` 现在是一个通用执行器，只解释以下受限操作：按名称部署本地合约、按顺序调用函数、读取观察值，以及执行 `eq` / `lte` / `gte` 与整数加减乘表达式。它不包含 HypeBears、OMNI、Revest、Marketplace 或 Batch voucher 的名称和专用分支，也不执行 Adapter 提供的任意代码。

Adapter 的权威格式在 `rules/adapters/adapter-spec.schema.json`，程序级跨字段校验在 `scripts/lib/adapter-spec.mjs`。每个 Adapter 必须声明：

- `dataset`：`development` 或 `holdout`；
- 精确静态路径和漏洞版/修复版合约；
- 有上限的整数参数；
- 本地部署、setup、entry、observations 和受限 assertion；
- 所有合约引用必须指向前面已声明的本地部署。

前三个 Adapter 标记为 `development`。新增的 `marketplace-bond` 标记为 `holdout`，用于回答“同一个执行器能否支持开发时未编码进核心运行器的新业务场景”。它只增加了教学合约、统一规则和 Adapter JSON，没有修改通用执行器，也没有增加案例专用分支。

| 数据集 | 案例 | 不变量 | 参数组 | 动态场景 |
|---|---|---|---:|---:|
| development | HypeBears | 一次外层调用最多铸造 1 枚 Toy NFT | 1 | 2 |
| development | OMNI | Toy debt 不超过剩余 Toy NFT 抵押能力 | 3 | 6 |
| development | Revest | Toy Token 支出不超过调用者实际投入 | 3 | 6 |
| holdout | Marketplace | 同一笔 Toy listing bond 最多返还一次 | 2 | 4 |
| holdout | Batch voucher | Toy ERC-1155 voucher 总量不超过记录 credit | 2 | 4 |
| holdout | Temporary authorization | 一次临时授权最多领取 1 枚 Toy NFT | 2 | 4 |

### 第三阶段：冻结基线、Ground truth 与负样本

第三阶段将 Stage 2 的 Adapter schema、校验器和通用执行器按 commit 与 SHA-256 固定为 baseline，然后在不修改这三个文件的前提下加入第二个 holdout。基线、人工标签和阈值位于 `evaluation/ground-truth.json`，格式定义在 `evaluation/ground-truth.schema.json`。

本阶段还加入两个完全本地的安全控制合约：

- `SafeCallbackControl` 在 ERC-721 callback 前完成状态更新，静态分析不应报告对应路径；
- `PermissionedCallbackControl` 用来暴露当前结构分析器不理解 admin 权限、token ownership 和 mapping key 区分的限制。

`pnpm evaluate:ground-truth` 只在人工标注路径上计算 precision、recall、specificity、动态结果通过率和 baseline 漂移。在 Stage 3 基线时，13 条标注路径中有 5 个 true positives、2 个 false positives、0 个 false negatives 和 6 个 true negatives。

### 第四阶段：Authorization-transition holdout

第四阶段加入 `temporary-authorization` holdout：本地 vault 给 receiver 一次临时资格，漏洞版在 ERC-721 callback 后才撤销，因此 callback 可以领取第二枚 Toy NFT；修复版在 callback 前消耗资格。该案例只新增 Toy fixture、统一规则和 Adapter JSON，没有修改冻结的 schema、校验器或通用执行器。

当前完整验证结果：6 条规则生成 26 个本地动态场景；静态分析列出 23 条未缓解审查候选，其中 6 条精确绑定路径已有本地动态反例，15 条仍明确标记为仅静态证据，2 条教学负样本附有人工排除理由。15 条 ground-truth 路径包含 6 个 true positives、2 个 false positives、0 个 false negatives 和 7 个 true negatives；precision 为 75%，recall 为 100%，specificity 为 77.8%。12/12 个动态 ground-truth 检查通过，3/3 个 holdout 均未修改冻结执行器，baseline 漂移为 0。23/23 条静态候选均有人工 disposition 和 reason code。完整测试共 68 项通过。

这里的“规则已覆盖”不等于“路径已证明可利用”，holdout 通过也只是当前受限 DSL 的局部泛化证据。

新增本地教学案例时，通常只需添加：

1. 一组最小化的漏洞版/修复版 Toy 合约与 callback receiver；
2. `rules/research-rule-spec.json` 中的一条语义绑定规则；
3. `rules/adapters/` 中的一份声明式 Adapter；
4. 少量、确定且有上下限的本地参数。

如果新场景不能由现有受限操作表达，应先扩展 schema、校验器和通用执行器，并为新操作增加安全测试；不要在执行器中加入某个案例名称的条件分支。

### 第五阶段：干净环境复现与只读 CI

第五阶段没有新增攻击能力或真实交易功能，而是把前四个阶段的结果固定成可检查的复现契约：

- `evaluation/expected-summary.json` 版本化保存预期规则数、场景数、静态候选数、ground-truth 指标和冻结基线状态；
- `scripts/verify-reproducibility.mjs` 将新生成的 JSON/HTML 报告与该契约逐项比较，并再次要求 `rpcCalls`、`privateKeys`、`realAssets` 和 `arbitraryAdapterCode` 保持关闭；
- `.github/workflows/local-toy-ci.yml` 从干净源码安装锁定依赖，只授予仓库内容读取权限，不持久化 Git 凭据，不读取 secrets，也没有部署、发布或网络链交互步骤；
- CI 最后检查受版本控制的源码没有被生成器意外改写。

统一复现命令是：

```bash
pnpm verify:ci
```

它依次运行完整测试、规则生成、临时 Hardhat 链上的 Toy 场景、静态覆盖分析、ground-truth 评估、离线报告生成和摘要漂移检查。验证成功时，最后一行应报告 6 条规则、26 个本地场景、23 条静态候选和 15 条标注路径。若研究者有意修改数据集或标注，应先人工审查新的结果，再显式更新 `evaluation/expected-summary.json`；不应为了让 CI 通过而自动接受漂移。

### 第六阶段：候选分级与研究有效性边界

第六阶段增加 `evaluation/candidate-review.json`，要求静态分析产生的每一条候选路径都有一条人工审查记录。`candidate-review.schema.json` 和程序级校验器只允许三种 disposition：

- `locally-demonstrated`：精确路径已有有界的本地反例，reason code 必须是 `local-counterexample`；
- `static-only`：结构值得继续审查，但缺少精确路径的本地证据；理由会区分可达性、权限、状态前提、mapping key alias 或尚无已审核场景；
- `intentionally-rejected`：只用于当前 Toy fixture 中有明确阻断条件的教学负样本，不能因为“暂时没有测试”就使用该标签。

校验器要求 review 与当前 AST 候选集合完全一致：不允许漏掉候选、不允许添加静态分析中不存在的路径，也不允许把没有本地动态证据的路径标成 `locally-demonstrated`。当前 23 条候选的分级是 6 条本地演示、15 条 static-only 和 2 条 intentionally rejected，未复核数为 0。这里的排除结论只针对本仓库的简化 Toy 合约，不能外推到真实协议。

### 执行完整工作流

先由研究者编辑 `rules/research-brief.txt`，再用 `$nft-callback-auditor` 让 Agent 检查代码并更新统一 IR。确认绑定后运行：

```bash
pnpm verify:ci
```

该命令依次：

1. 运行完整单元测试和本地 Toy 合约测试；
2. 校验统一规则并生成 `test/generated/callback-rules.test.ts`；
3. 在 Hardhat 临时内存链上运行漏洞版和修复版场景；
4. 编译 Solidity 并执行 callback/shared-state 静态分析；
5. 将声明规则与静态候选关联；
6. 对人工标注路径计算误报、漏报、动态结果和 baseline 漂移；
7. 生成机器可读、Markdown 和离线 HTML 报告；
8. 校验 23 条候选的人工 disposition、reason code 和动态证据一致性；
9. 将生成摘要与版本化预期结果比较，并重新检查本地安全边界。

主要输出为：

- `analysis/business-rule-report.json`：供工具读取的逐场景结果；
- `analysis/business-rule-report.md`：动态预期/观察对照；
- `analysis/shared-state-report.json` 和 `.md`：静态 callback/shared-state 候选；
- `analysis/rule-coverage-report.json` 和 `.md`：规则覆盖、未声明候选和证据级别；
- `analysis/ground-truth-evaluation.json` 和 `.md`：人工标注集上的误报、漏报、动态结果和 baseline 漂移；
- `business-rule-report.html`：可交互的离线可视化报告，可直接双击打开。

这些均为可再生输出，已被 `.gitignore` 排除。如果只需验证动态适配器或重新生成页面，可以分别运行：

```bash
pnpm verify:rules
pnpm visual:rules
```

项目级 Skill 位于 `.agents/skills/nft-callback-auditor/`，可通过 `$nft-callback-auditor` 调用。项目结论和最小复现见 `REPORT.md`。

### 第二版：共享状态防御分析器

`pnpm analyze` 只读取本项目的 Solidity 编译 AST，不连接任何 RPC、钱包或真实资产。它会合并 Hardhat 的增量编译批次并按源码/合约去重，然后：

1. 定位 ERC-721 / ERC-1155 的安全转移、铸造和接收回调点；
2. 计算外层函数与其他公开函数共同读写的状态；
3. 仅当某个公开函数能修改“回调后仍会被外层函数访问”的状态时，将它列为重入审查候选；
4. 标注同函数/跨函数模式、共享状态、源码位置和共同重入锁；
5. 生成 `analysis/shared-state-report.json` 和 `analysis/shared-state-report.md`。

候选项是静态审查提示，不等于已经证明可利用；仍需检查权限、参数约束和完整业务流程。

`pnpm verify:v2` 会先生成分析报告，再在 Hardhat 临时内存链中执行原有案例和第二版业务不变量测试。参数测试保持为少量确定性组合：OMNI 使用 3 个中高债务值，Revest 使用 3 组有上限的数量/存款组合。测试验证：

- 同一地址最多使用一次铸造资格；
- 未偿债务不得超过剩余抵押能力；
- FNFT 的最终支出不得超过调用者实际提供的价值。

这里的漏洞版断言用于确认测试确实能发现不变量被破坏；修复版必须在同样参数下保持不变量。

### 用图形页面逐步观察

`pnpm visual` 会重新创建一条临时本地链，运行三个教学案例的漏洞版和修复版，并把**实际本地交易收据中的事件日志**连同交易前后的状态，写入项目根目录的 `visual-report.html`。报告属于可再生输出，不纳入 Git；需要查看时运行命令生成即可。

在 PyCharm 中可直接找到 `visual-report.html`，右键选择 **Open in Browser**；也可以在访达中双击它。页面不需要服务器，也不会连接外部网站。你可以：

- 在 HypeBears、OMNI、Revest 之间切换；
- 对比“漏洞版”和“修复版”；
- 点击事件列表，或使用“上一步 / 下一步 / 自动播放”观察调用顺序；
- 查看每一步由谁执行、关键状态值以及最终结果；
- 在“这一步对应的代码”面板查看源码文件、函数、行号及高亮语句；
- 沿着当前调用路径观察 `mint / transfer → 接收回调 → 重入其他函数 → 返回外层`。

页面中的“链上事件”是教学合约在本地临时链交易里发出的日志；“脚本观察”是交易前后读取的状态或回滚结果。代码行号和片段在生成页面时直接读取项目内的 Solidity 文件，修改源码后请重新运行 `pnpm visual`。调用路径按教学合约的结构标注，**不是由 EVM 调试器生成的逐指令调用栈**；事件之间未打点的内部语句不会逐条出现。它也不是历史主网攻击的完整复现。

也可以启动一个持续运行的本地节点：

```bash
pnpm node
```

这个节点默认只用于本地开发。教学演示并不要求手动启动节点；`pnpm test` 和 `pnpm demo` 会自动使用临时内存链。

## 预期结果

### HypeBears

漏洞版：一次外层调用得到 2 枚 Toy NFT；修复版只得到 1 枚。

```text
漏洞版：资格检查 → safeMint → 回调重进 mint → 最后才消耗资格
修复版：资格检查 → 先消耗资格 → safeMint → 回调重进失败
```

### OMNI

漏洞版：借款人存入 2 枚 Toy NFT、借出 15 个 Toy Token。取回第一枚 NFT 的回调进入 `liquidate`，最终两枚 NFT 都离开资金池，但仍留下 14 个单位的虚拟债务。

修复版在发送 NFT 和触发回调以前重新计算健康度，因此不健康的取回操作直接回滚，接收回调根本不会发生。

这是对历史事件的教学化简：真实 OMNI 事件还涉及闪电贷、NFTX、Doodles、价格和两个攻击角色。本项目只保留“`withdraw` 回调进入 `liquidate` 并改变共享状态”的核心。

### Revest

漏洞版：外层创建 ID 2 时，`nextId` 尚未前进。ERC-1155 回调进入 `depositAdditionalToFNFT`，再次取得 ID 2，把一笔 1 单位的存款错误地解释为 6 份凭证的支持资产。教学账户从 1 个 Toy Token 变成 6 个，虚拟金库从 100 降到 95。

修复版在回调以前预留 ID。外层使用 ID 2，回调路径使用 ID 3；教学账户最终仍为 1，金库仍为 100。

### Marketplace holdout

漏洞版：seller-receiver 使用一笔 Toy Token bond 挂出自己的 Toy NFT，然后买回它。NFT 接收回调在 listing 仍处于 active 时进入 `refundListing`，回调返回后 `buy` 再次返还同一笔 bond，因此最终余额超过实际投入。

修复版：`buy` 在发送 Toy NFT 之前关闭 listing 并返还一次 bond。接收回调中的退款尝试失败，最终余额不超过投入。这个案例完全在本地构造，不对应真实 marketplace、真实订单或真实财产交易。

### Batch voucher holdout

漏洞版：本地 vault 向 receiver 批量发送 token ID 1 和 2。ERC-1155 batch callback 在 `credits` 仍为零时领取 ID 3 的 Toy bonus；外层调用返回后把 credit 覆盖为 pair 数量，因此最终 Toy voucher 总量高于记录 credit。

修复版：vault 在 batch transfer 前写入完整 credit，callback 中的 bonus 请求失败，Toy voucher 总量与记录 credit 一致。该场景只使用本地教学 token，不包含真实 NFT、市场或财产交易。

### Temporary authorization holdout

漏洞版：receiver 获得一次本地临时授权并领取第一枚 Toy NFT。ERC-721 callback 发生时授权仍有效，因此 `claimAdditional` 又转移一枚 Toy NFT，最终一次资格得到两枚。

修复版：vault 在发送第一枚 Toy NFT 前撤销授权，callback 中的第二次领取失败。该场景没有真实身份、账户权限或资产，只验证本地教学状态的更新顺序。

## 项目结构

```text
.github/workflows/local-toy-ci.yml
.agents/skills/nft-callback-auditor/
├── SKILL.md
├── agents/openai.yaml
└── references/rule-spec.md
contracts/
├── authorization/AuthorizationLab.sol
├── batch/BatchVoucherLab.sol
├── common/ToyAssets.sol
├── controls/CallbackControls.sol
├── hypebears/HypeBearsLab.sol
├── marketplace/MarketplaceLab.sol
├── omni/OmniLab.sol
└── revest/RevestLab.sol
rules/
├── adapters/
│   ├── adapter-spec.schema.json
│   ├── batch-credit.json
│   ├── collateral-coverage.json
│   ├── funded-value.json
│   ├── marketplace-bond.json
│   ├── temporary-authorization.json
│   └── one-time-mint.json
├── research-brief.txt
├── research-rule-spec.json
└── research-rule-spec.schema.json
scripts/
├── run-all.ts
├── analyze-shared-state.mjs
├── audit-rule-coverage.mjs
├── generate-callback-tests.mjs
├── evaluate-ground-truth.mjs
├── verify-reproducibility.mjs
└── lib/
    ├── adapter-spec.mjs
    ├── candidate-review.mjs
    └── research-rule-spec.mjs
test/
├── adapter-spec.test.mjs
├── ground-truth-evaluator.test.mjs
├── reproducibility-verifier.test.mjs
├── reentrancy-lab.ts
├── business-invariants.ts
└── support/callback-rule-runtime.ts
REPORT.md
evaluation/
├── candidate-review.json
├── candidate-review.schema.json
├── expected-summary.json
├── ground-truth.json
└── ground-truth.schema.json
```

每个动态案例均包含：

- 漏洞版协议；
- 回调教学合约；
- 修复版协议；
- 对比测试；
- 描述关键状态变化的 Solidity 事件。

## 怎样阅读代码

建议依次查看：

1. `HypeBearsVulnerable.mintNFT` 中 `addressMinted` 的写入位置；
2. `OmniPoolVulnerable.withdraw` 在回调前后的状态；
3. `RevestVulnerable.createSeries` 中 `nextId` 的更新时间；
4. 对应 `Fixed` 合约如何在外部调用前完成状态更新；
5. `test/reentrancy-lab.ts` 中修复前后的断言。

## 与真实案例的区别

| 案例 | 本项目保留 | 本项目省略 |
|---|---|---|
| HypeBears | 一次性资格、`safeMint`、接收回调 | 原始 NFT 元数据、销售流程 |
| OMNI | 抵押、虚拟债务、取回和清算之间的跨函数重入 | 闪电贷、NFTX、价格预言机、真实 Doodles |
| Revest | ERC-1155 回调、ID 复用、配置覆盖和超额赎回 | 原协议完整锁仓、治理和多链结构 |

这个取舍让每个实验保持短小，使学习重点集中在调用顺序和业务不变量上。

## 参考资料

- [ERC-721 标准](https://eips.ethereum.org/EIPS/eip-721)
- [ERC-1155 标准](https://eips.ethereum.org/EIPS/eip-1155)
- [BlockSec：HypeBears 事件分析](https://blocksec.com/blog/when-safe-mint-becomes-unsafe-lessons-from-the-hype-bears-security-incident)
- [Immunefi：OMNI Protocol 事件分析](https://immunefi.com/blog/bug-fix-reviews/hack-analysis-omni-protocol-july-2022/)
- [Revest Finance 官方复盘](https://revestfinance.medium.com/revest-protocol-exploit-recovery-plan-b06ca33fbdf5)
- [SoK: On the Security of Non-Fungible Tokens](https://doi.org/10.1016/j.bcra.2024.100268)
- [Hardhat 官方网站](https://hardhat.org/)

## 许可

仅用于本地研究、课堂演示、代码审计训练和防御测试。请勿将简化合约部署到公开网络或用于真实资产。
