import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.2: hints that named the wrong actor or the wrong people (found while writing the user course).
 * - `next --me` lists a gate that waits only for that person's answer to an open question.
 * - `explain` names the people the gate waits for, as `next` and `status` do.
 * - After `backlog start`, the draft intent (empty sections) goes to the agent to complete, not to a person to approve.
 * - With `min_approvals: 2`, the hint names only the people who have not approved yet.
 * - `roles who spec` for a medium-risk change lists only the product owners (the tech lead counts at high risk).
 * - With `design.debate: true`, the spec goes to the agent for the `## Debate` section before a person is asked.
 */

const ROLES = ['version: 1', 'signing: off', 'people:',
  '  maria: { name: Maria Ruiz, emails: [maria@nw.example] }',
  '  mike: { name: Mike Stone, emails: [mike@nw.example] }',
  '  ivan: { name: Ivan Lee, emails: [ivan@nw.example] }',
  'roles:', '  product-owner: [maria, mike]', '  tech-lead: [ivan]', '  engineer: [ivan]', '  code-owner: [ivan]',
  '  maintainer: [maria]', ''].join('\n');
const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');
const SPEC: Record<string, string> = {
  'proposal.md': '# Proposal\n\n## Why\n\nUsers need to take their data out of the product in a portable format.\n\n'
    + '## What Changes\n\n- export\n\n## Capabilities\n\n### New Capabilities\n- `export`: CSV export\n\n'
    + '## Impact\n\nsrc/export.js\n',
  'specs/export/spec.md': '# Spec Delta\n\n## Purpose\n\nLets users export their data in a portable, documented '
    + 'format.\n\n## ADDED Requirements\n\n### Requirement: Export\nThe system SHALL export CSV.\n\n'
    + '#### Scenario: Export works\n- **WHEN** asked\n- **THEN** CSV\n',
  'design.md': '# Design\n\n## Context\nsrc/export.js\n\n## Decisions\nCSV.\n\n## Policy compliance\nNone apply.\n\n'
    + '## Areas of concern\nNone identified\n',
};

function project(configure?: (config: Record<string, any>) => void) {
  const root = tempDir('sdlc-hints-0152-');
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Maria Ruiz']);
  git(root, ['config', 'user.email', 'maria@nw.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  if (configure) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    configure(config);
    write(file, stringify(config));
  }
  const change = (id: string, files: Record<string, string>) => {
    expect(cli(['new', id, '--json']).code).toBe(0);
    for (const [file, text] of Object.entries(files)) write(path.join(root, 'openspec/changes', id, file), text);
  };
  const as = (person: 'maria' | 'mike' | 'ivan') => ({
    GIT_AUTHOR_EMAIL: `${person}@nw.example`, GIT_COMMITTER_EMAIL: `${person}@nw.example`,
  });
  return { root, cli, change, as };
}

describe('0.15.2 hints', () => {
  it('next --me lists a gate that waits for my answer to an open question', () => {
    const p = project();
    p.change('q', { 'intent.md': INTENT.replace('## Open questions\nNone', '## Open questions\n1. Which format?') });
    const mine = p.cli(['next', '--me', '--json']).json();
    expect(JSON.stringify(mine)).toContain('"q"');
    expect(JSON.stringify(mine)).toContain('answer');
  }, 180000);

  it('explain names the people a gate waits for', () => {
    const p = project();
    p.change('e', { 'intent.md': INTENT });
    const text = p.cli(['explain', '--change', 'e']).stdout;
    expect(text).toMatch(/Maria Ruiz/);
    expect(text).toMatch(/Mike Stone/);
  }, 180000);

  it('after backlog start the draft intent goes to the agent to complete', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', 'Export CSV', '--outcome', 'Users export', '--accept', 'CSV downloads']).code)
      .toBe(0);
    const started = p.cli(['backlog', 'start', 'B1']);
    expect(started.code, started.stdout + started.stderr).toBe(0);
    const hint = started.stdout.split('\n').find((line) => line.startsWith('Next:')) ?? '';
    expect(hint).toMatch(/agent/i);
    expect(hint).not.toContain('approve intent');
    const next = p.cli(['next', '--change', 'export-csv', '--json']).json().next;
    expect(next).toMatchObject({ actor: 'agent', workflow: 'intent' });
  }, 180000);

  it('negative: a complete intent still goes to the product owner', () => {
    const p = project();
    p.change('c', { 'intent.md': INTENT });
    expect(p.cli(['next', '--change', 'c', '--json']).json().next).toMatchObject({ actor: 'human', gate: 'intent' });
  }, 180000);

  it('with min_approvals 2 the hint names only who has not approved yet', () => {
    const p = project((config) => { config.gates.intent.min_approvals = 2; });
    p.change('m', { 'intent.md': INTENT });
    const first = p.cli(['approve', 'intent', '--change', 'm', '--json'], p.as('maria'));
    expect(first.code, first.stdout + first.stderr).toBe(0);
    const next = p.cli(['next', '--change', 'm', '--json']).json().next;
    expect(JSON.stringify(next)).toContain('Mike Stone');
    expect(JSON.stringify(next)).not.toContain('Maria Ruiz');
  }, 180000);

  it('roles who spec for a medium-risk change lists the product owners only', () => {
    const p = project();
    p.change('r', { 'intent.md': INTENT });
    const who = p.cli(['roles', 'who', 'spec', '--change', 'r']).stdout;
    expect(who).toContain('Maria Ruiz');
    expect(who).not.toContain('Ivan Lee');
  }, 180000);

  it('with the debate lens the spec goes to the agent before a person is asked', () => {
    const p = project((config) => { config.design = { debate: true }; });
    p.change('d', { 'intent.md': INTENT, ...SPEC });
    expect(p.cli(['approve', 'intent', '--change', 'd', '--json'], p.as('maria')).code).toBe(0);
    const next = p.cli(['next', '--change', 'd', '--json']).json().next;
    expect(next).toMatchObject({ actor: 'agent' });
    expect(JSON.stringify(p.cli(['next', '--me', '--json'], p.as('mike')).json())).not.toContain('"d"');
  }, 180000);
});
