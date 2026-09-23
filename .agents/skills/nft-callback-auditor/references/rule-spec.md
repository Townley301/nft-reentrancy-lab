# Natural-language rule binding

Use this reference when converting researcher prose into `rules/research-rule-spec.json`.

## Required interpretation

Keep the original prose in the file named by `source.file`. The structured specification is an auditable interpretation, not a replacement for the source text.

Each rule contains:

- `id`: stable lowercase identifier.
- `statement`: one testable invariant, using the researcher's meaning.
- `expected`: always `preserve`; a business invariant describes the state that should hold.
- `scope.contracts`: exact Solidity contract names relevant to the rule.
- `scope.functions`: exact public/external entry functions relevant to the rule.
- `scope.states`: exact state-variable names needed to evaluate or correlate the rule.
- `dynamicTemplate`: optional reviewed local adapter. Omit it when none matches.
- `assumptions`: unresolved interpretation decisions or prerequisites.

The authoritative schema is `rules/research-rule-spec.schema.json`.

## Binding rules

Inspect code before adding identifiers. Do not derive identifiers only from lexical similarity to the prose. At least one identifier is required, and a strong binding normally includes a contract plus a function or state variable.

Split compound prose into separate invariants. For example, “only the owner may withdraw and debt must remain covered” becomes one authorization rule and one solvency rule.

Do not map to a dynamic template merely because its name sounds similar. Confirm that its fixture, callback sequence, state reads, and invariant formula match the researcher's rule.

## Coverage interpretation

The deterministic coverage analyzer matches declared scopes against AST callback candidates. A match means the declared rule touches the same contract/function/state area; it does not prove the rule itself is complete.

Candidates with no match are intentionally surfaced as undeclared. Review them for:

- conservation or accounting invariants;
- uniqueness and one-time rights;
- authorization changes during callbacks;
- debt, collateral, supply, or reserve consistency;
- identifier or configuration reuse;
- cross-function mutations after external control transfer.

If a candidate is plausible but no local dynamic adapter exists, keep it as `static-candidate` and describe the precise test harness needed. Never generate public-network exploit steps.
