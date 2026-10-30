import { parentPort, workerData } from 'node:worker_threads';
import { SdlcError } from '../core/errors.js';
import { LIMITS, canonical, fail, parseJson } from './api.js';
import { responseEnvelope } from './response.js';
import { PluginSchemas } from './schema.js';
import { validateProfile } from './wasm-profile.js';
const wasm = Reflect.get(globalThis, 'WebAssembly');
function range(memory, pointer, length) {
    const size = memory.buffer.byteLength;
    if (!Number.isInteger(pointer) || pointer < 0 || length > size || pointer > size - length) {
        fail('plugin_wasm', 'Wasm returned an out-of-bounds range');
    }
    return new Uint8Array(memory.buffer, pointer, length);
}
function response(value, m, schemas, op, hook) {
    const result = responseEnvelope(value, m, op, hook);
    schemas.check(m.operations[op].output, result.output, 'output');
    if (result.facts !== undefined)
        schemas.check(m.schemas.facts, result.facts, 'facts');
    if (result.state !== undefined)
        schemas.check(m.schemas.state, result.state, 'state');
    for (const event of result.events ?? []) {
        schemas.check(m.events[event.name], event.data, 'event data');
    }
    return result;
}
async function run(request) {
    const files = new Map(request.files.map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const m = request.manifest;
    const bytes = files.get(m.entry);
    if (!bytes)
        fail('plugin_wasm', 'Missing Wasm entry');
    const schemas = new PluginSchemas(files);
    schemas.manifest(m);
    if (request.validate) {
        const schema = m.schemas[request.validate.kind];
        if (schema === undefined)
            fail('plugin_schema', 'Plugin does not declare this extension schema');
        schemas.check(schema, request.validate.value, request.validate.kind);
    }
    validateProfile(bytes);
    if (!wasm.validate(bytes))
        fail('plugin_wasm', 'Engine rejected the Wasm binary');
    if (request.preflight || request.validate)
        return null;
    const op = request.operation;
    if (!Object.hasOwn(m.operations, op))
        fail('plugin_operation', 'Unknown plugin operation');
    schemas.check(m.schemas.config, request.config, 'config');
    schemas.check(m.schemas.state, request.state, 'state');
    schemas.check(m.operations[op].input, request.input, 'input');
    const revision = request.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0)
        fail('plugin_invalid', 'Invalid captured state revision');
    const input = Buffer.from(canonical({ api: 'sdlc.plugin/1', operation: op, input: request.input,
        config: request.config, state: request.state, revision, context: request.context ?? null }));
    const module = await wasm.compile(bytes);
    const memory = new wasm.Memory({ initial: LIMITS.initialPages, maximum: LIMITS.pages, shared: false });
    const instance = await wasm.instantiate(module, { sdlc: { memory } });
    const pointer = instance.exports.sdlc_alloc(input.length) >>> 0;
    range(memory, pointer, input.length).set(input);
    const packed = BigInt.asUintN(64, instance.exports.sdlc_call(pointer, input.length));
    const length = Number(packed & 0xffffffffn);
    if (length > LIMITS.jsonBytes)
        fail('plugin_limit', 'Wasm response exceeds its byte limit');
    const output = Buffer.from(range(memory, Number(packed >> 32n), length));
    return response(parseJson(output), m, schemas, op, request.hook === true);
}
run(workerData).then((result) => parentPort.postMessage({ ok: true, result }), (error) => parentPort.postMessage({ ok: false,
    code: error instanceof SdlcError ? error.code : 'plugin_runtime',
    detail: error instanceof SdlcError ? error.message : 'Plugin worker failed' })).finally(() => parentPort.close());
