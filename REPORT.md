# NFT Callback Reentrancy Lab — Brief Report

## 1. Objective

This project reproduces three classes of NFT callback reentrancy issues on an ephemeral local Hardhat blockchain and compares vulnerable implementations with their fixed counterparts. It does not connect to a public RPC endpoint or use real wallets, private keys, or assets.

## 2. Reproduced Cases

| Case | Callback entry point | Violated invariant | Mitigation |
|---|---|---|---|
| HypeBears | ERC-721 `onERC721Received` | One address may mint at most one NFT | Consume the minting entitlement before `_safeMint` |
| OMNI | ERC-721 safe-transfer callback | Debt must not exceed the remaining collateral capacity | Use a shared reentrancy guard and finalize state and health checks before transfer |
| Revest | ERC-1155 `onERC1155Received` | Redemption value must not exceed the value actually funded | Reserve a unique ID before the callback and reject configuration overwrites |

The corresponding invariants are:

$$
\Delta \mathrm{balance}_{NFT}(u) \le 1
$$

$$
\mathrm{debt}(u) \le \mathrm{collateralCount}(u) \times \mathrm{CREDIT\_PER\_NFT}
$$

$$
\mathrm{payout}(u) \le \mathrm{fundedValue}(u)
$$

## 3. Skill and Agent Workflow

The project Skill is located at `.agents/skills/nft-callback-auditor/`. It requires the Agent to bind a researcher's natural-language business rules to actual contracts, functions, and state variables before running local static analysis and bounded dynamic tests. A static candidate is not treated as proof of exploitability. A finding is labeled as locally demonstrated only when a local test observes an invariant violation.

## 4. Minimal Reproduction

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm verify:v2
pnpm audit:agent
```

Run the direct demonstration of all three cases with:

```bash
pnpm demo
```

The `analysis/` directory, `test/generated/`, and HTML reports produced by the test, analysis, and visualization commands are reproducible outputs and are therefore excluded from Git.

## 5. Conclusion

All three cases share the same underlying cause: critical business state remains incomplete or stale when control is transferred to an external NFT receiver callback. A robust fix generally combines the Checks-Effects-Interactions pattern, a cross-function reentrancy guard, and explicit business-invariant tests.
