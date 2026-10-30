import { randomUUID } from 'node:crypto';
import { LIMITS, canonical, fail, json, keys, object, text, type Json, type PluginResponse } from './api.js';
import { atomicStored, readStored, withPluginLock } from './activation.js';
import { pluginName } from './manifest.js';
import { hash } from './package.js';

export interface StoredEvent { id: string; record: Record<string, Json> }
export interface Receipt { id: string; digest: string; issuedAt: number; tx: string; result: Json }
export interface PluginStore {
  version: 1; name: string; stateId: string; revision: number; data: Json;
  genesis: { source: string; digest: string; stateDigest: string };
  pending: StoredEvent[]; receipts: Receipt[]; receiptFloor: number;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('plugin_store', `Invalid ${field}`);
  return value as number;
}

function parseStore(value: unknown, name: string): PluginStore {
  const v = object(value, 'plugin store');
  keys(v, ['version', 'name', 'stateId', 'revision', 'data', 'genesis', 'pending', 'receipts', 'receiptFloor'], 'plugin store');
  if (v.version !== 1 || v.name !== name) fail('plugin_store', 'Unknown plugin store identity/version');
  if (!Array.isArray(v.pending) || !Array.isArray(v.receipts)) fail('plugin_store', 'Invalid events/receipts');
  const pending = v.pending.map((raw) => {
    const event = object(raw, 'pending event');
    keys(event, ['id', 'record'], 'pending event');
    return { id: text(event.id, 'event id'), record: json(object(event.record, 'event record')) as Record<string, Json> };
  });
  const receipts = v.receipts.map((raw) => {
    const r = object(raw, 'receipt');
    keys(r, ['id', 'digest', 'issuedAt', 'tx', 'result'], 'receipt');
    return { id: text(r.id, 'request id'), digest: text(r.digest, 'request digest'),
      issuedAt: integer(r.issuedAt, 'issuedAt'), tx: text(r.tx, 'transaction'), result: json(r.result) };
  });
  if (new Set(pending.map((e) => e.id)).size !== pending.length
    || new Set(receipts.map((r) => r.id)).size !== receipts.length) fail('plugin_store', 'Duplicate store identifiers');
  const initial = object(v.genesis, 'genesis identity');
  keys(initial, ['source', 'digest', 'stateDigest'], 'genesis identity');
  const identity = { source: text(initial.source, 'genesis source'), digest: text(initial.digest, 'genesis digest'),
    stateDigest: text(initial.stateDigest, 'genesis state digest') };
  if (!/^sha256:[a-f0-9]{64}$/.test(identity.digest) || !/^[a-f0-9]{64}$/.test(identity.stateDigest)) {
    fail('plugin_store', 'Invalid genesis identity digest');
  }
  return { version: 1, name, stateId: text(v.stateId, 'stateId'), revision: integer(v.revision, 'revision'), genesis: identity,
    data: json(v.data), pending, receipts, receiptFloor: integer(v.receiptFloor, 'receiptFloor') };
}

export function storeRelative(name: string): string { return `state/${pluginName(name)}/store.json`; }

export function readStore(root: string, name: string, stateId?: string): PluginStore | undefined {
  const raw = readStored(root, storeRelative(name));
  if (raw === undefined) {
    if (stateId) fail('plugin_store', 'Initialized plugin store is missing');
    return undefined;
  }
  const store = parseStore(raw, name);
  if (stateId && store.stateId !== stateId) fail('plugin_store', 'Plugin state identity mismatch');
  return store;
}

export function withStore<T>(root: string, name: string, action: () => T): T {
  return withPluginLock(root, `state/${pluginName(name)}/store.lock`, action);
}

export function genesis(root: string, name: string, initialState: Json,
  identity: { source: string; digest: string }, expectedStateId?: string): PluginStore {
  return withStore(root, name, () => {
    const existing = readStore(root, name, expectedStateId);
    if (existing) return existing;
    const store: PluginStore = { version: 1, name, stateId: randomUUID(), revision: 0,
      genesis: { ...identity, stateDigest: hash(canonical(initialState)) },
      data: json(initialState), pending: [], receipts: [], receiptFloor: 0 };
    atomicStored(root, storeRelative(name), store);
    return store;
  });
}

/** Retained outcomes remain identifiable after clock rollback, but never below their expiry floor. */
export function requestTimestamp(id: string, floor: number, now = Date.now()): number {
  const match = /^p1\.(\d{1,16})\.([a-f0-9]{32})$/.exec(id);
  const time = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(time) || time < 0) fail('plugin_request', 'Invalid request identifier');
  if (time < floor || now - time > LIMITS.receiptMs) fail('plugin_request_expired', 'Expired request; outcome may not be retained');
  return time;
}

export function requestTime(id: string, floor: number, now = Date.now()): number {
  const time = requestTimestamp(id, floor, now);
  if (time > now + 60_000) fail('plugin_request', 'Request timestamp is in the future');
  return time;
}

export function receipt(store: PluginStore, id: string, args: unknown, now = Date.now()): Receipt | undefined {
  requestTimestamp(id, store.receiptFloor, now);
  const found = store.receipts.find((r) => r.id === id);
  if (found && found.digest !== hash(canonical(args))) fail('plugin_request_conflict', 'Request arguments changed');
  if (!found) requestTime(id, store.receiptFloor, now);
  return found;
}

export function commitStore(root: string, previous: PluginStore, id: string, args: unknown,
  result: PluginResponse, events: StoredEvent[], tx = randomUUID()): PluginStore {
  return withStore(root, previous.name, () => {
    const current = readStore(root, previous.name, previous.stateId)!;
    const replay = receipt(current, id, args);
    if (replay) return current;
    if (current.revision !== previous.revision) fail('plugin_evaluation_stale', 'Plugin state changed during execution');
    const floor = Math.max(current.receiptFloor, Date.now() - LIMITS.receiptMs, 0);
    const issuedAt = requestTime(id, floor);
    const next: PluginStore = { ...current, revision: current.revision + 1, receiptFloor: floor,
      data: result.state === undefined ? current.data : json(result.state), pending: [...current.pending, ...events],
      receipts: [...current.receipts.filter((r) => r.issuedAt >= floor),
        { id, digest: hash(canonical(args)), issuedAt, tx, result: json(result) }] };
    atomicStored(root, storeRelative(previous.name), next);
    return next;
  });
}
