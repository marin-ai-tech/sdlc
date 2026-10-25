# Harness Runtime adapter prototype

The adapter components connect the executor registry and task contract to DigitalOcean Harness Runtime.
They are a developer prototype with local contract and git bundle integration tests.
Live provider acceptance is deferred until account access is configured.
There is no hosted-task CLI command or production credential broker yet.

## Components

- `src/core/executors.ts` accepts executor type `harness`, with the ordinary risk and kind restrictions.
- `src/executors/harness-runtime.ts` uses the documented session, fork, input and sandbox-exec HTTP endpoints.
- `src/executors/harness-adapter.ts` coordinates typed tasks with a required host bridge.
- `src/executors/harness-bundle-host.ts` transfers small repositories and candidates as git bundles through sandbox exec.
- `src/executors/harness-validation.ts` defines the isolated validator contract and parses its verification evidence.
- `test/harness-runtime.test.ts` checks request shape, token isolation, lease behavior and candidate filtering.
- `test/harness-bundle.test.ts` exercises real git transfer, trailers and host verification through a local transport.

The provider-specific client stays outside the core gate and permission rules. A runtime cannot approve any gate.
The client uses the fixed HTTPS API origin, refuses redirects, bounds request duration and parses returned fields.
Responses have a 2 MiB streaming byte limit; oversized and HTTP-error bodies are cancelled without full buffering.
Provider error bodies are never repeated in diagnostics.

## Host bridge contract

`HarnessBundleHost` implements `HarnessHost`; an integrator may supply another implementation of the same contract:

1. `prepare` uploads a credential-free repository or git bundle and checks the installed sdlc hooks.
2. `heartbeat` renews the existing board claim. It must keep the claim token on the host.
3. `verify` downloads a candidate and delegates independent checks to an explicitly configured isolated validator.

Candidate verification must check the task's commit trailers, forbidden paths, executor identity and actual check
commands. It must fingerprint the checked candidate and require a fresh result. Only then may it return `passed`.
A callback that merely repeats the remote agent's claim is not a verifier.

The bundle bridge requires a clean, committed source with the approved task still open, the executor registry,
blocking agent hooks and the process records tracked. New audit log observations may remain uncommitted.
The board claim stays on the host. The bridge imports a candidate into a private `refs/sdlc/harness/` ref, checks
its ancestry from the task base, exact task/agent attribution and forbidden paths, then passes a full bundle to the
host-configured `validateCandidate` worker bridge. It never switches the source checkout or creates a shared
candidate worktree.

Candidate verification refuses before touching the runtime or source state when `validateCandidate` is absent.
There is no built-in local execution fallback. A temporary git worktree shares repository metadata and execution
privileges; scrubbing environment variables still exposes the host filesystem. Neither is a security boundary.

Implement `HarnessCandidateValidator` with a disposable credential-free OS/container boundary or separate worker,
isolated from the provider client, host home, host Git metadata and publication credentials. The request contains
only `bundle`, `ref`, `commit` and a copy of the trusted `verification` configuration. Keep that configuration's
explicit command environment credential-free too. The bridge does not provision a container or worker itself.

The worker imports the full bundle into a new repository, checks out the requested commit cleanly and runs the
trusted configuration with `runVerification`. Keep verifier Git metadata and its evidence channel outside the
candidate commands' writable security boundary. It returns `{ run, fingerprint }`, where `fingerprint` is computed
after all checks. The host independently derives the expected fingerprint from the immutable candidate tree in a
temporary index. It requires the exact commit, a clean initial checkout, that expected fingerprint before/after
checks and evidence for every configured command; failed or timed-out required commands cannot pass.
A provider or agent's own report
must never implement this validator. Local integration tests use a test-only local runner for trusted fixture code;
they prove bundle transfer and evidence checks, not a real security boundary.

Prototype limits are explicit: bundles are at most 512 KiB, sandbox Node/git/sdlc and the chosen coding agent must
already be installed, and host checks must work in a fresh checkout. MCP verification is refused by this bridge.
A warm workspace must already be on the same clean task branch and base commit; fork that prepared workspace.
The returned private ref is for local review. Publishing it through a host-bound git credential is an integrator
step; this prototype does not push, open a pull request or provide a git credential broker.

## Credentials

The DigitalOcean token is a private field in the host client. It is sent only in the HTTPS authorization header,
never in a task, sandbox environment, session-create body or diagnostic. A sandbox preflight refuses common
provider and git credential variables before the coordinator sends the task. This preflight does not prove the
absence of arbitrary credential files or identity-agent sockets; supply a reviewed credential-free runtime and
repository history. Treat the preflight as an additional refusal check.

Native GitHub OAuth setup injects a token into the sandbox environment. That does not meet this prototype's
credential-isolation requirement. Use a credential-free bundle transfer or a host-side broker instead. Restrict
the host's git credential to the intended git host; never upload it as a file, environment variable or prompt.

See DigitalOcean's [GitHub connection documentation](https://docs.digitalocean.com/products/managed-agents/agent-harness-runtime/how-to/connect-github/)
for the native credential behavior, and its [API reference](https://docs.digitalocean.com/reference/api/reference/harness-runtime/)
for the wire contract.

## Checkpoints, leases and candidates

Create a credential-free environment containing the coding agent, dependencies and sdlc CLI. A ready session can
receive a task after the host preparation step. Fork from a ready checkpoint to reuse the installed environment.
The provider accepts one to four child sessions per fork request.

Refresh stops renewing a claim when the runtime reports a paused or stopped session. Existing board lease expiry
then reopens the work; the adapter never manufactures a new lease or changes an approval. Host verification filters
each distinct candidate; failed candidates are not offered for review.
Launch confirms the claim before preparation and immediately before task input. Candidate inspection checks that
the claim is active without extending its lease, so inspecting a paused session cannot keep its task reserved.

See [checkpoint and fork operations](https://docs.digitalocean.com/products/managed-agents/agent-harness-runtime/how-to/checkpoint-fork-rollback-sessions/)
and the [executor workflow](28-executor-swarm-example.md).

## Acceptance still required

Local contract tests do not prove a real provider workflow. Acceptance needs an account, a chosen environment,
an isolated credential-free validator and a test repository. Run a real task, pause it through its lease, fork the warm
checkpoint, and verify a returned branch with the ordinary review process. Inspect the sandbox for credential
exposure and record the independent evidence before enabling production use.
