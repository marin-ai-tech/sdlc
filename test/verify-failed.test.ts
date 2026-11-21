import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B282 (E25): `sdlc verify --failed` reruns only the checks that did not pass, on the same fingerprint and the same
 * commands, and is refused otherwise. Each result records the fingerprint, the run id and its attempt; the gate
 * passes when every configured check passed on the current fingerprint, even from several runs. A stable check that
 * fails again keeps the gate failed; an old record without per-result fields reads as one run.
 */

const AGENT = { CLAUDECODE: '1' };

/** Scripts outside the project: each appends its name to a run log; `flaky` fails once, `broken` always. */
function scripts() {
  const dir = tempDir('sdlc-failed-scripts-');
  const runlog = path.join(dir, 'runs.txt').replace(/\\/g, '/');
  const marker = path.join(dir, 'flaky-ran-once').replace(/\\/g, '/');
  const script = (name: string, body: string[]) => {
    const file = path.join(dir, `${name}.cjs`);
    write(file, ["const fs = require('fs');", `fs.appendFileSync(${JSON.stringify(runlog)}, '${name}\\n');`, ...body,
      ''].join('\n'));
    return `node "${file.replace(/\\/g, '/')}"`;
  };
  return {
    ok: script('stable', ['process.exit(0);']),
    flaky: script('unstable', [
      `if (fs.existsSync(${JSON.stringify(marker)})) process.exit(0);`,
      `fs.writeFileSync(${JSON.stringify(marker)}, '1');`,
      'process.exit(1);',
    ]),
    broken: script('broken', ['process.exit(1);']),
    runs: () => (fs.existsSync(runlog) ? read(runlog).trim().split('\n').filter(Boolean) : []),
  };
}

function project(commands: (s: ReturnType<typeof scripts>) => Array<{ name: string; run: string }>) {
  const root = tempDir('sdlc-failed-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const s = scripts();
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (argv: string[]) => runCli(argv, root, { ...env, ...AGENT });
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  expect(runCli(['new', 'add-export', '--json'], root, env).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = commands(s).map((c) => ({ ...c, required: true }));
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const verify = (extra: string[] = []) => cli(['verify', '--change', 'add-export', ...extra, '--json']);
  const view = () => {
    const status = cli(['status', '--change', 'add-export', '--json']).json();
    return (status.change ?? status).verification as { status: string };
  };
  const row = (name: string) => read(path.join(root, 'openspec/changes/add-export/verification.md'))
    .split('\n').find((line) => line.startsWith(`| ${name} `)) ?? '';
  const state = path.join(root, 'openspec/changes/add-export/.sdlc.yaml');
  return { root, file, s, verify, view, row, state };
}

const stableAndFlaky = (s: ReturnType<typeof scripts>) => [{ name: 'stable', run: s.ok }, { name: 'unstable', run: s.flaky }];

describe('B282: only the failed checks are rerun, on request', () => {
  it('F1: a failed check is rerun alone, the gate passes on two runs, and the row names the attempt', () => {
    const p = project(stableAndFlaky);
    expect(p.verify().json().status).toBe('failed');
    expect(p.s.runs()).toEqual(['stable', 'unstable']);
    const r = p.verify(['--failed']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().status).toBe('passed');
    expect(p.s.runs()).toEqual(['stable', 'unstable', 'unstable']);
    expect(p.view().status).toBe('passed');
    expect(p.row('unstable')).toMatch(/attempt 2/);
    expect(p.row('stable')).not.toMatch(/attempt/);
  }, 240000);

  it('F2: an edit after the failed run refuses the rerun, and nothing runs', () => {
    const p = project(stableAndFlaky);
    p.verify();
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    const r = p.verify(['--failed']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/fingerprint/i);
    expect(p.s.runs()).toEqual(['stable', 'unstable']);
  }, 240000);

  it('F3: a changed command of a passed check refuses the rerun naming the check', () => {
    const p = project(stableAndFlaky);
    p.verify();
    const config = parse(read(p.file));
    config.verify.commands[0].run = `${config.verify.commands[0].run} --changed`;
    write(p.file, stringify(config));
    const r = p.verify(['--failed']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('stable');
    expect(p.s.runs()).toEqual(['stable', 'unstable']);
  }, 240000);

  it('F4: without a recorded run, and together with --only, --failed is refused', () => {
    const p = project(stableAndFlaky);
    const first = p.verify(['--failed']);
    expect(first.code).not.toBe(0);
    expect(first.stdout + first.stderr).not.toMatch(/unknown option/);
    p.verify();
    const both = p.verify(['--failed', '--only', 'unstable']);
    expect(both.code).not.toBe(0);
    expect(both.stdout + both.stderr).not.toMatch(/unknown option/);
    expect(p.s.runs()).toEqual(['stable', 'unstable']);
  }, 240000);
});

describe('B282: the gate over several runs', () => {
  it('F5: a stable check that fails again keeps the gate failed', () => {
    const p = project((s) => [{ name: 'stable', run: s.ok }, { name: 'broken', run: s.broken }]);
    p.verify();
    const r = p.verify(['--failed']);
    expect(r.json().status).toBe('failed');
    expect(p.s.runs()).toEqual(['stable', 'broken', 'broken']);
    expect(p.view().status).toBe('failed');
  }, 240000);

  it('F6: an --only run of the failed check on the same tree keeps the earlier pass and passes the gate', () => {
    const p = project(stableAndFlaky);
    p.verify();
    expect(p.verify(['--only', 'unstable']).code).toBe(0);
    expect(p.s.runs()).toEqual(['stable', 'unstable', 'unstable']);
    expect(p.view().status).toBe('passed');
    expect(p.row('stable')).toContain('exit 0');
  }, 240000);

  it('negative F8: an --only run after an edit keeps nothing and does not pass the gate', () => {
    const p = project(stableAndFlaky);
    p.verify();
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    p.verify(['--only', 'unstable']);
    expect(p.view().status).not.toBe('passed');
  }, 240000);

  it('negative F7: an old record without per-result fields on the current fingerprint still passes', () => {
    const p = project((s) => [{ name: 'stable', run: s.ok }]);
    expect(p.verify().json().status).toBe('passed');
    const state = parse(read(p.state));
    for (const result of state.verify.results) {
      delete result.fingerprint;
      delete result.run_id;
      delete result.attempt;
    }
    write(p.state, stringify(state));
    expect(p.view().status).toBe('passed');
  }, 240000);
});
