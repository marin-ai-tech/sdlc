import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installedLocales } from '../src/core/i18n.js';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * Defects found by a real-user run of 0.20.1 (the training video): `sdlc status` in another language showed
 * "<name> as product-owner" (an English word in the code, not in the catalog), and with no active change it named
 * `/sdlc-intent (OpenCode)` in a project set up for Claude Code only. Now the approver line comes from the catalog
 * and the start hint names the project's own tools (or only `sdlc new` when there are none).
 */

/** An interface language other than English installed in this checkout; the repository itself carries English only. */
const OTHER_LOCALE = installedLocales().find((code) => code !== 'en');

function project(tools: string, locale = 'xx') {
  const root = tempDir('sdlc-status-user-');
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_LOCALE: locale });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  return { root, cli };
}

describe('sdlc status as a person reads it', () => {

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
  it.skipIf(!OTHER_LOCALE)('the approver line is in the reader\'s language', () => {
    const p = project('none', OTHER_LOCALE);
    expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/add-farewell/intent.md'), FILES['intent.md']);
    const approved = p.cli(['approve', 'intent', '--change', 'add-farewell']);
    expect(approved.code).toBe(0);
    const text = p.cli(['status', '--change', 'add-farewell']).stdout;
    const intentLine = text.split('\n').find((line) => /^ {4}intent /.test(line)) ?? '';
    expect(intentLine).toContain('product-owner');
    expect(intentLine).not.toMatch(/ as /);
  }, 180000);
});
