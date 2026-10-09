import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.0 (B76, the part of B18 the agent team needs): packs bring roles and skills. `packs` in openspec/sdlc.yaml
 * lists `{ name, git, ref }` (a repository at a pinned tag or commit) or `{ name, npm }` (an npm spec). A pack holds
 * `roles/<id>.md` (or `roles/<locale>/<id>.md`) and `skills/<id>/…`. `sdlc team sync` reads the registry first, then
 * the packs, then the built-ins; a draft records the pack, its ref and the commit (or the npm integrity). No code of
 * a pack ever runs (no npm scripts), skill paths are vetted like registry skills (git cannot hold a `..` path; the
 * registry test covers it), and an unreachable pack is reported without failing the sync.
 */

const ANALYST = [
  '---', 'id: analyst', 'title: Corp analyst', 'description: The corporate analyst.', 'stages: [plan, design]',
  'tools: [read, grep, glob, bash, edit, write]', 'readonly: false', 'skills: [domain-terms]', '---',
  '# Role: corp analyst', '', 'Use the corporate glossary.', '{{artifacts}}', '{{project}}', '',
].join('\n');

function gitPack(): { url: string; commit: string } {
  const dir = tempDir('sdlc-pack-git-');
  initGitRepo(dir);
  write(path.join(dir, 'roles/analyst.md'), ANALYST);
  write(path.join(dir, 'skills/domain-terms/SKILL.md'), '---\nname: domain-terms\ndescription: The glossary\n---\nTerms.\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'pack']);
  git(dir, ['tag', 'v1']);
  const commit = runGit(dir, ['rev-parse', 'HEAD']);
  return { url: `file:///${dir.replace(/\\/g, '/').replace(/^\//, '')}`, commit };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/**
 * An npm pack as a tarball, made with `tar` (npm itself would run the prepare script while packing). Its scripts
 * would write the marker if anything ran them.
 */
function npmPack(): { dir: string; tgz: string; marker: string } {
  const stage = tempDir('sdlc-pack-npm-');
  const dir = path.join(stage, 'package');
  const marker = path.join(tempDir('sdlc-pack-marker-'), 'ran.txt');
  const script = `node -e "require('fs').writeFileSync(process.argv[1], 'ran')" ${JSON.stringify(marker)}`;
  write(path.join(dir, 'package.json'), JSON.stringify({
    name: 'corp-sdlc-pack', version: '1.2.0', files: ['roles', 'skills'],
    scripts: { prepack: script, prepare: script, postinstall: script },
  }));
  write(path.join(dir, 'roles/architect.md'), ANALYST.replace(/analyst/g, 'architect'));
  execFileSync('tar', ['-czf', 'corp-sdlc-pack-1.2.0.tgz', 'package'], { cwd: stage });
  return { dir, tgz: path.join(stage, 'corp-sdlc-pack-1.2.0.tgz'), marker };
}

function project(packs: unknown[]) {
  const root = tempDir('sdlc-team-packs-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.packs = packs;
  write(file, stringify(config));
  return { root, cli, text: (rel: string) => read(path.join(root, rel)), exists: (rel: string) => fs.existsSync(path.join(root, rel)) };
}

describe('packs', () => {
  it('a git pack at a pinned ref brings roles and skills; the draft records the pack and the commit', () => {
    const pack = gitPack();
    const p = project([{ name: 'corp', git: pack.url, ref: 'v1' }]);
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const draft = p.text('docs/agents/drafts/analyst.md');
    expect(draft).toContain('Use the corporate glossary.');
    expect(draft).toMatch(/kind: pack/);
    expect(draft).toContain(pack.commit);
    expect(p.text('docs/agents/drafts/tester.md')).not.toContain('corporate');
    expect(p.cli(['team', 'accept', 'analyst', '--json']).code).toBe(0);
    expect(p.text('.claude/skills/domain-terms/SKILL.md')).toContain('Terms.');
  }, 240000);

  it('an npm pack brings roles, and no script of the pack ever runs', () => {
    // 0.14.4: a folder is no longer an npm pack source (npm 10 runs its prepare script); the tarball is.
    const pack = npmPack();
    const p = project([{ name: 'corp-npm', npm: pack.tgz }]);
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.text('docs/agents/drafts/architect.md')).toMatch(/kind: pack/);
    expect(fs.existsSync(pack.marker)).toBe(false);
  }, 240000);

  it('negative: an unreachable pack is reported and the built-ins fill in', () => {
    const p = project([{ name: 'gone', git: 'file:///C:/no/such/pack', ref: 'v1' }]);
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.stringify(r.json())).toContain('gone');
    expect(p.exists('docs/agents/drafts/analyst.md')).toBe(true);
    expect(p.text('docs/agents/drafts/analyst.md')).toMatch(/kind: builtin/);
  }, 180000);
});
