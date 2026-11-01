# Harness Runtime adapter prototype

The adapter components connect the executor registry and task contract to DigitalOcean Harness Runtime.
They are a developer prototype with local contract and git bundle integration tests.
**Live acceptance: NOT RUN.** Owner preview access, region and a cost boundary remain prerequisites.
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
Ordinary requests have a 30000 ms client deadline. A sandbox exec requests a 60-second provider limit and has a
finite 90000 ms client deadline, including response handling. The additional margin does not extend other calls.
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

The preflight uses only POSIX shell builtins and checks whether each protected variable is present, including
an empty value: `DIGITALOCEAN_TOKEN`, `DIGITALOCEAN_ACCESS_TOKEN`, `DO_API_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` and
`GIT_ASKPASS`. It needs no `printenv` or other executable on `PATH`. It runs before preparation, lease renewal
or task input. A refusal prints no credential value. Local tests run this exact preflight in a real POSIX shell
with `PATH` cleared inside the interpreter; they do not substitute an always-successful mocked command.

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
`candidateReport` retains an ordinary failed candidate's problems and continues with independent sessions.
Fatal host or claim refusals propagate with their original `SdlcError` identity; an inactive claim is not an
empty successful candidate list. Each distinct attempted core or isolated-validator check emits one attributable
`task.result_checked` observation, including a failed check. Successful final consumption keeps its existing
observation without duplication. Candidate inspection does not renew a lease.
Launch confirms the claim before preparation and immediately before task input. Candidate inspection checks that
the claim is active without extending its lease, so inspecting a paused session cannot keep its task reserved.

See [checkpoint and fork operations](https://docs.digitalocean.com/products/managed-agents/agent-harness-runtime/how-to/checkpoint-fork-rollback-sessions/)
and the [executor workflow](28-executor-swarm-example.md).

## Owner-gated live acceptance runbook

Current DigitalOcean live acceptance is **NOT RUN**. Local contract, real-shell and real-Git tests do not prove
preview access, provider isolation, billing behavior or a successful push/pull request. Do not allocate a session
or claim live acceptance until the owner supplies these values in a run-specific, credential-free evidence ledger:

| Prerequisite | Current status |
|---|---|
| Owner identity and confirmed account preview access | NOT PROVIDED |
| Selected provider region and approved environment/configuration | NOT PROVIDED |
| Maximum cost boundary, stop condition and cleanup owner | NOT PROVIDED |
| Reviewed secret-free fixture repository and exact source commit | NOT PROVIDED |
| Disposable isolated validator with no provider or publication credentials | NOT CONFIGURED |
| Host-bound publication credential and intended repository and branch | NOT PROVIDED |

The owner chooses the region and cost boundary. The integrator supplies the isolated validator; a provider
agent's report, local worktree or environment scrubbing alone cannot substitute for that boundary. Record the
chosen environment and explicit command environments without recording credentials.

### Review the complete reachable source history

Before preparation, inspect the exact committed source and all objects reachable from `HEAD` in the approved
fixture repository. Read-only inventory commands include:

```sh
git rev-parse HEAD
git rev-list --objects HEAD
git log --format=fuller -p HEAD
```

Review deleted files and earlier versions as well as the current checkout. A secret removed from the latest
tree can still travel in its ancestors. Apply the owner's secret-review procedure to the full reachable history;
if any credential or unreviewed object remains, stop preparation and obtain an approved secret-free repository.
Do not automatically rewrite the person's original history or treat a filename scan as proof of secret absence.

The bundle bridge transfers reachable `HEAD` history, not every host ref. Real-Git controls prove that unrelated
private credential refs, host Git configuration and the board claim do not reach the sandbox. They do not make
already-reachable secrets safe. Keep credential files, identity-agent sockets and host homes out of the runtime
and the isolated validator. Inspect the actual runtime in the live run before sending work.

### Bind result publication on the host

Bind the intended repository and branch in trusted host configuration before launch. The guest cannot select
the publication destination or supply a credential. Keep the provider token in the host client and the Git
publication credential in a host-owned credential facility with access limited to that destination. Neither
credential may enter guest input, environment, history, Git configuration, validator requests or diagnostics.

Verification returns a private `refs/sdlc/harness/` candidate for local review. An integrator may then use a
host-bound push or pull-request transport after the ordinary required review and approval. This prototype does
not publish automatically and provides no credential broker. Record a real returned repository/branch or pull
request only after that transport succeeds; local bundle import alone is not live publication acceptance.

### Execute and retain evidence only after prerequisites are supplied

1. Confirm the agreed cost boundary and cleanup owner, then create one credential-free fixture session.
2. Run the real preflight and inspect the environment, credential files and sockets before task input.
3. Run one approved claimed task. Pause it through lease expiry and confirm it does not renew while paused.
4. Fork the chosen warm checkpoint within the one-to-four child limit and inspect each distinct candidate.
5. Retain failed candidate problems and their observations; confirm a fatal host refusal stops the operation.
6. Verify through the isolated validator, complete ordinary human review, then exercise the bound host transport.
7. Stop and clean up provider sessions within the approved boundary. Record timestamps, region, source commit,
   candidate evidence, actual publication result and measured cost without tokens or raw provider error bodies.

Until these steps have actual owner-authorized evidence, provider execution, provider credential isolation,
billing and host-bound publication remain **NOT RUN**. No local passing test changes that status.

## Runtime plugin demonstration

The [harness runtime plugin example](../../examples/plugins/harness/README.md) exercises the accepted Wasm
ABI, own state/events and a pure result hook. Its declared probe counts are signals, not independent proof.
It neither runs this prototype's provider adapters nor completes economic accounting, a self-improving harness or live provider integration.
See [runtime plugins](33-plugins.md) for the separate runtime package mechanism and its guarantees.
