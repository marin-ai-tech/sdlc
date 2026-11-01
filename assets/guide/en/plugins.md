---
title: Runtime plugins
summary: Inspect and accept Wasm packages, use their commands, and retain state safely.
---
# Runtime plugins

Accepted Wasm packages add namespaced operations, pure hooks and facts.

## Enable a package

A person places a complete package inside the project and reviews its manifest, source and schemas.
The guarded configuration workflow sets `plugins.<name>` with `package` (project-relative directory),
`digest` (complete-package SHA-256), `enabled` and `config`. Never edit generated plugin stores.

Use `sdlc plugins list --json` and `sdlc plugins inspect <name> --json` to check the exact digest,
manifest and problems. Inspection does not run guest functions. A person accepts in their own terminal:

```sh
sdlc plugins accept <name> --expect-digest sha256:<64-hex-digits> --json
sdlc doctor --json
```

Acceptance does not approve a lifecycle gate. Changed package bytes require a new pin and acceptance.
Examples: economy and harness-meta (`examples/plugins/harness`; `harness` is a core event namespace).
Read commands use `--input-json '{}'`. Record commands also need `--executor <registered-id>` and
`--request p1.<unix-milliseconds>.<32-lowercase-hex-digits>`. Reuse that identifier for an identical retry.

## Permissions and hooks

Read operations and all hooks cannot change state or emit events. Executor operations require a registered
executor; person operations require a person's CLI session. MCP exposes read tools to ordinary callers and
executor tools only with a project-bound HTTP executor token. Person tools are hidden and refused over MCP.
Tool names have the form `economy__read`; arguments contain `input` and, for mutations, `request`.

Hooks run at claim, bid, award, result_accept, file_edit and stop. Core denial wins. A plugin can impose an
additional restriction or return a signal; facts and signals never approve a gate or prove a task correct.
Core `plugin_policies` compare namespaced facts using bounded predicates, without executing policy code.

## Disable and recover

A person runs `sdlc plugins revoke <name> --json`, or uses the guarded configuration workflow to set
`enabled: false`. Both stop new calls and preserve state. `sdlc plugins recover <name> --request <id> --json`
reconciles a receipt and retries pending event projection. An expired outcome may be unknown: preserve the
identifier and investigate before issuing a new one. Never delete state to bypass an indeterminate result.
Recovery lists up to 64 `temporaryFiles` entries with `file` (relative to `openspec/.sdlc/plugins/`),
`bytes` and `authoritative:false`, plus `temporaryFilesTruncated`. These are diagnostic metadata;
recovery does not read or apply their contents and does not delete these files.

## Runtime limits

Only the bounded Wasm memory import is available: no WASI, files, network, process or JavaScript imports.
The host enforces 64 MiB maximum linear memory. Queueing is bounded at 5,000 ms, startup at 10,000 ms,
guest hooks at 1,000 ms, ordinary guest operations at 5,000 ms and cleanup at 1,000 ms. Preparation across
attempts shares a 30,000 ms ceiling. Startup completes before the allocator or guest call starts.
At most two workers execute and two may remain quarantined. Admission reserves cleanup headroom;
unreaped workers reduce available slots, and exhausted capacity refuses new calls.
This relies on Node/V8 and the OS; it is not an OS sandbox or a total-process memory bound.

Receipts retain compact output/facts and can read older version1 responses. Pending events have a lossless
1024-record/1 MiB bound: `plugin_backpressure` refuses before mutation until logging can drain them.
POSIX replacements flush their parent directory; uncertain acknowledgements remain `plugin_indeterminate`.
Reconcile the same request identifier before retrying. Unknown live or legacy lock ownership is protected;
run `doctor`, stop all checkout writers and confirm quiescence before any manual metadata recovery.
Never remove stores or pending events to clear a lock.
