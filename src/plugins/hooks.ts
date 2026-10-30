import type { SdlcConfig } from '../core/config.js';
import { LIMITS, fail, json, keys, object, pluginDiagnostic, type Actor, type Hook, type Json } from './api.js';
import { activePlugins } from './catalog.js';
import { invoke } from './runtime.js';
import { evaluatePolicies } from './policy.js';
import type { ActivePlugin } from './trust.js';

export interface PluginAttribution { name: string; version: string; digest: string; code: string; message?: string }
export interface HookDecision {
  decision: 'pass' | 'signal' | 'deny'; code?: string; message?: string;
  plugin?: PluginAttribution; policy?: string;
  fault?: boolean;
}
export interface HookEvaluation {
  verdict: HookDecision; facts: Record<string, Json>; plugins: ActivePlugin[];
}

function decision(raw: unknown, plugin: ActivePlugin): HookDecision {
  const value = object(raw, 'hook output');
  keys(value, ['decision', 'code', 'message'], 'hook output');
  if (typeof value.decision !== 'string' || !['pass', 'signal', 'deny'].includes(value.decision)) {
    fail('plugin_hook', 'Unknown hook decision');
  }
  if (value.code !== undefined && (typeof value.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value.code))) {
    fail('plugin_hook', 'Invalid bounded hook code');
  }
  if (value.message !== undefined && (typeof value.message !== 'string' || value.message.length > 500)) {
    fail('plugin_hook', 'Invalid bounded hook diagnostic');
  }
  const code = value.code as string | undefined;
  const message = value.message as string | undefined;
  return { decision: value.decision as HookDecision['decision'], ...(code ? { code } : {}), ...(message ? { message } : {}),
    plugin: { name: plugin.snapshot.manifest.name, version: plugin.snapshot.manifest.version,
      digest: plugin.snapshot.digest, code: code ?? String(value.decision), ...(message ? { message } : {}) } };
}

/** Only pure operations run here; invocation-scoped facts never become core proof. */
export async function evaluateHooks(root: string, config: SdlcConfig, hook: Hook, subject: Json, actor: Actor,
  captured?: ActivePlugin[], deadline = performance.now() + LIMITS.operationMs): Promise<HookEvaluation> {
  const plugins = captured ?? activePlugins(root, config);
  const facts: Record<string, Json> = Object.create(null);
  let verdict: HookDecision = { decision: 'pass' };
  for (const plugin of [...plugins].sort((a, b) => a.snapshot.manifest.name.localeCompare(b.snapshot.manifest.name))) {
    const operation = plugin.snapshot.manifest.hooks[hook];
    if (!operation) continue;
    const remaining = deadline - performance.now();
    if (remaining <= 0) fail('plugin_timeout', 'Aggregate hook preparation deadline exceeded');
    try {
      const response = (await invoke(plugin.snapshot, { operation, input: json({ hook, subject }), hook: true,
        config: plugin.setting.config, state: plugin.store.data, revision: plugin.store.revision, context: json({ actor }),
        timeoutMs: Math.min(LIMITS.hookMs, remaining) }))!;
      const next = decision(response.output, plugin);
      if (next.decision === 'deny' && verdict.decision !== 'deny'
        || next.decision === 'signal' && verdict.decision === 'pass') verdict = next;
      for (const [name, value] of Object.entries(response.facts ?? {})) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) fail('plugin_fact', 'Invalid fact name');
        facts[`${plugin.snapshot.manifest.name}.${name}`] = value;
      }
    } catch (error) {
      if (hook !== 'result_accept') throw error;
      const diagnostic = pluginDiagnostic(error);
      return { verdict: { decision: 'deny', fault: true,
        plugin: { name: plugin.snapshot.manifest.name, version: plugin.snapshot.manifest.version,
          digest: plugin.snapshot.digest, code: diagnostic.code, message: diagnostic.message.slice(0, 500) } }, facts, plugins };
    }
  }
  const policy = evaluatePolicies(config.pluginPolicies ?? [], hook, facts);
  if (policy && verdict.decision !== 'deny') verdict = { decision: 'deny', ...policy };
  return { verdict, facts, plugins };
}
