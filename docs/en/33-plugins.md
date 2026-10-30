# 33. Runtime plugins

Runtime plugins add namespaced commands, MCP tools, pure lifecycle hooks, task/bid extensions and facts.
They run accepted WebAssembly packages through the core broker. Every existing core restriction still applies;
facts and signals never decide a gate. Plugin acceptance authorizes a package, not a lifecycle approval.

The editor distribution produced by `sdlc plugin build plugin --marketplace` installs skills and integration
hooks. It is a separate mechanism from the runtime package format `sdlc.plugin/1` described here.

## Operator walkthrough

The repository includes runnable [economy](../../examples/plugins/economy/README.md) and
[harness-meta](../../examples/plugins/harness/README.md) demonstrations. They do not complete economic accounting,
provider execution, independent result proof or live provider integration. Start in a disposable project.
The harness-meta package remains in `examples/plugins/harness`; `harness` itself is a reserved core event namespace.

1. Copy a whole example directory into the project, such as `packages/economy`. Keep its source, schemas,
   manifest and compiled Wasm together. Review the package; links, devices and incomplete closures are refused.
2. Use the guarded configuration workflow to propose the setting below. For initial inspection, a valid
   placeholder pin of 64 zeroes lets inspection report the actual complete-package digest and `plugin_changed`.
   A person reviews/applies the proposal with `sdlc config show <id>` and `sdlc config apply <id>`.
3. Run `sdlc plugins inspect economy --json`. Take its exact `digest`, propose that full pin, and have a person
   apply it. Reinspect; before acceptance the only activation problem should be `plugin_unaccepted`.
4. A person runs the acceptance command below in their own terminal. Inspection and acceptance validate the
   package/profile/schemas without calling guest functions. Acceptance initializes state before recording trust.
5. Invoke read/record/guard, inspect diagnostics, then revoke or disable. Trust commands never run over MCP.

```yaml
plugins:
  economy:
    package: packages/economy
    digest: sha256:<64-lowercase-hex-digits>
    enabled: true
    config: {limit: 3}
```

For example, propose with `sdlc config propose --set 'plugins.economy={package: packages/economy,
digest: "sha256:<64-lowercase-hex-digits>", enabled: true, config: {limit: 3}}' --reason "Try the example"`.
The placeholder above is descriptive; substitute the actual digest before acceptance.

```sh
sdlc plugins list --json
sdlc plugins inspect economy --json
sdlc plugins accept economy --expect-digest sha256:<complete-digest> --json
sdlc economy read --input-json '{}' --json
sdlc economy record --input-json '{"units":3}' --executor mesh --request p1.<unix-ms>.<32-hex> --json
sdlc economy guard --input-json '{}' --json
sdlc doctor --json
sdlc plugins revoke economy --json
```

`mesh` must already be registered in `openspec/executors.yaml`; registration is a person's project setup action.
Generate each mutation identifier as `p1.` + current Unix milliseconds + `.` + 32 random lowercase hexadecimal
digits. Supply the same identifier and identical operation/input/executor for a retry. A successful record returns
`{plugin, output, facts, request, transaction}`: economy's output becomes `{used:3, remaining:0}`, and guard then
returns `{decision:"deny", code:"demo_limit", message:"Demo limit exhausted"}`. Read/guard have no transaction
and do not change state or emit events. Direct record is a protocol demonstration and can exceed the limit;
the guard restricts the configured hook point, rather than providing a complete accounting system.

Revocation immediately prevents new calls and retains the namespace's state/receipts/pending events. Alternatively
propose `plugins.economy.enabled=false` and have a person apply it. A changed package requires a new complete pin
and human acceptance. Reacceptance preserves initialized compatible state; an incompatible state schema refuses
activation. Do not replace/delete a store to make it fit.

## Manifest, schemas and extensions

The complete [economy manifest](../../examples/plugins/economy/sdlc-plugin.json) and
[local schemas](../../examples/plugins/economy/schemas.json) are executable references. The manifest declares:

