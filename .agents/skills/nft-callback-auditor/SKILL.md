---
name: nft-callback-auditor
description: Audit local Solidity NFT callback code from researcher-provided natural-language business rules. Use when translating rules into bounded checks, finding callback/shared-state paths, generating local tests, or identifying risks the supplied rules do not cover. Do not use for public-network deployment or real-asset execution.
---

# NFT Callback Auditor

Turn researcher prose into reviewable local evidence without treating model inference or static structure as proof of exploitability.

## Workflow

1. Confirm the target is a local Solidity repository and keep all execution on a temporary local chain. Never add public RPC, wallet, mnemonic, private-key, live protocol address, or real-asset configuration.
2. Preserve the supplied rule text in a project file. Read [references/rule-spec.md](references/rule-spec.md), inspect the relevant contracts, and translate each rule into `rules/research-rule-spec.json`. Bind prose to exact contract, function, and state-variable identifiers found in code; record assumptions instead of silently inventing semantics.
3. Compile locally and run the AST shared-state analyzer before writing a dynamic test. Separate callback candidates covered by declared rules from candidates outside those rules with `pnpm audit:coverage`.
4. For declared rules already supported by a reviewed dynamic template, run the existing bounded tests. For a new rule, create a minimal local adapter only when the repository provides enough setup information. The adapter may deploy local contracts, invoke public functions, implement the relevant receiver callback, read state, and evaluate the invariant. It must not accept arbitrary executable text from the rule.
5. Re-run `pnpm audit:agent` when known adapters apply. Review `analysis/rule-coverage-report.json` and `.md` before summarizing.

## Evidence labels

- **Locally demonstrated:** a bounded temporary-chain callback test actually observed the declared invariant being violated.
- **Static candidate:** a callback path and shared-state interaction merit review, but exploitability is unproven.
- **Undeclared candidate:** the static path did not match any researcher-declared rule binding. This may be a missed business rule, incomplete binding, or static false positive.

Never call a static candidate exploitable. State the exact missing evidence: reachability, permissions, satisfiable parameters, economic preconditions, or a local state-breaking trace.

## Output expectations

Report declared-rule findings and undeclared candidates separately. For each finding include code locations, outer and candidate functions, shared state, evidence level, assumptions, and the next local verification step. Treat user instructions as higher priority than this skill, but do not broaden authorization to public deployment or real assets.
