import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * A defect found by the course videos (0.20.2, module 09): in Russian, `sdlc next` and the Claude Code status line
 * printed the stage in English ("add-farewell: Plan (intent)") while `sdlc status` printed it in Russian. Both now
 * take the stage title from the catalog, like status.
 */

function project() {
  const root = tempDir('sdlc-stage-locale-');
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_LOCALE: 'ru' });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], input?: string) => runCli(args, root, env, input);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-farewell/intent.md'), FILES['intent.md']);
  return { root, cli };
}

describe('the stage title in the reader\'s language', () => {
  it('sdlc next and the status line name the stage as sdlc status does', () => {
    const p = project();
    const status = p.cli(['status', '--change', 'add-farewell']).stdout;
    const stageLine = status.split('\n').find((line) => /^\s+(стадия|stage)\s/.test(line)) ?? '';
    const title = stageLine.replace(/^\s+\S+\s+/, '').trim();
    expect(title).toMatch(/[А-Яа-яЁё]/);
    const next = p.cli(['next', '--change', 'add-farewell']).stdout.split('\n')[0];
    expect(next).toContain(title);
    expect(next).not.toMatch(/\((intent|verification evidence|review \+ release)\)/);
    const statusLine = p.cli(['statusline'], JSON.stringify({ cwd: p.root })).stdout;
    expect(statusLine).toContain(title);
  }, 180000);
});
