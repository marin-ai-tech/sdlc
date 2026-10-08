import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.12.0 (docs/ru/26, B21): `sdlc audit --export <dir>` bundles, for auditors, every approval with its signature and
 * trailer status, the change files and the project log of the period. Nothing outside openspec/ is included.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-export-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/demo/intent.md'), INTENT);
  expect(cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
  write(path.join(root, 'src/secret.txt'), 'not for auditors\n');
  return { root, cli };
}

/** Every file under `dir`, relative, with forward slashes. */
function files(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
}

describe('B21: evidence export for auditors', () => {
  it('the bundle lists every approval with its signature status, the change files and the log', () => {
    const p = project();
    const out = path.join(tempDir('sdlc-export-out-'), 'bundle');
    const r = p.cli(['audit', '--export', out, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const index = JSON.parse(read(path.join(out, 'index.json')));
    expect(index.approvals).toEqual([expect.objectContaining({
      change: 'demo', gate: 'intent', signature: 'not-checked', trailer: 'missing',
    })]);
    expect(index.approvals[0].digest).toMatch(/^sha256:/);
    const listed = files(out);
    expect(listed).toContain('index.md');
    expect(listed).toContain('log.jsonl');
    expect(listed).toContain('changes/demo/intent.md');
    expect(listed).toContain('changes/demo/.sdlc.yaml');
    // Negative: nothing outside openspec/ is included.
    expect(listed.filter((file) => !/^(index\.(json|md)|log\.jsonl|changes\/)/.test(file))).toEqual([]);
    expect(listed.some((file) => file.includes('secret'))).toBe(false);
  }, 180000);

  it('negative: --since leaves older log entries out, and an existing non-empty folder is refused', () => {
    const p = project();
    const log = path.join(p.root, 'openspec/.sdlc/log.jsonl');
    fs.appendFileSync(log, `${JSON.stringify({ ts: '2020-01-01T00:00:00Z', event: 'old.event', sdlc: '0.1', license: 'x' })}\n`);
    const out = path.join(tempDir('sdlc-export-out-'), 'bundle');
    expect(p.cli(['audit', '--export', out, '--since', '2026-01-01', '--json']).code).toBe(0);
    expect(read(path.join(out, 'log.jsonl'))).not.toContain('old.event');
    const again = p.cli(['audit', '--export', out, '--json']);
    expect(again.code).toBe(1);
    expect(again.json().status[0].code).toBe('invalid_option');
  }, 180000);
});
