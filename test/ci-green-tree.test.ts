import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B300 (E25): a `verify.mcp` check that uses `${HEAD}` counts only when the tree verify recorded (the fingerprint
 * taken before the commands) equals the tree of the commit it asks about, both without openspec/. The B111 refusal
 * of uncommitted code at the call stays (test/mcp-head-dirty.test.ts). The evidence row and the JSON answer name the
 * commit.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const AGENT = { CLAUDECODE: '1' };

/** git's standard output, trimmed; throws when git fails. */
function gitOut(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', timeout: 120000, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.status}`);
  return (r.stdout ?? '').trim();
}

/** A verify command that commits everything in the project, as an agent's command could during the run. */
function commitScript(): string {
  const file = path.join(tempDir('sdlc-ci-tree-script-'), 'commit-all.mjs');
  write(file, [
    "import { spawnSync } from 'node:child_process';",
    "const run = (args) => spawnSync('git', args, { stdio: 'inherit' }).status;",
    "if (run(['add', '-A']) !== 0) process.exit(1);",
    "const id = ['-c', 'user.name=Run', '-c', 'user.email=run@example.com'];",
    "process.exit(run([...id, 'commit', '-q', '--no-verify', '-m', 'during verify']) === 0 ? 0 : 1);",
    '',
  ].join('\n'));
  return file.replace(/\\/g, '/');
}

function project(options: { args?: Record<string, string>; command?: string } = {}) {
  const root = tempDir('sdlc-ci-tree-');
  const calls = path.join(tempDir('sdlc-ci-tree-count-'), 'count.txt');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_PENDING_FILE: calls, FAKE_PENDING_COUNT: '0' });
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (argv: string[]) => runCli(argv, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { build: { type: 'stdio', command: ['node', FAKE], stages: ['build', 'test'] } } };
  config.verify.commands = [{ name: 'step', run: options.command ?? 'node -e 0', required: true }];
  const args = options.args ?? { ref: '${HEAD}' };
  config.verify.mcp = [{ name: 'ci-green', server: 'build', tool: 'pipeline_status', args, expect: { status: 'success' } }];
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const count = () => (fs.existsSync(calls) ? Number(read(calls)) : 0);
  const verify = () => runCli(['verify', '--change', 'add-export', '--json'], root, { ...env, ...AGENT });
  const head = () => gitOut(root, ['rev-parse', 'HEAD']);
  const evidence = () => read(path.join(root, 'openspec/changes/add-export/verification.md'));
  return { root, verify, count, head, evidence };
}

