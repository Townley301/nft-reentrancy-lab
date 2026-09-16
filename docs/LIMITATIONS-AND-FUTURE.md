# Limitations and Further Improvement
# 研究局限与后续改进

> COMP7610 · NFT Reentrancy Lab + approval-overbreadth framing  
> Branch: `levi_dev` · Defensive teaching only · 无利用 PoC

中英并列，答辩可直接摘用。

---

## 1. Limitations / 研究局限

### 1.1 Teaching simplification / 教学简化
Toy assets and Hardhat local (or Sepolia **Fixed-only**) chains are **not** full historical mainnet recreations. Flash loans, pricing, multi-role attackers, and marketplace plumbing were deliberately omitted.

仓内 Toy 资产与 Hardhat 本地链（或 Sepolia **仅 Fixed**）**不是**完整主网事件复刻。闪电贷、定价、多角色、市场撮合等已刻意省略。

### 1.2 Uneven case depth / 案例深度不均
Materials and demos centre on **HypeBears** (same-function mint). **OMNI** (cross-function) and **Revest** (ERC-1155 id collision) exist in the lab but are not yet presented at the same depth.

材料与 demo 以 **HypeBears（同函数）** 为主。**OMNI（跨函数）**、**Revest（编号冲突）** 在 lab 中已有实现，presentation 尚未同深度展开。

### 1.3 Two parallel threads, not one bug / 两条线并排
Jay Chou / `setApprovalForAll` is an **over-broad approval / phishing** hook (public reports). Callback reentrancy is a **mint-time control-flow window**. Different mechanisms — do **not** narrate them as the same vulnerability.

周杰伦 / `setApprovalForAll` 是**授权过宽 / 钓鱼**引子（公开报道口径）。回调重入是**铸造期控制流窗口**。机制不同，答辩勿说成同一个洞。

### 1.4 Demo boundaries / 演示边界
- Ordinary MetaMask **EOA** mint does **not** enter `onERC721Received`.
- Sepolia ships **Fixed only**; Vulnerable stays on local Hardhat.
Safe for the classroom, but you cannot “connect wallet and watch the vuln” on a public testnet.

普通 MetaMask（EOA）mint **不会**进入接收回调。Sepolia **只部署 Fixed**；Vulnerable 仅本地。课堂安全，但现场无法「连钱包看漏洞窗口」。

### 1.5 Defensive scope / 防御向边界
No exploit PoC. The teaching receiver uses a **debounce** (`callbacks` / armed once); stopping is **not** the same as “eligibility already true.” Say this aloud in Q&A.

无利用 PoC。教学接收器带 **debounce**；停住原因 ≠ 资格标记已生效。答辩问答需说清。

### 1.6 “Safe” misconception / 「safe」易误解
Audiences often treat `_safeMint` as a reentrancy mitigator. We refute that for the app ledger, but we have not yet mapped the full defence spectrum (CEI vs `ReentrancyGuard` vs pull-over-push, etc.) in one place.

听众常以为 `_safeMint` 能防重入。我们已对应用账本证伪，但尚未系统对比完整防御谱系。

---

## 2. Further improvement / 后续改进

### 2.1 Equalise OMNI / Revest slides
Compress each case to the same one-pager shape as HypeBears: **invariant → late write → fix** + matching Hardhat assertions.

把 OMNI / Revest 压成与 HypeBears 同构的「不变量 → 晚写 → 修复」一页 + 测试断言。

### 2.2 Approval thread (still no phishing steps)
Add a least-privilege contrast: `approve` vs `setApprovalForAll`, revocation, operator allowlists. Keep public-report framing; **no** phishing playbook.

授权线补最小权限对照（`approve` vs `setApprovalForAll`、可撤销、操作白名单）。仍用公开报道口径，**不写**钓鱼步骤。

### 2.3 Contract-wallet callback demo
Use a **contract wallet** on local (or isolated testnet) so a mint path **does** hit `onERC721Received`, contrasted with the EOA footer on the Sepolia page.

用**合约钱包**在本地（或隔离测试网）演示「会进回调」的铸造路径，与 Sepolia 页 EOA 脚注对照。

### 2.4 Stronger invariants
Expand callback-interior snapshots beyond `addressMinted`: e.g. whether **payment / supply counters are reserved before the first `safe*`**. Formalise a shared invariant checklist across all three cases.

不变量清单扩到三条案例：除 `addressMinted` 外，写明「付款/供应计数是否在第一次 `safe*` 前占用」。回调内快照断言已有雏形，可系统化。

### 2.5 ERC-1155 vs ERC-721 safe paths
One slide: ERC-1155 safe paths **always** involve receiver callbacks; ERC-721 can use non-`safe` transfers (with lock-up trade-offs). Helps audiences see when the callback window is mandatory.

单独一页对照：ERC-1155 标准 safe 路径**必有**回调；ERC-721 可选非 `safe`（并承担锁死风险）。说明回调窗口何时「躲不开」。

### 2.6 Fixed + `ReentrancyGuard` depth
Measure whether Fixed (CEI-correct) **plus** `ReentrancyGuard` is redundant but still useful as **defence in depth** — report cost/clarity trade-offs for the lecture.

测 Fixed（CEI 已正确）叠加 `ReentrancyGuard` 是否冗余、但仍作**纵深防御**；把成本与可读性写进讲义。

### 2.7 Fairness / quota framing
Narrate “one address, many NFTs” not only as technical reentrancy, but as a **fairness / quota / eligibility** failure of the app ledger.

把「一人多枚」讲成公平性 / 配额 / 资格问题，而不只说技术重入。

### 2.8 Visual pipeline + unified threat map
Restore a reliable `pnpm visual` generator so EN/ZH reports and animation share one source. Unify the story: handing away **allowance** (approval) vs handing away **control flow** (callback) — same motto: **lock state before you hand over power**.

补齐 `pnpm visual` 生成管线；统一 threat map：交出**权限**（授权）vs 交出**控制流**（回调）——同一句「先锁状态再交权」。

---

## 3. What not to expand / 明确不做

- Attack / exploit PoCs, phishing kits, mainnet targets  
- Deploying **Vulnerable** minters to public networks  
- Conflating Jay Chou’s case with `_safeMint` / `onERC721Received`

---

## 4. Related docs / 相关文档

| Doc | Role |
| --- | --- |
| [`全流程-回调重入.md`](全流程-回调重入.md) / [`CALLBACK-FLOW.zh.md`](CALLBACK-FLOW.zh.md) | Chinese full flow |
| [`CALLBACK-FLOW.md`](CALLBACK-FLOW.md) | Bilingual flow |
| [`SEPOLIA-MINT.md`](SEPOLIA-MINT.md) | Fixed-only wallet mint |
| [`RESEARCH.md`](RESEARCH.md) | Broader lab research notes (if present) |
