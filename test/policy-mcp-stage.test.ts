import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { harnessHooks } from '../src/integrations/settings.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B43: the hook sees MCP tool calls. A call to a server of the registry (`mcp.servers`) whose `stages` do not include
 * the stage of any active change is denied in `block` and reminded in `warn` (rule `mcp-stage`, a process rule).
 * Claude Code names the tool `mcp__<server>__<tool>`, OpenCode `<server>_<tool>`. The sdlc server itself and servers
 * outside the registry are not governed; without an active change there is no stage to judge by.
 */

const SERVERS = {
  build: { type: 'stdio', command: ['node', 'build-mcp.js'], stages: ['build', 'test'] },
  jira: { type: 'http', url: 'https://mcp.corp.example/jira', stages: ['plan', 'deploy'] },
};

function project(mode: 'warn' | 'block', withChange = true) {
  const root = tempDir('sdlc-mcp-stage-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: SERVERS };
  config.enforcement.mode = mode;
  write(file, stringify(config));
  // A new change waits for its intent: its stage is `plan`.
  if (withChange) expect(runCli(['new', 'add-export', '--json'], root, env).code).toBe(0);
  const call = (tool: string, agent: 'claude' | 'opencode' = 'claude') => {
    const input = JSON.stringify({ cwd: root, session_id: `s-${Math.random()}`, tool_name: tool, tool_input: {} });
    const args = ['hook', 'pre-tool', ...(agent === 'opencode' ? ['--agent', 'opencode'] : [])];
    return runCli(args, root, env, input).stdout;
  };
  return { call };
}

describe('MCP calls by stage', () => {
  it('denies a registry server the current stage does not allow, in block mode', () => {
    const p = project('block');
    const out = p.call('mcp__build__pipeline_status');
    expect(out).toContain('"permissionDecision":"deny"');
    expect(out).toContain('mcp-stage');
    expect(out).toContain('build');
    const opencode = p.call('build_pipeline_status', 'opencode');
    expect(opencode).toContain('"decision":"deny"');
  }, 120000);

  it('reminds in warn mode', () => {
    const out = project('warn').call('mcp__build__pipeline_status');
    expect(out).toContain('additionalContext');
    expect(out).toContain('mcp-stage');
    expect(out).not.toContain('"deny"');
  }, 120000);

  it('negative: an allowed server, the sdlc server, unknown servers and no active change pass', () => {
    const p = project('block');
    for (const tool of ['mcp__jira__search', 'mcp__sdlc__status', 'mcp__other__anything']) {
      expect(p.call(tool), tool).not.toContain('deny');
    }
    expect(p.call('jira_search', 'opencode')).not.toContain('"deny"');
    expect(project('block', false).call('mcp__build__pipeline_status')).not.toContain('deny');
  }, 180000);
});

describe('the Claude Code PreToolUse matcher', () => {
  it('covers MCP tools', () => {
    const matcher = String(harnessHooks('sdlc').PreToolUse[0].matcher);
    expect(new RegExp(`^(?:${matcher})$`).test('mcp__build__pipeline_status')).toBe(true);
    expect(new RegExp(`^(?:${matcher})$`).test('Read')).toBe(false);
  });
});
