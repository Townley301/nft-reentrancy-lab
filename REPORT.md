# NFT Callback Reentrancy Lab — Brief Report

## 1. Objective

This project reproduces three classes of NFT callback reentrancy issues on an ephemeral local Hardhat blockchain and compares vulnerable implementations with their fixed counterparts. Three independently labeled holdouts—a marketplace bond case, an ERC-1155 batch voucher case, and a temporary-authorization case—check whether the same workflow can express new business invariants without adding case-specific branches to the executor.

The project does not connect to a public RPC endpoint or use real wallets, private keys, addresses, orders, or assets. Every transaction uses only local teaching contracts, Toy NFTs, and Toy Tokens whose state disappears with the temporary chain.

## 2. Reproduced Cases

| Case | Callback entry point | Violated invariant | Mitigation |
|---|---|---|---|
| HypeBears | ERC-721 `onERC721Received` | One address may mint at most one NFT | Consume the minting entitlement before `_safeMint` |
| OMNI | ERC-721 safe-transfer callback | Debt must not exceed the remaining collateral capacity | Use a shared reentrancy guard and finalize state and health checks before transfer |
| Revest | ERC-1155 `onERC1155Received` | Redemption value must not exceed the value actually funded | Reserve a unique ID before the callback and reject configuration overwrites |
| Marketplace holdout | ERC-721 `onERC721Received` | One Toy Token listing bond may be returned at most once | Finalize the listing and return the bond before transferring the Toy NFT |
| Batch voucher holdout | ERC-1155 `onERC1155BatchReceived` | Total Toy voucher balance must not exceed recorded credit | Record the complete credit before transferring the Toy token batch |
| Temporary authorization holdout | ERC-721 `onERC721Received` | One temporary authorization may transfer at most one Toy NFT | Consume the authorization before transferring the first Toy NFT |

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

$$
\sum_i \mathrm{voucherBalance}(u,i) \le \mathrm{recordedCredit}(u)
$$

$$
\Delta \mathrm{toyNftBalance}(u,\mathrm{temporaryAuthorization}) \le 1
$$

## 3. Skill and Agent Workflow

The project Skill is located at `.agents/skills/nft-callback-auditor/`. It requires the Agent to bind a researcher's natural-language business rules to actual contracts, functions, and state variables before running local static analysis and bounded dynamic tests. A static candidate is not treated as proof of exploitability. A finding is labeled as locally demonstrated only when a local test observes an invariant violation.

Stage 2 replaces the three hard-coded dynamic test branches with declarative JSON adapters. The generic executor supports only reviewed local deployments, ordered contract calls, state observations, bounded integer parameters, and a small assertion language. Adapter files cannot contain arbitrary JavaScript, Solidity, RPC, network, account, wallet, address, mnemonic, or private-key fields.

The three original adapters form the development set. The marketplace bond, batch voucher, and temporary-authorization rules are holdouts: each required a new Toy fixture, one unified rule, and one adapter configuration, but no case-specific executor logic. This is evidence that the current DSL generalizes to three additional callback patterns; it is not a claim of universal contract coverage.

Stage 3 freezes the adapter schema, validator, and generic runtime by commit and SHA-256 digest. A hand-reviewed manifest labels positive paths, fixed variants, safe ordering controls, and permission/state-index controls. The evaluator reports false positives and false negatives instead of treating every structural candidate as a successful finding.

Stage 4 adds the authorization-category holdout without changing any frozen engine file. The vulnerable fixture keeps a one-use local authorization active during the ERC-721 callback; the fixed fixture consumes it before transferring the Toy NFT.

Stage 5 adds a versioned reproducibility contract and a read-only continuous-integration workflow. A single command regenerates every local result and rejects unexpected metric drift, missing reports, failed ground-truth thresholds, or a weakened safety boundary. The CI job has read-only repository permission, does not persist Git credentials, does not read secrets, and contains no deployment or public-chain step.

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

This workflow currently completes seven useful tasks:

1. It preserves the researcher's prose while creating an auditable semantic binding to exact local code identifiers.
2. It separates a static review hypothesis from a locally demonstrated invariant violation, avoiding the claim that an AST pattern alone proves exploitability.
3. It generates deterministic vulnerable/fixed regression scenarios from reviewed data rather than executing arbitrary model-generated code.
4. It distinguishes development cases from holdouts, allowing limited measurement of whether the adapter DSL generalizes beyond the cases used to shape it.
5. It enforces a local-only safety boundary: ephemeral Hardhat state, project-defined Toy assets, bounded parameters, and no public RPC, wallet, private key, live address, or real-asset operation.
6. It evaluates a frozen engine against hand-labeled positive and negative paths and records whether holdouts required an executor change.
7. It compares all generated summary metrics with a reviewer-controlled expected file so that accidental result drift cannot pass silently.

