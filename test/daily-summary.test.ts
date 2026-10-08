import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir } from './helpers.js';

/**
 * 0.12.0 (docs/ru/26, B25): an example script, shipped with sdlc, writes a daily summary file from `sdlc report`
 * (done, next, blocked, waiting on people). It publishes nothing by itself.
 */

const SCRIPT = path.join(REPO_ROOT, 'assets/examples/daily-summary.mjs');

describe('B25: the daily summary example', () => {
  it('runs like a scheduler would and writes the summary file', () => {
    const root = tempDir('sdlc-daily-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    expect(runCli(['new', 'demo', '--json'], root, env).code).toBe(0);
    const out = tempDir('sdlc-daily-out-');
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out], {
      cwd: root, encoding: 'utf-8', env: { ...env, SDLC_BIN: `"${process.execPath}" "${BIN}"` }, timeout: 120000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const written = fs.readdirSync(out).filter((name) => /^daily-summary-\d{4}-\d{2}-\d{2}\.md$/.test(name));
    expect(written).toHaveLength(1);
    const text = read(path.join(out, written[0]));
    for (const heading of ['## Done', '## Next', '## Blocked', '## Waiting on people']) expect(text).toContain(heading);
    expect(text).toContain('demo');
  }, 180000);

  it('negative: --since must be a date, so it cannot carry a shell command', () => {
    const out = tempDir('sdlc-daily-out-');
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out, '--since', '2026-10-01 & echo hacked'], {
      cwd: tempDir('sdlc-daily-cwd-'), encoding: 'utf-8', timeout: 60000,
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain('hacked');
    expect(fs.readdirSync(out)).toEqual([]);
  }, 120000);

  it('negative: the example opens no network connection and calls no messaging tool', () => {
    const text = read(SCRIPT);
    expect(text).not.toMatch(/\b(fetch|https?:|node:https?|node:net|WebSocket|curl|smtp)\b/i);
  });
});
