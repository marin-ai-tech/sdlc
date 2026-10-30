import { loadConfig, type SdlcConfig } from '../core/config.js';
import { harnessStamp } from '../core/license.js';
import { parseLogEntry } from '../core/log-record.js';
import { appendLogRecords, logFile, withLogWriter } from '../core/log-write.js';
import { atomicStored, withActivation } from './activation.js';
import { fail, pluginDiagnostic, type Actor, type PluginEvent } from './api.js';
import { readStore, withStore, type StoredEvent } from './store.js';
import type { ActivePlugin } from './trust.js';

export function pluginEvents(active: ActivePlugin, events: PluginEvent[], actor: Actor,
  request: string, tx: string, now: number, config: SdlcConfig): StoredEvent[] {
  const stamp = harnessStamp(config);
  return events.map((event, index) => {
    const id = `${active.store.stateId}:${tx}:${index}`;
    return { id, record: {
      ts: new Date(now).toISOString(), event: `${active.snapshot.manifest.name}.${event.name}`,
      sdlc: stamp.version, license: stamp.license,
      ...(actor.executor ? { executor: actor.executor } : {}), ...(actor.person ? { by: actor.person } : {}),
      plugin: { name: active.snapshot.manifest.name, version: active.snapshot.manifest.version,
        digest: active.snapshot.digest, eventId: id, request, transaction: tx, payload: event.data },
    } };
  });
}

/** Projection may duplicate a stable id after a crash; readLog alone deduplicates plugin records. */
export function projectEvents(root: string, config: SdlcConfig, name: string, stateId: string) {
  if (!config.log.enabled) return { projected: 0, pending: readStore(root, name, stateId)!.pending.length };
  try {
    return withActivation(root, () => withStore(root, name, () => {
      const store = readStore(root, name, stateId)!;
      if (!loadConfig(`${root}/openspec/sdlc.yaml`).log.enabled) return { projected: 0, pending: store.pending.length };
      if (!store.pending.length) return { projected: 0, pending: 0 };
      for (const event of store.pending) {
        const entry = parseLogEntry(event.record);
        if (!entry?.plugin || entry.plugin.name !== name || entry.plugin.eventId !== event.id) {
          fail('plugin_store', 'Invalid authoritative plugin event envelope');
        }
      }
      withLogWriter(root, () => appendLogRecords(logFile(root, 'log.jsonl'), store.pending.map((e) => e.record)));
      atomicStored(root, `state/${name}/store.json`, { ...store, pending: [] });
      return { projected: store.pending.length, pending: 0 };
    }));
  } catch (error) { return { projected: 0, pending: readStore(root, name, stateId)!.pending.length,
    problem: pluginDiagnostic(error) }; }
}
