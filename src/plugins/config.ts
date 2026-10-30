import { HOOKS, LIMITS, fail, json, keys, object, text, type Hook, type Json, type PluginSetting } from './api.js';
import { pluginName } from './manifest.js';
import { safeRelative } from './package.js';

export type Predicate = { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { fact: string; op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in'; value: Json };
export interface PluginPolicy { id: string; hook: Hook; require: Predicate; reason: string }

export function parsePlugins(raw: unknown): Record<string, PluginSetting> | undefined {
  if (raw === undefined) return undefined;
  const result: Record<string, PluginSetting> = Object.create(null);
  for (const [id, rawSetting] of Object.entries(object(raw, 'plugins'))) {
    pluginName(id);
    const v = object(rawSetting, `plugins.${id}`);
    keys(v, ['package', 'digest', 'enabled', 'config'], `plugins.${id}`);
    const source = text(v.package, 'package');
    if (!safeRelative(source)) fail('plugin_path', 'Plugin package must be project-relative');
    if (typeof v.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v.digest)) {
      fail('plugin_pin', 'Plugin needs a complete SHA-256 pin');
    }
    if (typeof v.enabled !== 'boolean') fail('plugin_invalid', 'Plugin enabled must be boolean');
    result[id] = { package: source, digest: v.digest, enabled: v.enabled,
      config: json(Object.hasOwn(v, 'config') ? v.config : {}) };
  }
  if (Object.values(result).filter((v) => v.enabled).length > LIMITS.plugins) fail('plugin_limit', 'Too many enabled plugins');
  return result;
}

function predicate(raw: unknown, depth: number, budget: { nodes: number }): Predicate {
  if (depth > 8 || --budget.nodes < 0) fail('plugin_policy', 'Policy complexity limit exceeded');
  const v = object(raw, 'policy predicate');
  if (Object.hasOwn(v, 'all') || Object.hasOwn(v, 'any')) {
    const key = Object.hasOwn(v, 'all') ? 'all' : 'any';
    keys(v, [key], 'policy');
    const values = v[key];
    if (!Array.isArray(values) || !values.length || values.length > 64) fail('plugin_policy', 'Invalid predicate list');
    return { [key]: values.map((value) => predicate(value, depth + 1, budget)) } as Predicate;
  }
  if (Object.hasOwn(v, 'not')) {
    keys(v, ['not'], 'policy');
    return { not: predicate(v.not, depth + 1, budget) };
  }
  keys(v, ['fact', 'op', 'value'], 'policy leaf');
  const fact = text(v.fact, 'fact');
  if (!/^[a-z][a-z0-9-]{0,23}\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(fact)
    || typeof v.op !== 'string' || !['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in'].includes(v.op)) {
    fail('plugin_policy', 'Invalid fact predicate');
  }
  const value = json(v.value);
  const scalar = (x: Json) => x === null || ['string', 'number', 'boolean'].includes(typeof x);
  if (v.op === 'in' ? !Array.isArray(value) || !value.every(scalar) : !scalar(value)) {
    fail('plugin_policy', 'Policy values must be scalars');
  }
  return { fact, op: v.op as 'eq', value };
}

export function parsePluginPolicies(raw: unknown): PluginPolicy[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 64) fail('plugin_policy', 'Policies must be a bounded list');
  const result = raw.map((item) => {
    const v = object(item, 'plugin policy');
    keys(v, ['id', 'hook', 'require', 'reason'], 'plugin policy');
    if (!(HOOKS as readonly unknown[]).includes(v.hook)) fail('plugin_policy', 'Unknown policy hook');
    return { id: text(v.id, 'policy id'), hook: v.hook as Hook,
      require: predicate(v.require, 0, { nodes: 64 }), reason: text(v.reason, 'policy reason') };
  });
  if (new Set(result.map((p) => p.id)).size !== result.length) fail('plugin_policy', 'Duplicate policy id');
  return result;
}
