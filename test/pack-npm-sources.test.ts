import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.14.4: npm 10 runs a package's `prepare` script when `npm pack` is given a folder or a git spec, even with
 * `--ignore-scripts` (seen in CI on npm 10.9.9; npm 11 does not). "No code of a pack runs" (B76) must hold on every
 * npm, so an npm pack is only a registry package (`name`, `name@1.2.3`, `@scope/name@^1`) or a `.tgz` — sources npm
 * never runs scripts for. A folder or a repository is refused when the configuration is read, with a hint to use a
 * `git:` pack instead.
 */

function project(npm: string) {
  const root = tempDir('sdlc-pack-npm-src-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.packs = [{ name: 'corp', npm }];
  write(file, stringify(config));
  return { root, cli };
}

describe('npm pack sources', () => {
  const folder = tempDir('sdlc-pack-folder-');
  for (const spec of [folder, './packs/corp', 'file:../corp-pack', 'github:corp/sdlc-pack', 'corp/sdlc-pack',
    'git+https://example.com/corp/pack.git', 'git+ssh://git@example.com/corp/pack.git', 'gitlab:corp/pack']) {
    it(`refuses ${spec}: a folder or a repository is not an npm pack`, () => {
      const p = project(spec);
      const r = p.cli(['status', '--json']);
      expect(r.code).toBe(1);
      const status = r.json().status[0];
      expect(status.code).toBe('invalid_config');
      expect(JSON.stringify(status)).toContain('packs[0].npm');
      expect(JSON.stringify(status)).toMatch(/git:/);
    }, 120000);
  }

  for (const spec of ['corp-sdlc-pack', 'corp-sdlc-pack@1.2.0', '@corp/sdlc-pack@^1.2.0', '@corp/sdlc-pack@latest',
    './dist/corp-sdlc-pack-1.2.0.tgz', 'https://example.com/corp-sdlc-pack-1.2.0.tgz']) {
    it(`negative: accepts ${spec}`, () => {
      const p = project(spec);
      expect(p.cli(['status', '--json']).code).toBe(0);
    }, 120000);
  }

  it('a folder whose name ends in .tgz is not fetched, and nothing of it runs', () => {
    const stage = tempDir('sdlc-pack-fake-tgz-');
    const dir = path.join(stage, 'corp.tgz');
    const marker = path.join(tempDir('sdlc-pack-marker-'), 'ran.txt');
    const script = `node -e "require('fs').writeFileSync(process.argv[1], 'ran')" ${JSON.stringify(marker)}`;
    const manifest = { name: 'corp', version: '1.0.0', scripts: { prepare: script } };
    write(path.join(dir, 'package.json'), JSON.stringify(manifest));
    write(path.join(dir, 'roles/architect.md'), '# not used\n');
    const p = project(dir);
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.stringify(r.json())).toContain('corp');
    expect(fs.existsSync(marker)).toBe(false);
    expect(read(path.join(p.root, 'docs/agents/drafts/architect.md'))).toMatch(/kind: builtin/);
  }, 180000);
});
