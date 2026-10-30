import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { agentEnvironment } from '../core/agent-env.js';
import { loadConfig, type SdlcConfig } from '../core/config.js';
import { readExecutors } from '../core/executors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { canonical, fail, json, keys, object, parsePluginInput, type Actor, type Json } from './api.js';
import { withActivation } from './activation.js';
import { pluginEvents, projectEvents } from './events.js';
import { activePlugin, currentActive, type ActivePlugin } from './trust.js';
import { commitStore, readStore, receipt, withStore, type Receipt } from './store.js';
import { invoke } from './runtime.js';
import { hash } from './package.js';

function authorize(root: string, active: ActivePlugin, operation: string, actor: Actor): void {
  const access = active.snapshot.manifest.operations[operation]?.access;
  if (access !== 'read' && access !== 'person' && access !== 'executor') fail('plugin_operation', 'Operation access is not declared');
  if (actor.origin === 'hook' && access !== 'read') fail('plugin_access', 'Hooks are pure');
  if (access === 'person' && (actor.origin !== 'cli' || agentEnvironment() || !actor.person)) {
    fail('plugin_person_only', 'Person-only operations require a person in their own terminal');
  }
  if (access === 'executor' && (!actor.executor || !readExecutors(root)?.has(actor.executor))) {
    fail('plugin_executor', 'An authenticated registered executor is required');
  }
}

export function cliActor(root: string, executor?: string): Actor {
  if (process.env.SDLC_MCP_ORIGIN === '1') return { origin: 'mcp',
    ...(process.env.SDLC_MCP_EXECUTOR ? { executor: process.env.SDLC_MCP_EXECUTOR } : {}) };
  const person = !agentEnvironment() ? formatIdentity(gitIdentity(root)) : undefined;
  return { origin: 'cli', ...(person ? { person } : {}), ...(executor ? { executor } : {}) };
}

function reply(name: string, result: unknown, saved?: Receipt) {
  const response = object(result, 'plugin receipt result');
  keys(response, ['output', 'facts', 'state', 'events'], 'plugin receipt result');
  return { plugin: name, output: json(response.output),
    ...(response.facts !== undefined ? { facts: json(object(response.facts, 'receipt facts')) } : {}),
    ...(saved ? { request: saved.id, transaction: saved.tx } : {}) };
}

function projectedReply(root: string, config: SdlcConfig, name: string, stateId: string, saved: Receipt) {
  const projection = projectEvents(root, config, name, stateId);
  return { ...reply(name, saved.result, saved), ...(projection.pending ? { warning: {
    code: 'plugin_log_pending', pending: projection.pending, message: 'Transaction committed; event projection remains pending',
  } } : {}) };
}

export async function callPlugin(root: string, config: SdlcConfig, name: string, operation: string,
  input: Json, actor: Actor, request?: string) {
  const currentConfig = loadConfig(`${root}/openspec/sdlc.yaml`);
  if (canonical(config.plugins?.[name] ?? null) !== canonical(currentConfig.plugins?.[name] ?? null)) {
    fail('plugin_evaluation_stale', 'Plugin descriptor configuration changed before invocation');
  }
  config = currentConfig;
  const active = activePlugin(root, config, name);
  authorize(root, active, operation, actor);
  input = parsePluginInput(input);
  const access = active.snapshot.manifest.operations[operation].access;
  const executorDigest = access === 'executor' ? hash(fs.readFileSync(`${root}/openspec/executors.yaml`)) : undefined;
  const reauthorize = () => {
    authorize(root, active, operation, actor);
    if (executorDigest && hash(fs.readFileSync(`${root}/openspec/executors.yaml`)) !== executorDigest) {
      fail('plugin_evaluation_stale', 'Executor registry changed during invocation');
    }
  };
  const args = json({ operation, input, actor, digest: active.snapshot.digest, config: active.setting.config });
  if (access !== 'read') {
    if (!request) fail('plugin_request', 'A stable request id is required for mutating operations');
    const saved = receipt(active.store, request, args);
    if (saved) {
      const confirmed = withActivation(root, () => withStore(root, name, () => {
        reauthorize();
        const current = activePlugin(root, loadConfig(`${root}/openspec/sdlc.yaml`), name);
        if (current.store.stateId !== active.store.stateId || current.snapshot.digest !== active.snapshot.digest
          || canonical(current.setting) !== canonical(active.setting) || current.configDigest !== active.configDigest) {
          fail('plugin_evaluation_stale', 'Plugin activation changed');
        }
        return receipt(current.store, request!, args)!;
      }));
      return projectedReply(root, config, name, active.store.stateId, confirmed);
    }
  }
  const response = (await invoke(active.snapshot, { operation, input, state: active.store.data, revision: active.store.revision,
    config: active.setting.config, context: json({ actor }) }))!;
  if (access === 'read') {
    withActivation(root, () => currentActive(root, active));
    return reply(name, response);
  }
  const tx = randomUUID();
  const now = Date.now();
  const events = pluginEvents(active, response.events ?? [], actor, request!, tx, now, config);
  let saved: Receipt;
  try {
    saved = withActivation(root, () => {
      reauthorize();
      currentActive(root, active);
      const next = commitStore(root, active.store, request!, args, response, events, tx);
      return receipt(next, request!, args, now)!;
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'plugin_indeterminate') {
      fail('plugin_indeterminate', `Request ${request}: reconcile this identifier before retrying; commit acknowledgement is uncertain`);
    }
    throw error;
  }
  return projectedReply(root, loadConfig(`${root}/openspec/sdlc.yaml`), name, active.store.stateId, saved);
}
