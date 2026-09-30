import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

const INTENT = '# Intent: x\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

function project() {
  const root = tempDir('sdlc-hints-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) => runCli(args, root, { ...env, ...extra }, input);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

/** The last non-empty line of text output. */
const lastLine = (out: string) => out.trim().split('\n').filter((l) => l.trim()).at(-1) ?? '';

describe('Next: hints after commands that change state', () => {
  it('new, approve and track set end with who acts next and how', () => {
    const { root, cli } = project();
    const created = cli(['new', 'add-export']);
    expect(lastLine(created.stdout)).toMatch(/^Next: agent — .*\/sdlc(:|-)intent|^Next: agent — .*intent/i);
    write(path.join(root, 'openspec/changes/add-export/intent.md'), INTENT);
    const status = cli(['next', '--change', 'add-export', '--json']).json();
    expect(status.next.actor).toBe('human');
    const approved = cli(['approve', 'intent', '--change', 'add-export']);
    expect(approved.code, approved.stderr).toBe(0);
    expect(lastLine(approved.stdout)).toMatch(/^Next: agent — /);
    cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'low']);
    const set = cli(['track', 'set', 'lite', '--change', 'fix-typo']);
    expect(lastLine(set.stdout)).toMatch(/^Next: /);
  });

  it('JSON output carries the same next action', () => {
    const { cli } = project();
    const r = cli(['new', 'add-export', '--json']).json();
    expect(r.next).toMatchObject({ actor: 'agent' });
    const a = cli(['backlog', 'add', 'Show stage', '--outcome', 'see it', '--accept', 'works', '--json']).json();
    expect(a.item.id).toBe('B1');
    const started = cli(['backlog', 'start', 'B1', '--json']).json();
    expect(started.next).toMatchObject({ actor: expect.stringMatching(/agent|human/) });
  });

  it('when a person must act, the hint is the exact command for their terminal', () => {
    const { root, cli } = project();
    cli(['new', 'add-export']);
    write(path.join(root, 'openspec/changes/add-export/intent.md'), INTENT);
    const r = cli(['defer', 'add', 'Later', '--why', 'not now', '--change', 'add-export']);
    expect(lastLine(r.stdout)).toMatch(/^Next: person — .*sdlc approve intent --change add-export/);
  });

  it('negative: read-only commands do not print hints', () => {
    const { cli } = project();
    cli(['new', 'add-export']);
    expect(cli(['status']).stdout).not.toMatch(/^Next: /m);
    expect(cli(['backlog', 'list']).stdout).not.toMatch(/^Next: /m);
  });
});

describe('session start context', () => {
  it('with no active change it names the next ready backlog item', () => {
    const { root, cli } = project();
    cli(['backlog', 'add', 'Show stage', '--outcome', 'see it', '--accept', 'works', '--json']);
    const r = cli(['hook', 'session-start'], {}, JSON.stringify({ cwd: root, source: 'startup' }));
    expect(r.code).toBe(0);
    const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(context).toMatch(/B1/);
    expect(context).toMatch(/sdlc backlog start B1/);
  });

  it('negative: with no change and an empty backlog it stays silent', () => {
    const { root, cli } = project();
    const r = cli(['hook', 'session-start'], {}, JSON.stringify({ cwd: root, source: 'startup' }));
    expect(r.stdout.trim()).toBe('');
  });
});
