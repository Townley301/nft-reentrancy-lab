# Unified natural-language invariant binding

Use this reference when converting researcher prose into the schema-v2 `rules/research-rule-spec.json`. This file is the sole input for both coverage analysis and dynamic test generation; do not maintain a second rule file.

## Required interpretation

Keep the original prose in the file named by `source.file`. The structured specification is an auditable interpretation, not a replacement for the source text.

Each rule contains:

- `id`: stable lowercase identifier.
- `dataset`: `development` for cases used to shape the workflow, or `holdout` for independently evaluated cases.
- `statement`: one testable invariant, using the researcher's meaning.
- `expected`: always `preserve`; a business invariant describes the state that should hold.
- `scope.contracts`: exact Solidity contract names relevant to the rule.
- `scope.functions`: exact public/external entry functions relevant to the rule.
- `scope.states`: exact state-variable names needed to evaluate or correlate the rule.
- `model.actors`: semantic roles participating in the scenario.
- `model.preconditions`: prerequisites that must hold before the tested sequence.
- `model.actions`: ordered setup, entry, callback, reentry, or assertion actions bound to exact function names.
- `model.observables`: state variables required to evaluate the invariant; every item must also appear in `scope.states`.
- `model.invariant`: a category, relation, and human-reviewable statement. It is documentation and binding evidence, not executable code.
- `bindingConfidence`: `high`, `medium`, or `low`, based on the quality of the code binding.
- `evidenceRequired`: the evidence levels needed to satisfy the research goal.
- `dynamic`: optional reviewed local adapter, bounded parameters, vulnerable/fixed variants, and the precise static candidate path. Omit it when no reviewed adapter matches.
- `assumptions`: unresolved interpretation decisions or prerequisites.

The authoritative rule schema is `rules/research-rule-spec.schema.json`. Dynamic adapter structure is defined separately by `rules/adapters/adapter-spec.schema.json` and validated by `scripts/lib/adapter-spec.mjs`.

## Binding rules

Inspect code before adding identifiers. Do not derive identifiers only from lexical similarity to the prose. At least one identifier is required, and a strong binding normally includes a contract plus a function or state variable.

Split compound prose into separate invariants. For example, “only the owner may withdraw and debt must remain covered” becomes one authorization rule and one solvency rule.

Every action function and observable must be present in the inspected scope. Set `bindingConfidence` to `high` only when the named contracts, functions, states, callback order, and invariant meaning all match the code. Record ambiguity as an assumption and lower the confidence.

Do not map to a dynamic adapter merely because its name sounds similar. Confirm its fixture, callback sequence, state reads, bounded parameters, candidate path, dataset, and invariant formula. A dynamic adapter is a deterministic implementation choice; the model's invariant statement is never evaluated as arbitrary code.

The adapter may use only the expression and operation types allowed by its schema. All deployment references must be local and declared, all parameter values must remain inside adapter bounds, and adapter/rule path plus vulnerable/fixed variants must agree exactly. Do not encode case-specific logic in the generic runtime.

Treat holdout labels as research provenance. If executor behavior or the DSL is changed after examining a holdout, disclose that change and do not present the same case as an untouched holdout result.

## Coverage interpretation

The deterministic coverage analyzer matches declared scopes against AST callback candidates and obtains adapter-to-path mappings from the same specification. A match means the declared rule touches the same contract/function/state area; it does not prove the rule itself is complete.

Candidates with no match are intentionally surfaced as undeclared. Review them for:

- conservation or accounting invariants;
- uniqueness and one-time rights;
- authorization changes during callbacks;
- debt, collateral, supply, or reserve consistency;
- identifier or configuration reuse;
- cross-function mutations after external control transfer.

If a candidate is plausible but no local dynamic adapter exists, keep it as `static-candidate` and describe the precise test harness needed. Never generate public-network exploit steps.
