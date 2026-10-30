import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { claimTask, type ClaimResult } from '../dist/core/board.js';
import { readBoard } from '../dist/core/board-store.js';
import { resolveChange } from '../dist/core/changes.js';
import { loadConfig } from '../dist/core/config.js';
import { SdlcError } from '../dist/core/errors.js';
import { git as inspectGit, worktreeFingerprint } from '../dist/core/git.js';
import { FINGERPRINT_EXCLUDES } from '../dist/core/lifecycle.js';
import { projectPaths } from '../dist/core/project.js';
import { runVerification } from '../dist/core/verify.js';
import { HarnessAdapter, type HarnessHost } from '../dist/executors/harness-adapter.js';
import { HarnessBundleHost } from '../dist/executors/harness-bundle-host.js';
import type { HarnessRuntime } from '../dist/executors/harness-runtime.js';
import type { HarnessCandidateValidator, HarnessValidationRequest } from '../dist/executors/harness-validation.js';
import { capturePackage } from '../dist/plugins/package.js';
import { readRegistry } from '../dist/plugins/trust.js';
import { FILES } from './farewell-fixture.js';
import { BIN, git, humanEnv, initGitRepo, read, REPO_ROOT, tempDir, write } from './helpers.js';

function demoPackage(root: string, guard?: 'deny' | 'fault') {
  const source = 'packages/demo';
  const directory = path.join(root, source);
  fs.cpSync(path.join(REPO_ROOT, 'examples/plugins/economy'), directory, { recursive: true });
  const file = path.join(directory, 'sdlc-plugin.json');
  const manifest = JSON.parse(read(file));
  manifest.name = 'demo';
  manifest.hooks = {};
  if (guard) {
    manifest.initialState = { used: 3 };
    manifest.hooks.result_accept = guard === 'deny' ? 'guard' : 'read';
    if (guard === 'fault') manifest.operations.read.input = true;
  }
  manifest.schemas.taskExt = true;
  write(file, JSON.stringify(manifest, null, 2));
  return capturePackage(root, source);
}

