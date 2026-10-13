import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * Defects found by a real-user run of 0.20.1 (the training video): `sdlc status` in Russian showed
 * "Анна <…> as product-owner" (an English word in the code, not in the catalog), and with no active change it named
 * `/sdlc-intent (OpenCode)` in a project set up for Claude Code only. Now the approver line comes from the catalog
 * and the start hint names the project's own tools (or only `sdlc new` when there are none).
 */

function project(tools: string) {
  const root = tempDir('sdlc-status-user-');
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_LOCALE: 'ru' });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  return { root, cli };
}

describe('sdlc status as a person reads it', () => {
  it('the approver line is in the reader\'s language', () => {
    const p = project('none');
    expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/add-farewell/intent.md'), FILES['intent.md']);
    const approved = p.cli(['approve', 'intent', '--change', 'add-farewell']);
    expect(approved.code).toBe(0);
    // The approval line does not guess the person's gender ("Анна … утвердил" was a defect).
    expect(approved.stdout).toMatch(/гейт intent утверждён: .*, роль product-owner/);
    expect(approved.stdout).not.toMatch(/утвердил /);
    const text = p.cli(['status', '--change', 'add-farewell']).stdout;
    const intentLine = text.split('\n').find((line) => /^ {4}intent /.test(line)) ?? '';
    expect(intentLine).toContain('product-owner');
    expect(intentLine).not.toMatch(/ as /);
  }, 180000);

  it('with no active change, the hint names the project\'s tools only', () => {
    const claude = project('claude');
    const hint = claude.cli(['status']).stdout;
    expect(hint).toContain('/sdlc:intent');
    expect(hint).not.toContain('OpenCode');
    const none = project('none');
    const plain = none.cli(['status']).stdout;
    expect(plain).toContain('sdlc new');
    expect(plain).not.toContain('/sdlc:intent');
  }, 180000);
});
