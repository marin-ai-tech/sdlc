# Security

Security baseline for {{project.name}}. Agents must treat sensitive zones as human-gated. Expand the threat model as the system gains surfaces.

## Assets

- Credentials, API keys, and tokens
- Personal data and customer content
- Signing keys and certificates
- Production configuration and infrastructure access
- Audit / lifecycle logs under openspec/.sdlc/ (do not rewrite history)

## Trust boundaries

| Boundary | Inside | Outside |
|----------|--------|---------|
| Process edge | Application code after authn/authz | Untrusted HTTP/RPC clients |
| Data store | Persistence layer with least privilege | Direct DB clients from agents/CI without review |
| Supply chain | Lockfile and reviewed dependencies | Arbitrary new packages |
| Human gates | Approved plans and sdlc approve in a person terminal | Agent-driven approve or config edits |

## Threat model (STRIDE-style)

| Category | Example threat | Mitigation |
|----------|----------------|------------|
| Spoofing | Stolen session or forged identity | Strong authn; short-lived tokens; no secrets in logs |
| Tampering | Quiet edit of .sdlc.yaml or lifecycle log | Agents must not edit those files; humans review diffs |
| Repudiation | Unclear who approved a gate | Only humans run approve; keep audit trail intact |
| Information disclosure | PII in errors or agent transcripts | Redact; follow [conventions]({{path:conventions}}) logging rules |
| Denial of service | Unbounded work from agent loops | Scope to approved plan; rate limits at edges |
| Elevation of privilege | Agent widens IAM or skips review | Sensitive zones below require explicit human approval |

## Sensitive zones (human approval required)

Agents must not change these without an explicit human plan and approval:

- Authentication, authorization, and session handling
- Cryptography, key management, and secret storage
- Payment, billing, and money movement
- .sdlc.yaml, openspec/.sdlc/log.jsonl, and CI deploy credentials
- Production infrastructure as code and firewall / IAM policies
- Dependency updates that alter trust (new network clients, native addons)

When in doubt, stop and ask a human. See also [REVIEW.md]({{path:review-policy}}) security pass and [AGENTS.md]({{path:agents-guide}}) rules.
