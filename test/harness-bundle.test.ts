import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { claimTask } from '../src/core/board.js';
import { readBoard } from '../src/core/board-store.js';
import { resolveChange } from '../src/core/changes.js';
import { loadConfig } from '../src/core/config.js';
import { git as inspectGit, worktreeFingerprint } from '../src/core/git.js';
import { FINGERPRINT_EXCLUDES } from '../src/core/lifecycle.js';
import { projectPaths } from '../src/core/project.js';
import * as verification from '../src/core/verify.js';
import * as taskResult from '../src/core/task-result.js';
import { HarnessBundleHost } from '../src/executors/harness-bundle-host.js';
import { HarnessAdapter } from '../src/executors/harness-adapter.js';
import { readLog } from '../src/core/log.js';
import type { HarnessRuntime } from '../src/executors/harness-runtime.js';
import type { HarnessValidationRequest } from '../src/executors/harness-validation.js';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

function project(prefix = '') {
  const top = tempDir('sdlc-harness-host-');
  initGitRepo(top);
  const root = path.join(top, prefix);
  fs.mkdirSync(root, { recursive: true });
  if (prefix) write(path.join(root, '.gitignore'), '/openspec/.sdlc/board.json\n/openspec/.sdlc/board.lock\n');
  write(path.join(root, 'src/greet.js'), '// original\n');
  if (prefix) write(path.join(root, 'test/locked.test.ts'), '// locked test\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'initial']);
  const env = humanEnv(tempDir('sdlc-harness-home-'));
  const cli = (args: string[]) => {
    const result = runCli([...args, '--json'], root, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result;
  };
  cli(['init', '--tools', 'codex']);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const raw = parse(read(file));
  raw.enforcement.mode = 'block';
  if (prefix) raw.enforcement.test_paths = ['test/**'];
  raw.verify.commands = [{ name: 'candidate', run: 'node check.cjs', required: true }];
  write(file, stringify(raw));
  write(path.join(root, 'check.cjs'), [
    "const fs=require('fs');",
    "const text=fs.readFileSync('src/greet.js','utf8').replace(/\\r\\n/g,'\\n');",
    "if(text!=='// candidate\\n')process.exit(1);",
  ].join('\n'));
  cli(['new', 'add-farewell', '--risk', 'medium']);
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  write(change('intent.md'), FILES['intent.md']);
  cli(['approve', 'intent', '--change', 'add-farewell']);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  cli(['approve', 'spec', '--change', 'add-farewell']);
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 Implement farewell\n- [ ] 1.2 Another task\n');
  write(path.join(root, 'openspec/executors.yaml'), stringify({ executors: {
    hosted: { type: 'harness', max_risk: 'medium' },
  } }));
  cli(['approve', 'plan', '--change', 'add-farewell']);
  if (prefix) cli(['tests', 'lock', '--change', 'add-farewell']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved source']);
  const paths = projectPaths(root);
  const config = loadConfig(file);
  const ref = resolveChange(paths, 'add-farewell');
  const claim = claimTask(root, paths, config, { change: ref.id, task: '1.1', executor: 'hosted', agent: 'codex' });
  return { root, top, env, config, ref, claim };
}

function localRuntime(p: ReturnType<typeof project>, sandbox: string, remoteCalls: string[] = []) {
  const mapPath = (value: string) => value.replace(/^\/workspace(?=\/|$)/, sandbox);
  return { exec: async (_session: string, argv: string[], stdin = '', workdir = '/workspace') => {
    remoteCalls.push(JSON.stringify({ argv, stdin }));
    if (argv[0] === 'sdlc') {
      const result = runCli(argv.slice(1), mapPath(workdir), p.env);
      return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
    }
    const result = spawnSync(argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1).map(mapPath), {
      cwd: mapPath(workdir), env: p.env, input: stdin, encoding: 'utf8', timeout: 15000,
    });
    return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } };
}

/** Trusted fixture code only. This local test callback does not provide an OS security boundary. */
function fixtureValidator(p: ReturnType<typeof project>) {
  return vi.fn(async (request: HarnessValidationRequest) => {
    expect(Object.keys(request).sort()).toEqual(['bundle', 'commit', 'ref', 'verification']);
    const directory = tempDir('sdlc-trusted-fixture-validator-');
    const bundle = path.join(directory, 'candidate.bundle');
    const checkout = path.join(directory, 'checkout');
    fs.writeFileSync(bundle, request.bundle);
    fs.mkdirSync(checkout);
    initGitRepo(checkout);
    git(checkout, ['fetch', '-q', bundle, `${request.ref}:refs/heads/candidate`]);
    git(checkout, ['switch', '--detach', request.commit]);
    expect(fs.existsSync(path.join(checkout, 'openspec/.sdlc/board.json'))).toBe(false);
    const run = await verification.runVerification(checkout, { ...p.config, verify: request.verification });
    return { run, fingerprint: worktreeFingerprint(checkout, FINGERPRINT_EXCLUDES) };
  });
}

function privateHostHistory(p: ReturnType<typeof project>) {
  const token = 'fixture-host-token-never-upload';
  const run = (args: string[], input?: string) => {
    const result = spawnSync('git', args, { cwd: p.root, env: p.env, input, encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const blob = run(['hash-object', '-w', '--stdin'], token);
  const tree = run(['mktree'], `100644 blob ${blob}\tcredential.txt\n`);
  const commit = run(['commit-tree', tree, '-m', 'host-only unrelated history']);
  run(['update-ref', 'refs/private/host-credentials', commit]);
  run(['config', 'remote.host-publication.url', `https://${token}@example.invalid/private`]);
  return { token, blob, commit };
}

describe('B124: real git bundle round trip with a local sandbox transport', () => {
  it('Harness candidate checking applies nested project-relative locked globs to exact Git names', async () => {
    const p = project('packages/app');
    const sandbox = tempDir('e20-harness-monorepo-');
    const checkout = path.join(sandbox, 'project');
    git(sandbox, ['clone', '-q', p.top, checkout]);
    initGitRepo(checkout);
    git(checkout, ['switch', '-c', p.claim.item.result.branch]);
    const changed = 'packages/app/test/locked.test.ts';
    write(path.join(checkout, changed), '// changed locked test\n');
    git(checkout, ['add', changed]);
    git(checkout, ['commit', '-qm',
      'candidate\n\nSDLC-Change: add-farewell\nSDLC-Task: 1.1\nSDLC-Agent: hosted/codex']);
    const validator = vi.fn();
    const host = new HarnessBundleHost({ ...p,
      runtime: localRuntime(p, sandbox) as unknown as HarnessRuntime, tool: 'codex', validateCandidate: validator });
    expect(inspectGit(p.root, ['diff', '--name-only', 'HEAD']).stdout)
      .toBe('packages/app/openspec/.sdlc/log.jsonl');
    expect(inspectGit(p.root, ['ls-files', '--others', '--exclude-standard']).stdout).toBe('');
    const result = await host.verify('one', p.claim.item).catch((error: Error) => {
      const status = inspectGit(p.root, ['status', '--porcelain', '--untracked-files=normal']).stdout;
      throw new Error(`${error.message}\nNested fixture status:\n${status}`);
    });
    expect(result.passed).toBe(false);
    expect(result.problems).toContainEqual({ code: 'forbidden_path', file: changed });
    expect(validator).not.toHaveBeenCalled();
    expect(readLog(p.root).filter((entry) => entry.event === 'task.result_checked')).toHaveLength(1);
  }, 180000);
  it('propagates an actual inactive host-bound claim before any runtime call', async () => {
    const p = project();
    const board = readBoard(p.root);
    board.claims[0].expiresAt = '2000-01-01T00:00:00.000Z';
    write(path.join(p.root, 'openspec/.sdlc/board.json'), JSON.stringify(board));
    const runtime = { exec: vi.fn() };
    const validator = vi.fn();
    const host = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
      tool: 'codex', validateCandidate: validator });
    const adapter = new HarnessAdapter(runtime as unknown as HarnessRuntime, host);
    await expect(adapter.candidates(['one'], p.claim.item)).rejects.toMatchObject({ code: 'harness_refused' });
    expect(runtime.exec).not.toHaveBeenCalled();
    expect(validator).not.toHaveBeenCalled();
  }, 180000);
  it('transfers only reviewed reachable HEAD history and keeps host-only credential refs/config private', async () => {
    const p = project();
    const privateHistory = privateHostHistory(p);
    const sandbox = tempDir('e20-harness-reviewed-source-');
    const calls: string[] = [];
    const runtime = localRuntime(p, sandbox, calls);
    const host = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
      tool: 'codex', validateCandidate: fixtureValidator(p) });
    await host.prepare('local', p.claim.item);
    const checkout = path.join(sandbox, 'project');
    const bundleRefs = inspectGit(p.root, ['bundle', 'list-heads', path.join(sandbox, 'input.bundle')]);
    expect(bundleRefs.ok).toBe(true);
    expect(bundleRefs.stdout.split(/\r?\n/)).toEqual([`${p.claim.item.base.commit} HEAD`]);
    expect(inspectGit(checkout, ['cat-file', '-e', privateHistory.blob]).ok).toBe(false);
    expect(inspectGit(checkout, ['cat-file', '-e', privateHistory.commit]).ok).toBe(false);
    expect(inspectGit(checkout, ['config', '--get', 'remote.host-publication.url']).ok).toBe(false);
    expect(calls.join('\n')).not.toContain(privateHistory.token);
    expect(calls.join('\n')).not.toContain(p.claim.claim.id);
    expect(readBoard(p.root).claims[0].state).toBe('held');
  }, 180000);
  it.each(['core', 'validator'])('records a %s failure once and retains the independent candidate', async (kind) => {
    const p = project();
    const hosts = new Map<string, HarnessBundleHost>();
    for (const session of ['bad', 'good']) {
      const sandbox = tempDir('e20-harness-candidate-');
      const runtime = localRuntime(p, sandbox);
      const host = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
        tool: 'codex', validateCandidate: fixtureValidator(p) });
      hosts.set(session, host);
      await host.prepare(session, p.claim.item);
      const checkout = path.join(sandbox, 'project');
      initGitRepo(checkout);
      write(path.join(checkout, 'src/greet.js'), session === 'bad' && kind === 'validator'
        ? '// invalid candidate\n' : '// candidate\n');
      git(checkout, ['add', 'src/greet.js']);
      const message = session === 'bad' && kind === 'core' ? 'missing required trailers'
        : 'candidate\n\nSDLC-Change: add-farewell\nSDLC-Task: 1.1\nSDLC-Agent: hosted/codex';
      git(checkout, ['commit', '-qm', message]);
    }
    const initial = readLog(p.root).filter((entry) => entry.event === 'task.result_checked').length;
    const adapter = new HarnessAdapter({} as HarnessRuntime, { prepare: async () => {}, heartbeat: async () => {},
      verify: (session, item) => hosts.get(session)!.verify(session, item) });
    const reports = await adapter.candidateReport(['bad', 'good', 'bad'], p.claim.item);
    expect(reports.map((report) => [report.session, report.passed])).toEqual([['bad', false], ['good', true]]);
    const observed = readLog(p.root).filter((entry) => entry.event === 'task.result_checked').slice(initial);
    expect(observed).toHaveLength(2);
    expect(observed.filter((entry) => entry.detail === 'ok')).toHaveLength(1);
    expect(observed.some((entry) => entry.detail?.includes(kind === 'core'
      ? 'missing_trailer' : 'harness_validator_failed'))).toBe(true);
    expect(observed.every((entry) => entry.change === 'add-farewell' && entry.executor === 'hosted')).toBe(true);
  }, 180000);
  it('refuses unrelated history even with matching files, task trailers and passing commands', async () => {
    const p = project();
    const sandbox = tempDir('sdlc-harness-unrelated-');
    const runtime = localRuntime(p, sandbox);
    const validateCandidate = fixtureValidator(p);
    const host = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
      tool: 'codex', validateCandidate });
    await host.prepare('local', p.claim.item);
    const checkout = path.join(sandbox, 'project');
    initGitRepo(checkout);
    write(path.join(checkout, 'src/greet.js'), '// candidate\n');
    git(checkout, ['add', 'src/greet.js']);
    const tree = inspectGit(checkout, ['write-tree']);
    const unrelated = inspectGit(checkout, ['commit-tree', tree.stdout, '-m', [
      'unrelated history', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.1', 'SDLC-Agent: hosted/codex',
    ].join('\n')]);
    expect(tree.ok && unrelated.ok).toBe(true);
    git(checkout, ['update-ref', `refs/heads/${p.claim.item.result.branch}`, unrelated.stdout]);
    expect((await host.verify('local', p.claim.item)).passed).toBe(false);
    expect(validateCandidate).not.toHaveBeenCalled();
  }, 120000);

  it.each([
    { task: '1.2', agent: 'hosted/codex', reason: 'another known task' },
    { task: '1.1', agent: 'hosted/claude', reason: 'a different claimed agent' },
  ])('refuses $reason before executing any candidate check', async ({ task, agent }) => {
    const p = project();
    const sandbox = tempDir('sdlc-harness-other-task-');
    const runtime = localRuntime(p, sandbox);
    const validateCandidate = fixtureValidator(p);
    const host = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
      tool: 'codex', validateCandidate });
    await host.prepare('local', p.claim.item);
    const checkout = path.join(sandbox, 'project');
    initGitRepo(checkout);
    write(path.join(checkout, 'src/greet.js'), '// candidate\n');
    git(checkout, ['add', 'src/greet.js']);
    git(checkout, ['commit', '-qm', [
      'wrong identity', '', 'SDLC-Change: add-farewell', `SDLC-Task: ${task}`, `SDLC-Agent: ${agent}`,
    ].join('\n')]);
    const verifySpy = vi.spyOn(verification, 'runVerification');
    try {
      expect((await host.verify('local', p.claim.item)).passed).toBe(false);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(validateCandidate).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  }, 120000);

  it('checks returned commits and delegates bundles to the validator while preserving the source checkout', async () => {
    const p = project();
    const sandbox = tempDir('sdlc-harness-sandbox-');
    const remoteCalls: string[] = [];
    const runtime = localRuntime(p, sandbox, remoteCalls);
    const validateCandidate = fixtureValidator(p);
    const host = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
      tool: 'codex', validateCandidate });
    const sourceWorktrees = inspectGit(p.root, ['worktree', 'list', '--porcelain']).stdout;
    const verifySpy = vi.spyOn(verification, 'runVerification');
    const resultSpy = vi.spyOn(taskResult, 'checkResult');
    await host.prepare('local', p.claim.item);
    const checkout = path.join(sandbox, 'project');
    initGitRepo(checkout);
    const commit = (text: string, trailers = true, task = '1.1') => {
      write(path.join(checkout, 'src/greet.js'), text);
      git(checkout, ['add', 'src/greet.js']);
      const message = trailers ? ['candidate', '', 'SDLC-Change: add-farewell', `SDLC-Task: ${task}`,
        'SDLC-Agent: hosted/codex'].join('\n') : 'missing task trailers';
      git(checkout, ['commit', '-qm', message]);
    };
    commit('// candidate\n');
    const wrongTreeHost = new HarnessBundleHost({ ...p, runtime: runtime as unknown as HarnessRuntime,
      tool: 'codex', validateCandidate: async (request) => {
        const evidence = await validateCandidate(request);
        const wrongFingerprint = `git-tree:${'f'.repeat(40)}`;
        return { run: { ...evidence.run, fingerprint: wrongFingerprint }, fingerprint: wrongFingerprint };
      } });
    expect((await wrongTreeHost.verify('local', p.claim.item)).passed).toBe(false);
    const leaseBefore = readBoard(p.root).claims[0].expiresAt;
    const good = await host.verify('local', p.claim.item);
    const checks = await Promise.all(verifySpy.mock.results.map((result) => result.value));
    expect(good.passed, JSON.stringify({ checks, result: resultSpy.mock.results })).toBe(true);
    expect(inspectGit(p.root, ['show', `${good.branch}:src/greet.js`]).stdout).toBe('// candidate');
    expect(read(path.join(p.root, 'src/greet.js'))).toBe('// original\n');
    expect(inspectGit(p.root, ['rev-parse', 'HEAD']).stdout).toBe(p.claim.item.base.commit);
    expect(readBoard(p.root).claims[0].expiresAt).toBe(leaseBefore);
    expect(inspectGit(p.root, ['worktree', 'list', '--porcelain']).stdout).toBe(sourceWorktrees);
    commit('// failing check\n');
    expect((await host.verify('local', p.claim.item)).passed).toBe(false);
    commit('// candidate again\n', false);
    expect((await host.verify('local', p.claim.item)).passed).toBe(false);
    expect(remoteCalls.join('\n')).not.toContain(p.claim.claim.id);
    expect(fs.existsSync(path.join(checkout, 'openspec/.sdlc/board.json'))).toBe(false);
    vi.restoreAllMocks();
  }, 120000);
});