function project(ext?: Record<string, unknown>, guard?: 'deny' | 'fault') {
  const root = tempDir('sdlc-harness-report-');
  const env = humanEnv(tempDir('sdlc-harness-report-person-'));
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), '// original\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'initial']);
  const cli = (args: string[]) => {
    const result = spawnSync(process.execPath, [BIN, ...args, '--json'], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
  };
  cli(['init', '--tools', 'codex']);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const raw = parse(read(file));
  raw.enforcement.mode = 'block';
  raw.verify.commands = [{ name: 'candidate', run: 'node check.cjs', required: true }];
  const demo = ext === undefined && !guard ? undefined : demoPackage(root, guard);
  if (demo) {
    raw.plugins = { demo: { package: demo.source, digest: demo.digest, enabled: true, config: { limit: 3 } } };
    // A raw package pin must survive Git bundle checkouts on hosts with core.autocrlf enabled.
    write(path.join(root, '.gitattributes'), 'packages/** -text\n');
  }
  write(file, stringify(raw));
  if (demo) cli(['plugins', 'accept', 'demo', '--expect-digest', demo.digest]);
  write(path.join(root, 'check.cjs'), "if(require('fs').readFileSync('src/greet.js','utf8').trim()!=='// candidate')process.exit(1)\n");
  cli(['new', 'add-farewell', '--risk', 'medium']);
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  write(change('intent.md'), FILES['intent.md']);
  cli(['approve', 'intent', '--change', 'add-farewell']);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  cli(['approve', 'spec', '--change', 'add-farewell']);
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement farewell\n- [ ] 1.2 Another task\n');
  write(path.join(root, 'openspec/executors.yaml'), 'executors:\n  hosted:\n    type: harness\n    max_risk: medium\n');
  cli(['approve', 'plan', '--change', 'add-farewell']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved source']);
  const paths = projectPaths(root);
  const config = loadConfig(file);
  const ref = resolveChange(paths, 'add-farewell');
  let claim: ClaimResult;
  if (!demo) {
    claim = claimTask(root, paths, config, { change: ref.id, task: '1.1', executor: 'hosted', agent: 'codex' });
  } else {
    const result = JSON.parse(cli(['board', 'claim', '--change', ref.id, '--task', '1.1',
      '--executor', 'hosted', '--agent', 'codex', ...(ext === undefined ? [] : ['--ext-json', JSON.stringify(ext)])]));
    const stored = readBoard(root).claims.find((entry) => entry.id === result.claim.id);
    expect(stored).toMatchObject({ state: 'held', ...(ext === undefined ? {} : { ext }) });
    claim = { claim: stored!, item: result.item };
  }
  return { root, env, config, ref, claim };
}

function pluginBytes(root: string) {
  return ['registry.json', 'state/demo/store.json'].map((file) =>
    fs.readFileSync(path.join(root, 'openspec/.sdlc/plugins', file)));
}

/** A person prepares an independent worker checkout before the production host receives it. */
function provisionWarm(p: ReturnType<typeof project>, sandbox: string) {
  const checkout = path.join(sandbox, 'project');
  git(sandbox, ['clone', '--no-local', p.root, checkout]);
  initGitRepo(checkout);
  git(checkout, ['switch', '-c', p.claim.item.result.branch, p.claim.item.base.commit!]);
  const accepted = spawnSync(process.execPath, [BIN, 'plugins', 'accept', 'demo',
    '--expect-digest', p.config.plugins!.demo.digest, '--json'], {
    cwd: checkout, env: p.env, encoding: 'utf8', timeout: 20000,
  });
  expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
  expect(inspectGit(checkout, ['rev-parse', 'HEAD']).stdout).toBe(p.claim.item.base.commit);
  expect(inspectGit(checkout, ['symbolic-ref', '--short', 'HEAD']).stdout).toBe(p.claim.item.result.branch);
  expect(inspectGit(checkout, ['status', '--porcelain']).stdout).toBe('');
  return checkout;
}

function runtime(p: ReturnType<typeof project>, sandbox: string) {
  const map = (value: string) => value.replace(/^\/workspace(?=\/|$)/, sandbox);
  return { exec: vi.fn(async (_session: string, argv: string[], input = '', workdir = '/workspace') => {
    const executable = argv[0] === 'node' || argv[0] === 'sdlc' ? process.execPath : argv[0];
    const args = argv[0] === 'sdlc' ? [BIN, ...argv.slice(1)] : argv.slice(1).map(map);
    const result = spawnSync(executable, args, {
      cwd: map(workdir), env: p.env, input, encoding: 'utf8', timeout: 20000,
    });
    return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }) };
}

// Trusted local fixture only; production validation still requires an isolated credential-free runner.
function validator(p: ReturnType<typeof project>) {
  return vi.fn(async (request: HarnessValidationRequest) => {
    const directory = tempDir('sdlc-harness-report-validator-');
    const bundle = path.join(directory, 'candidate.bundle');
    const checkout = path.join(directory, 'checkout');
    fs.mkdirSync(checkout);
    fs.writeFileSync(bundle, request.bundle);
    initGitRepo(checkout);
    git(checkout, ['fetch', '-q', bundle, `${request.ref}:refs/heads/candidate`]);
    git(checkout, ['switch', '--detach', request.commit]);
    const run = await runVerification(checkout, { ...p.config, verify: request.verification });
    return { run, fingerprint: worktreeFingerprint(checkout, FINGERPRINT_EXCLUDES) };
  });
}

async function prepared(options: { task?: string; agent?: string; edit?: string; forbidden?: boolean;
  validate?: HarnessCandidateValidator; ext?: Record<string, unknown>; guard?: 'deny' | 'fault' } = {}) {
  const p = project(options.ext, options.guard);
  const sandbox = tempDir('sdlc-harness-report-sandbox-');
  if (p.config.plugins?.demo) provisionWarm(p, sandbox);
  const transport = runtime(p, sandbox);
  const check = options.validate ?? validator(p);
  const host = new HarnessBundleHost({ ...p, runtime: transport as unknown as HarnessRuntime,
    tool: 'codex', validateCandidate: check });
  await host.prepare('local', p.claim.item);
  const checkout = path.join(sandbox, 'project');
  initGitRepo(checkout);
  const target = options.forbidden ? 'openspec/executors.yaml' : 'src/greet.js';
  write(path.join(checkout, target), options.edit ?? '// candidate\n');
  git(checkout, ['add', target]);
  git(checkout, ['commit', '-qm', ['candidate', '', 'SDLC-Change: add-farewell',
    `SDLC-Task: ${options.task ?? '1.1'}`, `SDLC-Agent: ${options.agent ?? 'hosted/codex'}`].join('\n')]);
  return { ...p, host, check, transport, checkout };
}

describe('structured Harness candidate reports', () => {
  it('prepares a person-provisioned warm worker without accepting or copying host trust', async () => {
    const p = project({ demo: { a: 1, b: [1, 2] } });
    const sandbox = tempDir('sdlc-harness-provisioned-worker-');
    const checkout = provisionWarm(p, sandbox);
    const source = pluginBytes(p.root);
    const worker = pluginBytes(checkout);
    expect(readRegistry(checkout).plugins.demo.status).toBe('accepted');
    expect(readRegistry(checkout).plugins.demo.stateId).not.toBe(readRegistry(p.root).plugins.demo.stateId);
    const transport = runtime(p, sandbox);
    const host = new HarnessBundleHost({ ...p, runtime: transport as unknown as HarnessRuntime, tool: 'codex' });
    await host.prepare('local', p.claim.item);
    const doctor = transport.exec.mock.calls.findIndex(([, argv]) => argv[0] === 'sdlc' && argv[1] === 'doctor');
    expect(doctor).toBeGreaterThanOrEqual(0);
    expect((await transport.exec.mock.results[doctor].value).exitCode).toBe(0);
    expect(transport.exec.mock.calls.some(([, argv]) => argv[0] === 'sdlc' && argv[1] === 'plugins')).toBe(false);
    expect(transport.exec.mock.calls.some(([, argv]) => argv[0] === 'git' && argv.includes('clone'))).toBe(false);
    expect(pluginBytes(p.root)).toEqual(source);
    expect(pluginBytes(checkout)).toEqual(worker);
  }, 120000);

  it('refuses a fresh worker with unaccepted plugins instead of granting it host trust', async () => {
    const p = project({ demo: { a: 1, b: [1, 2] } });
    const source = pluginBytes(p.root);
    const sandbox = tempDir('sdlc-harness-unaccepted-worker-');
    const transport = runtime(p, sandbox);
    const host = new HarnessBundleHost({ ...p, runtime: transport as unknown as HarnessRuntime, tool: 'codex' });
    await expect(host.prepare('local', p.claim.item)).rejects.toMatchObject({ code: 'harness_refused' });
    const doctor = transport.exec.mock.calls.findIndex(([, argv]) => argv[0] === 'sdlc' && argv[1] === 'doctor');
    expect(doctor).toBeGreaterThanOrEqual(0);
    const result = await transport.exec.mock.results[doctor].value;
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).checks.filter((check: { status: string }) => check.status === 'error'))
      .toEqual([expect.objectContaining({ check: 'plugin demo', message: expect.stringContaining('human acceptance') })]);
    expect(fs.existsSync(path.join(sandbox, 'project/openspec/.sdlc/plugins/registry.json'))).toBe(false);
    expect(pluginBytes(p.root)).toEqual(source);
  }, 120000);

  it('reports every distinct session and preserves success-only candidates', async () => {
    const p = project();
    const host: HarnessHost = { prepare: async () => {}, heartbeat: async () => {}, verify: async (session) => {
      if (session === 'throw') throw new SdlcError('plugin_refused', { key: 'error.pluginFailure', params: { detail: 'private' } });
      return { branch: session, passed: session === 'good',
        ...(session === 'bad' ? { problems: [{ code: 'forbidden_path', file: 'protected.txt' }] } : {}) };
    } };
    const adapter = new HarnessAdapter({} as HarnessRuntime, host);
    const report = await adapter.candidateReport(['bad', 'good', 'throw', 'unknown', 'good'], p.claim.item);
    expect(report.map((entry) => entry.session)).toEqual(['bad', 'good', 'throw', 'unknown']);
    expect(report[0].problems).toEqual([{ code: 'forbidden_path', file: 'protected.txt' }]);
    expect(report[2].problems).toEqual([{ code: 'plugin_refused' }]);
    expect(report[3].problems).toEqual([{ code: 'harness_verification_failed' }]);
    expect(JSON.stringify(report)).not.toContain('private');
    expect(await adapter.candidates(['bad', 'good', 'good'], p.claim.item)).toEqual([{ session: 'good', branch: 'good' }]);
  }, 120000);

  it('retains exact core problems and does not reach the validator', async () => {
    const p = await prepared({ forbidden: true, guard: 'deny' });
    const result = await p.host.verify('local', p.claim.item);
    expect(result).toMatchObject({ passed: false, problems: [{ code: 'forbidden_path', file: 'openspec/executors.yaml' }] });
    expect(p.check).not.toHaveBeenCalled();
  }, 120000);

  it.each([{ task: '1.2' }, { agent: 'hosted/claude' }])('reports exact claim identity failure: %j', async (identity) => {
    const p = await prepared(identity);
    const result = await p.host.verify('local', p.claim.item);
    expect(result.passed).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'harness_identity', sha: expect.any(String) }));
    expect(p.check).not.toHaveBeenCalled();
  }, 120000);

  it('reports ancestry failure before core and validator acceptance', async () => {
    const p = await prepared();
    const tree = inspectGit(p.checkout, ['write-tree']);
    const unrelated = inspectGit(p.checkout, ['commit-tree', tree.stdout, '-m', 'unrelated']);
    expect(unrelated.ok).toBe(true);
    git(p.checkout, ['update-ref', `refs/heads/${p.claim.item.result.branch}`, unrelated.stdout]);
    expect(await p.host.verify('local', p.claim.item)).toMatchObject({
      passed: false, problems: [{ code: 'harness_ancestry' }],
    });
    expect(p.check).not.toHaveBeenCalled();
  }, 120000);

  it('reports missing validator without touching source or transport', async () => {
    const p = project();
    const transport = runtime(p, tempDir('sdlc-harness-missing-validator-'));
    const host = new HarnessBundleHost({ ...p, runtime: transport as unknown as HarnessRuntime, tool: 'codex' });
    const adapter = new HarnessAdapter(transport as unknown as HarnessRuntime, host);
    expect(await adapter.candidateReport(['missing'], p.claim.item)).toMatchObject([
      { session: 'missing', passed: false, problems: [{ code: 'harness_validator_missing' }] },
    ]);
    expect(transport.exec).not.toHaveBeenCalled();
  }, 120000);

  it.each([
    { validate: async () => ({ passed: true }), code: 'harness_validator_failed' },
    { validate: async () => { throw new Error('provider-secret'); }, code: 'harness_validator_unavailable' },
  ])('reports isolated validator failure: $code', async ({ validate, code }) => {
    const p = await prepared({ validate });
    const result = await p.host.verify('local', p.claim.item);
    expect(result).toMatchObject({ passed: false, problems: [{ code }] });
    expect(JSON.stringify(result)).not.toContain('provider-secret');
  }, 120000);

  it('offers a candidate only after actual complete independent fixture checks pass', async () => {
    const p = await prepared();
    const result = await p.host.verify('local', p.claim.item);
    expect(result.passed).toBe(true);
    expect(result.problems ?? []).toEqual([]);
    expect(p.check).toHaveBeenCalledOnce();
    expect(read(path.join(p.root, 'src/greet.js'))).toBe('// original\n');
  }, 120000);

  it.each(['deny', 'fault'] as const)('retains the real result hook %s after isolated validation', async (guard) => {
    const p = await prepared({ guard });
    const state = () => ['board.json', 'log.jsonl'].map((file) => read(path.join(p.root, 'openspec/.sdlc', file)));
    const before = state();
    const result = await p.host.verify('local', p.claim.item);
    expect(result).toMatchObject({ passed: false, problems: [{ code: 'plugin_refused',
      plugin: { name: 'demo', code: guard === 'deny' ? 'demo_limit' : 'plugin_invalid' } }] });
    expect(p.check).toHaveBeenCalledOnce();
    expect(readBoard(p.root).claims.find((entry) => entry.id === p.claim.claim.id)?.state).toBe('held');
    if (guard === 'fault') expect(state()).toEqual(before);
  }, 120000);

  it('compares extension object keys canonically while retaining type and array order', async () => {
    const ext = { demo: { a: 1, b: [1, 2] } };
    const p = await prepared({ ext });
    expect(readRegistry(p.root).plugins.demo.status).toBe('accepted');
    expect(p.claim.item).toMatchObject({ ext });
    expect(readBoard(p.root).claims.find((entry) => entry.id === p.claim.claim.id)).toMatchObject({ ext });
    const original = p.claim.item;
    const equivalent = { ...original, ext: { demo: { b: [1, 2], a: 1 } } };
    expect((await p.host.verify('local', equivalent)).passed).toBe(true);
    for (const ext of [{ demo: { a: '1', b: [1, 2] } }, { demo: { a: 1, b: [2, 1] } }]) {
      await expect(p.host.verify('local', { ...original, ext })).rejects.toMatchObject({ code: 'harness_refused' });
    }
    expect(p.check).toHaveBeenCalledOnce();
  }, 120000);
});