| Field | Meaning |
|---|---|
| `format`, `name`, `version` | `sdlc.plugin/1`, unique lowercase namespace, semantic package version |
| `api` | Semver range admitting the host API, currently `1.0.0`; incompatible ranges refuse before execution |
| `entry`, `initialState` | Package-local `.wasm` entry and schema-valid genesis state |
| `schemas` | Required config/state/facts schemas; optional taskExt/bidExt schemas |
| `operations` | IDs with `access: read`, `executor` or `person`, plus input/output schemas |
| `commands`, `tools` | Route names mapped to declared operation IDs |
| `hooks` | Supported hook point mapped to a declared read operation |
| `events` | Event suffix mapped to its payload schema |

Namespaces and route names must match `[a-z][a-z0-9-]{0,23}`; core command and event namespaces are reserved.
The probe example uses `plugins.harness-meta`, commands such as `sdlc harness-meta read`, facts such as
`harness-meta.remaining`, and events such as `harness-meta.probed`. A complete digest covers
every package file, including source and README bytes. Use the same bytes after inspection: even a README edit
changes the pin. Packages are project-relative directories; absolute/escaping paths, symlinks, hardlinks and
special files are refused. Snapshots bound inspection and invocation to a complete immutable byte closure.

Schemas use the strict, non-executable JSON Schema 2020-12 subset supported by the host. Schemas may be inline
objects/booleans or local references such as `schemas.json#/$defs/state`. Remote/escaping references, dynamic
references, async/data features and prototype keys are refused. Validation never coerces values, inserts defaults
or removes fields. Declare `additionalProperties: false` where fields should be closed.

Task and bid extension data lives under `ext.<plugin-name>` and must match taskExt/bidExt respectively.
For economy, valid values are `ext: {economy: {budget: 3}}` on a task and
`ext: {economy: {quote: 2}}` on a bid. For harness-meta, use `ext: {harness-meta: {profile:"demo"}}` on a task
and `ext: {harness-meta: {probe:true}}` on a bid.
Extensions cannot replace core executor, identity or gate fields. New unknown/disabled namespaces refuse;
historical stored extensions remain opaque when their plugin is unavailable. With no extension, omit `ext`.

## Wasm ABI and authority

The numeric wasm32 module imports **only** `sdlc.memory`, declared `(memory 16 1024)`, and exports that same
nonshared memory as `memory`. It exports `sdlc_alloc(i32 size) -> i32 pointer` and
`sdlc_call(i32 pointer, i32 byteLength) -> i64`. There is no start function, WASI, JavaScript function import,
shared/memory64/additional memory, reference-valued function interface or unbounded table. A bounded funcref
table may contain at most 4,096 entries. Other profile bounds are enforced before the engine instantiates.

The host allocates request space, copies canonical UTF-8 JSON into memory, then calls `sdlc_call`:

```json
{"api":"sdlc.plugin/1","operation":"record","input":{"units":1},"config":{"limit":3},"state":{"used":0},"revision":0,"context":{"actor":{"origin":"cli","executor":"mesh"}}}
```

`revision` belongs to the supplied state snapshot. It starts at zero and advances on committed mutable
transactions. Commands and hooks receive it from core; caller input cannot override it.

The returned i64 packs an unsigned response pointer in the high 32 bits and byte length in the low 32 bits.
The host checks both bounds, reacquires the memory buffer after guest calls (including memory growth), copies
the response, parses strict JSON and validates all returned fields. A response has `output` and optionally
`facts`, `state`, `events: [{name,data}]`. Unknown top-level fields, paths, core state and forged provenance refuse
the whole invocation. The guest proposes effects; the core validates, authorizes and commits them.

```json
{"output":{"used":1,"remaining":2},"facts":{"used":1,"remaining":2},"state":{"used":1},"events":[{"name":"charged","data":{"units":1}}]}
```

The guest has no file, network, process, environment or module-loading authority. The authority boundary relies
on the Node/V8 WebAssembly engine, worker termination and the OS behaving correctly; this is not an OS sandbox.
Native engine vulnerabilities and a compromised host are outside this boundary. Worker heap settings do not
establish a total-process memory bound or a hard RSS cap.

