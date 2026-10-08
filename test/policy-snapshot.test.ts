import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.4 (docs/ru/25).
 * B78: the first evaluation that applies an auto_waive policy records the waiver on the change, so removing the
 *      policy later does not change what that change shows.
 * B79: a rework record written before 0.11.2 has no cycle counter; the count comes from the history.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-snapshot-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const configFile = path.join(root, 'openspec/sdlc.yaml');
  const setPolicy = (on: boolean) => {
    const config = parse(read(configFile));
    if (on) config.gates.spec.auto_waive = { kinds: ['docs'] };
    else delete config.gates.spec.auto_waive;
    write(configFile, stringify(config));
  };
  const spec = (id: string) => cli(['status', '--change', id, '--json']).json().change.gates
    .find((g: { id: string }) => g.id === 'spec');
  const state = (id: string) => path.join(root, 'openspec/changes', id, '.sdlc.yaml');
  return { root, cli, setPolicy, spec, state };
}

describe('B78: a policy waiver is recorded on the change', () => {
  it('after the policy is removed, the change it waived stays waived', () => {
    const p = project();
    p.setPolicy(true);
    expect(p.cli(['new', 'docs-x', '--kind', 'docs', '--json']).code).toBe(0);
    expect(p.spec('docs-x').status).toBe('waived');
    expect(parse(read(p.state('docs-x'))).gates.spec.waived).toMatchObject({ by: 'policy' });
    p.setPolicy(false);
    expect(p.spec('docs-x').status).toBe('waived');
  }, 180000);

  // Review of 0.11.4: an agent's session (its status calls, its session-start hook) never makes the policy permanent.
  it('negative: an agent evaluating the change does not record the waiver', () => {
    const p = project();
    expect(p.cli(['new', 'docs-y', '--kind', 'docs', '--json']).code).toBe(0);
    p.setPolicy(true);
    const agentEnv = { ...humanEnv(tempDir('sdlc-home-')), SDLC_AGENT: 'test' };
    const r = runCli(['status', '--change', 'docs-y', '--json'], p.root, agentEnv);
    expect(r.json().change.gates.find((g: { id: string }) => g.id === 'spec').status).toBe('waived');
    expect(parse(read(p.state('docs-y'))).gates?.spec?.waived).toBeUndefined();
    expect(p.spec('docs-y').status).toBe('waived');
    expect(parse(read(p.state('docs-y'))).gates.spec.waived).toMatchObject({ by: 'policy' });
  }, 180000);

  it('negative: a change the policy does not match records no waiver', () => {
    const p = project();
    p.setPolicy(true);
    expect(p.cli(['new', 'feat-x', '--json']).code).toBe(0);
    expect(p.spec('feat-x').status).not.toBe('waived');
    expect(parse(read(p.state('feat-x'))).gates?.spec?.waived).toBeUndefined();
  }, 180000);
});

describe('B79: rework cycles of records without a counter', () => {
  function reworkedThrice(p: ReturnType<typeof project>): void {
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    const intent = path.join(p.root, 'openspec/changes/demo/intent.md');
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      write(intent, `${INTENT}\nCycle ${cycle}.\n`);
      expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
      const args = ['rework', 'intent', '--change', 'demo', '--reason', 'other', '--note', 'n', '--json'];
      expect(p.cli(args).code).toBe(0);
    }
  }

  function dropCounter(p: ReturnType<typeof project>, keepReworkEvents: number): void {
    const record = parse(read(p.state('demo')));
    delete record.gates.intent.rework.cycle;
    let kept = 0;
    record.history = record.history.filter((event: { event: string }) => {
      if (event.event !== 'gate.intent.rework') return true;
      kept += 1;
      return kept <= keepReworkEvents;
    });
    write(p.state('demo'), stringify(record));
  }

  it('three reworks in the history of an old record still reach the limit', () => {
    const p = project();
    reworkedThrice(p);
    dropCounter(p, 3);
    expect(p.cli(['next', '--change', 'demo', '--json']).json().next.action).toBe('review-scope');
  }, 240000);

  it('negative: one rework in the history of an old record stays below the limit', () => {
    const p = project();
    reworkedThrice(p);
    dropCounter(p, 1);
    expect(p.cli(['next', '--change', 'demo', '--json']).json().next.action).not.toBe('review-scope');
  }, 240000);
});
