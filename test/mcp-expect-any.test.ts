import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { pendingMatch, subsetMismatch } from '../src/mcp/checks.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B95 (0.16.0): `expect` and `wait_while` of a `verify.mcp` / `release.mcp` check match a list item by item and by
 * length, so "one of the runs succeeded" could not be said. `{ $any: <pattern> }` in place of a list matches when at
 * least one item of the answer's list contains the pattern. Plain lists keep their exact meaning. Any other key that
 * starts with `$`, or `$any` next to other keys, is an invalid configuration.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const AGENT = { CLAUDECODE: '1' };
const RUNS = (...conclusions: string[]) => JSON.stringify(conclusions.map((conclusion, i) => ({ id: i, conclusion })));

describe('B95: $any in expect and wait_while (unit)', () => {
  const pattern = { workflow_runs: { $any: { conclusion: 'success' } } };

  it('matches when one item of the list contains the pattern', () => {
    const answer = { workflow_runs: [{ conclusion: 'failure' }, { conclusion: 'success', id: 2 }] };
    expect(subsetMismatch(pattern, answer)).toBeUndefined();
  });

  it('negative: no item, an empty list or no list at all is a mismatch at that key', () => {
    expect(subsetMismatch(pattern, { workflow_runs: [{ conclusion: 'failure' }] })?.key).toBe('workflow_runs');
    expect(subsetMismatch(pattern, { workflow_runs: [] })?.key).toBe('workflow_runs');
    expect(subsetMismatch(pattern, { workflow_runs: { conclusion: 'success' } })?.key).toBe('workflow_runs');
  });

  it('negative: a plain list still matches item by item and by length', () => {
    expect(subsetMismatch({ runs: [{ a: 1 }] }, { runs: [{ a: 1 }, { a: 2 }] })).toBeDefined();
    expect(subsetMismatch({ runs: [{ a: 1 }] }, { runs: [{ a: 1, b: 2 }] })).toBeUndefined();
  });

  it('wait_while: $any waits while any run is still pending; a list of values still means any of them', () => {
    const waiting = { workflow_runs: { $any: { status: ['queued', 'in_progress'] } } };
    expect(pendingMatch(waiting, { workflow_runs: [{ status: 'completed' }, { status: 'queued' }] })).toBe(true);
    expect(pendingMatch(waiting, { workflow_runs: [{ status: 'completed' }] })).toBe(false);
    expect(pendingMatch({ status: ['queued', 'in_progress'] }, { status: 'queued' })).toBe(true);
  });
});

function project(check: Record<string, unknown>) {
  const root = tempDir('sdlc-mcp-any-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', FAKE], stages: ['build', 'test'] } } };
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  config.verify.mcp = [{ name: 'ci-green', server: 'build', tool: 'pipeline_status', args: { ref: 'main' }, ...check }];
  write(file, stringify(config));
  const verify = (extra: NodeJS.ProcessEnv = {}) =>
    cli(['verify', '--change', 'add-export', '--json'], { ...AGENT, ...extra });
  return { cli, verify };
}

describe('B95: $any in a real verify.mcp check', () => {
  it('passes when one run succeeded, fails when none did', () => {
    const p = project({ expect: { workflow_runs: { $any: { conclusion: 'success' } } } });
    const passed = p.verify({ FAKE_RUNS: RUNS('failure', 'success') });
    expect(passed.code, passed.stdout + passed.stderr).toBe(0);
    expect(passed.json().mcp[0]).toMatchObject({ name: 'ci-green', ok: true });
    const failed = p.verify({ FAKE_RUNS: RUNS('failure', 'cancelled') });
    expect(failed.json().mcp[0].ok).toBe(false);
  }, 180000);

  it('negative: an unknown $ key or $any next to other keys is an invalid configuration', () => {
    const unknown = project({ expect: { workflow_runs: { $all: { conclusion: 'success' } } } });
    const r1 = unknown.cli(['verify', '--list', '--json']);
    expect(r1.code).not.toBe(0);
    expect(r1.json().status[0].code).toBe('invalid_config');
    const mixed = project({ expect: { workflow_runs: { $any: { conclusion: 'success' }, extra: 1 } } });
    expect(mixed.cli(['verify', '--list', '--json']).json().status[0].code).toBe('invalid_config');
  }, 180000);
});
