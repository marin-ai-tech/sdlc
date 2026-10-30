import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { resolveChange } from '../src/core/changes.js';
import { loadConfig } from '../src/core/config.js';
import * as gitModule from '../src/core/git.js';
import { projectPaths } from '../src/core/project.js';
import { checkResult } from '../src/core/task-result.js';
import { FILES } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B151 (review finding F9 of harness-runtime-prototype): the forbidden-path part of the result check (B115) sees
 * every changed path under its real name. Before B151 it ran `git diff --name-only <base>..<branch>`, so
 * - git's rename detection collapsed a move into its new path, and a locked test moved away was never compared;
 * - `core.quotePath` printed a non-ASCII name C-quoted, so a protected `config/tést.yaml` matched no glob;
 * - a failing diff (a missing tree object) was read as an empty change and the branch passed.
 * The check now reads `--name-status -z --no-renames --no-relative`, compares the exact and the trimmed name, and
 * reports `diff_unavailable` when the listing cannot be read or parsed. `task check-result` and `board submit`
 * share it; a failed check keeps a board claim held.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = { executors: { 'swarm-a': { type: 'board', max_risk: 'medium' } } };
const PROTECTED = 'config/tést.yaml';
const LOCKED = 'test/locked.test.ts';
/** The plan lists `src/greet.js` and `src/new.js`, not `src/old.js`. */
const PLAN = FILES['plan.md'].replace('- `test/greet.test.js` (new)', '- `src/new.js` (new)');
const MESSAGE = ['work', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.2', 'SDLC-Agent: swarm-a/coder-1'].join('\n');
const CURRENT_CODES = ['missing_trailer', 'unknown_task', 'forbidden_path', 'no_commits', 'missing_agent',
  'unknown_executor', 'executor_not_allowed', 'wrong_executor'];

interface Entry {
  event: string;
  task?: string;
  detail?: string;
}

interface Problem {
  code: string;
  file?: string;
}

interface Result {
  ok: boolean;
  files: string[];
  problems: Problem[];
  warnings: { code: string; file: string }[];
}

function sources(root: string): void {
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  write(path.join(root, 'src/old.js'), 'export const old = "an old module with some content";\n');
  write(path.join(root, LOCKED), "import { test } from 'node:test';\ntest('locked', () => {});\n");
  write(path.join(root, PROTECTED), 'setting: protected value\n');
}

function project() {
  const root = tempDir('sdlc-result-paths-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  sources(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.enforcement.protected_paths = [PROTECTED];
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  const approve = (gate: string) => expect(cli(['approve', gate, '--change', 'add-farewell', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--risk', 'medium', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  approve('intent');
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  approve('spec');
  write(change('plan.md'), PLAN);
  write(change('tasks.md'), OPEN_TASKS);
  write(path.join(root, 'openspec/executors.yaml'), stringify(REGISTRY));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planning and executor registry']);
  approve('plan');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'plan approved']);
  // The tests are locked and the lock is committed on main before any result branch is made.
  expect(cli(['tests', 'lock', '--change', 'add-farewell', '--json']).code).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'tests locked']);
  return { root, cli, ...helpers(root, cli) };
}

function helpers(root: string, cli: (args: string[], extra?: NodeJS.ProcessEnv) => ReturnType<typeof runCli>) {
  /** A branch from main with one commit of exactly the paths `work` moves or writes (never `add -A`). */
  const branch = (name: string, work: () => void, extra: string[] = []) => {
    git(root, ['checkout', '-q', '-b', name]);
    work();
    git(root, ['commit', '-q', ...extra, '-m', MESSAGE]);
    git(root, ['checkout', '-q', 'main']);
  };
  const move = (from: string, to: string) => {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    git(root, ['mv', from, to]);
  };
  const edit = (rel: string) => {
    write(path.join(root, rel), `// edited ${rel}\n`);
    git(root, ['add', '--', rel]);
  };
  const check = (name: string) =>
    cli(['task', 'check-result', '--change', 'add-farewell', '--branch', name, '--json'], AGENT);
  const board = (args: string[]) => cli(['board', ...args, '--json'], AGENT);
  const claim = () => {
    const r = board(['claim', '--change', 'add-farewell', '--task', '1.2', '--executor', 'swarm-a',
      '--agent', 'coder-1']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json<{ claim: { id: string } }>().claim.id;
  };
  const status = () => board(['list']).json<{ tasks: { id: string; status: string }[] }>().tasks
    .find((task) => task.id === 'add-farewell#1.2')?.status;
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  const lastChecked = () => log().filter((entry) => entry.event === 'task.result_checked').at(-1)?.detail;
  const rawGit = (args: string[], input?: string) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf-8', input, timeout: 30000 });
  /**
   * A branch whose one commit (with the task's trailers) names a tree that does not exist: `git log` reads the
   * commit, `git diff` cannot. The commit object is written directly, so no file has to be deleted (review round 1:
   * deleting the tip's loose tree file failed once under load because the file was not where it was expected).
   */
  const brokenTip = (name: string) => {
    const parent = rawGit(['rev-parse', 'main']).stdout.trim();
    const stamp = 'Pat Owner <pat@example.com> 1761609600 +0000';
    const body = [`tree ${'0123456789abcdef'.repeat(2)}01234567`, `parent ${parent}`, `author ${stamp}`,
      `committer ${stamp}`, '', MESSAGE, ''].join('\n');
    const written = rawGit(['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], body);
    expect(written.status, written.stderr).toBe(0);
    git(root, ['update-ref', `refs/heads/${name}`, written.stdout.trim()]);
    expect(rawGit(['log', '--format=%H', `main..${name}`]).status).toBe(0);
    expect(rawGit(['diff', '--name-only', `main..${name}`]).status).not.toBe(0);
  };
  /** A gitlink at `file` on main (pointing at main's first commit), then a branch that moves it to another commit. */
  const movedGitlink = (name: string, file: string) => {
    const first = rawGit(['rev-list', '--max-parents=0', 'main']).stdout.trim();
    git(root, ['update-index', '--add', '--cacheinfo', `160000,${first},${file}`]);
    git(root, ['commit', '-q', '-m', 'vendor a fixture repository']);
    const second = rawGit(['rev-parse', 'main']).stdout.trim();
    branch(name, () => git(root, ['update-index', '--cacheinfo', `160000,${second},${file}`]));
  };
  return { root, branch, move, edit, check, board, claim, status, log, lastChecked, brokenTip, movedGitlink };
}

const codes = (result: Result): string[] => result.problems.map((problem) => problem.code);
const forbidden = (result: Result) => result.problems
  .filter((problem) => problem.code === 'forbidden_path')
  .map((problem) => problem.file);
const outside = (result: Result) => result.warnings
  .filter((warning) => warning.code === 'outside_plan')
  .map((warning) => warning.file);

describe('B151: check-result compares every changed path under its real name', () => {
  it('check-result refuses a result branch that adds plugin trust or state', () => {
    const p = project();
    const file = 'openspec/.sdlc/plugins/state/economy/store.json';
    p.branch('forged-plugin-store', () => {
      write(path.join(p.root, file), '{"forged":true}\n');
      git(p.root, ['add', '-f', '--', file]);
    });
    const result = p.check('forged-plugin-store');
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(forbidden(result.json<Result>())).toEqual([file]);
  }, 240000);

  it('check-result refuses a locked test renamed out of the test paths', () => {
    const p = project();
    p.branch('moved-test', () => p.move(LOCKED, 'elsewhere/moved.ts'));
    const r = p.check('moved-test');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const result = r.json<Result>();
    expect(result.ok).toBe(false);
    expect(forbidden(result)).toEqual([LOCKED]);
    expect(result.files).toEqual(['elsewhere/moved.ts', LOCKED]);
  }, 240000);

  it('check-result refuses an edited non-ASCII protected file under its real name', () => {
    const p = project();
    // git's default; set explicitly, so a local setting cannot be what makes the name readable.
    git(p.root, ['config', 'core.quotePath', 'true']);
    p.branch('edited-protected', () => p.edit(PROTECTED));
    const r = p.check('edited-protected');
    const result = r.json<Result>();
    expect(result.files).toEqual([PROTECTED]);
    expect(result.files.filter((file) => file.includes('\\') || file.includes('"'))).toEqual([]);
    expect(forbidden(result)).toEqual([PROTECTED]);
    expect(result.ok).toBe(false);
    expect(r.code, r.stdout + r.stderr).toBe(1);
  }, 240000);

  it('local git settings do not hide the renamed locked test', () => {
    const p = project();
    for (const [key, value] of [['diff.renames', 'true'], ['diff.relative', 'true']]) {
      git(p.root, ['config', key, value]);
    }
    p.branch('moved-test', () => p.move(LOCKED, 'elsewhere/moved.ts'));
    const r = p.check('moved-test');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const result = r.json<Result>();
    expect(forbidden(result)).toEqual([LOCKED]);
    expect(result.files).toEqual(['elsewhere/moved.ts', LOCKED]);
  }, 240000);

  it('a submodule-ignore setting does not hide a moved gitlink under the locked test paths', () => {
    // Review round 1, F5: with diff.ignoreSubmodules=all the listing of a moved gitlink was empty but readable.
    const p = project();
    git(p.root, ['config', 'diff.ignoreSubmodules', 'all']);
    p.movedGitlink('moved-gitlink', 'test/vendor');
    const r = p.check('moved-gitlink');
    const result = r.json<Result>();
    expect(result.files).toEqual(['test/vendor']);
    expect(forbidden(result)).toEqual(['test/vendor']);
    expect(codes(result)).not.toContain('diff_unavailable');
    expect(result.ok).toBe(false);
    expect(r.code, r.stdout + r.stderr).toBe(1);
  }, 240000);

  it('the old path of a renamed planned file is an outside_plan warning only', () => {
    const p = project();
    p.branch('renamed-planned', () => p.move('src/old.js', 'src/new.js'));
    const r = p.check('renamed-planned');
    const result = r.json<Result>();
    expect(outside(result)).toEqual(['src/old.js']);
    expect(outside(result)).not.toContain('src/new.js');
    expect(result.ok).toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  }, 240000);

  it('a rename outside every forbidden path passes with both paths in files', () => {
    const p = project();
    p.branch('renamed-planned', () => p.move('src/old.js', 'src/new.js'));
    const r = p.check('renamed-planned');
    const result = r.json<Result>();
    // Green before B151 too: no forbidden_path and exit 0. Red before B151: files listed only src/new.js.
    expect(forbidden(result)).toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(result.files).toEqual(['src/new.js', 'src/old.js']);
  }, 240000);

  it('an unchanged non-ASCII protected file is not named', () => {
    // Guard: green before and after B151.
    const p = project();
    p.branch('greet-only', () => p.edit('src/greet.js'));
    const r = p.check('greet-only');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const result = r.json<Result>();
    expect(result.files).toEqual(['src/greet.js']);
    expect(JSON.stringify(result.problems)).not.toContain('config/');
    expect(JSON.stringify(result.warnings)).not.toContain('config/');
  }, 240000);
});

describe('B151: check-result fails closed when the changed paths cannot be read', () => {
  it('check-result fails closed when the branch tree object is missing', () => {
    const p = project();
    p.brokenTip('broken-tree');
    const r = p.check('broken-tree');
    const result = r.json<Result>();
    expect(codes(result)).toContain('diff_unavailable');
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(p.lastChecked()).toContain('diff_unavailable');
  }, 240000);

  it('a passing branch reports no diff_unavailable', () => {
    // Guard: green before and after B151.
    const p = project();
    p.branch('passing', () => p.edit('src/greet.js'));
    const r = p.check('passing');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const result = r.json<Result>();
    expect(result.ok).toBe(true);
    expect(codes(result)).not.toContain('diff_unavailable');
    expect(p.lastChecked()).toBe('ok');
  }, 240000);

  it('an empty but readable diff is not a failure', () => {
    // Guard: green before and after B151.
    const p = project();
    p.branch('empty', () => undefined, ['--allow-empty']);
    const r = p.check('empty');
    const result = r.json<Result>();
    expect(result.files).toEqual([]);
    expect(codes(result)).not.toContain('diff_unavailable');
    expect(r.code, r.stdout + r.stderr).toBe(0);
  }, 240000);
});

describe('B151: the listing is parsed at the boundary (in-process, git listing replaced)', () => {
  /** Runs the result check with only the `git diff` listing call replaced by `listing`. */
  function checkWithListing(p: ReturnType<typeof project>, listing: string) {
    const real = gitModule.git;
    const spy = vi.spyOn(gitModule, 'git').mockImplementation((cwd, args, options) =>
      args[0] === 'diff' ? { ok: true, stdout: listing, stderr: '' } : real(cwd, args, options));
    try {
      const config = loadConfig(path.join(p.root, 'openspec/sdlc.yaml'));
      const ref = resolveChange(projectPaths(p.root), 'add-farewell');
      const result = checkResult(p.root, ref, config, 'work') as unknown as Result;
      expect(spy.mock.calls.some(([, args]) => args[0] === 'diff'), 'the listing call was replaced').toBe(true);
      return result;
    } finally {
      spy.mockRestore();
    }
  }

  it('a malformed listing fails the check and lists no path', () => {
    const p = project();
    p.branch('work', () => p.edit('src/greet.js'));
    for (const listing of ['R100\0src/old.js\0src/new.js\0', 'X\0a\0', 'M\0']) {
      const result = checkWithListing(p, listing);
      const label = JSON.stringify(listing);
      expect(result.files, label).toEqual([]);
      expect(codes(result), label).toContain('diff_unavailable');
      expect(result.ok, label).toBe(false);
      expect(forbidden(result), label).toEqual([]);
      expect(result.warnings, label).toEqual([]);
    }
  }, 240000);

  it('a path with surrounding whitespace is refused when its trimmed name is forbidden', () => {
    const p = project();
    p.branch('work', () => p.edit('src/greet.js'));
    const result = checkWithListing(p, 'M\0openspec/roles.yaml \0');
    expect(forbidden(result)).toEqual(['openspec/roles.yaml ']);
    expect(result.ok).toBe(false);
    expect(codes(result)).not.toContain('diff_unavailable');
  }, 240000);
});

describe('B151: the published result contract', () => {
  it('the published result contract lists exactly the problem codes, diff_unavailable among them', () => {
    const file = path.join(REPO_ROOT, 'schemas/contracts/result.schema.json');
    const schema = JSON.parse(read(file));
    const listed: string[] = schema.properties.problems.items.properties.code.enum;
    expect([...listed].sort()).toEqual([...CURRENT_CODES, 'diff_unavailable', 'plugin_refused'].sort());
  });
});

describe('B151: board submit runs the same check and keeps the claim held', () => {
  it('board submit keeps the claim held for a renamed locked test', () => {
    const p = project();
    const id = p.claim();
    p.branch('moved-test', () => p.move(LOCKED, 'elsewhere/moved.ts'));
    const r = p.board(['submit', '--claim', id, '--branch', 'moved-test']);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(forbidden(r.json<{ result: Result }>().result)).toEqual([LOCKED]);
    expect(p.status()).toBe('claimed');
    expect(p.log().filter((entry) => entry.event === 'task.submitted')).toEqual([]);
  }, 240000);

  it('board submit keeps the claim held when the diff is unreadable', () => {
    const p = project();
    const id = p.claim();
    p.brokenTip('broken-tree');
    const r = p.board(['submit', '--claim', id, '--branch', 'broken-tree']);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(codes(r.json<{ result: Result }>().result)).toContain('diff_unavailable');
    expect(p.status()).toBe('claimed');
    expect(p.log().filter((entry) => entry.event === 'task.submitted')).toEqual([]);
    expect(p.lastChecked()).toContain('diff_unavailable');
  }, 240000);
});
