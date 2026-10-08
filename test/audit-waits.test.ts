import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B6: the audit shows how long each gate waited for a person (from the first `gate.<g>.awaiting` the CLI saw for
 * the gate's digest to the approval), the reworks with their reasons, verify attempts until the first pass, and
 * how many times a gate was approved.
 */

const INTENT = '# Intent: say goodbye\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

function project() {
  const root = tempDir('sdlc-audit-waits-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'flag', run: 'node -e "process.exit(require(\'fs\').existsSync(\'ok\')?0:1)"' }];
  write(file, stringify(config));
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/demo/intent.md'), INTENT);
  const events = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  return { root, cli, events };
}

describe('waits, reworks and attempts in the log and the audit', () => {
  it('a gate waiting for a person is logged once per digest', () => {
    const p = project();
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.cli(['next', '--change', 'demo', '--json']).code).toBe(0);
    const awaiting = p.events().filter((e) => e.event === 'gate.intent.awaiting');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].detail).toMatch(/sha256:/);
    fs.appendFileSync(path.join(p.root, 'openspec/changes/demo/intent.md'), '\nMore context.\n');
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.events().filter((e) => e.event === 'gate.intent.awaiting')).toHaveLength(2);
  }, 120000);

  it('the change audit shows the wait per gate and how many times a gate was approved', () => {
    const p = project();
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    const metrics = p.cli(['audit', '--change', 'demo', '--json']).json().metrics;
    expect(metrics.waits.intent.seconds).toBeGreaterThanOrEqual(0);
    expect(metrics.approvals.intent).toBe(1);
  }, 120000);

  it('reworks are counted with their reasons, per change and across the project', () => {
    const p = project();
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    const rework = p.cli(['rework', 'intent', '--change', 'demo', '--reason', 'wrong-assumption', '--note', 'n', '--json']);
    expect(rework.code, rework.stdout + rework.stderr).toBe(0);
    // 0.11.2 (B56): re-approving an unchanged gate after its rework needs a note.
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--note', 'n', '--json']).code).toBe(0);
    const metrics = p.cli(['audit', '--change', 'demo', '--json']).json().metrics;
    expect(metrics.reworks).toEqual([expect.objectContaining({ gate: 'intent', reason: 'wrong-assumption' })]);
    expect(metrics.approvals.intent).toBe(2);
    const all = p.cli(['audit', '--json']).json().aggregate;
    expect(all.reworkReasons).toEqual([{ reason: 'wrong-assumption', count: 1 }]);
    expect(all.medianWaitSeconds).toHaveProperty('intent');
  }, 180000);

  it('verify attempts until the first pass', () => {
    const p = project();
    write(path.join(p.root, 'openspec/changes/demo/tasks.md'), '# Tasks\n\n- [x] 1.1 Done\n');
    p.cli(['verify', '--change', 'demo', '--json']);
    write(path.join(p.root, 'ok'), 'ok\n');
    p.cli(['verify', '--change', 'demo', '--json']);
    const metrics = p.cli(['audit', '--change', 'demo', '--json']).json().metrics;
    expect(metrics.verifyAttemptsToPass).toBe(2);
  }, 180000);

  it('negative: a change nobody waited on shows no wait, and the text audit names the waits', () => {
    const p = project();
    const metrics = p.cli(['audit', '--change', 'demo', '--json']).json().metrics;
    expect(metrics.waits).toEqual({});
    expect(metrics.reworks).toEqual([]);
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.cli(['audit', '--change', 'demo']).stdout).toMatch(/wait/i);
  }, 120000);
});
