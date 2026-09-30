# Review instructions

Every change gets the same review passes. Findings do not approve or block a
pull request on their own: a code owner decides, informed by them.

## Passes
Run three passes and tag each finding with its pass:
- **bugs**: logic errors, broken edge cases, error handling, subtle regressions
- **security**: injection risks, authentication and authorization gaps, secrets, PII in logs or error messages
- **compliance**: the change matches its spec (openspec/changes/<id>/specs), its plan (plan.md) and our design principles below

## Lenses
Run each lens in fresh context and tag its findings with the lens name:
- **adversarial**: how would an attacker or hostile input break this?
- **edge-cases**: boundaries, empty, huge, concurrent and Unicode inputs, and failure paths.
- **verification-gaps**: behaviour the tests and evidence do not actually prove.

Every pass and lens must appear under `## Coverage` in review.md, with a finding count or `none found — checked: <what was checked>`.

## What Important means here
Reserve **important** for findings that would break behavior, leak data or
breach a policy. Style and naming are **nit**. Problems the change did not
introduce are **pre-existing**.

## Cap the nits
Report at most five nits per review; summarize the rest as a count.

## Design principles
<!-- Add the principles reviewers must check, e.g.:
- Money is always a decimal type, never floating point.
- Every external endpoint validates input against its schema.
-->

## Do not report
Generated files and anything CI already enforces (formatting, lint rules).
<!-- List generated paths here, e.g. src/gen/ -->
