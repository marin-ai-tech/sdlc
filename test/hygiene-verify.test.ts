import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.2, process hygiene — verification (docs/ru/22, B57, B58).
 * B57: `sdlc verify` warns about files the plan lists under "Files that change" that were not touched (JSON
 *      `planDrift.untouched`, and in verification.md); a warning, not a failure.
 * B58: verification.md has a "Not run / limits" section, and the files in the change's `verification/` folder are
 *      listed in the evidence as links.
 */

const PLAN = [
  '# Plan', '', 'Context: `docs/context.md` explains the area.', '',
  '## Files that change', '- `src/a.js` (new)', '- `src/b.js` (new)', '- `openspec/specs/x/spec.md`', '',
  '## Order of work', '1. Do.', '',
  '## Proof', '`node -e 0`', '', '## Rollback', 'Revert.', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-hygiene-verify-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  config.review.base = 'main';
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'setup']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  const change = (rel: string) => path.join(root, 'openspec/changes/demo', rel);
  write(change('plan.md'), PLAN);
  write(change('tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  write(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'a only']);
  const verify = () => {
    const r = cli(['verify', '--change', 'demo', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json();
  };
  return { root, verify, change, evidence: () => read(change('verification.md')) };
}

describe('B57: planned files must change', () => {
  it('verify warns about a planned file nobody touched, and still passes', () => {
    const p = project();
    const out = p.verify();
    expect(out.status).toBe('passed');
    expect(out.planDrift.untouched).toEqual(['src/b.js']);
    expect(p.evidence()).toContain('src/b.js');
  }, 180000);

  it('negative: a touched planned file is not reported', () => {
    const p = project();
    expect(p.verify().planDrift.untouched).not.toContain('src/a.js');
  }, 180000);

  // Review of 0.11.2: only "Files that change" counts, openspec/ is never in the diff, and work on the base itself
  // has nothing to compare with.
  it('negative: context paths, openspec/ paths and work on the base branch are not reported', () => {
    const p = project();
    const untouched = p.verify().planDrift.untouched;
    expect(untouched).not.toContain('docs/context.md');
    expect(untouched).not.toContain('openspec/specs/x/spec.md');
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'evidence']);
    git(p.root, ['checkout', '-q', 'main']);
    git(p.root, ['merge', '-q', '--ff-only', 'feature']);
    expect(p.verify().planDrift.untouched).toEqual([]);
  }, 180000);
});

describe('B58: limits and attachments', () => {
  it('the evidence has a Not run section and lists the verification/ attachments', () => {
    const p = project();
    write(p.change('verification/login.png'), 'png');
    write(p.change('verification/browser-results.json'), '{}');
    p.verify();
    const evidence = p.evidence();
    expect(evidence).toMatch(/## Not run/);
    expect(evidence).toContain('verification/login.png');
    expect(evidence).toContain('verification/browser-results.json');
  }, 180000);

  it('negative: without a verification/ folder no attachments are listed', () => {
    const p = project();
    p.verify();
    expect(fs.existsSync(p.change('verification'))).toBe(false);
    expect(p.evidence()).not.toContain('verification/');
  }, 180000);
});
