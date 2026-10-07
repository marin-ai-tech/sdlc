import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B47: `release.mcp` checks, in the format of `verify.mcp`, are called by the CLI when a person approves the release:
 * `sdlc approve release` is refused while a required check fails (`release_checks_failed`, with the reason), and the
 * results are recorded with the approval. `sdlc release check --change <id>` runs them beforehand without approving;
 * it writes nothing and any actor may run it.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const CHECK = {
  name: 'chg-approved', server: 'servicenow', tool: 'pipeline_status', args: { ref: '${CHANGE}' },
  expect: { status: 'success' },
};

function project() {
  const root = tempDir('sdlc-release-checks-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.gates.release.required = true;
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  config.mcp = { servers: { servicenow: { type: 'stdio', command: ['node', FAKE], stages: ['deploy'] } } };
  config.release.mcp = [CHECK];
  write(file, stringify(config));
  expect(cli(['new', 'add-x', '--json']).code).toBe(0);
  const change = (name: string) => path.join(root, 'openspec/changes/add-x', name);
  write(change('tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  for (const gate of ['intent', 'spec', 'plan']) {
    expect(cli(['waive', gate, '--change', 'add-x', '--note', 't', '--json']).code, gate).toBe(0);
  }
  expect(cli(['verify', '--change', 'add-x', '--json']).code).toBe(0);
  write(change('review.md'), '# Review: add-x\n\n## Findings\n\nNone.\n');
  expect(cli(['waive', 'review', '--change', 'add-x', '--note', 't', '--json']).code).toBe(0);
  write(change('release.md'), '# Release: add-x\n\nNotes.\n');
  const record = () => read(change('.sdlc.yaml'));
  return { cli, record };
}

describe('MCP checks in the release gate', () => {
  it('refuse the release approval while a required check fails, and change nothing', () => {
    const p = project();
    const before = p.record();
    const r = p.cli(['approve', 'release', '--change', 'add-x', '--json'], { FAKE_STATUS: 'pending' });
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('release_checks_failed');
    expect(r.stdout).toContain('chg-approved');
    expect(p.record()).toBe(before);
  }, 240000);

  it('let the approval through when they pass, and record their results with it', () => {
    const p = project();
    const r = p.cli(['approve', 'release', '--change', 'add-x', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const state = parse(p.record());
    expect(JSON.stringify(state.gates.release)).toContain('chg-approved');
  }, 240000);

  it('sdlc release check runs them beforehand, for anyone, and writes nothing', () => {
    const p = project();
    const before = p.record();
    const red = p.cli(['release', 'check', '--change', 'add-x', '--json'], { CLAUDECODE: '1', FAKE_STATUS: 'pending' });
    expect(red.json().mcp[0]).toMatchObject({ name: 'chg-approved', ok: false });
    const green = p.cli(['release', 'check', '--change', 'add-x', '--json'], { CLAUDECODE: '1' });
    expect(green.code, green.stdout + green.stderr).toBe(0);
    expect(green.json().mcp[0]).toMatchObject({ name: 'chg-approved', ok: true, result: { ref: 'add-x' } });
    expect(p.record()).toBe(before);
  }, 240000);
});
