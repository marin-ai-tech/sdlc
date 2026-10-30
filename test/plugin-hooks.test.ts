import { describe, expect, it } from 'vitest';
import { evaluatePolicies } from '../dist/plugins/policy.js';
import { evaluateHooks } from '../dist/plugins/hooks.js';
import { parsePluginPolicies } from '../dist/plugins/config.js';
import { pluginProject } from './fixtures/plugin-project.js';

const policy = (requirement: unknown) => parsePluginPolicies([
  { id: 'capacity', hook: 'claim', require: requirement, reason: 'Capacity is required' },
])!;

describe('Bounded additive core fact policies', () => {
  it.each([
    { not: { fact: 'economy.remaining', op: 'gte', value: 1 } },
    { any: [{ fact: 'economy.ready', op: 'eq', value: true }, { fact: 'economy.remaining', op: 'gte', value: 1 }] },
  ])('missing facts refuse even in negation or a branch that could short circuit', (requirement) => {
    expect(() => evaluatePolicies(policy(requirement), 'claim', { 'economy.ready': true })).toThrow(/unavailable/);
  });

  it('rejects a type mismatch rather than allowing negation', () => {
    const rules = policy({ not: { fact: 'economy.remaining', op: 'gte', value: 1 } });
    expect(() => evaluatePolicies(rules, 'claim', { 'economy.remaining': '10' })).toThrow(/different type/);
  });

  it.each(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in'])('supports bounded scalar predicate %s', (op) => {
    const value = op === 'in' ? [2, 3] : ['ne', 'lt', 'lte'].includes(op) ? 3 : op === 'gt' ? 1 : 2;
    expect(evaluatePolicies(policy({ fact: 'economy.remaining', op, value }), 'claim', { 'economy.remaining': 2 })).toBeUndefined();
  });

  it('a failed requirement adds a refusal and other hook points are unaffected', () => {
    const rules = policy({ fact: 'economy.remaining', op: 'gte', value: 1 });
    expect(evaluatePolicies(rules, 'claim', { 'economy.remaining': 0 })).toMatchObject({ policy: 'capacity', code: 'policy_failed' });
    expect(evaluatePolicies(rules, 'claim', { 'economy.remaining': 0 })?.message).toContain('economy.remaining');
    expect(evaluatePolicies(rules, 'stop', {})).toBeUndefined();
  });
});

describe('Real pure Wasm hooks', () => {
  it.each(['pass', 'signal', 'deny'])('composes %s with core-bound provenance', async (value) => {
    const p = await pluginProject({ output: { decision: value }, facts: { remaining: 5 } }, { hooks: { claim: 'read' } });
    const checked = await evaluateHooks(p.root, p.config, 'claim', { task: 'example#1.1' }, p.actor);
    expect(checked.verdict.decision).toBe(value);
    expect(checked.facts).toEqual({ 'economy.remaining': 5 });
    if (value !== 'pass') expect(checked.verdict.plugin).toMatchObject({ name: 'economy', digest: p.snapshot.digest });
  });

  it('unknown allow override and persistent effects are faults, not permission', async () => {
    const p = await pluginProject({ output: { decision: 'allow' } }, { hooks: { claim: 'read' } });
    await expect(evaluateHooks(p.root, p.config, 'claim', {}, p.actor)).rejects.toMatchObject({ code: 'plugin_hook' });
    const q = await pluginProject({ output: { decision: 'pass' }, state: { forged: true } }, { hooks: { claim: 'read' } });
    await expect(evaluateHooks(q.root, q.config, 'claim', {}, q.actor)).rejects.toMatchObject({ code: 'plugin_effect' });
  });
});