| Fixed limit | Bound |
|---|---|
| Enabled plugins / concurrent workers | 8 / 2 |
| Package files / total bytes / manifest / Wasm | 256 / 16 MiB / 256 KiB / 8 MiB |
| Linear memory | 16 initial 64 KiB pages (1 MiB), 1,024 maximum pages (64 MiB) |
| Request/response JSON / extension JSON | 1 MiB / 256 KiB |
| Own store / event / event batch | 4 MiB / 64 KiB / 64 events |
| Hook / ordinary operation / termination cleanup | 1,000 ms / 5,000 ms / 1,000 ms |
| Request receipt window | 24 hours, subject to the persisted expiry floor |

Execution deadlines include waiting for a worker slot and startup. Late responses are discarded and workers
are terminated after completion, traps or deadline expiry. Host scheduling/termination is not a hard real-time
guarantee. The small WAT examples further limit input to 64 KiB and parse only their schema-checked integer
fields from canonical host JSON; they are not a general-purpose JSON implementation.

## Hooks, facts and core policies

Hooks receive `input: {hook, subject}` and the current own config/state. The subject is the core's typed snapshot
for the operation, not caller-supplied authority. Context contains the core-attributed actor, never host secrets.
Hooks return `output: {decision:"pass"|"signal"|"deny", code?, message?}` and optional validated facts.
They cannot return state or events. Unknown decisions, traps, timeouts, missing facts and invalid responses fail
closed for the guarded operation. A plugin pass never overrides a core denial; signal supplies information.

| Hook | Evaluated boundary |
|---|---|
| `claim` | Before a new task claim |
| `bid` | Before recording/replacing a bid |
| `award` | Before manual/automatic/dispatched award |
| `result_accept` | After core result validation, before accepting the immutable candidate |
| `file_edit` | Before a supported native/shell edit |
| `stop` | Before allowing a session to finish |

Read-only views do not settle pending decisions. Freshness checks bind prepared hooks to task/registry/state/
configuration/trust snapshots before mutation. Replay returns the saved response without calling a guest again.
Core-invalid task results remain invalid even when a plugin passes. The harness-meta probe counts are demo signals,
not independent result verification evidence.

Trust and own-state stores are local to a checkout. A Harness worker with enabled plugins needs an honestly
prepared local trust store before its blocking hooks and `doctor` can run; a fresh bundle does not carry the
host's ignored registry, state or request receipts. The host never accepts a package on a person's behalf.
Its final result checks use the host's current plugin state and remain authoritative after isolated validation.
Keep pinned package bytes identical across checkouts, including line endings of supporting files.

For example, economy's claim hook supplies `economy.remaining`. A person can add this core policy through the
guarded configuration workflow:

```yaml
plugin_policies:
  - id: positive-demo-budget
    hook: claim
    require: {fact: economy.remaining, op: gt, value: 0}
    reason: Demo budget must remain positive
```

Predicates support `all`, `any`, `not`, and leaves `{fact: namespace.key, op, value}` with
`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`. Ordering operators require numbers; equality and membership compare
strictly by type. Lists, nesting and total nodes are bounded. There is no JavaScript, regex or executable
predicate. Missing/type-invalid facts refuse even beneath `not` or in a short-circuited branch; facts are attributed to their accepted plugin
and current evaluation. The policy can add a restriction, never write an approval or substitute proof.

## State, events, diagnostics and recovery

Core owns `openspec/.sdlc/plugins/registry.json` and `state/<name>/store.json` under that directory, together
with activation/recovery/writer records. Agents cannot edit this guarded storage through native edits, shell
aliases, links or result branches. A plugin sees only its own state and cannot choose a storage path.

A mutation commits a complete schema-valid own state, receipt and event batch by atomic replacement under
core locks, with revision/trust/configuration revalidation. A stale evaluation refuses without a partial write.
An identical retained request replays its transaction; changed arguments conflict. Receipts expire after 24 hours
and the persisted floor prevents reviving old identifiers after compaction or clock rollback.

