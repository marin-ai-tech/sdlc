import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { readChangeState } from '../src/core/change-state.js';
import { BIN, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F6 (close-the-digest-integrity-review-findings): B126 parses approval entries before use and skips malformed ones,
 * but the next write of `.sdlc.yaml` dropped them for good. A malformed entry stays in its gate's list, unchanged,
 * whatever sdlc writes (a waiver, a rejection, another person's approval), and it never counts as an approval.
 * The kept entry may move to the end of its gate's list; its content does not change.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

const PAT = 'Pat Owner <pat@example.com>';
const MARKER = 'kept-entry-f6';

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8', timeout: 60000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
}

function project() {
  const root = tempDir('sdlc-keep-approval-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => {
    const r = run([...args, '--json'], root, env);
    expect(r.code, r.out).toBe(0);
    return JSON.parse(r.stdout);
  };
  cli(['init', '--tools', 'none']);
  cli(['new', 'keep']);
  const dir = path.join(root, 'openspec', 'changes', 'keep');
  write(path.join(dir, 'intent.md'), INTENT);
  const stateFile = path.join(dir, '.sdlc.yaml');
  const intentGate = () => cli(['status', '--change', 'keep']).change.gates
    .find((gate: { id: string }) => gate.id === 'intent');
  return { root, dir, cli, intentGate, raw: () => parse(read(stateFile)), stateFile };
}

/** A hand-written entry that names the gate's role and current digest but has a malformed field. */
function malformed(by: string, digest: string): Record<string, unknown> {
  return { role: 'product-owner', by, at: '2026-10-27T00:00:00.000Z', digest, note: ['not', 'a', 'string'],
    marker: MARKER };
}

function plant(p: ReturnType<typeof project>, entry: Record<string, unknown>): void {
  const raw = p.raw();
  raw.gates = { ...(raw.gates ?? {}), intent: { ...(raw.gates?.intent ?? {}), approvals: [entry] } };
  write(p.stateFile, stringify(raw));
}

function intentApprovals(p: ReturnType<typeof project>): unknown[] {
  return p.raw().gates?.intent?.approvals ?? [];
}

describe('F6: a malformed approval survives a later write', () => {
  it('keeps a malformed approval through a waiver write', () => {
    const p = project();
    const entry = malformed('Mallory <mallory@example.com>', p.intentGate().digest);
    plant(p, entry);
    p.cli(['waive', 'spec', '--change', 'keep', '--note', 'not needed']);
    expect(p.raw().gates.spec.waived).toMatchObject({ note: 'not needed' });
    expect(intentApprovals(p)).toContainEqual(entry);
  }, 180000);

  it('keeps a malformed approval through another person\'s approval', () => {
    const p = project();
    const entry = malformed('Mallory <mallory@example.com>', p.intentGate().digest);
    plant(p, entry);
    p.cli(['approve', 'intent', '--change', 'keep']);
    const approvals = intentApprovals(p) as Array<Record<string, unknown>>;
    expect(approvals.filter((item) => item.by === PAT && item.marker === undefined)).toHaveLength(1);
    expect(approvals).toContainEqual(entry);
  }, 180000);

  it('keeps a malformed approval through a rejection', () => {
    const p = project();
    const entry = malformed('Mallory <mallory@example.com>', p.intentGate().digest);
    plant(p, entry);
    p.cli(['reject', 'intent', '--change', 'keep', '--note', 'unclear problem']);
    expect(p.raw().gates.intent.rejection).toMatchObject({ by: PAT, note: 'unclear problem' });
    expect(intentApprovals(p)).toContainEqual(entry);
  }, 180000);
});

describe('F6: a kept malformed approval never counts', () => {
  it('a kept malformed approval does not approve the gate', () => {
    const p = project();
    plant(p, malformed(PAT, p.intentGate().digest));
    p.cli(['waive', 'spec', '--change', 'keep', '--note', 'not needed']);
    const gate = p.intentGate();
    expect(gate.status).toBe('pending');
    expect(gate.approvals).toEqual([]);
    expect(gate.missingRoles).toContain('product-owner');
  }, 180000);

  it('the same person is not reported as already approved', () => {
    const p = project();
    plant(p, malformed(PAT, p.intentGate().digest));
    p.cli(['waive', 'spec', '--change', 'keep', '--note', 'not needed']);
    const out = p.cli(['approve', 'intent', '--change', 'keep']);
    expect(out.alreadyApproved).toBeUndefined();
    expect(out.by).toBe(PAT);
    expect(p.intentGate().status).toBe('approved');
    const valid = (intentApprovals(p) as Array<Record<string, unknown>>).filter((item) => item.marker === undefined);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ by: PAT, role: 'product-owner' });
  }, 180000);

  it('no read lists the kept entry as an approval', () => {
    const p = project();
    plant(p, malformed(PAT, p.intentGate().digest));
    p.cli(['waive', 'spec', '--change', 'keep', '--note', 'not needed']);
    expect(readChangeState(p.dir).gates.intent?.approvals ?? []).toEqual([]);
    expect(JSON.stringify(readChangeState(p.dir).gates)).not.toContain(MARKER);
    const status = p.cli(['status', '--change', 'keep']);
    expect(JSON.stringify(status)).not.toContain(MARKER);
    const all = p.cli(['status']);
    expect(JSON.stringify(all)).not.toContain(MARKER);
    const queue = p.cli(['next', '--me']);
    expect(JSON.stringify(queue)).not.toContain(MARKER);
    expect(queue.items.map((item: { change: string; gate: string }) => `${item.change}:${item.gate}`))
      .toContain('keep:intent');
  }, 180000);
});

/** The archived copy of the change's state; exactly one archive folder ends with `-keep`. */
function archivedState(p: ReturnType<typeof project>): any {
  const archive = path.join(p.root, 'openspec', 'changes', 'archive');
  const folders = fs.readdirSync(archive).filter((name) => name.endsWith('-keep'));
  expect(folders).toHaveLength(1);
  return parse(read(path.join(archive, folders[0], '.sdlc.yaml')));
}

// Review round 1, F7: drop and archive clone the state before writing, so they must carry the kept entries.
describe('F6: drop and archive keep a malformed approval (review round 1, F7)', () => {
  it('keeps a malformed approval through sdlc drop', () => {
    const p = project();
    const entry = malformed('Mallory <mallory@example.com>', p.intentGate().digest);
    plant(p, entry);
    p.cli(['drop', 'keep', '--note', 'not needed']);
    const state = archivedState(p);
    expect(state.dropped).toMatchObject({ note: 'not needed' });
    expect(state.gates.intent.approvals).toContainEqual(entry);
  }, 180000);

  it('keeps a malformed approval through sdlc archive --skip-specs', () => {
    const p = project();
    const entry = malformed('Mallory <mallory@example.com>', p.intentGate().digest);
    plant(p, entry);
    p.cli(['archive', 'keep', '--yes', '--skip-specs', '--force', '--note', 'test']);
    const state = archivedState(p);
    expect(JSON.stringify(state.history ?? [])).toContain('change.archived');
    expect(state.gates.intent.approvals).toContainEqual(entry);
  }, 180000);
});
