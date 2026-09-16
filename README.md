# NFT Callback Reentrancy Local Lab

一个完全在本地运行的 NFT 回调重入教学项目（HypeBears / OMNI / Revest 最小化模拟）。

## HypeBears 回调全流程讲义

- [`docs/CALLBACK-FLOW.md`](docs/CALLBACK-FLOW.md)
- [`docs/全流程-回调重入.md`](docs/全流程-回调重入.md)
- 学习点测试：`test/hypebears-callback-flow.ts`（随 `pnpm test`）

## Sepolia Fixed-only mint（可选）

仅部署 **Fixed** 铸造合约 + 静态网页。**不要**部署 Vulnerable 到公开网络。

- 指南：[`docs/SEPOLIA-MINT.md`](docs/SEPOLIA-MINT.md)
- 页面：`frontend/sepolia-mint.html`（Connect 后显示 `addressMinted`；mint 成功后自动刷新 flag + balance）
- 命令：`pnpm deploy:sepolia:fixed`（`.env`：`SEPOLIA_RPC_URL` + `DEPLOYER_PRIVATE_KEY`；见 `.env.example`）

**课堂注意：** MetaMask EOA 铸造**不会**出现回调重入窗口；该窗口只在本地 `HypeBearsCallbackStudent` / `pnpm visual` / `docs/CALLBACK-FLOW.md` 中演示。页面页脚也写了：*EOA mint won't show the callback window — see lab demo for that.*

## 安全边界

- 教学主路径：Hardhat 临时本地区块链
- Sepolia 仅允许 Fixed 演示；无主网配置
- `.env` 已在 `.gitignore`；勿提交私钥
- 无攻击 PoC / 无钓鱼 UX / 无 `setApprovalForAll`

## 安装和运行

```bash
pnpm install
pnpm test
pnpm demo
pnpm visual
# optional:
# cp .env.example .env   # then fill Sepolia RPC + deployer key
# pnpm deploy:sepolia:fixed
```

## 预期（HypeBears）

```text
漏洞版：资格检查 → safeMint → 回调重进 mint → 最后才消耗资格  → balance 2
修复版：资格检查 → 先消耗资格 → safeMint → 回调重进失败     → balance 1
```

## 关键文件

```text
contracts/hypebears/HypeBearsLab.sol          # local Vulnerable + Fixed + CallbackStudent
contracts/hypebears/HypeBearsFixedMinter.sol  # Sepolia Fixed-only
docs/CALLBACK-FLOW.md / docs/全流程-回调重入.md / docs/SEPOLIA-MINT.md
frontend/sepolia-mint.html + frontend/config.js
scripts/deploy-fixed-sepolia.ts
test/hypebears-callback-flow.ts
test/reentrancy-lab.ts
```

## 许可

仅用于本地研究、课堂演示、代码审计训练和防御测试。请勿将 Vulnerable 简化合约部署到公开网络或用于真实资产。
