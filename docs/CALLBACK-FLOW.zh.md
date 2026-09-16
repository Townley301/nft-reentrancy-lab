# 全流程：NFT 回调重入（HypeBears 风格）

> **仅防御向教学**  
> 本文说明两层账本、CEI 顺序与课堂演示接收者。  
> **无攻击 PoC、无钓鱼、无主网目标、无逐步「如何攻击」剧本。**  
> 课堂演示接收合约：`HypeBearsCallbackStudent`（不要另写专用 exploit 合约）。

英文对照版见 [`CALLBACK-FLOW.md`](CALLBACK-FLOW.md)。

---

## 0. 如何运行

```bash
# 仓库根目录：nft-reentrancy-lab
pnpm install
pnpm test
pnpm demo      # scripts/run-all.ts：本地临时链控制台演示
pnpm visual    # 刷新 visual-report.html
```

聚焦三条学习点的测试：

```bash
pnpm exec hardhat test test/hypebears-callback-flow.ts
# 或完整套件：
pnpm test
```

课程电脑路径：

`C:\Users\Yifeng\OneDrive\Documentos\HKU\COMP7610A\CourseProject\nft-reentrancy-lab`

需要 Node.js ≥ 22 与 pnpm。链全部是 Hardhat **内存/本地**，不连主网。

---

## 1. 两层账本

| 层级 | 跟踪内容 | 接收钩子 `onERC721Received` 运行时 |
| --- | --- | --- |
| **代币账本** | `ownerOf` / `balanceOf` | 已在 `_safeMint` **内部、回调之前**更新 |
| **应用账本** | `addressMinted[addr]`（一地址一铸） | 若写在 `_safeMint` **之后**，此时仍是旧值 |

EIP-721 的「safe」防的是把 NFT **锁死在不会处理回调的合约里**，**不是**防重入。  
`safe` / `_safeMint` 属于 **Interaction（外部交互）**。保护业务不变量的应用侧 **Effects（状态写入）** 必须在这次交互 **之前** 完成。

```text
代币账本  ≠  应用账本
owner/balance    addressMinted / 资格 / 配额
```

---

## 2. 漏洞版流程

`HypeBearsVulnerable.mintNFT`：

```text
检查：require(!addressMinted[msg.sender])
   ↓
_safeMint(msg.sender)
   ├─ 写入 ownerOf / balanceOf          ← 代币账本已更新
   └─ onERC721Received(...)              ← 同笔交易交出控制权
        └─ 教学接收合约可能再次调用 mintNFT
             此时 addressMinted[student] 仍为 false
   ↓
晚写 Effects：addressMinted[msg.sender] = true
```

### 同一笔交易窗口

整段发生在 **同一笔交易、同一调用栈** 里：外层 `mintNFT` 尚未写完 `addressMinted`，钩子已经拿到执行权。  
这不是「下一区块再打」——是 **回调窗口（callback window）**。

### 教学接收者 vs 诚实接收

| | 教学接收（`HypeBearsCallbackStudent`） | 诚实接收 |
| --- | --- | --- |
| 目的 | 课堂演示 | 收下 NFT 即停 |
| 钩子行为 | 在 `armed` 时**最多再调一次** `mintNFT` | 只返回魔法值 |
| 目标 | 让 CEI 问题在测试里**可观测** | 兼容 safe mint |

高层含义：演示「应用标记尚未写完，控制权已回到外部代码」。这不是生产级攻击工具包。

**学习点 (a)**：Vulnerable 的第一次回调中，即使 `balanceOf` 已增加，`addressMinted[student]` 仍为 `false`。  
在 `test/hypebears-callback-flow.ts` 里通过 `addressMintedDuringFirstCallback` 断言。

---

## 3. 身份与 `msg.sender`（学习点 b）

| 场景 | `msg.sender` | 说明 |
| --- | --- | --- |
| 外层 `mintNFT`（由 `runLesson` 进入） | **学生合约** | 资格键 / 余额都记在学生地址上 |
| 钩子内再次 `mintNFT` | **仍是学生合约** | 同一资格键——所以晚写标记才致命 |
| `onERC721Received` 钩子体内 | **NFT / Toy 合约** | EIP-721：钩子里的 `msg.sender` 永远是代币合约 |
| 钩子参数 `operator` | **学生**（本实验） | `_safeMint` 传入的是铸造调用方 |

**不要混：** 钩子里的 `msg.sender`（NFT）≠ 铸造时的 `msg.sender`（学生）。  
常见误区：把「谁拥有 NFT」和「钩子里的 `msg.sender` 是谁」当成一回事。

测试断言：`msgSenderDuringCallback == victim`，`operatorDuringCallback == student`。

---

## 4. 修复版流程（学习点 c）——一行 CEI 之差

`HypeBearsFixed.mintNFT`：

```text
检查：require(!addressMinted[msg.sender])
Effects：addressMinted[msg.sender] = true     ← 唯一顺序变化
   ↓
_safeMint → 回调
   └─ 第二次 mintNFT → require 失败 → catch → reentrySucceeded=false
```

| | 漏洞版 | 修复版 |
| --- | --- | --- |
| 标记相对 `_safeMint` | **之后** | **之前** |
| 第一次回调时标记 | `false` | `true` |
| 课后 `balanceOf(student)` | `2` | `1` |
| `reentrySucceeded` | `true` | `false` |
| `callbacks` | `2` | `1` |

NFT 应用侧的 CEI：**在第一次 `safe*` / `_safeMint` 之前写完应用 Effects。**  
`ReentrancyGuard` 可以加，但**不能代替**这一顺序。

---

## 5. 审计 / 学生检查清单

- [ ] 列出所有 `safeMint` / `safeTransferFrom` / ERC-1155 safe 路径（Interactions）
- [ ] 对每条路径，列出保护不变量的**应用**状态（`addressMinted`、配额、健康度、编号…）
- [ ] 确认这些 Effects 写在**第一次**外部接收回调之前
- [ ] 记住：代币账本看起来「对」，应用账本仍可能过期
- [ ] 核对钩子里对 `msg.sender` 的假设（必须是代币合约）
- [ ] 优先在**回调内部**快照应用状态（本实验已这样做）
- [ ] 不要把「我们用了 `_safeMint`」当成防重入措施

---

## 6. 相关文件

| 路径 | 作用 |
| --- | --- |
| `contracts/hypebears/HypeBearsLab.sol` | 漏洞版 + 修复版 + 教学接收器 |
| `test/hypebears-callback-flow.ts` | 学习点 (a)(b)(c) |
| `test/reentrancy-lab.ts` | 原有余额 / 重入套件 |
| `scripts/run-all.ts` | `pnpm demo` |
| `visual-report.html` | 分步 UI（`pnpm visual`） |
| `frontend/sepolia-mint.html` | Sepolia 仅 Fixed 铸造页 |

---

## 7. 安全声明

本包用于 COMP7610 类课程的**防御向教学**：

- 无专用攻击 exploit 脚本  
- 无钓鱼工具  
- 无「如何攻击」逐步复现剧本  
- 无真实主网地址或真实资金  

请只使用 Hardhat 本地链与仓内 Toy 资产。

可选：Sepolia **仅 Fixed** 铸造演示（普通 EOA **看不到**回调窗口）——见 [`SEPOLIA-MINT.md`](SEPOLIA-MINT.md)。  
网页页脚说明：*EOA mint 不会展示回调窗口——请看本地 lab demo。*
