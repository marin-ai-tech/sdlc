import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * 0.14.0 defect found in the live Codex check: `sdlc init --cli "node C:/tools/sdlc.js"` wrote a value that loading the
 * configuration then refused (a drive letter's colon), so every later command failed and the hooks let everything
 * through. The colon is allowed now; a value that is still refused is refused by init before anything is written.
 */

function repo() {
  const root = tempDir('sdlc-cli-value-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  return { root, cli: (args: string[]) => runCli(args, root, env) };
}

describe('the cli value', () => {
  it('a Windows path with a drive letter works for init and every later command', () => {
    const p = repo();
    const init = p.cli(['init', '--tools', 'none', '--cli', 'node C:/tools/sdlc/bin/sdlc.js', '--json']);
    expect(init.code, init.stdout + init.stderr).toBe(0);
    expect(p.cli(['status', '--json']).code).toBe(0);
  }, 120000);

  it('negative: a value with shell characters is refused by init, and nothing is written', () => {
    const p = repo();
    const r = p.cli(['init', '--tools', 'none', '--cli', 'sdlc; rm -rf ~', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('invalid_config');
    expect(fs.existsSync(path.join(p.root, 'openspec'))).toBe(false);
  }, 120000);
});
