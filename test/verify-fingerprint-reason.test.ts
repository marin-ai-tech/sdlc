import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaultConfig, loadConfig } from '../src/core/config.js';
import { stopCheck } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { runVerification, toVerifyRecord } from '../src/core/verify.js';
import { withMcpChecks } from '../src/mcp/checks.js';
import { BIN, humanEnv, read, tempDir, write } from './helpers.js';

/**
 * F7 (close-the-digest-integrity-review-findings): since B126 a verify run without a worktree fingerprint is failed
 * even when every check passed, and that stays. But the run said nothing about why: the text told the user to "fix
 * the code (not the tests)", JSON and the stored record had no reason, and the verify gate (so the stop-hook detail)
 * said only that the last run failed. When the missing fingerprint is the only cause (every required check and
 * required MCP check passed, the run was not partial, at least one check ran), the run, its record, JSON, text and
 * the gate now name it as `fingerprint_unavailable`. Any other cause keeps the old message and no reason.
 *
 * Every project here has no git repository, so no fingerprint can exist; a guard checks that first.
 */

const REASON = 'fingerprint_unavailable';
const CLI_TIMEOUT = 60000;
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/a.js` (new)\n\n## Order of work\n1. Do.\n\n## Proof\n'
  + '`node -e 0`\n\n## Rollback\nRevert.\n';
const DONE_TASKS = '# Tasks\n\n## 1. Work\n\n- [x] 1.1 Do it and verify node -e 0 passes\n';

type Command = { name: string; run: string; required: boolean };

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8', timeout: CLI_TIMEOUT });
  return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function expectNoRepository(root: string): void {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf-8', timeout: 30000 });
  expect(r.status, `the fixture is inside a git repository: ${r.stdout}`).not.toBe(0);
}

/** A project without git whose change "demo" is past its plan with every task done. */
function project(commands: Command[]) {
  const root = tempDir('sdlc-verify-reason-');
  expectNoRepository(root);
  // No repository means no repository config: the person who sets the planning gates aside comes from the
  // environment's git config.
  const env = humanEnv(tempDir('sdlc-home-'), {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: 'Pat',
    GIT_CONFIG_KEY_1: 'user.email',
    GIT_CONFIG_VALUE_1: 'pat@example.com',
  });
  const cli = (args: string[]) => run(args, root, env);
  const ok = (args: string[]) => {
    const r = cli([...args, '--json']);
    expect(r.code, r.out).toBe(0);
  };
  ok(['init', '--tools', 'none']);
  write(path.join(root, 'ok.cjs'), 'process.exit(0);\n');
  write(path.join(root, 'fail.cjs'), 'process.exit(1);\n');
  const configFile = path.join(root, 'openspec', 'sdlc.yaml');
  const config = parse(read(configFile));
  config.enforcement.verify_before_stop = true;
  config.verify.commands = commands;
  write(configFile, stringify(config));
  const dir = path.join(root, 'openspec', 'changes', 'demo');
  ok(['new', 'demo']);
  write(path.join(dir, 'intent.md'), INTENT);
  for (const gate of ['intent', 'spec', 'plan']) ok(['waive', gate, '--change', 'demo', '--note', 'test']);
  write(path.join(dir, 'plan.md'), PLAN);
  write(path.join(dir, 'tasks.md'), DONE_TASKS);
  const record = () => parse(fs.readFileSync(path.join(dir, '.sdlc.yaml'), 'utf8')).verify;
  const stop = () => {
    const paths = projectPaths(root);
    return stopCheck({ paths, config: loadConfig(paths.sdlcConfig) });
  };
  return { root, cli, record, stop };
}

const passing: Command = { name: 'unit', run: 'node ok.cjs', required: true };
const failing: Command = { name: 'lint', run: 'node fail.cjs', required: true };

describe('F7: a verify run without a fingerprint names the reason', () => {
  it('a command run without git is recorded as failed', () => {
    const p = project([passing]);
    const r = p.cli(['verify', '--change', 'demo', '--json']);
    expect(r.code, r.out).toBe(1);
    const json = JSON.parse(r.stdout);
    expect(json.status).toBe('failed');
    expect(json.checks.map((c: { exit_code: number }) => c.exit_code)).toEqual([0]);
    expect(p.record().status).toBe('failed');
    expect(p.record().fingerprint).toBeUndefined();
  }, 180000);

  it('names fingerprint_unavailable in JSON, the record, the text and the stop-hook detail', () => {
    const p = project([passing]);
    const json = p.cli(['verify', '--change', 'demo', '--json']);
    expect(json.code, json.out).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 'failed', reason: REASON });
    expect(p.record()).toMatchObject({ status: 'failed', reason: REASON });

    const text = p.cli(['verify', '--change', 'demo']);
    expect(text.code, text.out).toBe(1);
    expect(text.out).toMatch(/fingerprint/i);
    expect(text.out).not.toMatch(/fix the code/i);

    const detail = p.stop();
    expect(detail, 'the stop is not blocked').toBeDefined();
    expect(detail).toContain('demo');
    expect(detail).toMatch(/fingerprint/i);
  }, 180000);

  it('a failing check without git has no reason and keeps the failed-checks message', () => {
    const p = project([passing, failing]);
    const json = p.cli(['verify', '--change', 'demo', '--json']);
    expect(json.code, json.out).toBe(1);
    expect(JSON.parse(json.stdout).status).toBe('failed');
    expect(JSON.parse(json.stdout)).not.toHaveProperty('reason');
    expect(p.record()).not.toHaveProperty('reason');
    const text = p.cli(['verify', '--change', 'demo']);
    expect(text.out).toMatch(/fix the code/i);
    expect(p.stop()).not.toMatch(/fingerprint/i);
  }, 180000);

  it('a partial run without git has no reason', () => {
    const p = project([passing, { name: 'other', run: 'node ok.cjs', required: true }]);
    const json = p.cli(['verify', '--change', 'demo', '--only', 'unit', '--json']);
    expect(json.code, json.out).toBe(1);
    expect(JSON.parse(json.stdout).status).toBe('failed');
    expect(JSON.parse(json.stdout)).not.toHaveProperty('reason');
    expect(p.record()).not.toHaveProperty('reason');
  }, 180000);

  it('an MCP-only run without git carries the reason, and a failed MCP check does not', async () => {
    const root = tempDir('sdlc-verify-reason-mcp-');
    expectNoRepository(root);
    const config = defaultConfig();
    config.verify.commands = [];
    config.verify.mcp = [{ name: 'ci', server: 'build', tool: 'status', args: {}, required: true }];
    const base = await runVerification(root, config);
    expect(base.fingerprint).toBeUndefined();
    const check = (ok: boolean) => [{ name: 'ci', server: 'build', tool: 'status', required: true, ok,
      duration_ms: 1, result: {} }];

    const passed = withMcpChecks(base, config, check(true));
    expect(passed.status).toBe('failed');
    expect((passed as { reason?: string }).reason).toBe(REASON);
    expect((toVerifyRecord(passed) as { reason?: string }).reason).toBe(REASON);

    const failed = withMcpChecks(base, config, check(false));
    expect(failed.status).toBe('failed');
    expect(failed).not.toHaveProperty('reason');
    expect(toVerifyRecord(failed)).not.toHaveProperty('reason');
  }, 60000);

  it('a failing MCP check removes the reason that passing commands carried (review round 1, F8)', async () => {
    const root = tempDir('sdlc-verify-reason-mcp-');
    expectNoRepository(root);
    write(path.join(root, 'ok.cjs'), 'process.exit(0);\n');
    const config = defaultConfig();
    config.verify.commands = [passing];
    config.verify.mcp = [{ name: 'ci', server: 'build', tool: 'status', args: {}, required: true }];
    const base = await runVerification(root, config);
    expect(base.checks.map((check) => check.exit_code)).toEqual([0]);
    expect((base as { reason?: string }).reason).toBe(REASON);
    const failed = withMcpChecks(base, config, [{ name: 'ci', server: 'build', tool: 'status', required: true,
      ok: false, duration_ms: 1, result: {} }]);
    expect(failed.status).toBe('failed');
    expect(failed).not.toHaveProperty('reason');
    expect(toVerifyRecord(failed)).not.toHaveProperty('reason');
  }, 120000);
});
