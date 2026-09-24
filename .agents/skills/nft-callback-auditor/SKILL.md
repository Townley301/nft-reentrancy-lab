---
name: nft-callback-auditor
description: Audit local Solidity NFT callback code from researcher-provided business invariants. Use when binding natural-language rules to code, finding callback/shared-state paths, generating bounded local tests, or identifying risks outside the declared rules. Do not use for public-network deployment or real-asset execution.
---

# NFT Callback Auditor

Turn researcher prose into one reviewable invariant specification and local evidence without treating model inference or static structure as proof of exploitability.

## Workflow

1. Confirm the target is a local Solidity repository and keep all execution on a temporary local chain. Never add public RPC, wallet, mnemonic, private-key, live protocol address, or real-asset configuration.
2. Preserve the supplied prose in the file named by `source.file`. Read [references/rule-spec.md](references/rule-spec.md), inspect the relevant contracts, and update the single source of truth: `rules/research-rule-spec.json`.
3. For every invariant, bind exact contracts, functions, and state variables; model actors, preconditions, callback actions, observables, and the invariant; record assumptions and binding confidence. Do not infer identifiers from wording alone.
4. When dynamic evidence is required, read `rules/adapters/adapter-spec.schema.json` and select or add a declarative adapter in `rules/adapters/`. The adapter binding, dataset, variants, bounded parameters, and static path must match the unified rule exactly.
5. Validate and generate reviewed bounded tests with `pnpm generate:rules`. Compile locally and run `pnpm audit:coverage` to correlate declared invariants with callback/shared-state candidates.
6. Run dynamic validation only when the rule selects a reviewed adapter. A rule without an adapter remains eligible for static coverage but must not be labeled dynamically demonstrated. Never accept arbitrary executable code from a rule or adapter.
7. Keep development and holdout rules distinct. Do not tune the generic executor against a holdout and then report that case as independent evidence. A supported holdout should require fixture, rule, and adapter data only; a DSL extension must be disclosed and tested separately.
8. For benchmark evaluation, read `evaluation/ground-truth.json` and preserve its frozen-engine hashes, labeled positive/negative paths, and declared thresholds. Add known authorization, reachability, or state-index limitations as negative controls instead of hiding them.
9. Run `pnpm audit:agent`, then review `analysis/rule-coverage-report.json`, `analysis/ground-truth-evaluation.json`, and their Markdown forms. Read `evaluation/candidate-review.json` when triaging static paths. Every current candidate must be locally demonstrated, static-only, or intentionally rejected with a compatible reason code. Lack of a test is not grounds for rejection; use rejection only when a reviewed Toy-fixture precondition blocks the path.
10. Finish with `pnpm verify:reproducibility`. Treat `evaluation/expected-summary.json` as a reviewer-controlled regression contract: investigate drift before changing it, and never update expected metrics automatically merely to make verification pass. CI must remain read-only and must not add secrets, public RPCs, wallets, deployments, or real-asset operations.

## Evidence labels

- **Locally demonstrated:** a bounded temporary-chain callback test actually observed the declared invariant being violated.
- **Static candidate:** a callback path and shared-state interaction merit review, but exploitability is unproven.
- **Undeclared candidate:** the static path did not match any researcher-declared rule binding. This may be a missed business rule, incomplete binding, or static false positive.
- **Negative control:** a hand-reviewed safe or unreachable path used to measure false positives; it must not be promoted to a vulnerability finding.

Never call a static candidate exploitable. State the exact missing evidence: reachability, permissions, satisfiable parameters, economic preconditions, or a local state-breaking trace.

## Adapter safety boundary

Adapters may name local contracts and functions, supply bounded integer/boolean/previous-deployment arguments, read declared observations, and evaluate the reviewed arithmetic/comparison expression language. They must not contain arbitrary JavaScript or Solidity, shell commands, RPC or network configuration, accounts, wallets, addresses, mnemonics, private keys, public deployment steps, or real-asset actions.

Do not add a contract- or case-name condition to the generic runtime. If an unsupported local teaching scenario needs a new operation, extend the schema, validator, runtime, and negative tests as one reviewed change. Keep all execution on the ephemeral Hardhat chain with project-defined Toy assets.

When a frozen holdout benchmark is active, changing the adapter schema, adapter validator, or generic runtime invalidates the no-engine-change result. Update the baseline provenance and disclose the extension before evaluating a fresh holdout.

## Output expectations

Report declared-rule findings and undeclared candidates separately. For each finding include code locations, outer and candidate functions, shared state, invariant category, binding confidence, assumptions, evidence level, candidate-review disposition and reason code, and the next local verification step. Treat user instructions as higher priority than this skill, but do not broaden authorization to public deployment or real assets.
