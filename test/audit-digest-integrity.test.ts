import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { captureCheckpoint } from '../src/core/checkpoint.js';
import { assertSnapshotContent } from '../src/core/approval-snapshot.js';
import { parseApprovalGates } from '../src/core/approval-records.js';
import { digestFiles } from '../src/core/digest.js';
import { provenanceComment } from '../src/core/license.js';
import { decisionProject } from './e20-decision-fixture.js';
import { preloadCli, waiveFixtureGates } from './audit-decision-preload.js';
import { git, initGitRepo, read, tempDir, write } from './helpers.js';

function checkpointMutation(file: string, after: number): string {
  return [
    'const original = cp.spawnSync;', 'let checkpoints = 0;',
    'cp.spawnSync = function(command, args, opts) {',
    "  if (command === 'git' && args.includes('add') && opts?.env?.GIT_INDEX_FILE?.includes('sdlc-checkpoint-')) {",
    '    checkpoints += 1;',
    `    if (checkpoints === ${after}) fs.appendFileSync(${JSON.stringify(file)}, 'Intruding edit.\\n');`,
    '  }', '  return original.apply(this, arguments);', '};',
  ].join('\n');
}

describe('Retro digest audit D4/D6/D7/D8/D9', () => {
  it('D4 actual review raw-tree proof refuses a tracked non-fingerprint edit during the checkpoint', () => {
    const p = decisionProject();
    waiveFixtureGates(p, ['intent', 'spec', 'plan', 'verify']);
    const target = path.join(p.root, 'openspec/notes.md');
    write(target, 'Before.\n');
    git(p.root, ['add', '--', 'openspec/notes.md']);
    const out = preloadCli(p, ['approve', 'review', '--change', 'demo', '--json'], checkpointMutation(target, 2));
    expect(read(target)).toContain('Intruding edit.');
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.json().status[0]).toMatchObject({ code: 'digest_changed' });
    expect(parse(read(p.stateFile)).gates.review?.approvals ?? []).toEqual([]);
    const refs = spawnSync('git', ['for-each-ref', 'refs/sdlc/demo/review'],
      { cwd: p.root, encoding: 'utf8', timeout: 30000 });
    expect(refs.stdout).toBe('');
  }, 120000);

  it('D7 actual approval refuses immutable snapshot mismatch and retains the earlier checkpoint', () => {
    const p = decisionProject();
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    const ref = () => spawnSync('git', ['rev-parse', 'refs/sdlc/demo/intent'],
      { cwd: p.root, encoding: 'utf8', timeout: 30000 }).stdout;
    const earlier = ref();
    const state = parse(read(p.stateFile)).gates.intent.approvals;
    const target = path.join(p.dir, 'intent.md');
    write(target, read(target).replace('Sessions end without a goodbye.', 'Sessions end abruptly.'));
    const out = preloadCli(p, ['approve', 'intent', '--change', 'demo', '--json'], checkpointMutation(target, 1));
    expect(read(target)).toContain('Intruding edit.');
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.json().status[0]).toMatchObject({ code: 'digest_changed' });
    expect(parse(read(p.stateFile)).gates.intent.approvals).toEqual(state);
    expect(ref()).toBe(earlier);
  }, 120000);

  it('D6 changes to embedded stamp-shaped content change the digest while a trailing stamp remains excluded', () => {
    const dir = tempDir('sdlc-embedded-stamp-');
    const mark = provenanceComment({ version: '0.29.0', license: 'community' });
    const file = path.join(dir, 'intent.md');
    write(file, `# Intent\n${mark}\nBody\n${mark}\n`);
    const before = digestFiles(dir, ['intent.md']);
    write(file, `# Intent\n${mark.replace('0.29.0', '0.28.0')}\nBody\n${mark}\n`);
    const changed = digestFiles(dir, ['intent.md']);
    expect(changed).not.toBe(before);
    write(file, read(file).replace(/0\.29\.0(?=[^\n]*-->\n$)/, '0.27.0'));
    expect(digestFiles(dir, ['intent.md'])).toBe(changed);
  });

  it.each([42, ['not a timestamp'], { timestamp: 'forged' }])('D8 rejects an approval with non-string at %s', (at) => {
    const valid = { role: 'engineer', by: 'Pat', at: '2026-10-29', digest: 'sha256:abc' };
    const gates = parseApprovalGates({ plan: { approvals: [{ ...valid, at }, valid] } });
    expect(gates.plan.approvals).toEqual([valid]);
  });

  it('D9 exercises actual inside, chained and escaping file links', (context) => {
    const root = tempDir('sdlc-real-file-links-');
    initGitRepo(root);
    const dir = path.join(root, 'change');
    write(path.join(dir, 'target.md'), 'Inside.\n');
    const outside = path.join(tempDir('sdlc-outside-links-'), 'outside.md');
    write(outside, 'Outside.\n');
    try {
      fs.symlinkSync('target.md', path.join(dir, 'inside.md'), 'file');
      fs.symlinkSync('inside.md', path.join(dir, 'chain.md'), 'file');
      fs.symlinkSync(outside, path.join(dir, 'escape.md'), 'file');
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('NOT RUN: native Windows file symlinks require an unavailable privilege; no modeled substitute.');
        return;
      }
      throw error;
    }
    for (const file of ['inside.md', 'chain.md']) {
      const capture = new Map();
      const digest = digestFiles(dir, [file], undefined, capture);
      const snapshot = captureCheckpoint(root, [`change/${file}`])!;
      expect(() => assertSnapshotContent(root, dir, 'intent', snapshot, capture.get(digest), 'tasks.md')).not.toThrow();
    }
    expect(() => digestFiles(dir, ['escape.md'])).toThrow(/unsafe|outside/i);
    expect(captureCheckpoint(root, ['change/escape.md'])).toBeUndefined();
  });
});
