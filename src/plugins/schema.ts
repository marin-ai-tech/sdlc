import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { INPUT_CONTROL_FIELDS, fail, type Manifest, type Schema } from './api.js';
import { SdlcError } from '../core/errors.js';
import { normalizeSchema, schemaPointer } from './schema-anchors.js';

function inspect(value: unknown, depth = 0): void {
  if (depth > 32) fail('plugin_schema', 'Schema is too deep');
  if (Array.isArray(value)) { for (const item of value) inspect(item, depth + 1); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['$async', '$data', '$dynamicRef', '$dynamicAnchor', '__proto__', 'constructor', 'prototype'].includes(key)) {
      fail('plugin_schema', 'Executable/dynamic schema features are refused');
    }
    if (['$ref', '$id'].includes(key) && typeof item === 'string'
      && /^[a-z]+:|^\/|\\|\.\./i.test(item)) {
      fail('plugin_schema', 'Schema references must be package-local');
    }
    inspect(item, depth + 1);
  }
}

export class PluginSchemas {
  private ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false,
    removeAdditional: false, allErrors: false, validateFormats: false });
  private compiled = new Map<Schema, ValidateFunction>();
  constructor(private files: Map<string, Buffer>) {}

  compile(value: Schema, name?: string): ValidateFunction {
    const previous = this.compiled.get(value);
    if (previous && !name) return previous;
    inspect(value);
    try {
      const input = normalizeSchema(this.files, value) as object | boolean;
      let validate: ValidateFunction;
      if (name) {
        this.ajv.addSchema(input, name);
        validate = this.ajv.getSchema(name)!;
      } else validate = this.ajv.compile(input);
      this.compiled.set(value, validate);
      return validate;
    } catch (error) {
      if (error instanceof SdlcError) throw error;
      return fail('plugin_schema', 'Schema is invalid or has an unresolved local reference');
    }
  }

  check(schema: Schema, value: unknown, field: string): void {
    if (!this.compile(schema)(value)) fail('plugin_schema', `${field} does not match its plugin schema`);
  }

  /** Follow only applicators that validate the same input root, never nested plugin data. */
  private input(schema: Schema): void {
    const root = this.compile(schema).schema;
    const seen = new Set<unknown>();
    const pending: unknown[] = [root];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) continue;
      seen.add(value);
      const v = value as Record<string, unknown>;
      if (INPUT_CONTROL_FIELDS.some((key) => inputNames(v).includes(key))) {
        fail('plugin_schema', 'Operation input schema declares reserved transport identity');
      }
      if (typeof v.$ref === 'string') pending.push(schemaPointer(root, v.$ref));
      pending.push(...rootApplicators(v));
    }
  }

  manifest(manifest: Manifest): void {
    for (const schema of Object.values(manifest.schemas)) this.compile(schema);
    for (const op of Object.values(manifest.operations)) { this.input(op.input); this.compile(op.output); }
    for (const schema of Object.values(manifest.events)) this.compile(schema);
    this.check(manifest.schemas.state, manifest.initialState, 'initialState');
  }
}

function inputNames(value: Record<string, unknown>): unknown[] {
  const named = (item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : [];
  const dependencies = value.dependentRequired && typeof value.dependentRequired === 'object'
    ? Object.values(value.dependentRequired).flatMap((item) => Array.isArray(item) ? item : []) : [];
  return [...named(value.properties), ...named(value.dependentRequired), ...named(value.dependentSchemas),
    ...(Array.isArray(value.required) ? value.required : []), ...dependencies];
}

function rootApplicators(value: Record<string, unknown>): unknown[] {
  const arrays = ['allOf', 'anyOf', 'oneOf'].flatMap((key) => Array.isArray(value[key]) ? value[key] : []);
  const singles = ['not', 'if', 'then', 'else'].map((key) => value[key]);
  const dependent = value.dependentSchemas && typeof value.dependentSchemas === 'object'
    ? Object.values(value.dependentSchemas) : [];
  return [...arrays, ...singles, ...dependent];
}
