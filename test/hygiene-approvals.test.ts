import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.2, process hygiene — the approval side (docs/ru/22, B56, B59, B60, B61).
 * B56: after a rework, approving the gate again with the digest approved before it needs a note.
 * B59: `gates.<g>.auto_waive` waives a gate for matching kinds or tracks, logged as policy (never verify or review).
 * B60: `sdlc approve` proposes a commit message with `SDLC-Approval: <change>:<gate>:<digest12>`; approvals verify
 *      reports whether that commit exists.
 * B61: after `rework.max_cycles` (default 3) reworks of a gate, `next` proposes a takeover or a scope review to a person.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const ROLES = [
  'version: 1', 'signing: warn', 'people:', '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]', '',
].join('\n');

function project(options: { kind?: string; config?: (c: Record<string, any>) => void; roles?: boolean } = {}) {
  const root = tempDir('sdlc-hygiene-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (options.roles) write(path.join(root, 'openspec/roles.yaml'), ROLES);
  if (options.config) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    options.config(config);
    write(file, stringify(config));
  }
  expect(cli(['new', 'demo', ...(options.kind ? ['--kind', options.kind] : []), '--json']).code).toBe(0);
  const intent = path.join(root, 'openspec/changes/demo/intent.md');
  write(intent, INTENT);
  const run = (args: string[]) => cli([...args, '--change', 'demo', '--json']);
  const gate = (id: string) => cli(['status', '--change', 'demo', '--json']).json().change.gates
    .find((g: { id: string }) => g.id === id);
  return { root, env, cli, run, gate, intent };
}

const REWORK = ['rework', 'intent', '--reason', 'missing-requirement', '--note', 'n'];

describe('B56: re-approval after a rework', () => {
  it('needs a note when nothing changed since the approval before the rework', () => {
    const p = project();
    expect(p.run(['approve', 'intent']).code).toBe(0);
    expect(p.run(REWORK).code).toBe(0);
    expect(p.run(['approve', 'intent', '--preview']).json().unchangedSinceRework).toBe(true);
    const bare = p.run(['approve', 'intent']);
    expect(bare.code).toBe(1);
    expect(bare.json().status[0].code).toBe('unchanged_after_rework');
    expect(p.run(['approve', 'intent', '--note', '  ']).json().status[0].code).toBe('unchanged_after_rework');
    expect(p.run(['approve', 'intent', '--note', 'The rework was a mistake']).code).toBe(0);
  }, 180000);

  it('negative: after a change the approval needs no note', () => {
    const p = project();
    expect(p.run(['approve', 'intent']).code).toBe(0);
    expect(p.run(REWORK).code).toBe(0);
    write(p.intent, `${INTENT}\nThe missing requirement.\n`);
    expect(p.run(['approve', 'intent']).code).toBe(0);
  }, 180000);
});

describe('B59: auto-waive policy', () => {
  const policy = (c: Record<string, any>) => { c.gates.spec.auto_waive = { kinds: ['docs'] }; };

  it('waives the gate for a matching kind and logs it once as policy', () => {
    const p = project({ kind: 'docs', config: policy });
    expect(p.gate('spec').status).toBe('waived');
    expect(p.gate('spec').status).toBe('waived');
    const log = read(path.join(p.root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
    expect(log.filter((e: { event: string }) => e.event === 'gate.spec.auto_waived')).toHaveLength(1);
  }, 180000);

  it('negative: other kinds keep the gate, and verify or review cannot be auto-waived', () => {
    const p = project({ kind: 'feature', config: policy });
    expect(p.gate('spec').status).not.toBe('waived');
    // The bad policy is written after `sdlc new`: `new` itself must refuse a project with an invalid config.
    const q = project();
    const file = path.join(q.root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.gates.review = { ...(config.gates.review ?? {}), auto_waive: { kinds: ['docs'] } };
    write(file, stringify(config));
    const r = q.cli(['status', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 180000);

  // Review of 0.11.2: verify and release cannot be waived by policy either; lists must name known kinds or tracks.
  it('negative: auto_waive on verify or release, an unknown kind or an empty policy is a config error', () => {
    const p = project();
    const file = path.join(p.root, 'openspec/sdlc.yaml');
    const original = read(file);
    const bad: Array<(c: Record<string, any>) => void> = [
      (c) => { c.gates.verify = { ...(c.gates.verify ?? {}), auto_waive: { kinds: ['docs'] } }; },
      (c) => { c.gates.release.auto_waive = { kinds: ['docs'] }; },
      (c) => { c.gates.spec.auto_waive = { kinds: ['doc'] }; },
      (c) => { c.gates.spec.auto_waive = {}; },
    ];
    for (const edit of bad) {
      const config = parse(original);
      edit(config);
      write(file, stringify(config));
      const r = p.cli(['status', '--json']);
      expect(r.code, JSON.stringify(config.gates)).toBe(1);
      expect(r.json().status[0].code).toBe('invalid_config');
    }
  }, 240000);

  it('negative: a kind an agent chose does not trigger the policy', () => {
    const p = project({ config: policy });
    const agent = runCli(['new', 'by-agent', '--kind', 'docs', '--json'], p.root, { ...p.env, SDLC_AGENT: 'test' });
    expect(agent.code, agent.stdout + agent.stderr).toBe(0);
    const status = p.cli(['status', '--change', 'by-agent', '--json']).json();
    expect(status.change.gates.find((g: { id: string }) => g.id === 'spec').status).not.toBe('waived');
  }, 180000);
});

describe('B60: the approval trailer', () => {
  it('approve proposes the commit message; approvals verify finds the commit by its trailer', () => {
    const p = project({ roles: true });
    const approved = p.run(['approve', 'intent']).json();
    expect(approved.commitMessage).toMatch(/SDLC-Approval: demo:intent:[0-9a-f]{12}/);
    const before = p.cli(['approvals', 'verify', '--mode', 'warn', '--json']).json();
    expect(before.results[0].trailer).toBe('missing');
    git(p.root, ['add', '-A']);
    execFileSync('git', ['commit', '-q', '-m', approved.commitMessage], { cwd: p.root });
    const after = p.cli(['approvals', 'verify', '--mode', 'warn', '--json']).json();
    expect(after.results[0].trailer).toBe('found');
  }, 180000);
});

describe('B61: the rework cycle limit', () => {
  it('after the third rework of a gate, next proposes a takeover or a scope review to a person', () => {
    const p = project();
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      write(p.intent, `${INTENT}\nCycle ${cycle}.\n`);
      expect(p.run(['approve', 'intent']).code, `approve ${cycle}`).toBe(0);
      expect(p.run(REWORK).code, `rework ${cycle}`).toBe(0);
    }
    const next = p.run(['next']).json().next;
    expect(next).toMatchObject({ actor: 'human', action: 'review-scope' });
    expect(JSON.stringify(next)).toMatch(/takeover/);
  }, 240000);

  it('negative: before the limit the agent goes on', () => {
    const p = project();
    expect(p.run(['approve', 'intent']).code).toBe(0);
    expect(p.run(REWORK).code).toBe(0);
    expect(p.run(['next']).json().next.action).not.toBe('review-scope');
  }, 180000);
});
