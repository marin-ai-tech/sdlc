import { SdlcError, toDiagnostic, type Diagnostic } from '../core/errors.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Extensions = Record<string, Json>;
export const INPUT_CONTROL_FIELDS = ['project', 'executor', 'origin', 'request'] as const;
export type Schema = boolean | Record<string, unknown> | string;
export const API_VERSION = '1.0.0';
export const NAME = /^[a-z][a-z0-9-]{0,23}$/;
export const HOOKS = ['claim', 'bid', 'award', 'result_accept', 'file_edit', 'stop'] as const;
export type Hook = typeof HOOKS[number];
export const LIMITS = Object.freeze({
  files: 256, packageBytes: 16 * 1024 * 1024, manifestBytes: 256 * 1024,
  moduleBytes: 8 * 1024 * 1024, jsonBytes: 1024 * 1024, extBytes: 256 * 1024,
  storeBytes: 4 * 1024 * 1024, eventBytes: 64 * 1024, depth: 32, effects: 64,
  pages: 1024, initialPages: 16, plugins: 8, workers: 2, hookMs: 1000,
  operationMs: 5000, cleanupMs: 1000, receiptMs: 86_400_000,
});

export interface Operation { access: 'read' | 'executor' | 'person'; input: Schema; output: Schema }
export interface Manifest {
  format: 'sdlc.plugin/1'; name: string; version: string; api: string; entry: string;
  initialState: Json;
  schemas: { config: Schema; state: Schema; facts: Schema; taskExt?: Schema; bidExt?: Schema };
  operations: Record<string, Operation>;
  commands: Record<string, string>;
  tools: Record<string, string>;
  hooks: Partial<Record<Hook, string>>;
  events: Record<string, Schema>;
}
export interface PluginSetting { package: string; digest: string; enabled: boolean; config: Json }
export interface PackageSnapshot { source: string; digest: string; files: Map<string, Buffer>; manifest: Manifest }
export interface PluginEvent { name: string; data: Json }
export interface PluginResponse { output: Json; facts?: Record<string, Json>; state?: Json; events?: PluginEvent[] }
export interface Actor { origin: 'cli' | 'mcp' | 'hook'; executor?: string; person?: string }

export function fail(code: string, detail: string): never {
  throw new SdlcError(code, { key: 'error.pluginFailure', params: { detail: detail.slice(0, 500) } },
    { key: 'fix.pluginFailure' });
}

/** Public plugin boundaries never expose native filesystem/process exception details. */
export function pluginError(error: unknown): SdlcError {
  if (error instanceof SdlcError) return error;
  return new SdlcError('plugin_unavailable', {
    key: 'error.pluginFailure',
    params: { detail: 'Plugin resources are unavailable; inspect the pinned package and storage.' },
  }, { key: 'fix.pluginFailure' });
}

export function pluginDiagnostic(error: unknown): Diagnostic {
  return toDiagnostic(pluginError(error));
}

export function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('plugin_invalid', `${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function keys(value: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      fail('plugin_invalid', `${where}: unknown field ${key}`);
    }
  }
}

export function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail('plugin_invalid', `${where} is invalid`);
  return value;
}

function normalize(value: unknown, depth: number, budget: { nodes: number }): Json {
  if (depth > LIMITS.depth || --budget.nodes < 0) fail('plugin_invalid', 'JSON complexity limit exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1, budget));
  const source = object(value, 'JSON');
  const result: Record<string, Json> = Object.create(null);
  for (const key of Object.keys(source).sort()) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('plugin_invalid', 'Unsafe JSON key');
    result[key] = normalize(source[key], depth + 1, budget);
  }
  return result;
}

export function canonical(value: unknown, limit = LIMITS.jsonBytes): string {
  const result = JSON.stringify(normalize(value, 0, { nodes: 100_000 }));
  if (Buffer.byteLength(result) > limit) fail('plugin_limit', 'JSON byte limit exceeded');
  return result;
}

export function json(value: unknown, limit = LIMITS.jsonBytes): Json {
  return JSON.parse(canonical(value, limit)) as Json;
}

/** Parse stored or new extensions; only the runtime can authorize new namespaces. */
export function parseExtensions(raw: unknown): Extensions | undefined {
  if (raw === undefined) return undefined;
  const value = object(raw, 'extensions');
  for (const name of Object.keys(value)) {
    if (!NAME.test(name) || INPUT_CONTROL_FIELDS.includes(name as typeof INPUT_CONTROL_FIELDS[number])
      || ['__proto__', 'prototype', 'constructor'].includes(name)) {
      fail('plugin_namespace', 'Extension namespace is invalid or reserved');
    }
  }
  return json(value, LIMITS.extBytes) as Extensions;
}

/** Transport identity is host-owned; nested plugin JSON remains plugin-owned. */
export function parsePluginInput(raw: unknown): Json {
  const value = json(raw);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (INPUT_CONTROL_FIELDS.some((key) => Object.hasOwn(value, key))) {
      fail('plugin_input', 'Plugin input cannot override transport identity');
    }
  }
  return value;
}

export function parseJson(bytes: Uint8Array, limit = LIMITS.jsonBytes): Json {
  if (bytes.byteLength > limit) fail('plugin_limit', 'JSON byte limit exceeded');
  try { return json(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), limit); }
  catch (error) {
    if (error instanceof SdlcError) throw error;
    return fail('plugin_invalid', 'Invalid UTF-8 or JSON');
  }
}
