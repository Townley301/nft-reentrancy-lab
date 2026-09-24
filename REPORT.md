# NFT Callback Reentrancy Lab — Brief Report

## 1. Objective

This project reproduces three classes of NFT callback reentrancy issues on an ephemeral local Hardhat blockchain and compares vulnerable implementations with their fixed counterparts. A fourth, independently labeled marketplace holdout checks whether the same workflow can express a new business invariant without adding a case-specific branch to the executor.

The project does not connect to a public RPC endpoint or use real wallets, private keys, addresses, orders, or assets. Every transaction uses only local teaching contracts, Toy NFTs, and Toy Tokens whose state disappears with the temporary chain.

## 2. Reproduced Cases

| Case | Callback entry point | Violated invariant | Mitigation |
|---|---|---|---|
| HypeBears | ERC-721 `onERC721Received` | One address may mint at most one NFT | Consume the minting entitlement before `_safeMint` |
| OMNI | ERC-721 safe-transfer callback | Debt must not exceed the remaining collateral capacity | Use a shared reentrancy guard and finalize state and health checks before transfer |
| Revest | ERC-1155 `onERC1155Received` | Redemption value must not exceed the value actually funded | Reserve a unique ID before the callback and reject configuration overwrites |
| Marketplace holdout | ERC-721 `onERC721Received` | One Toy Token listing bond may be returned at most once | Finalize the listing and return the bond before transferring the Toy NFT |

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

$$
\mathrm{finalBondBalance}(u) \le \mathrm{fundedBond}(u)
$$

## 3. Skill and Agent Workflow

The project Skill is located at `.agents/skills/nft-callback-auditor/`. It requires the Agent to bind a researcher's natural-language business rules to actual contracts, functions, and state variables before running local static analysis and bounded dynamic tests. A static candidate is not treated as proof of exploitability. A finding is labeled as locally demonstrated only when a local test observes an invariant violation.

Stage 2 replaces the three hard-coded dynamic test branches with declarative JSON adapters. The generic executor supports only reviewed local deployments, ordered contract calls, state observations, bounded integer parameters, and a small assertion language. Adapter files cannot contain arbitrary JavaScript, Solidity, RPC, network, account, wallet, address, mnemonic, or private-key fields.

The three original adapters form the development set. The marketplace bond rule is a holdout: supporting it required a new Toy fixture, one unified rule, and one adapter configuration, but no marketplace-specific executor logic. This is evidence that the current DSL generalizes to one additional ERC-721 cross-function callback pattern; it is not a claim of universal contract coverage.

## 4. Minimal Reproduction

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm verify:v2
pnpm audit:agent
```

Run the direct demonstration of the three original historical teaching cases with:

```bash
pnpm demo
```

The `analysis/` directory, `test/generated/`, and HTML reports produced by the test, analysis, and visualization commands are reproducible outputs and are therefore excluded from Git.

The current verified result is:

- 4 bound business-invariant rules: 3 development and 1 holdout;
- 18 generated local scenarios: 9 vulnerable and 9 fixed;
- 16 unmitigated static review candidates;
- 4 precisely bound candidates with local counterexamples and 12 static-only candidates;
- 0 candidates outside the declared rule scopes;
- 53 passing tests in the complete suite.

## 5. Conclusion

All four cases share the same underlying cause: critical business state remains incomplete or stale when control is transferred to an external NFT receiver callback. A robust fix generally combines the Checks-Effects-Interactions pattern, a cross-function reentrancy guard, and explicit business-invariant tests.

The next research step should add a second, structurally different holdout—preferably an ERC-1155 batch or authorization-transition invariant—and measure adapter coverage, false positives, and unsupported DSL requirements without tuning the executor against the holdout before evaluation.