describe('B300: a ${HEAD} check counts only for the tree verify recorded', () => {
  it('C1: a clean tree passes, the server is asked about HEAD, and the row and JSON name the commit', () => {
    const p = project();
    const head = p.head();
    const r = p.verify();
    const check = r.json().mcp[0];
    expect(check).toMatchObject({ name: 'ci-green', ok: true });
    expect(check.result.ref).toBe(head);
    expect(check.commit).toBe(head);
    const row = p.evidence().split('\n').find((line) => line.startsWith('| ci-green'));
    expect(row).toContain(`@ ${head.slice(0, 12)}`);
    expect(row).not.toContain(head.slice(0, 13));
  }, 180000);

  it('C2: code committed during the run does not count, and the reason names the files', () => {
    const p = project({ command: `node ${commitScript()}` });
    const before = p.head();
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    write(path.join(p.root, 'src/new.js'), 'export const b = 1;\n');
    const r = p.verify();
    expect(p.head()).not.toBe(before);
    const check = r.json().mcp[0];
    expect(check.ok).toBe(false);
    expect(String(check.reason)).toContain('src/app.js');
    expect(String(check.reason)).toContain('src/new.js');
    expect(String(check.reason)).toContain(before.slice(0, 12));
    expect(r.json().status).toBe('failed');
    expect(p.count()).toBe(0);
  }, 180000);

  it('C3: twelve changed files are summarised as ten names and how many more', () => {
    const p = project({ command: `node ${commitScript()}` });
    for (let i = 1; i <= 12; i += 1) {
      write(path.join(p.root, `src/f${String(i).padStart(2, '0')}.js`), `export const v = ${i};\n`);
    }
    const check = p.verify().json().mcp[0];
    expect(check.ok).toBe(false);
    const reason = String(check.reason);
    const named = [...reason.matchAll(/src\/f\d\d\.js/g)].map((m) => m[0]);
    expect(new Set(named).size).toBe(10);
    expect(reason).toMatch(/\b2 more\b/);
    expect(p.count()).toBe(0);
  }, 180000);

  it('C4: without a commit the ${HEAD} check is not called and fails', () => {
    const p = project();
    git(p.root, ['checkout', '-q', '--orphan', 'fresh']);
    git(p.root, ['rm', '-r', '-q', '--cached', '.']);
    for (const entry of fs.readdirSync(p.root)) {
      if (entry === '.git' || entry === 'openspec') continue;
      fs.rmSync(path.join(p.root, entry), { recursive: true, force: true });
    }
    expect(gitOut(p.root, ['status', '--porcelain', '--', '.', ':(exclude)openspec/'])).toBe('');
    const check = p.verify().json().mcp[0];
    expect(check.ok).toBe(false);
    expect(String(check.reason)).toMatch(/no commit/i);
    expect(check.commit).toBeUndefined();
    expect(p.count()).toBe(0);
  }, 180000);

  it('C7 (review F1): a replacement object behind HEAD does not make another tree count as the commit', () => {
    const p = project();
    const original = p.head();
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    gitOut(p.root, ['add', '-A']);
    gitOut(p.root, ['commit', '-q', '-m', 'other code']);
    const other = p.head();
    gitOut(p.root, ['reset', '-q', '--soft', original]);
    gitOut(p.root, ['replace', original, other]);
    expect(gitOut(p.root, ['status', '--porcelain', '--', '.', ':(exclude)openspec/'])).toBe('');
    const check = p.verify().json().mcp[0];
    expect(check.ok).toBe(false);
    expect(String(check.reason)).toContain('src/app.js');
    expect(check.commit).toBe(original);
    expect(p.count()).toBe(0);
  }, 180000);

  it('C8 (review F2): without a commit, an untracked file still gives the no-commit reason', () => {
    const p = project();
    gitOut(p.root, ['checkout', '-q', '--orphan', 'fresh']);
    gitOut(p.root, ['rm', '-r', '-q', '--cached', '.']);
    const check = p.verify().json().mcp[0];
    expect(check.ok).toBe(false);
    expect(String(check.reason)).toMatch(/no commit/i);
    expect(p.count()).toBe(0);
  }, 180000);

  it('C9 (review F4): a changed file name is not written into the evidence as Markdown', () => {
    const p = project({ command: `node ${commitScript()}` });
    write(path.join(p.root, 'src/![x](https-example.invalid).js'), 'export const c = 1;\n');
    const check = p.verify().json().mcp[0];
    expect(check.ok).toBe(false);
    const row = p.evidence().split('\n').find((line) => line.startsWith('| ci-green')) ?? '';
    expect(row).toContain('https-example.invalid');
    expect(row).not.toContain('![x](https-example.invalid)');
  }, 180000);

  it('negative C5: a difference only under openspec/ is not a difference', () => {
    const p = project({ command: `node ${commitScript()}` });
    write(path.join(p.root, 'openspec/changes/add-export/notes.md'), 'notes\n');
    const check = p.verify().json().mcp[0];
    expect(check).toMatchObject({ name: 'ci-green', ok: true });
    expect(p.count()).toBe(1);
  }, 180000);

  it('negative C6: a check without ${HEAD} is not bound and names no commit', () => {
    const p = project({ args: { ref: 'main' }, command: `node ${commitScript()}` });
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    const check = p.verify().json().mcp[0];
    expect(check).toMatchObject({ name: 'ci-green', ok: true });
    expect(check.commit).toBeUndefined();
    expect(p.count()).toBe(1);
    const row = p.evidence().split('\n').find((line) => line.startsWith('| ci-green'));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/ @ [0-9a-f]{12}/);
  }, 180000);
});
