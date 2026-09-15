# 共享状态回调分析报告（本地防御实验）

本报告由本地 Solidity 编译器 AST 生成，不进行 RPC 调用，也不证明候选路径一定可利用。候选函数仍需结合访问控制、参数约束和业务逻辑人工复核。

- 生成时间：2026-09-15T06:58:15.152Z
- Solidity 编译器：0.8.28+commit.7893614a
- 已检查合约：16
- 含回调的入口函数：12
- 未缓解的候选路径：13

## 回调点

| 合约 | 入口函数 | 回调类型 | 位置 | 回调后继续访问的状态 |
|---|---|---|---|---|
| ToyERC721 | safeTransferFrom | ERC-721 receiver callback | contracts/common/ToyAssets.sol:93 | 无 |
| ToyERC1155 | mint | ERC-1155 receiver callback | contracts/common/ToyAssets.sol:122 | 无 |
| HypeBearsVulnerable | mintNFT | ERC-721 receiver callback | contracts/hypebears/HypeBearsLab.sol:39 | addressMinted, balanceOf |
| HypeBearsFixed | mintNFT | ERC-721 receiver callback | contracts/hypebears/HypeBearsLab.sol:51 | 无 |
| OmniPoolVulnerable | withdraw | ERC-721 safe-transfer callback | contracts/omni/OmniLab.sol:70 | collateralCount, debt, usingAsCollateral |
| OmniPoolVulnerable | liquidate | ERC-721 safe-transfer callback | contracts/omni/OmniLab.sol:95 | collateralCount, debt, usingAsCollateral |
| OmniPoolFixed | withdraw | ERC-721 safe-transfer callback | contracts/omni/OmniLab.sol:130 | 无 |
| OmniPoolFixed | liquidate | ERC-721 safe-transfer callback | contracts/omni/OmniLab.sol:149 | 无 |
| RevestVulnerable | createSeries | ERC-1155 mint callback | contracts/revest/RevestLab.sol:71 | nextId |
| RevestVulnerable | depositAdditionalToFNFT | ERC-1155 mint callback | contracts/revest/RevestLab.sol:91 | nextId |
| RevestFixed | createSeries | ERC-1155 mint callback | contracts/revest/RevestLab.sol:111 | 无 |
| RevestFixed | depositAdditionalToFNFT | ERC-1155 mint callback | contracts/revest/RevestLab.sol:126 | 无 |

## 按风险排序的重入审查候选

### HypeBearsVulnerable

| 风险 | 外层函数 | 候选重入函数 | 模式 | 相关共享状态 | 锁检查 |
|---|---|---|---|---|---|
| high | mintNFT | mintNFT | same-function | addressMinted, balanceOf | 未观察到共享 nonReentrant 修饰器 |

### OmniPoolVulnerable

| 风险 | 外层函数 | 候选重入函数 | 模式 | 相关共享状态 | 锁检查 |
|---|---|---|---|---|---|
| high | withdraw | withdraw | same-function | collateralCount, usingAsCollateral | 未观察到共享 nonReentrant 修饰器 |
| high | withdraw | liquidate | cross-function | collateralCount, debt, usingAsCollateral | 未观察到共享 nonReentrant 修饰器 |
| high | withdraw | supply | cross-function | collateralCount, usingAsCollateral | 未观察到共享 nonReentrant 修饰器 |
| high | liquidate | withdraw | cross-function | collateralCount, usingAsCollateral | 未观察到共享 nonReentrant 修饰器 |
| high | liquidate | liquidate | same-function | collateralCount, debt, usingAsCollateral | 未观察到共享 nonReentrant 修饰器 |
| high | liquidate | supply | cross-function | collateralCount, usingAsCollateral | 未观察到共享 nonReentrant 修饰器 |
| medium | withdraw | borrow | cross-function | debt | 未观察到共享 nonReentrant 修饰器 |
| medium | liquidate | borrow | cross-function | debt | 未观察到共享 nonReentrant 修饰器 |

### RevestVulnerable

| 风险 | 外层函数 | 候选重入函数 | 模式 | 相关共享状态 | 锁检查 |
|---|---|---|---|---|---|
| medium | createSeries | createSeries | same-function | nextId | 未观察到共享 nonReentrant 修饰器 |
| medium | createSeries | depositAdditionalToFNFT | cross-function | nextId | 未观察到共享 nonReentrant 修饰器 |
| medium | depositAdditionalToFNFT | createSeries | cross-function | nextId | 未观察到共享 nonReentrant 修饰器 |
| medium | depositAdditionalToFNFT | depositAdditionalToFNFT | same-function | nextId | 未观察到共享 nonReentrant 修饰器 |

## 如何解释结果

只有当回调发生后，外层函数仍会访问某项状态，并且另一个 public/external 函数能够写入该状态时，路径才会被列出。`high` 和 `medium` 表示审查优先级，不是可利用性结论；`mitigated` 表示两条路径可见地共享重入锁。

配套业务不变量测试只在 Hardhat 临时内存链中执行。
