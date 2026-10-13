import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B94 (0.17.0): `sdlc ci init --provider github|gitlab` writes a starter CI configuration that runs the sdlc checks
 * on a full clone (approvals verify refuses a shallow one since 0.16.3): it installs this sdlc version and runs
 * `sdlc validate --all` and `sdlc approvals verify`. An existing file is kept (`--force` replaces it). For GitLab the
 * jobs go to .gitlab/sdlc.yml; .gitlab-ci.yml is created with an `include` only when there is none, never edited.
 * `--check <server>` adds a ready `ci-green` check to verify.mcp for that registry server (`${HEAD}`, `$any`, a wait
 * for a pending run). CI configuration is a person's decision: an agent is refused by the CLI and the hook.
 */

const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version as string;
const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

function project(tools = 'none') {
  const root = tempDir('sdlc-ci-init-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  const file = (rel: string) => path.join(root, rel);
  return { root, cli, file };
}

type Step = { run?: string; with?: Record<string, unknown>; uses?: string };

describe('B94: sdlc ci init', () => {
  it('github: a workflow on a full clone that installs this version and runs the sdlc checks', () => {
    const p = project();
    const r = p.cli(['ci', 'init', '--provider', 'github', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const text = read(p.file('.github/workflows/sdlc.yml'));
    const workflow = parse(text);
    const steps: Step[] = Object.values(workflow.jobs as Record<string, { steps: Step[] }>).flatMap((job) => job.steps);
    const checkout = steps.find((step) => String(step.uses ?? '').startsWith('actions/checkout'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    const runs = steps.map((step) => step.run ?? '').join('\n');
    expect(runs).toContain(`sdlc-${VERSION}.tgz`);
    expect(runs).toMatch(/sdlc validate --all/);
    expect(runs).toMatch(/sdlc approvals verify/);
    // The commands the workflow runs work on a fresh project.
    expect(p.cli(['validate', '--all', '--json']).code).toBe(0);
    expect(p.cli(['approvals', 'verify', '--json']).code).toBe(0);
  }, 120000);

  it('an existing workflow is kept; --force replaces it', () => {
    const p = project();
    write(p.file('.github/workflows/sdlc.yml'), '# the team\'s own\n');
    const kept = p.cli(['ci', 'init', '--provider', 'github', '--json']);
    expect(kept.code).toBe(0);
    expect(JSON.stringify(kept.json())).toMatch(/kept/);
    expect(read(p.file('.github/workflows/sdlc.yml'))).toBe('# the team\'s own\n');
    expect(p.cli(['ci', 'init', '--provider', 'github', '--force', '--json']).code).toBe(0);
    expect(read(p.file('.github/workflows/sdlc.yml'))).toMatch(/approvals verify/);
  }, 120000);

  it('gitlab: jobs in .gitlab/sdlc.yml with full history; .gitlab-ci.yml created with an include', () => {
    const p = project();
    expect(p.cli(['ci', 'init', '--provider', 'gitlab', '--json']).code).toBe(0);
    const jobs = read(p.file('.gitlab/sdlc.yml'));
    expect(jobs).toMatch(/GIT_DEPTH:\s*["']?0/);
    expect(jobs).toMatch(/sdlc approvals verify/);
    expect(jobs).toContain(`sdlc-${VERSION}.tgz`);
    expect(parse(read(p.file('.gitlab-ci.yml'))).include).toEqual(
      expect.arrayContaining([expect.objectContaining({ local: '.gitlab/sdlc.yml' })]));
  }, 120000);

  it('negative: an existing .gitlab-ci.yml is never edited; the include to add is reported', () => {
    const p = project();
    write(p.file('.gitlab-ci.yml'), 'stages: [test]\n');
    const r = p.cli(['ci', 'init', '--provider', 'gitlab', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(read(p.file('.gitlab-ci.yml'))).toBe('stages: [test]\n');
    expect(JSON.stringify(r.json())).toContain('.gitlab/sdlc.yml');
    expect(p.cli(['ci', 'init', '--provider', 'gitlab']).stdout).toMatch(/include/);
  }, 120000);

  it('--check adds a ready ci-green check for a registry server, once', () => {
    const p = project();
    const file = p.file('openspec/sdlc.yaml');
    const config = parse(read(file));
    config.mcp = { servers: { github: { type: 'stdio', command: ['node', FAKE] } } };
    write(file, stringify(config));
    expect(p.cli(['ci', 'init', '--provider', 'github', '--check', 'github', '--json']).code).toBe(0);
    expect(p.cli(['ci', 'init', '--provider', 'github', '--check', 'github', '--json']).code).toBe(0);
    const checks = (parse(read(file)).verify.mcp ?? []) as Array<Record<string, unknown>>;
    const green = checks.filter((check) => check.name === 'ci-green');
    expect(green).toHaveLength(1);
    expect(green[0].server).toBe('github');
    expect(JSON.stringify(green[0])).toContain('${HEAD}');
    expect(JSON.stringify(green[0].expect)).toContain('$any');
    expect(green[0].wait_while).toBeTruthy();
    expect(p.cli(['verify', '--list', '--json']).code).toBe(0);
    const unknown = p.cli(['ci', 'init', '--provider', 'github', '--check', 'nope', '--json']);
    expect(unknown.code).not.toBe(0);
  }, 120000);

  it('negative: an unknown provider is refused', () => {
    const p = project();
    const r = p.cli(['ci', 'init', '--provider', 'jenkins', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('invalid_option');
  }, 120000);

  it('an agent may not write CI configuration: the CLI refuses and the hook denies', () => {
    const p = project('claude');
    const refused = p.cli(['ci', 'init', '--provider', 'github', '--json'], { CLAUDECODE: '1' });
    expect(refused.code).not.toBe(0);
    expect(refused.json().status[0].code).toBe('agent_cannot_edit_ci');
    expect(fs.existsSync(p.file('.github/workflows/sdlc.yml'))).toBe(false);
    const command = 'sdlc ci init --provider github';
    const input = JSON.stringify({ cwd: p.root, tool_name: 'Bash', tool_input: { command } });
    const out = p.cli(['hook', 'pre-tool'], {}, input).stdout.trim();
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  }, 120000);
});
