import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * People annotate openspec/sdlc.yaml. Commands that change settings (adopt --apply, license set, init again, layout
 * adapt) must change the keys they own and keep the comments, the unknown keys and the order of the rest.
 */

const TEAM_COMMENT = '# Team: keep warn mode until the pilot ends (Dana, 2026-10).';
const INLINE_COMMENT = 'schema: sdlc  # the default schema, do not change';
const UNKNOWN_KEY = 'x_team:\n  owner: dana';

function project() {
  const root = tempDir('sdlc-config-keep-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const text = read(file)
    .replace('version: 1\n', `${TEAM_COMMENT}\nversion: 1\n`)
    .replace('schema: sdlc\n', `${INLINE_COMMENT}\n`);
  write(file, `${text}${UNKNOWN_KEY}\n`);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { lint: 'eslint .' } }));
  return { root, cli, read: () => read(file) };
}

function expectAnnotationsKept(text: string): void {
  expect(text).toContain(TEAM_COMMENT);
  // The YAML writer normalizes the spaces before an inline comment; the comment itself must stay on its key.
  expect(text).toMatch(/^schema: sdlc +# the default schema, do not change$/m);
  expect(text).toContain(UNKNOWN_KEY);
}

describe('settings writes keep what people wrote in sdlc.yaml', () => {
  it('adopt --apply adds its keys and keeps comments and unknown keys', () => {
    const p = project();
    const r = p.cli(['adopt', '--apply', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expectAnnotationsKept(p.read());
    const runs = parse(p.read()).verify.commands.map((c: { run: string }) => c.run);
    expect(runs).toContain('npm run lint');
  });

  it('license set, init again and layout adapt keep them too', () => {
    const p = project();
    const license = p.cli(['license', 'set', 'commercial', '--agreement', 'A-1', '--licensee', 'Acme', '--json']);
    expect(license.code, license.stderr + license.stdout).toBe(0);
    expectAnnotationsKept(p.read());
    expect(parse(p.read()).license).toMatchObject({ type: 'commercial', agreement: 'A-1' });
    expect(p.cli(['init', '--tools', 'opencode', '--mode', 'block', '--json']).code).toBe(0);
    expectAnnotationsKept(p.read());
    expect(parse(p.read()).enforcement.mode).toBe('block');
    write(path.join(p.root, 'ARCHITECTURE.md'), '# Architecture\n');
    expect(p.cli(['layout', 'adapt', '--json']).code).toBe(0);
    expectAnnotationsKept(p.read());
    expect(parse(p.read()).layout.architecture).toBe('ARCHITECTURE.md');
  });

  it('negative: the unknown key stays unknown, and a write with nothing new changes no byte', () => {
    const p = project();
    expect(p.cli(['adopt', '--apply', '--json']).code).toBe(0);
    const once = p.read();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(p.read()).toBe(once);
    expect(p.cli(['doctor', '--json']).code).toBe(0);
  });
});
