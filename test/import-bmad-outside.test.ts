import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * B91 (0.15.4): `sdlc import bmad` with a path outside the project is refused for what it is, in both modes, through
 * the one "inside the root" check. `--to-backlog` used to say "No BMAD artifacts found."; `--change` read the folder
 * outside the project and imported it.
 */

const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/bmad/claims');

function project() {
  const base = tempDir('sdlc-bmad-outside-');
  const root = path.join(base, 'app');
  fs.mkdirSync(root);
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const outside = path.join(base, 'planning');
  fs.mkdirSync(outside);
  for (const file of fs.readdirSync(FIXTURES)) fs.copyFileSync(path.join(FIXTURES, file), path.join(outside, file));
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, outside, cli };
}

describe('B91: a BMAD folder outside the project', () => {
  it('--to-backlog is refused as outside the project, naming the path', () => {
    const p = project();
    const r = p.cli(['import', 'bmad', '../planning', '--to-backlog', '--json']);
    expect(r.code).not.toBe(0);
    const status = r.json().status[0];
    expect(status.code).toBe('path_outside_project');
    expect(status.message).toContain('planning');
    expect(status.message).not.toMatch(/No BMAD artifacts found/);
  }, 120000);

  it('--change is refused as outside the project and creates nothing', () => {
    const p = project();
    const r = p.cli(['import', 'bmad', p.outside, '--change', 'claims-status', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('path_outside_project');
    expect(fs.existsSync(path.join(p.root, 'openspec/changes/claims-status'))).toBe(false);
  }, 120000);

  it('negative: a missing folder inside the project still says no BMAD artifacts were found', () => {
    const p = project();
    const r = p.cli(['import', 'bmad', '_bmad-output/none', '--to-backlog', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('no_bmad_artifacts');
  }, 120000);
});
