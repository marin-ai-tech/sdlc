import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B39: .sdlc.yaml travels through git between machines whose clocks differ. Whether an approval came before or
 * after a rework or a rejection must follow the order the decisions were recorded in, not their wall-clock time.
 * Records written before the fix (no order recorded) keep the time rule.
 */

const INTENT = '# Intent: x\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

function project() {
  const root = tempDir('sdlc-decision-order-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/demo/intent.md'), INTENT);
  const file = path.join(root, 'openspec/changes/demo/.sdlc.yaml');
  const edit = (change: (state: Record<string, any>) => void) => {
    const state = parse(read(file));
    change(state);
    write(file, stringify(state));
  };
  const intent = () => cli(['status', '--change', 'demo', '--json']).json().change.gates
    .find((g: { id: string }) => g.id === 'intent').status;
  const run = (args: string[]) => {
    const r = cli([...args, '--change', 'demo', '--json']);
    expect(r.code, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
  };
  return { run, edit, intent };
}

const REWORK = ['rework', 'intent', '--reason', 'other', '--note', 'n'];

describe('the order of decisions does not depend on the clocks', () => {
  it('an approval from a machine whose clock runs ahead still stops counting after a later rework', () => {
    const p = project();
    p.run(['approve', 'intent']);
    p.edit((s) => { s.gates.intent.approvals[0].at = FUTURE; });
    p.run(REWORK);
    expect(p.intent()).toBe('rejected');
  }, 120000);

  it('a rework from a machine whose clock runs ahead does not hide a later approval', () => {
    const p = project();
    p.run(['approve', 'intent']);
    p.run(REWORK);
    p.edit((s) => { s.gates.intent.rework.at = FUTURE; });
    p.run(['approve', 'intent']);
    expect(p.intent()).toBe('approved');
  }, 120000);

  it('a rejection from a machine whose clock runs ahead does not hide a later approval', () => {
    const p = project();
    p.run(['reject', 'intent', '--note', 'no']);
    p.edit((s) => { s.gates.intent.rejection.at = FUTURE; });
    p.run(['approve', 'intent']);
    expect(p.intent()).toBe('approved');
  }, 120000);

  it('negative: records written before the fix keep the time rule', () => {
    const p = project();
    p.run(['approve', 'intent']);
    p.run(REWORK);
    p.edit((s) => {
      const strip = (record: Record<string, unknown> | undefined) => { if (record) delete record.seq; };
      for (const approval of s.gates.intent.approvals ?? []) strip(approval);
      strip(s.gates.intent.rework);
      strip(s.gates.intent.rejection);
      delete s.seq;
      s.gates.intent.approvals[0].at = PAST;
    });
    expect(p.intent()).toBe('rejected');
  }, 120000);
});
