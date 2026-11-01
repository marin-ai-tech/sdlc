import { parentPort, workerData } from 'node:worker_threads';
import { SdlcError } from '../core/errors.js';
import { LIMITS, canonical, fail, json, keys, object, parseJson, type Json, type Manifest,
  type PluginResponse } from './api.js';
import { responseEnvelope } from './response.js';
import { PluginSchemas } from './schema.js';
import { validateProfile } from './wasm-profile.js';

interface WasmMemory { buffer: ArrayBuffer }
interface WasmExports { memory: WasmMemory; sdlc_alloc(size: number): number; sdlc_call(ptr: number, size: number): bigint }
interface WasmApi {
  validate(bytes: Uint8Array): boolean;
  compile(bytes: Uint8Array): Promise<unknown>;
  instantiate(module: unknown, imports: { sdlc: { memory: WasmMemory } }): Promise<{ exports: WasmExports }>;
  Memory: new (limits: { initial: number; maximum: number; shared: false }) => WasmMemory;
}
const wasm = Reflect.get(globalThis, 'WebAssembly') as WasmApi;
interface Request {
  manifest: Manifest; files: Array<[string, Uint8Array]>; operation?: string;
  input?: Json; state?: Json; revision?: number; config?: Json; context?: Json; preflight?: boolean; hook?: boolean;
  validate?: { kind: 'taskExt' | 'bidExt' | 'config' | 'state'; value: Json };
}

function range(memory: WasmMemory, pointer: number, length: number): Uint8Array {
  const size = memory.buffer.byteLength;
  if (!Number.isInteger(pointer) || pointer < 0 || length > size || pointer > size - length) {
    fail('plugin_wasm', 'Wasm returned an out-of-bounds range');
  }
  return new Uint8Array(memory.buffer, pointer, length);
}

function response(value: Json, m: Manifest, schemas: PluginSchemas, op: string, hook: boolean): PluginResponse {
  const result = responseEnvelope(value, m, op, hook);
  schemas.check(m.operations[op].output, result.output, 'output');
  if (result.facts !== undefined) schemas.check(m.schemas.facts, result.facts, 'facts');
  if (result.state !== undefined) schemas.check(m.schemas.state, result.state, 'state');
  for (const event of result.events ?? []) {
    schemas.check(m.events[event.name], event.data, 'event data');
  }
  return result;
}

interface Prepared {
  request: Request;
  schemas: PluginSchemas;
  memory: WasmMemory;
  instance: { exports: WasmExports };
}

async function prepare(request: Request): Promise<Prepared> {
  const files = new Map(request.files.map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const m = request.manifest;
  const bytes = files.get(m.entry);
  if (!bytes) fail('plugin_wasm', 'Missing Wasm entry');
  const schemas = new PluginSchemas(files);
  schemas.manifest(m);
  validateProfile(bytes);
  if (!wasm.validate(bytes)) fail('plugin_wasm', 'Engine rejected the Wasm binary');
  const module = await wasm.compile(bytes);
  const memory = new wasm.Memory({ initial: LIMITS.initialPages, maximum: LIMITS.pages, shared: false });
  const instance = await wasm.instantiate(module, { sdlc: { memory } });
  return { request, schemas, memory, instance };
}

function inputBytes(request: Request, schemas: PluginSchemas): Buffer {
  const m = request.manifest;
  const op = request.operation!;
  if (!Object.hasOwn(m.operations, op)) fail('plugin_operation', 'Unknown plugin operation');
  const config = json(request.config);
  const state = json(request.state);
  const input = json(request.input, LIMITS.jsonBytes, LIMITS.depth + (request.hook ? 8 : 0));
  schemas.check(m.schemas.config, config, 'config');
  schemas.check(m.schemas.state, state, 'state');
  schemas.check(m.operations[op].input, input, 'input');
  const revision = request.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) fail('plugin_invalid', 'Invalid captured state revision');
  return Buffer.from(canonical({ api: 'sdlc.plugin/1', operation: op, input,
    config, state, revision, context: request.context ?? null }, LIMITS.jsonBytes, LIMITS.depth + 8));
}

function execute({ request, schemas, memory, instance }: Prepared): Json {
  const m = request.manifest;
  if (request.validate) {
    const schema = m.schemas[request.validate.kind];
    if (schema === undefined) fail('plugin_schema', 'Plugin does not declare this extension schema');
    schemas.check(schema, json(request.validate.value), request.validate.kind);
  }
  if (request.preflight || request.validate) return null;
  const op = request.operation!;
  const input = inputBytes(request, schemas);
  const pointer = instance.exports.sdlc_alloc(input.length) >>> 0;
  range(memory, pointer, input.length).set(input);
  const packed = BigInt.asUintN(64, instance.exports.sdlc_call(pointer, input.length));
  const length = Number(packed & 0xffff_ffffn);
  if (length > LIMITS.jsonBytes) fail('plugin_limit', 'Wasm response exceeds its byte limit');
  const output = Buffer.from(range(memory, Number(packed >> 32n), length));
  return response(parseJson(output, LIMITS.jsonBytes, LIMITS.depth + 8), m, schemas, op,
    request.hook === true) as unknown as Json;
}

function ready(prepared: Prepared): Promise<Json> {
  return new Promise((resolve, reject) => {
    parentPort!.once('message', (raw: unknown) => {
      try {
        const message = object(raw, 'worker execute');
        keys(message, ['phase'], 'worker execute');
        if (message.phase !== 'execute') fail('plugin_runtime', 'Missing execution handshake');
        resolve(execute(prepared));
      } catch (error) { reject(error); }
    });
    parentPort!.postMessage({ phase: 'ready' });
  });
}

prepare(workerData as Request).then(ready).then(
  (result) => parentPort!.postMessage({ phase: 'result', ok: true, result }),
  (error: unknown) => parentPort!.postMessage({ phase: 'result', ok: false,
    code: error instanceof SdlcError ? error.code : 'plugin_runtime',
    detail: error instanceof SdlcError ? error.message : 'Plugin worker failed' }),
).finally(() => parentPort!.close());
