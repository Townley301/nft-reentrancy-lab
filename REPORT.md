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

## 4. What the Workflow Now Accomplishes

The implemented workflow is:

```text
Researcher-written business invariant
        ↓
Agent inspection and semantic binding to contracts, functions, and state
        ↓
Unified rule specification with development/holdout provenance
        ↓
Schema and cross-field validation
        ↓
Local AST callback/shared-state candidate analysis
        ↓
Reviewed declarative adapter executed on an ephemeral Hardhat chain
        ↓
Vulnerable/fixed comparison under the same bounded parameters
        ↓
Evidence correlation and JSON, Markdown, and offline HTML reports
```

This workflow currently completes five useful tasks:

1. It preserves the researcher's prose while creating an auditable semantic binding to exact local code identifiers.
2. It separates a static review hypothesis from a locally demonstrated invariant violation, avoiding the claim that an AST pattern alone proves exploitability.
3. It generates deterministic vulnerable/fixed regression scenarios from reviewed data rather than executing arbitrary model-generated code.
4. It distinguishes development cases from holdouts, allowing limited measurement of whether the adapter DSL generalizes beyond the cases used to shape it.
5. It enforces a local-only safety boundary: ephemeral Hardhat state, project-defined Toy assets, bounded parameters, and no public RPC, wallet, private key, live address, or real-asset operation.

The workflow does not yet automatically understand arbitrary prose, synthesize a safe adapter for every contract, prove reachability, or establish production exploitability. Unsupported rules remain static-only until a reviewer supplies an appropriate local fixture and adapter.

## 5. Next Research Work

The next stage should evaluate the frozen workflow rather than immediately add more executor features.

1. Freeze the current adapter schema and generic executor as the Stage 2 baseline.
2. Add at least two structurally different holdouts that were not used to design that baseline:
   - an ERC-1155 batch-callback accounting or identifier-consistency case;
   - an authorization or role-transition case in which callback reentry changes who may perform an action.
3. Add negative controls: callback-containing contracts that are intentionally safe, plus static candidates that are unreachable because of permissions or state preconditions.
4. Create a hand-reviewed ground-truth manifest for every expected callback path and expected evidence level.
5. Measure path coverage, false positives, false negatives, unsupported-adapter rate, and whether each holdout required a schema/runtime change.
6. Add clean-install continuous integration that runs rule generation, all tests, coverage correlation, safety checks, and report generation from an empty build directory.
7. Document limitations and threats to validity, especially the small synthetic dataset, simplified Toy contracts, bounded parameter search, AST aliasing limits, and the difference between local evidence and real-protocol security conclusions.

If a holdout requires a new DSL operation, that operation should first be isolated, schema-validated, negatively tested, and reported as a workflow extension. The same case should not then be counted as untouched holdout evidence.

## 6. Definition of a More Complete Study

The project would be reasonably complete as a reproducible defensive research prototype when all of the following are true:

- the dataset contains at least three development cases and three or more untouched holdouts across ERC-721 and ERC-1155, same-function and cross-function reentry, and more than one invariant category;
- every case has a vulnerable fixture, a fixed fixture, an explicit invariant, bounded parameters, and a reviewer-approved expected result;
- the generic executor contains no case or contract names, and most holdouts run without executor changes;
- safe negative controls are included and the report presents false positives and false negatives rather than only successful detections;
- every static candidate is classified as locally demonstrated, static-only, or intentionally rejected with a recorded reason;
- a clean checkout reproduces the same tests and summary metrics with one documented command;
- schemas, safety rejection tests, development/holdout provenance, and generated-report formats are versioned;
- the report clearly limits conclusions to local Toy contracts and never generalizes the results to real assets or production exploitability.

Meeting these criteria would make the work a credible teaching and research prototype. A production auditor would still require broader Solidity semantics, larger independently curated datasets, stronger interprocedural and alias analysis, systematic state-space exploration, and external validation.

## 7. Minimal Reproduction

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

## 8. Conclusion

All four cases share the same underlying cause: critical business state remains incomplete or stale when control is transferred to an external NFT receiver callback. A robust fix generally combines the Checks-Effects-Interactions pattern, a cross-function reentrancy guard, and explicit business-invariant tests.

The immediate next step is to freeze the Stage 2 engine, add the two independent holdouts and safe negative controls described above, and evaluate them against a hand-reviewed ground truth before changing the DSL.
