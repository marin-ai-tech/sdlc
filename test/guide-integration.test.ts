import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.9.1: the agent can be asked how sdlc works. A `guide` workflow (skill `sdlc-guide`, commands) is loaded on demand;
 * the session start tells the agent it can be asked; every hook denial names the guide section for its rule; and the
 * sdlc MCP server offers the guide as a tool, so other clients can consult it too.
 */

function project(mode: 'warn' | 'block' = 'block') {
  const root = tempDir('sdlc-guide-int-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.enforcement.mode = mode;
  write(file, stringify(config));
  const hook = (event: string, input: Record<string, unknown>) =>
    runCli(['hook', event], root, env, JSON.stringify({ cwd: root, ...input })).stdout;
  return { root, env, hook, file: (rel: string) => read(path.join(root, rel)) };
}

describe('the guide in the agent', () => {
  it('is a workflow both tools load on demand', () => {
    const p = project();
    const skill = p.file('.claude/skills/sdlc-guide/SKILL.md');
    expect(skill).toMatch(/^description: .*(how|sdlc)/im);
    expect(skill).toContain('sdlc guide');
    expect(p.file('.opencode/commands/sdlc-guide.md')).toContain('sdlc guide');
    expect(p.file('.claude/commands/sdlc/guide.md')).toContain('sdlc guide');
  }, 120000);

  it('the session start says the agent can be asked', () => {
    const p = project();
    expect(p.hook('session-start', { source: 'startup' })).toContain('sdlc guide');
  }, 120000);

  it('a denial names the guide section of its rule', () => {
    const p = project('block');
    const out = p.hook('pre-tool', { tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'src/app.js') } });
    expect(out).toContain('plan-gate');
    expect(out).toContain('sdlc guide denials#plan-gate');
    const state = p.hook('pre-tool', {
      tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'openspec/roles.yaml') },
    });
    expect(state).toContain('sdlc guide denials#state-integrity');
  }, 120000);
});

describe('the guide over MCP', () => {
  it('the sdlc server offers a guide tool that answers like sdlc guide --json', async () => {
    const p = project();
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BIN, 'mcp', 'serve'], cwd: p.root, env: p.env as Record<string, string>,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'sdlc-test', version: '0.0.0' });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain('guide');
      const result = await client.callTool({ name: 'guide', arguments: { topic: 'gates' } });
      const cli = runCli(['guide', 'gates', '--json'], p.root, p.env).json();
      expect(result.structuredContent).toEqual(cli);
    } finally {
      await client.close();
    }
  }, 120000);
});
