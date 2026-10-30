import * as fs from 'node:fs';
import { object, text, fail } from './api.js';
import { readStored, storagePath, withActivation, withPluginLock } from './activation.js';
import { assertPluginHuman, readRegistry } from './trust.js';
import { pluginName } from './manifest.js';
import { readStore, requestTime, requestTimestamp, withStore, type PluginStore } from './store.js';
import { recoverLogWriter } from '../core/log-write.js';
import { withRecoveryEntry } from './recovery-lock.js';

function releaseDead(root: string, relative: string): void {
  const lock = readStored(root, relative);
  if (lock === undefined) return;
  const value = object(lock, 'writer lock');
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) < 1) fail('plugin_store', 'Malformed writer owner');
  const nonce = text(value.nonce, 'lock nonce');
  try { process.kill(value.pid as number, 0); fail('plugin_busy', 'Writer is still active'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const current = object(readStored(root, relative), 'writer lock');
  if (current.pid !== value.pid || current.nonce !== nonce) fail('plugin_busy', 'Lock owner changed');
  fs.unlinkSync(storagePath(root, relative));
}

function temporaryFiles(root: string, name: string) {
  const files: Array<{ file: string; bytes: number; authoritative: false }> = [];
  for (const relative of ['', `state/${name}`]) {
    const directory = storagePath(root, relative);
    for (const entry of fs.readdirSync(directory).filter((file) => file.endsWith('.tmp')).sort()) {
      if (files.length === 64) return { temporaryFiles: files, temporaryFilesTruncated: true };
      const file = relative ? `${relative}/${entry}` : entry;
      const info = fs.lstatSync(storagePath(root, file));
      if (!info.isFile()) fail('plugin_store', 'Temporary storage entry is not a regular file');
      files.push({ file, bytes: info.size, authoritative: false });
    }
  }
  return { temporaryFiles: files, temporaryFilesTruncated: false };
}

function requestOutcome(store: PluginStore, request: string) {
  const saved = store.receipts.find((r) => r.id === request);
  try {
    if (saved) requestTimestamp(request, store.receiptFloor);
    else requestTime(request, store.receiptFloor);
    return saved ? { request, status: 'committed', transaction: saved.tx, result: saved.result }
      : { request, status: 'not_committed' };
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'plugin_request_expired') throw error;
    return { request, status: 'outcome_not_retained' };
  }
}

function reconcile(root: string, name: string, request?: string) {
  return withActivation(root, () => {
    const accepted = readRegistry(root).plugins[name];
    if (!accepted) fail('plugin_unknown', 'No initialized namespace to recover');
    return withStore(root, name, () => {
      const store = readStore(root, name, accepted.stateId)!;
      return { name, revision: store.revision, receipts: store.receipts.map((r) => ({ request: r.id, tx: r.tx })),
        pendingEvents: store.pending.length, status: 'reconciled', ...temporaryFiles(root, name),
        ...(request ? { outcome: requestOutcome(store, request) } : {}) };
    });
  }, true);
}

export function recoverPlugin(root: string, name: string, request?: string) {
  assertPluginHuman(root);
  pluginName(name);
  return withRecoveryEntry(root, () => {
    releaseDead(root, 'recovery.lock');
    return withPluginLock(root, 'recovery.lock', () => {
      releaseDead(root, 'activation.lock');
      releaseDead(root, `state/${name}/store.lock`);
      recoverLogWriter(root);
      return reconcile(root, name, request);
    });
  });
}