The workflow does not yet automatically understand arbitrary prose, synthesize a safe adapter for every contract, prove reachability, or establish production exploitability. Unsupported rules remain static-only until a reviewer supplies an appropriate local fixture and adapter.

## 5. Next Research Work

Stage 5 completes the clean-install reproducibility step. The next stage should refine evaluation quality rather than immediately add more executor features.

1. Preserve the frozen Stage 2 adapter schema, validator, and generic executor baseline.
2. Expand negative controls for modifiers, mapping-key aliasing, callback reachability, and mutually exclusive state conditions.
3. Extend the hand-reviewed manifest until every intentionally evaluated callback path has an expected evidence level.
4. Add explicit reason codes for static-only and intentionally rejected candidates.
5. Continue measuring path coverage, false positives, false negatives, unsupported-adapter rate, and whether each holdout required a schema/runtime change.
6. Write the final threats-to-validity section, especially the small synthetic dataset, simplified Toy contracts, bounded parameter search, AST aliasing limits, and the difference between local evidence and real-protocol security conclusions.

If a holdout requires a new DSL operation, that operation should first be isolated, schema-validated, negatively tested, and reported as a workflow extension. The same case should not then be counted as untouched holdout evidence.

## 6. Definition of a More Complete Study

The project would be reasonably complete as a reproducible defensive research prototype when all of the following are true:

- the dataset contains at least three development cases and three or more untouched holdouts across ERC-721 and ERC-1155, same-function and cross-function reentry, and more than one invariant category;
- every case has a vulnerable fixture, a fixed fixture, an explicit invariant, bounded parameters, and a reviewer-approved expected result;
- the generic executor contains no case or contract names, and most holdouts run without executor changes;
- safe negative controls are included and the report presents false positives and false negatives rather than only successful detections;
- every static candidate is classified as locally demonstrated, static-only, or intentionally rejected with a recorded reason;
- a clean checkout reproduces the same tests and summary metrics with the documented `pnpm verify:ci` command (implemented in Stage 5);
- schemas, safety rejection tests, development/holdout provenance, and generated-report formats are versioned;
- the report clearly limits conclusions to local Toy contracts and never generalizes the results to real assets or production exploitability.

Meeting these criteria would make the work a credible teaching and research prototype. A production auditor would still require broader Solidity semantics, larger independently curated datasets, stronger interprocedural and alias analysis, systematic state-space exploration, and external validation.

## 7. Minimal Reproduction

Requirements: Node.js 22+ and pnpm 12.4.1.

```bash
pnpm install --frozen-lockfile
pnpm verify:ci
```

Run the direct demonstration of the three original historical teaching cases with:

```bash
pnpm demo
```

The `analysis/` directory, `test/generated/`, and HTML reports produced by the test, analysis, and visualization commands are reproducible outputs and are therefore excluded from Git.

The current verified result is:

- 6 bound business-invariant rules: 3 development and 3 holdouts;
- 26 generated local scenarios: 13 vulnerable and 13 fixed;
- 23 unmitigated static review candidates;
- 6 precisely bound candidates with local counterexamples and 17 static-only candidates;
- 15 hand-labeled evaluation paths: 6 true positives, 2 false positives, 0 false negatives, and 7 true negatives;
- 75% precision, 100% recall, and 77.8% specificity on the labeled paths;
- 12/12 dynamic ground-truth checks passed, 3/3 holdouts required no executor change, and frozen-engine drift is zero;
- 66 passing tests in the complete suite, including reproducibility drift and safety-boundary rejection tests;
- the generated JSON and offline HTML reports match `evaluation/expected-summary.json`.

## 8. Conclusion

All six dynamic cases share the same underlying cause: critical business state remains incomplete or stale when control is transferred to an external NFT receiver callback. A robust fix generally combines the Checks-Effects-Interactions pattern, a cross-function reentrancy guard, and explicit business-invariant tests.

The immediate next step is Stage 6: improve negative-control classification and document threats to validity, while keeping the frozen engine and Stage 5 reproducibility contract unchanged.
