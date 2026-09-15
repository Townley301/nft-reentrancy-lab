# NFT Callback Reentrancy Local Lab

一个完全在本地运行的 NFT 回调重入教学项目，对三个历史案例的**核心逻辑**进行最小化模拟：

1. HypeBears：ERC-721 `_safeMint` 回调导致同函数重入；
2. OMNI Protocol：ERC-721 转账回调进入另一条清算函数；
3. Revest Finance：ERC-1155 铸造回调读取过期的 FNFT 编号。

本项目不是原协议复刻，也不包含真实攻击所需的主网地址、RPC、私钥、闪电贷、价格操纵或资产兑换代码。

## 安全边界

- 只使用 Hardhat 临时本地区块链；
- 所有账户均由本地节点临时生成；
- 所有 NFT 和代币均为项目内定义的 `Toy` 资产；
- 配置中没有主网或测试网 RPC；
- `.env` 被排除在 Git 之外，代码也不会读取私钥；
- 每次运行测试都会创建一条新的临时链，运行结束后状态消失。

不要把 `contracts/common/ToyAssets.sol` 中的简化资产合约用于生产环境。

## 环境要求

- Node.js 22 或更高版本；
- pnpm 10 或兼容的 npm。

## 安装和运行

```bash
pnpm install
pnpm test
pnpm demo
pnpm visual
pnpm analyze
pnpm verify:v2
pnpm verify:rules
```

### 由研究者业务规则生成回调测试

研究者只需按照 `rules/callback-rules.schema.json` 编辑 `rules/callback-rules.json`，为已审查的本地模板填写业务不变量、少量有上限的参数组合，以及漏洞版/修复版的预期（`violate` 或 `preserve`）。随后运行：

```bash
pnpm verify:rules
```

该命令会严格校验规则、生成 `test/generated/callback-rules.test.ts`、在 Hardhat 临时内存链上执行回调场景，并输出：

- `analysis/business-rule-report.json`：供工具读取的逐场景结果；
- `analysis/business-rule-report.md`：供研究者阅读的预期/观察对照表。

规则格式只允许项目内已有的三个回调模板，不接受任意代码、RPC、网络、钱包、账户、地址、助记词或私钥字段。参数数量和值域都有上限。完整的流程差距和仍保留的限制见 `analysis/workflow-gap-report.md`。

### 第二版：共享状态防御分析器

`pnpm analyze` 只读取本项目的 Solidity 编译 AST，不连接任何 RPC、钱包或真实资产。它会：

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

`pnpm visual` 会重新创建一条临时本地链，运行三个教学案例的漏洞版和修复版，并把**实际本地交易收据中的事件日志**连同交易前后的状态，写入项目根目录的 `visual-report.html`。该文件已经随项目提供一份示例结果；想刷新结果时再执行生成命令即可。

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

## 项目结构

```text
contracts/
├── common/ToyAssets.sol
├── hypebears/HypeBearsLab.sol
├── omni/OmniLab.sol
└── revest/RevestLab.sol
scripts/
├── run-all.ts
└── generate-visual-report.ts
test/
└── reentrancy-lab.ts
viewer/
└── template.html
visual-report.html
```

每个案例均包含：

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
