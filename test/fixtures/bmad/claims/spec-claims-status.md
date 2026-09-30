---
id: SPEC-claims-status
companions: []
sources: [prd-claims-status.md]
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# Claims status self-service

## Why

A pain to solve: policyholders cannot see where their claim is and call support, which costs the support team hours every day and frustrates customers who wait on hold.

## Capabilities

- **CAP-1**
  - **intent:** Policyholder can see the current stage of each of their open claims in the portal.
  - **success:** For a claim in review, the portal shows "in review"; a claim of another policyholder is not listed.
- **CAP-2**
  - **intent:** Policyholder can get an email when a claim changes stage.
  - **success:** Moving a claim from "in review" to "approved" sends one email to the claim owner within 5 minutes.

## Constraints

- Claim data stays in the EU region.

## Non-goals

- Editing claims from the portal.

## Success signal

- Status calls to support drop by 40% within two months of launch.

## Open Questions

- Do brokers see their clients' claims?
