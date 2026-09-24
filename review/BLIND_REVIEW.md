# Blind Candidate Review Protocol

This protocol supports an independent review of a small local Toy NFT sample without exposing the project's expected candidate labels.

## Prepare the packet

Run the normal local analysis, then generate the packet:

```bash
pnpm audit:coverage
pnpm generate:blind-review
```

The output is `analysis/blind-review-packet.json`. It contains six static paths, source locations, callback type, shared states, and review questions. It deliberately omits rule matches, dynamic evidence, evidence levels, dispositions, reason codes, and existing rationales.

## Reviewer boundary

Give the reviewer the generated packet and the listed local Solidity source files. Do not give them `evaluation/candidate-review.json`, `analysis/rule-coverage-report.json`, or the dynamic reports until they return their first-pass classifications.

For each `review-NN` case, ask the reviewer to return:

- `disposition`: `locally-demonstrated`, `static-only`, or `intentionally-rejected`;
- `reasonCode`: a concise reason category;
- `rationale`: the exact reachability, caller, ownership, parameter, state, or mapping-key evidence behind the decision;
- `needsDynamicCheck`: whether another bounded local Toy scenario is required.

The review must remain local. It must not use public RPCs, wallets, private keys, live addresses, deployment, or real assets.

## Interpretation

The tracked plan remains `pending-independent-review` until a separate reviewer supplies results. Generating the packet is not independent validation. Any disagreement should be recorded before updating the answer manifest; labels must not be changed merely to improve measured metrics.
