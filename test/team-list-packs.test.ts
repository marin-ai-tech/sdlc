import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * A gap found by the 0.20.0 course audit: `sdlc team list` did not show packs, so nobody could see which pack waits
 * for acceptance or is in effect. Since 0.20.1 it lists every pack of sdlc.yaml (JSON `packs`): whether it is synced,
 * whether it is in effect, its lenses, workflows and checks, and its problems; the text says how to accept a pack that
 * waits.
 */

function gitPack(): { url: string; commit: string } {
  const dir = tempDir('sdlc-list-pack-');
  initGitRepo(dir);
  write(path.join(dir, 'lenses/privacy.md'), '# Privacy\n\nPersonal data in logs.\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'pack']);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
  return { url: `file:///${dir.replace(/\\/g, '/').replace(/^\//, '')}`, commit };
}

function project(packs: unknown[] | undefined) {
  const root = tempDir('sdlc-team-list-packs-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (packs) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.packs = packs;
    write(file, stringify(config));
  }
  return { cli };
}

describe('sdlc team list shows the packs', () => {
  it('declared, synced, waiting for a person, then in effect', () => {
    const pack = gitPack();
    const p = project([{ name: 'corp', git: pack.url, ref: pack.commit }]);
    expect(p.cli(['team', 'list', '--json']).json().packs).toEqual([
      expect.objectContaining({ name: 'corp', synced: false, inEffect: false }),
    ]);
    p.cli(['team', 'sync', '--json']);
    const waiting = p.cli(['team', 'list', '--json']).json().packs[0];
    expect(waiting).toMatchObject({ name: 'corp', synced: true, inEffect: false, lenses: ['corp-privacy'] });
    expect(p.cli(['team', 'list']).stdout).toContain('sdlc team accept --pack corp');
    expect(p.cli(['team', 'accept', '--pack', 'corp', '--json']).code).toBe(0);
    const accepted = p.cli(['team', 'list', '--json']).json().packs[0];
    expect(accepted).toMatchObject({ name: 'corp', inEffect: true, lenses: ['corp-privacy'] });
    expect(p.cli(['team', 'list']).stdout).toMatch(/corp[^\n]*corp-privacy/);
  }, 300000);

  it('negative: a project without packs lists none and prints no packs block', () => {
    const p = project(undefined);
    expect(p.cli(['team', 'list', '--json']).json().packs).toEqual([]);
    expect(p.cli(['team', 'list']).stdout).not.toMatch(/accept --pack/);
  }, 120000);
});
