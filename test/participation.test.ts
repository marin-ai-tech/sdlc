import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.4 (docs/ru/25, B63): the audit and the dashboard compare, per change, the people's decisions the track plans
 * with what happened: approvals, reworks, takeovers, waivers, answers and waits.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(edit?: (config: Record<string, any>) => void) {
  const root = tempDir('sdlc-participation-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (edit) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    edit(config);
    write(file, stringify(config));
  }
  const change = (id: string, track?: string) => {
    expect(cli(['new', id, ...(track ? ['--track', track] : []), '--json']).code).toBe(0);
    write(path.join(root, 'openspec/changes', id, 'intent.md'), INTENT);
  };
  const audit = (id: string) => {
    const r = cli(['audit', '--change', id, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json().metrics.participation;
  };
  return { root, cli, change, audit };
}

describe('B63: planned vs actual participation of people', () => {
  it('a full-track change plans four approvals; the audit counts what happened', () => {
    const p = project();
    p.change('demo');
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    expect(p.cli(['rework', 'intent', '--change', 'demo', '--reason', 'other', '--note', 'n', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/demo/intent.md'), `${INTENT}\nMore.\n`);
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    const participation = p.audit('demo');
    expect(participation.planned).toMatchObject({ gates: ['intent', 'spec', 'plan', 'review'], approvals: 4 });
    expect(participation.actual).toMatchObject({ approvals: 2, reworks: 1, takeovers: 0, waivers: 0, answers: 0 });
    const whole = p.cli(['audit', '--json']).json();
    expect(whole.changes.find((row: { change: string }) => row.change === 'demo').participation.actual.reworks)
      .toBe(1);
    const report = JSON.parse(p.cli(['report', '--format', 'json']).stdout);
    expect(report.changes.find((row: { id: string }) => row.id === 'demo').participation.planned.approvals).toBe(4);
  }, 240000);

  it('negative: the lite track plans no intent or spec decision; min_approvals counts every person', () => {
    const p = project((c) => { c.gates.plan.min_approvals = 2; });
    p.change('small', 'lite');
    const planned = p.audit('small').planned;
    expect(planned.gates).toEqual(['plan', 'review']);
    expect(planned.gates).not.toContain('intent');
    expect(planned.approvals).toBe(3);
  }, 180000);
});
