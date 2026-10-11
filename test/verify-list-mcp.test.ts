import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.0: `sdlc verify --list` shows every check the verify gate runs — the commands and the `verify.mcp` checks
 * (name, server, tool, whether it is required). Before, it listed the commands only, so a person could not see from
 * the CLI that the gate also waits for CI.
 */

function project() {
  const root = tempDir('sdlc-verify-list-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', 'build-mcp.js'], stages: ['test'] } } };
  config.verify.commands = [{ name: 'test', run: 'npm test' }];
  config.verify.mcp = [
    { name: 'ci-green', server: 'build', tool: 'pipeline_status', args: { ref: '${HEAD}' },
      expect: { status: 'success' } },
    { name: 'coverage', server: 'build', tool: 'coverage', expect: { ok: true }, required: false },
  ];
  write(file, stringify(config));
  return cli;
}

describe('sdlc verify --list', () => {
  it('lists the commands and the MCP checks, with server, tool and whether each is required', () => {
    const cli = project();
    const json = cli(['verify', '--list', '--json']);
    expect(json.code, json.stdout + json.stderr).toBe(0);
    const text = JSON.stringify(json.json());
    expect(text).toContain('npm test');
    expect(text).toContain('ci-green');
    expect(text).toContain('pipeline_status');
    const checks = JSON.parse(text);
    const mcp = (checks.mcp ?? []) as Array<{ name: string; server: string; tool: string; required: boolean }>;
    expect(mcp).toEqual([
      expect.objectContaining({ name: 'ci-green', server: 'build', tool: 'pipeline_status', required: true }),
      expect.objectContaining({ name: 'coverage', server: 'build', tool: 'coverage', required: false }),
    ]);
    const plain = cli(['verify', '--list']).stdout;
    expect(plain).toContain('npm test');
    expect(plain).toMatch(/ci-green.*build.*pipeline_status/);
  }, 120000);

  it('negative: --list runs nothing and calls no server', () => {
    const cli = project();
    const r = cli(['verify', '--list', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.stringify(r.json())).not.toMatch(/unreachable|passed|failed/);
  }, 120000);
});
