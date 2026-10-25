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
import type { HarnessRuntime } from '../src/executors/harness-runtime.js';
import type { HarnessValidationRequest } from '../src/executors/harness-validation.js';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

function project() {
  const root = tempDir('sdlc-harness-host-');
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), '// original\n');
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
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved source']);
  const paths = projectPaths(root);
  const config = loadConfig(file);
  const ref = resolveChange(paths, 'add-farewell');
  const claim = claimTask(root, paths, config, { change: ref.id, task: '1.1', executor: 'hosted', agent: 'codex' });
  return { root, env, config, ref, claim };
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

describe('B124: real git bundle round trip with a local sandbox transport', () => {
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
