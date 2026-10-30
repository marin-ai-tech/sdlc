# harness-meta runtime plugin demonstration

This example counts declared demo probe samples. It does not start a provider, run a worker or prove a result correct.
Both examples demonstrate the sdlc.plugin/1 protocol; neither completes economic accounting, a self-improving harness or live provider integration.

The runtime namespace is harness-meta; the repository directory remains examples/plugins/harness.
The name harness is reserved for core events and cannot identify a runtime plugin.

## Build and inspect

From the repository root, with locked development dependencies installed:

```sh
node scripts/build-plugins.mjs
node scripts/build-plugins.mjs
```

The pinned wabt compiler reproducibly compiles plugin.wat into plugin.wasm. Source, manifest, local schemas,
compiled Wasm and this README all participate in the complete-package digest. Editing any file changes the pin.

Copy this whole directory into a disposable SDLC project as packages/harness-meta. A person uses the guarded
configuration workflow to apply this setting (substitute the complete digest reported by inspection):

```yaml
plugins:
  harness-meta:
    package: packages/harness-meta
    digest: sha256:<64-lowercase-hex-digits>
    enabled: true
    config: {limit: 3}
```

For bootstrap inspection a valid placeholder pin of 64 zeroes reports plugin_changed and the actual digest.
Update the pin through a reviewed config proposal before accepting. See the full
[operator walkthrough](../../../docs/en/33-plugins.md#operator-walkthrough) for configuration commands.

A person then runs acceptance in their own terminal; inspection and acceptance do not call guest functions:

```sh
sdlc plugins inspect harness-meta --json
sdlc plugins accept harness-meta --expect-digest sha256:<complete-digest> --json
sdlc harness-meta read --input-json '{}' --json
sdlc harness-meta record --input-json '{"samples":3}' --executor mesh --request p1.<unix-ms>.<32-hex> --json
sdlc harness-meta guard --input-json '{}' --json
sdlc doctor --json
```

mesh must be a registered executor. Generate each mutation request identifier from current Unix milliseconds
and 32 random lowercase hexadecimal digits. Reuse it only for an identical retry.

Initial read returns output/facts {probes:0,remaining:3}. record adds the supplied samples to own state,
returns {probes:3,remaining:0}, and proposes one probed event. The core stamps it as harness-meta.probed
with accepted package identity, executor, request, transaction and payload {samples:3}. A retained retry
returns the same transaction without another mutation/event. Record is a protocol demo and may exceed the limit.

The pure guard operation is also wired to result_accept. It returns decision pass while remaining>0 and
decision deny with code demo_limit once remaining<=0. It never writes state or events. Core rules still win.
The probe signal is not independent proof, and an economy resource declaration is not a verified cost.

## Schemas and permissions

| Surface | Access | Input / effect |
|---|---|---|
| read | read | {}; returns current own counter and remaining, no effects |
| record | executor | {samples:1..1000}; updates own counter and emits probed |
| reset | person | {}; resets own counter to zero and emits reset |
| guard | read | {} or core {hook,subject}; returns decision and facts, no effects |

Configuration requires limit:1..1000000; state counters are nonnegative integers up to 1000000000.
Input strings are never coerced to numbers, and unknown fields refuse. taskExt/bidExt are namespaced under
ext["harness-meta"]: valid task {profile:"demo"}, bid {probe:true}.

MCP read uses harness-meta__read with {input:{}}. Executor calls use harness-meta__record with
{input:{samples:1},request:"p1.…"} and a project-bound HTTP executor token. Ordinary server-token and
stdio callers cannot mutate. reset is hidden and refused over MCP; agents cannot invoke person operations.

For a person-only reset:

```sh
sdlc harness-meta reset --input-json '{}' --request p1.<new-unix-ms>.<new-32-hex> --json
```

A core fact policy can require positive remaining at the hook point:

```yaml
plugin_policies:
  - id: harness-meta-demo-limit
    hook: result_accept
    require: {fact: harness-meta.remaining, op: gt, value: 0}
    reason: Demo allowance exhausted
```

Only a person applies this policy through a guarded configuration proposal. Facts never approve a gate.

## Disable, recover and boundaries

```sh
sdlc plugins revoke harness-meta --json
sdlc plugins recover harness-meta --request p1.<original-unix-ms>.<original-32-hex> --json
```

Alternatively a person applies enabled:false. Revocation/disablement preserves initialized state, receipts and
pending events. Reacceptance preserves compatible state. Unknown expired outcomes need reconciliation before
a new request identifier; never delete storage to retry.

The WAT imports only host-owned bounded memory and exports the numeric JSON ABI. It has no WASI, filesystem,
network, process, environment or JavaScript imports. It accepts at most 64 KiB canonical schema-checked input
and parses only declared integer fields. Linear memory is bounded at 64 MiB; operations have a 5,000 ms host
deadline and hooks 1,000 ms including queueing. Node/V8 and OS correctness are assumptions; this is not an
OS sandbox, total-process memory cap, hard real-time service or power-loss durability guarantee.

[Full runtime API, storage/event semantics and rollback](../../../docs/en/33-plugins.md).
