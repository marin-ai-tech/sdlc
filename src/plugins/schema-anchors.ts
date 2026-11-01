import * as path from 'node:path';
import { LIMITS, fail, json, parseJson, type Schema } from './api.js';
import { safeRelative } from './package.js';

const MAPS = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas']);
const ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SINGLES = new Set(['not', 'if', 'then', 'else', 'items', 'contains', 'propertyNames',
  'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema']);
const MAX_REFERENCES = 4096;
const MAX_NODES = 32768;
const MAX_PROJECTION_DEPTH = 64;
const ANCHOR = /^[A-Za-z_][-A-Za-z0-9._]*$/;

interface Location { document: string; pointer: string; base: string; value: unknown }
type Child = { tokens: string[]; value: unknown };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function children(schema: Record<string, unknown>): Child[] {
  const result: Child[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (MAPS.has(key) && record(value)) {
      for (const [name, child] of Object.entries(value)) result.push({ tokens: [key, name], value: child });
    } else if (ARRAYS.has(key) && Array.isArray(value)) {
      value.forEach((child, index) => result.push({ tokens: [key, String(index)], value: child }));
    } else if (SINGLES.has(key) && (record(value) || typeof value === 'boolean')) {
      result.push({ tokens: [key], value });
    }
  }
  return result;
}

function localReference(reference: string, base: string): { resource: string; fragment: string } {
  if (/^[a-z]+:|^\/|\\|\.\./i.test(reference)) fail('plugin_schema', 'Schema references must be package-local');
  const hash = reference.indexOf('#');
  const relative = hash < 0 ? reference : reference.slice(0, hash);
  if (relative && !safeRelative(relative)) fail('plugin_schema', 'Invalid local schema path');
  let fragment: string;
  try { fragment = decodeURIComponent(hash < 0 ? '' : reference.slice(hash + 1)); }
  catch { return fail('plugin_schema', 'Invalid schema fragment encoding'); }
  const resource = relative ? path.posix.join(path.posix.dirname(base), relative) : base;
  return { resource, fragment };
}

function cloneSchema(value: unknown, transform: (value: unknown, tokens: string[]) => unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (!record(value)) fail('plugin_schema', 'Expected a supported schema object or boolean');
  const result = structuredClone(value);
  for (const child of children(value)) {
    let target: Record<string, unknown> | unknown[] = result;
    for (const token of child.tokens.slice(0, -1)) target = target[token as keyof typeof target] as typeof target;
    Object.defineProperty(target, child.tokens.at(-1)!, {
      value: transform(child.value, child.tokens), enumerable: true, configurable: true, writable: true,
    });
  }
  return result;
}

/** Indexes actual schema positions once. Literal defaults/examples/const data are never reference sites. */
class LocalSchemas {
  private documents = new Map<string, unknown>();
  private locations = new Map<string, Location>();
  private resources = new Map<string, Location>();
  private anchors = new Map<string, Location>();
  private definitions: Record<string, unknown> = Object.create(null);
  private nodes = 0;
  private references = 0;
  private bytes = 0;

  constructor(private files: Map<string, Buffer>) {}

  normalize(schema: Schema): unknown {
    this.addDocument('', typeof schema === 'string' ? { $ref: schema } : schema);
    this.emitDocument('', 0);
    try { return json({ $ref: '#/$defs/', $defs: this.definitions }, LIMITS.jsonBytes, MAX_PROJECTION_DEPTH + 8); }
    catch { return fail('plugin_schema', 'Normalized schema resource limit exceeded'); }
  }

  private key(document: string, pointer: string): string {
    return `${document}#${pointer}`;
  }

  private register(registry: Map<string, Location>, name: string, location: Location): void {
    const previous = registry.get(name);
    if (previous && this.key(previous.document, previous.pointer) !== this.key(location.document, location.pointer)) {
      fail('plugin_schema', 'Ambiguous schema identifier or anchor');
    }
    registry.set(name, location);
  }

  private addDocument(name: string, value: unknown): void {
    if (this.documents.has(name)) return;
    if (this.documents.size >= LIMITS.files) fail('plugin_schema', 'Schema document limit exceeded');
    this.bytes += Buffer.byteLength(JSON.stringify(value));
    if (this.bytes > LIMITS.jsonBytes) fail('plugin_schema', 'Schema document byte limit exceeded');
    this.documents.set(name, value);
    const root = { document: name, pointer: '', base: name, value };
    this.register(this.resources, name, root);
    this.index(root, 0);
  }

