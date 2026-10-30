import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { loadConfig } from '../dist/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../dist/core/policy.js';
import { projectPaths } from '../dist/core/project.js';
import { pluginProject } from './fixtures/plugin-project.js';
import { humanEnv, runCli, tempDir } from './helpers.js';

type Project = Awaited<ReturnType<typeof pluginProject>>;

function configure(p: Project, mode: 'block' | 'warn') {
  const raw = p.raw as Record<string, any>;
  raw.enforcement.mode = mode;
  raw.log.enabled = false;
  raw.log.hook_decisions = false;
  fs.writeFileSync(p.file, stringify(raw));
}

function preTool(p: Project, tool: string, input: Record<string, unknown>, agent = 'claude') {
  const answer = runCli(['hook', 'pre-tool', '--agent', agent], p.root,
    humanEnv(tempDir('sdlc-plugin-policy-agent-'), { SDLC_AGENT: 'guard-test' }),
    JSON.stringify({ cwd: p.root, tool_name: tool, tool_input: input, skip_log: true }));
  expect(answer.code, answer.stderr).toBe(0);
  expect(answer.stdout.trim(), `A hook must answer explicitly: ${answer.stderr}`).not.toBe('');
  return answer.json().hookSpecificOutput;
}

describe('Plugin faults preserve real pre-tool guard decisions', () => {
  it.each(['missing', 'unaccepted', 'changed', 'revoked'] as const)
    ('keeps core denials and closes dynamic discovery failure for %s packages', async (status) => {
      const p = await pluginProject({ output: 1 }, {}, {}, status !== 'unaccepted');
      if (status === 'missing') (p.raw.plugins as any).economy.package = 'missing-package';
      if (status === 'changed') fs.writeFileSync(path.join(p.root, p.p.source, 'changed.txt'), 'changed');
      if (status === 'revoked') expect(p.cli(['plugins', 'revoke', 'economy', '--json']).code).toBe(0);
      configure(p, 'block');
      const config = loadConfig(p.file);
      const core = { ...config, plugins: {} };
      const protectedFiles = [p.file, path.join(p.root, 'openspec/.sdlc/plugins/registry.json'),
        path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json')];
      const before = protectedFiles.map((file) => fs.existsSync(file) ? fs.readFileSync(file) : undefined);
      for (const command of ['sdlc approve plan --change demo',
        'echo forged > openspec/.sdlc/plugins/registry.json', 'echo forged > openspec/roles.yaml']) {
        const baseline = evaluateToolCall(normalizeToolCall('Bash', { command }, p.root),
          { paths: projectPaths(p.root), config: core });
        expect(baseline.decision).toBe('deny');
        for (const agent of ['claude', 'codex']) {
          const answer = preTool(p, 'Bash', { command }, agent);
          expect(answer.permissionDecision).toBe('deny');
          expect(answer.permissionDecisionReason).toContain(`[sdlc:${baseline.rule}]`);
        }
      }
      const fault = preTool(p, 'Bash', { command: 'echo harmless' });
      expect(fault.permissionDecision).toBe('deny');
      expect(fault.permissionDecisionReason).toContain('[sdlc:plugin]');
      expect(fault.permissionDecisionReason).not.toContain(p.root);
      expect(protectedFiles.map((file) => fs.existsSync(file) ? fs.readFileSync(file) : undefined)).toEqual(before);
    });

  it.each(['missing-fact', 'fault', 'pass'] as const)
    ('checks %s restrictions for native and shell edits after a soft core warning', async (outcome) => {
      const response = outcome === 'fault' ? { output: { decision: 'invalid' } }
        : { output: { decision: 'pass' }, ...(outcome === 'pass' ? { facts: { ready: true } } : {}) };
      const p = await pluginProject(response, { hooks: { file_edit: 'read' } });
      (p.raw as any).plugin_policies = [{ id: 'edit-ready', hook: 'file_edit',
        require: { fact: 'economy.ready', op: 'eq', value: true }, reason: 'Ready fact is required' }];
      configure(p, 'warn');
      const store = path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json');
      const before = fs.readFileSync(store);
      const calls: Array<[string, Record<string, unknown>]> = [
        ['Edit', { file_path: 'src/blocked.ts', old_string: 'old', new_string: 'new' }],
        ['Bash', { command: 'echo changed > src/blocked.ts' }],
      ];
      for (const [tool, input] of calls) {
        const answer = preTool(p, tool, input);
        if (outcome === 'pass') {
          expect(answer.permissionDecision).not.toBe('deny');
          expect(answer.additionalContext).toContain('[sdlc:plan-gate]');
        } else {
          expect(answer.permissionDecision).toBe('deny');
          expect(answer.permissionDecisionReason).toContain('[sdlc:plugin]');
          if (outcome === 'missing-fact') expect(answer.permissionDecisionReason).toContain('plugin_fact_missing');
        }
      }
      expect(fs.readFileSync(store)).toEqual(before);
    });
});
