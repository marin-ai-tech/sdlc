import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.3 (docs/ru/23, B53): `sdlc explain --change <id>` says why a change is where it is: the stage, the open gate
 * and its reason, what it waits for, what unblocks it, and the latest decisions. Anyone may run it; it writes nothing.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

/** Every file under `dir` with its content, sorted; empty when `dir` does not exist. */
function tree(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const lines = files.map((entry) => path.join(entry.parentPath, entry.name));
  return lines.sort().map((file) => `${file}\n${fs.readFileSync(file, 'utf-8')}`).join('\n');
}

function project() {
  const root = tempDir('sdlc-explain-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  const intent = path.join(root, 'openspec/changes/demo/intent.md');
  const explain = (extra: NodeJS.ProcessEnv = {}) => {
    const r = cli(['explain', '--change', 'demo', '--json'], extra);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json();
  };
  return { root, cli, intent, explain };
}

describe('B53: sdlc explain', () => {
  it('a missing artifact: the agent writes it', () => {
    const p = project();
    const out = p.explain();
    expect(out).toMatchObject({ change: 'demo', gate: { id: 'intent' } });
    expect(typeof out.stage).toBe('string');
    expect(out.waitingFor.actor).toBe('agent');
    expect(JSON.stringify(out.unblock)).toMatch(/intent\.md/);
  }, 180000);

  it('a ready artifact: a person approves it, with the command', () => {
    const p = project();
    write(p.intent, INTENT);
    const out = p.explain();
    expect(out.gate).toMatchObject({ id: 'intent', status: 'pending' });
    expect(out.waitingFor.actor).toBe('human');
    expect(out.unblock.map((step: { cli?: string }) => step.cli ?? '').join('\n'))
      .toContain('sdlc approve intent --change demo');
  }, 180000);

  it('after a rework it names the reason and the note, and lists the recent decisions', () => {
    const p = project();
    write(p.intent, INTENT);
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    const note = 'Name the users who print receipts';
    expect(p.cli(['rework', 'intent', '--change', 'demo', '--reason', 'missing-requirement', '--note', note,
      '--json']).code).toBe(0);
    const out = p.explain();
    expect(out.gate).toMatchObject({ id: 'intent', status: 'rejected' });
    expect(out.gate.rework).toMatchObject({ reason: 'missing-requirement', note });
    const events = out.recent.map((e: { event: string }) => e.event);
    expect(events).toContain('gate.intent.rework');
    expect(out.recent.length).toBeLessThanOrEqual(5);
  }, 180000);

  it('negative: it writes nothing, also when an agent runs it', () => {
    const p = project();
    write(p.intent, INTENT);
    // The change record, the whole openspec/.sdlc folder (log, inbox, awaiting entries) and the event outbox.
    const snapshot = () => [path.join(p.root, 'openspec'), path.join(p.root, '.git/sdlc')].map(tree).join('\n');
    const before = snapshot();
    p.explain({ SDLC_AGENT: 'test' });
    p.explain();
    expect(snapshot()).toBe(before);
  }, 180000);

  it('negative: an unknown change is an error, not an empty explanation', () => {
    const p = project();
    const r = p.cli(['explain', '--change', 'nope', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).not.toBe(undefined);
  }, 180000);
});
