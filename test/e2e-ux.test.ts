import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.5.0 end to end in one project: install for both tools with the status
 * line, get help, follow the Next: hints from the backlog to an approved
 * intent, see the stepper, the status line and the report diagrams.
 */
const INTENT = '# Intent: show claim stage\n\nAuthor: Pat. Status: draft. Source: backlog B1\n\n## Problem\nPolicyholders call support to learn the stage.\n\n## Proposed outcome\nThey see it in the portal.\n\n## Affected users and systems\nPolicyholders.\n\n## Constraints\nNone\n\n## Success measures\nFewer calls.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

describe('UX e2e (0.5.0)', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) => runCli(args, root, { ...env, ...extra }, input);
  const AGENT = { CLAUDECODE: '1' };
  const lastLine = (out: string) => out.trim().split('\n').filter((l) => l.trim()).at(-1) ?? '';

  beforeAll(() => {
    root = tempDir('sdlc-e2e-ux-');
    env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  });

  it('1. init for both tools with the status line; each tool gets its own UX wording', () => {
    expect(cli(['init', '--tools', 'claude,opencode', '--statusline', '--json']).code).toBe(0);
    expect(JSON.parse(read(path.join(root, '.claude/settings.json'))).statusLine.command).toBe('sdlc statusline');
    expect(read(path.join(root, '.claude/commands/sdlc/review.md'))).toMatch(/AskUserQuestion/);
    expect(read(path.join(root, '.opencode/commands/sdlc-review.md'))).toMatch(/`question` tool/);
    expect(read(path.join(root, '.opencode/commands/sdlc-help.md'))).toContain('!`sdlc help --json`');
    expect(fs.existsSync(path.join(root, '.claude/skills/sdlc-help/SKILL.md'))).toBe(true);
  });

  it('2. help lists the workflows and marks the decisions that belong to people', () => {
    const catalog = cli(['help', '--json']).json();
    expect(catalog.workflows.map((w: { id: string }) => w.id)).toContain('help');
    expect(catalog.commands.filter((c: { actor: string }) => c.actor === 'human').map((c: { name: string }) => c.name))
      .toEqual(expect.arrayContaining(['approve', 'track set', 'backlog move']));
    expect(cli(['help']).stdout).toMatch(/Decisions made by people/i);
  });

  it('3. from an empty project the hints lead through the backlog to an approved intent', () => {
    expect(cli(['next', '--json']).code).toBe(1);
    const added = cli(['backlog', 'add', 'Show claim stage', '--kind', 'feature', '--risk', 'low', '--outcome', 'policyholders see the stage', '--accept', 'in review shows', '--json'], AGENT);
    expect(added.code).toBe(0);
    const session = cli(['hook', 'session-start'], {}, JSON.stringify({ cwd: root, source: 'startup' }));
    expect(JSON.parse(session.stdout).hookSpecificOutput.additionalContext).toMatch(/sdlc backlog start B1/);
    const started = cli(['backlog', 'start', 'B1'], AGENT);
    expect(lastLine(started.stdout)).toMatch(/^Next: (agent|person) — /);
    write(path.join(root, 'openspec/changes/show-claim-stage/intent.md'), INTENT);
    const status = cli(['status', '--change', 'show-claim-stage']).stdout;
    expect(status).toMatch(/intent ● ─ spec ○/);
    const approved = cli(['approve', 'intent', '--change', 'show-claim-stage']);
    expect(approved.code, approved.stderr).toBe(0);
    expect(lastLine(approved.stdout)).toMatch(/^Next: agent — /);
    expect(cli(['status', '--change', 'show-claim-stage']).stdout).toMatch(/intent ✓ ─ spec ●/);
  });

  it('4. the status line and the report diagrams reflect the same state', () => {
    const line = cli(['statusline'], {}, JSON.stringify({ workspace: { current_dir: root } })).stdout.trim();
    expect(line).toMatch(/show-claim-stage/);
    expect(line.split('\n')).toHaveLength(1);
    const md = cli(['report', '--format', 'md']).stdout;
    expect(md).toMatch(/```mermaid[\s\S]*show-claim-stage[\s\S]*```/);
  });

  it('5. people keep their decisions: the agent cannot reprioritize or set the license, even via the hook', () => {
    expect(cli(['backlog', 'move', 'B1', '--top', '--json'], AGENT).json().status[0].code).toBe('agent_cannot_prioritize');
    const denied = cli(['hook', 'pre-tool'], {}, JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command: 'sdlc license set commercial --agreement X' } }));
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