Events are named `<plugin>.<suffix>`, such as `economy.charged`, and core stamps version, digest, actor,
request, transaction and stable event ID. Raw guest data is kept inside the attributed payload. Authoritative
pending events live in the same transaction as state. The project log is a rebuildable projection; disabled
logging retains pending events. Recovery retries projection, and the log reader deduplicates stable IDs after
a crash between append and acknowledgement. Atomic replacement and file flushes do not promise power-loss
durability across every filesystem, engine or OS.

Use `plugins inspect`, `plugins list` and `doctor` for current activation problems. Common codes include
`plugin_unaccepted`, `plugin_changed`, `plugin_disabled`, `plugin_schema`, `plugin_wasm`, `plugin_timeout`,
`plugin_person_only`, `plugin_executor`, `plugin_evaluation_stale` and `plugin_indeterminate`.
For an uncertain acknowledgement, stop callers and preserve the identifier. A person runs:

```sh
sdlc plugins recover economy --request p1.<original-unix-ms>.<original-32-hex> --json
```

Recovery refuses to displace a live writer, validates retained state and reports `committed`, `not_committed`
or `outcome_not_retained`. An expired receipt cannot establish the old outcome. Investigate before a new
identifier; never erase state or locks as a retry strategy.

Recovery also returns `temporaryFiles: [{file, bytes, authoritative:false}]` and the boolean
`temporaryFilesTruncated`. Each `file` is relative to `openspec/.sdlc/plugins/`; at most 64 entries describe
leftover temporary files in that directory and the selected plugin's state directory. These are diagnostic
metadata only: recovery does not read their contents, apply them as state or delete them. A truncated listing
does not establish that no other temporary files exist.

## CLI and MCP permissions

CLI commands use `<namespace> <command> --input-json <JSON>`. Read operations need no request identifier;
executor mutations additionally require `--executor` and `--request`. Person-only operations, such as the
examples' `reset`, require a person's own terminal and a request identifier. Passing a person/executor field
inside plugin JSON does not grant authority. Core validates permissions and schemas before guest execution.

MCP uses `<namespace>__<tool>`, for example `economy__read` with `{input:{}}` or `economy__record` with
`{input:{units:1},request:"p1.…"}`; the probe example uses `harness-meta__read` and `harness-meta__record`.
A multiproject server also requires the project selector. Ordinary stdio
and server-token clients see/call only read tools. A project-bound HTTP executor token enables that project's
executor tools and supplies the executor identity. Person tools are hidden and direct calls refuse, including
when a person started the server. Tokens for another project, stale/revoked catalogs and name/schema collisions
cannot invoke a guest. See [MCP use cases](11-mcp-use-cases.md).

## Rebuild, compatibility and rollback

From a repository checkout with locked development dependencies, run `node scripts/build-plugins.mjs` twice.
The pinned `wabt` compiler reads each `plugin.wat` and writes `plugin.wasm` without timestamps/debug paths.
Both complete package hash inventories must match. Run `npm run compile`, then
`node node_modules/vitest/vitest.mjs run test/plugin-examples.test.ts --maxWorkers=1` to exercise actual
inspection, acceptance, broker/worker invocation, state, attributed events, permissions and deterministic builds.
Examples remain repository examples and are not runtime dependencies of the installed package.

No-plugin projects preserve their existing behavior. API negotiation is additive: future incompatible manifests
refuse before execution. Keep core source, dependency pins and generated files together when upgrading.

For rollback, a person disables/revokes plugins, stops callers and preserves registry, own stores, pending
events and receipts. Restore compatible code/configuration/package pins through the normal guarded workflow,
inspect and accept the exact package again, then re-enable. If older code cannot parse plugin settings, remove
those settings through the human workflow while retaining a backup. Preserve historical log/approval records
and indeterminate transactions throughout rollback.

See also [architecture](04-architecture.md), [glossary](glossary.md) and `sdlc guide plugins`.
