import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.1: `sdlc mcp check --strict` exits 1 when a server of the registry cannot be reached, so a CI step can fail
 * on it without parsing the JSON. Without `--strict` the exit code is 0 as before (the JSON and the text still name
 * the unreachable server).
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

function project() {
  const root = tempDir('sdlc-mcp-strict-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', FAKE], stages: ['test'] } } };
  write(file, stringify(config));
  return cli;
}

describe('sdlc mcp check --strict', () => {
  it('exits 1 when a server is unreachable, and names it', () => {
    const cli = project();
    const r = cli(['mcp', 'check', '--strict', '--json'], { FAKE_EXIT: '1' });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('build');
  }, 120000);

  it('negative: exits 0 when every server answers', () => {
    const cli = project();
    expect(cli(['mcp', 'check', '--strict', '--json']).code).toBe(0);
  }, 120000);

  it('negative: without --strict an unreachable server still exits 0, as before', () => {
    const cli = project();
    expect(cli(['mcp', 'check', '--json'], { FAKE_EXIT: '1' }).code).toBe(0);
  }, 120000);
});