  private attributes(location: Location, value: Record<string, unknown>): void {
    if (['$async', '$data', '$dynamicRef', '$dynamicAnchor'].some((key) => Object.hasOwn(value, key))) {
      fail('plugin_schema', 'Executable/dynamic schema features are refused');
    }
    if (value.$id !== undefined) {
      if (typeof value.$id !== 'string' || value.$id.includes('#')) fail('plugin_schema', 'Invalid static schema id');
      location.base = localReference(value.$id, location.base).resource;
      this.register(this.resources, location.base, location);
    }
    if (value.$anchor !== undefined) {
      if (typeof value.$anchor !== 'string' || !ANCHOR.test(value.$anchor)) {
        fail('plugin_schema', 'Invalid static anchor');
      }
      this.register(this.anchors, `${location.base}#${value.$anchor}`, location);
    }
    if (value.$ref !== undefined) {
      if (typeof value.$ref !== 'string') fail('plugin_schema', 'Schema reference must be a string');
      localReference(value.$ref, location.base);
      if (++this.references > MAX_REFERENCES) fail('plugin_schema', 'Schema reference limit exceeded (4096)');
    }
  }

  private index(location: Location, depth: number): void {
    if (depth > LIMITS.depth || ++this.nodes > MAX_NODES) fail('plugin_schema', 'Schema node/depth limit exceeded');
    this.locations.set(this.key(location.document, location.pointer), location);
    if (typeof location.value === 'boolean') return;
    if (!record(location.value)) fail('plugin_schema', 'Expected a supported schema object or boolean');
    this.attributes(location, location.value);
    for (const child of children(location.value)) {
      this.index({ document: location.document, base: location.base, value: child.value,
        pointer: location.pointer + '/' + child.tokens.map(pointerToken).join('/') }, depth + 1);
    }
  }

  private target(reference: string, base: string): Location {
    const { resource, fragment } = localReference(reference, base);
    if (!this.resources.has(resource)) {
      const bytes = this.files.get(resource);
      if (!bytes) fail('plugin_schema', 'Missing captured schema document');
      this.addDocument(resource, parseJson(bytes));
    }
    const root = this.resources.get(resource)!;
    if (!fragment) return root;
    const target = fragment.startsWith('/')
      ? this.locations.get(this.key(root.document, root.pointer + fragment))
      : this.anchors.get(`${resource}#${fragment}`) ?? this.anchors.get(`${root.base}#${fragment}`);
    if (!target) fail('plugin_schema', 'Missing or unsupported local schema reference target');
    return target;
  }

  private emitDocument(name: string, depth: number): void {
    if (Object.hasOwn(this.definitions, name)) return;
    this.definitions[name] = true;
    this.definitions[name] = this.emit(this.locations.get(this.key(name, ''))!, depth);
  }

  private emit(location: Location, depth: number): unknown {
    if (depth > MAX_PROJECTION_DEPTH) fail('plugin_schema', 'Schema projection depth limit exceeded');
    if (typeof location.value === 'boolean') return location.value;
    const result = cloneSchema(location.value, (_child, tokens) => {
      const pointer = location.pointer + '/' + tokens.map(pointerToken).join('/');
      return this.emit(this.locations.get(this.key(location.document, pointer))!, depth + 1);
    }) as Record<string, unknown>;
    delete result.$id;
    delete result.$anchor;
    if (typeof result.$ref === 'string') {
      const target = this.target(result.$ref, location.base);
      this.emitDocument(target.document, depth + 1);
      const pointer = `/$defs/${pointerToken(target.document)}${target.pointer}`;
      result.$ref = '#' + pointer.split('/').map(encodeURIComponent).join('/');
    }
    return result;
  }
}

export function normalizeSchema(files: Map<string, Buffer>, schema: Schema): unknown {
  return new LocalSchemas(files).normalize(schema);
}

/** Public descriptors are normalized first, so only actual schema references need the outer MCP prefix. */
export function nestSchemaReferences(schema: unknown, prefix: string): unknown {
  const result = cloneSchema(schema, (child) => nestSchemaReferences(child, prefix));
  if (record(result) && typeof result.$ref === 'string' && result.$ref.startsWith('#/')) {
    result.$ref = `#${prefix}${result.$ref.slice(1)}`;
  }
  return result;
}

export function schemaPointer(schema: unknown, reference: string): unknown {
  if (!reference.startsWith('#/')) fail('plugin_schema', 'Expected a normalized schema pointer');
  let current: unknown = schema;
  for (const token of reference.slice(2).split('/')) {
    const name = decodeURIComponent(token).replaceAll('~1', '/').replaceAll('~0', '~');
    if ((!record(current) && !Array.isArray(current)) || !Object.hasOwn(current, name)) {
      fail('plugin_schema', 'Unresolved normalized schema pointer');
    }
    current = (current as Record<string, unknown>)[name];
  }
  return current;
}
