import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B96 (0.16.0): `sdlc mcp check` lists the tools of each server but not their arguments, so a person writing a
 * `verify.mcp` check had to guess the argument names. The JSON now gives each tool's arguments from its input schema
 * (`args`: tool → [{ name, type, required }]); `--args` prints them in text, one tool per line, an optional
 * argument with `?`. `tools` (the list of names) and the default text are unchanged.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

function project() {
  const root = tempDir('sdlc-mcp-args-');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_FILES: '1' });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', FAKE], stages: ['test'] } } };
  write(file, stringify(config));
  return cli;
}

describe('B96: sdlc mcp check shows the tool arguments', () => {
  it('JSON: args per tool from the input schema; tools stays the list of names', () => {
    const cli = project();
    const r = cli(['mcp', 'check', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const server = r.json().servers[0];
    expect(server.tools).toEqual(['pipeline_status', 'write_file']);
    expect(server.args.pipeline_status).toEqual([{ name: 'ref', type: 'string', required: true }]);
    expect(server.args.write_file).toEqual([
      { name: 'path', type: 'string', required: false },
      { name: 'content', type: 'string', required: false },
    ]);
  }, 120000);

  it('text with --args: one tool per line, optional arguments marked', () => {
    const cli = project();
    const r = cli(['mcp', 'check', '--args']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('pipeline_status(ref: string)');
    expect(r.stdout).toContain('write_file(path?: string, content?: string)');
  }, 120000);

  it('negative: the default text still lists names only', () => {
    const cli = project();
    const r = cli(['mcp', 'check']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('pipeline_status');
    expect(r.stdout).not.toContain('ref: string');
  }, 120000);
});
