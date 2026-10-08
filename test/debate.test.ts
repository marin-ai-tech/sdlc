import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * 0.12.0 (docs/ru/26, B20): the debate lens, off by default. When `design.debate` is on, the spec gate waits for a
 * `## Debate` section in design.md with two positions and the decision.
 */

const FILES: Record<string, string> = {
  'intent.md': '# Intent: say goodbye\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nSessions end without a goodbye.\n\n## Proposed outcome\nUsers see a named farewell.\n\n## Affected users and systems\nAll users.\n\n## Constraints\nNone\n\n## Success measures\nShown on sign-out.\n\n## Out of scope\nLocalization.\n\n## Open questions\nNone\n',
  'proposal.md': '# Proposal\n\n## Why\n\nSessions end abruptly because users never see a farewell message that uses their name.\n\n## What Changes\n\n- Add farewell(name).\n\n## Capabilities\n\n### New Capabilities\n- `greeting`: greeting and farewell messages\n\n## Impact\n\nsrc/greet.js\n',
  'specs/greeting/spec.md': '# Spec Delta\n\n## Purpose\n\nProvide friendly messages.\n\n## ADDED Requirements\n\n### Requirement: Farewell message\nThe system SHALL produce a farewell message that includes the user\'s name.\n\n#### Scenario: Named farewell\n- **WHEN** Ada signs out\n- **THEN** the message is "Goodbye, Ada"\n',
  'design.md': '# Design\n\n## Context\nsrc/greet.js\n\n## Decisions\nAdd farewell next to greet.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
};

const DEBATE = [
  '', '## Debate', '', '### Position: simplicity and speed', 'A function next to greet is enough.', '',
  '### Position: robustness and safety', 'Escape the name before showing it.', '', '### Decision',
  'Add farewell next to greet and escape the name.', '',
].join('\n');

function project(debate: boolean) {
  const root = tempDir('sdlc-debate-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (debate) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.design = { debate: true };
    write(file, stringify(config));
  }
  expect(cli(['new', 'farewell', '--json']).code).toBe(0);
  const change = (rel: string) => path.join(root, 'openspec/changes/farewell', rel);
  for (const [rel, text] of Object.entries(FILES)) write(change(rel), text);
  expect(cli(['approve', 'intent', '--change', 'farewell', '--json']).code).toBe(0);
  const approveSpec = () => cli(['approve', 'spec', '--change', 'farewell', '--json']);
  return { root, cli, change, approveSpec };
}

describe('B20: the debate lens', () => {
  it('when on, the spec waits for both positions and the decision in design.md', () => {
    const p = project(true);
    const refused = p.approveSpec();
    expect(refused.code).toBe(1);
    expect(refused.json().status[0].code).toBe('debate_required');
    const half = DEBATE.replace(/### Position: robustness and safety[\s\S]*?(?=### Decision)/, '');
    write(p.change('design.md'), `${FILES['design.md']}${half}`);
    expect(p.approveSpec().json().status[0].code).toBe('debate_required');
    write(p.change('design.md'), `${FILES['design.md']}${DEBATE}`);
    const approved = p.approveSpec();
    expect(approved.code, approved.stdout + approved.stderr).toBe(0);
  }, 240000);

  // Review of 0.12.0: a code sample does not end the section; a template inside a code block does not count.
  it('code blocks neither end the debate nor fake one; `### Decision:` counts', () => {
    const p = project(true);
    const fenced = ['', '```md', '## Debate', '### Position: a', '### Position: b', '### Decision', 'TBD', '```', ''];
    write(p.change('design.md'), `${FILES['design.md']}${fenced.join('\n')}`);
    expect(p.approveSpec().json().status[0].code).toBe('debate_required');
    const withCode = DEBATE.replace('A function next to greet is enough.', 'Enough:\n```sh\n# run tests\nnpm test\n```')
      .replace('### Decision', '### Decision:');
    write(p.change('design.md'), `${FILES['design.md']}${withCode}`);
    const approved = p.approveSpec();
    expect(approved.code, approved.stdout + approved.stderr).toBe(0);
  }, 240000);

  it('negative: off by default, the spec is approved without a debate', () => {
    const p = project(false);
    const approved = p.approveSpec();
    expect(approved.code, approved.stdout + approved.stderr).toBe(0);
  }, 240000);

  it('the read-only advocate subagent ships with sdlc', () => {
    expect(read(path.join(REPO_ROOT, 'assets/agents/advocate.md'))).toMatch(/readonly: true/);
    expect(read(path.join(REPO_ROOT, 'assets/workflows/spec.md'))).toContain('## Debate');
  });
});
