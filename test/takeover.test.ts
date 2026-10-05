import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B4: a person takes a change over; while it is theirs the hook denies agent edits in the change folder and in the
 * files of plan.md "Files that change" (without plan.md: in the whole project); handing it back leaves a note the
 * agent sees.
 */

const PLAN = '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n- `test/greet.test.js` (new)\n\n## Order of work\n1. Test.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n';
const AGENT = { CLAUDECODE: '1' };

function project(withPlan = true) {
  const root = tempDir('sdlc-takeover-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/add-farewell');
  if (withPlan) write(path.join(dir, 'plan.md'), PLAN);
  const decide = (file: string) => {
    const ctx = { paths: projectPaths(root), config: loadConfig(path.join(root, 'openspec/sdlc.yaml')) };
    return evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, file) }, root), ctx);
  };
  return { root, cli, dir, decide };
}

describe('sdlc takeover and release-control', () => {
  it('while a person holds the change, agent edits of its folder and plan files are denied with who and why', () => {
    const p = project();
    const r = p.cli(['takeover', '--change', 'add-farewell', '--note', 'I will fix the migration myself', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(parse(read(path.join(p.dir, '.sdlc.yaml'))).takeover).toMatchObject({ note: 'I will fix the migration myself' });
    for (const file of ['openspec/changes/add-farewell/plan.md', 'src/greet.js', 'test/greet.test.js']) {
      const decision = p.decide(file);
      expect(decision, file).toMatchObject({ decision: 'deny', rule: 'takeover' });
      expect(decision.reason, file).toMatch(/Pat Owner/);
      expect(decision.reason, file).toMatch(/migration myself/);
    }
    expect(p.decide('src/other.js').decision).not.toBe('deny');
    const next = p.cli(['next', '--change', 'add-farewell', '--json'], AGENT).json();
    expect(next.next ?? next).toMatchObject({ actor: 'human', action: 'taken-over' });
  }, 180000);

  it('without plan.md the agent is paused in the whole project for this change', () => {
    const p = project(false);
    expect(p.cli(['takeover', '--change', 'add-farewell', '--note', 'pause', '--json']).code).toBe(0);
    expect(p.decide('src/other.js')).toMatchObject({ decision: 'deny', rule: 'takeover' });
  }, 180000);

  it('release-control hands the change back with a note the agent sees, and edits are allowed again', () => {
    const p = project();
    expect(p.cli(['takeover', '--change', 'add-farewell', '--note', 'mine', '--json']).code).toBe(0);
    const r = p.cli(['release-control', '--change', 'add-farewell', '--note', 'Migration fixed, carry on', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(p.decide('src/greet.js').decision).not.toBe('deny');
    expect(parse(read(path.join(p.dir, '.sdlc.yaml'))).takeover).toBeUndefined();
    const session = p.cli(['hook', 'session-start'], AGENT).stdout;
    expect(session).toMatch(/Migration fixed, carry on/);
    const events = read(path.join(p.root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(expect.arrayContaining(['change.takeover', 'change.released']));
  }, 180000);

  it('only a person: the CLI refuses an agent, the hook denies both commands, help marks them human', () => {
    const p = project();
    const r = p.cli(['takeover', '--change', 'add-farewell', '--note', 'n', '--json'], AGENT);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_approve');
    const ctx = { paths: projectPaths(p.root), config: loadConfig(path.join(p.root, 'openspec/sdlc.yaml')) };
    for (const command of ['sdlc takeover --change x --note n', 'sdlc release-control --change x --note n']) {
      const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, p.root), ctx);
      expect(decision, command).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    }
    const commands = p.cli(['help', '--json']).json().commands as Array<{ name: string; actor: string }>;
    expect(commands.find((c) => c.name === 'takeover')).toMatchObject({ actor: 'human' });
    expect(commands.find((c) => c.name === 'release-control')).toMatchObject({ actor: 'human' });
  }, 180000);

  it('negative: a note is required; release-control of a change nobody holds is refused', () => {
    const p = project();
    const noNote = p.cli(['takeover', '--change', 'add-farewell', '--json']);
    expect(noNote.code).toBe(1);
    expect(noNote.json().status[0].code).toBe('note_required');
    const free = p.cli(['release-control', '--change', 'add-farewell', '--note', 'n', '--json']);
    expect(free.code).toBe(1);
    expect(free.json().status[0].code).toBe('invalid_transition');
  }, 180000);
});
