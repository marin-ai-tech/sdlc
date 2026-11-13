import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardTaskListing, claimTask } from '../src/core/board.js';
import { readBoard } from '../src/core/board-store.js';
import * as gitModule from '../src/core/git.js';
import { readLog } from '../src/core/log.js';
import type { Executor } from '../src/core/executors.js';
import type { TaskItem } from '../src/core/task-contract.js';
import * as verification from '../src/core/verify.js';
import { HarnessAdapter, type HarnessHost } from '../src/executors/harness-adapter.js';
import { HarnessBundleHost } from '../src/executors/harness-bundle-host.js';
import { HarnessRuntime } from '../src/executors/harness-runtime.js';
import type { HarnessCandidateValidator, HarnessValidationRequest } from '../src/executors/harness-validation.js';
import { auditProject, auditRuntime, auditSourceCopy, auditValidator, candidate, claimAuditSource,
  prepareAuditSource } from './fixtures/harness-audit.js';
import { git, initGitRepo, read, tempDir, write } from './helpers.js';

const LIMIT = 512 * 1024;
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const nativeRead = vi.mocked(fs.readFileSync).getMockImplementation()!;
afterEach(() => {
  vi.mocked(fs.readFileSync).mockImplementation(nativeRead);
  vi.restoreAllMocks();
});

function host(p: ReturnType<typeof auditProject>, runtime: ReturnType<typeof auditRuntime>,
  validateCandidate: HarnessCandidateValidator = vi.fn(async () => ({}))) {
  return new HarnessBundleHost({ ...p, runtime: runtime as never, tool: 'codex', validateCandidate });
}

function replaceBundle(name: string, size: number): void {
  vi.mocked(fs.readFileSync).mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
    if (typeof file === 'string' && path.basename(file) === name) return Buffer.alloc(size);
    return Reflect.apply(nativeRead, fs, [file, options]);
  }) as typeof fs.readFileSync);
}

function sourceSnapshot(root: string) {
  return { state: read(path.join(root, 'openspec/changes/add-farewell/.sdlc.yaml')),
    log: read(path.join(root, 'openspec/.sdlc/log.jsonl')),
    head: gitModule.git(root, ['rev-parse', 'HEAD']).stdout,
    board: fs.existsSync(path.join(root, 'openspec/.sdlc/board.json')) };
}

/** H9 checks physical directory identity; spelling or a string prefix is not proof. */
function assertH9Isolation(output: string, expected: string, source: string): void {
  const actual = output.trim();
  if (!actual || /[\r\n]/.test(actual) || !path.isAbsolute(actual)
    || !path.isAbsolute(expected) || !path.isAbsolute(source)) throw new Error('Invalid H9 path');
  const [actualPath, expectedPath, sourcePath] = [actual, expected, source].map((entry) => {
    const physical = fs.realpathSync.native(entry);
    if (!fs.statSync(physical).isDirectory()) throw new Error('H9 path is not a directory');
    return physical;
  });
  if (path.relative(expectedPath, actualPath) !== '') throw new Error('H9 output is not the validator directory');
  if (path.relative(expectedPath, sourcePath) === '') throw new Error('H9 validator is the source directory');
}

describe('H9 physical path controls', () => {
  it('accepts one physical validator directory and rejects a similar neighbouring directory', () => {
    const root = tempDir('sdlc-h9-boundary-');
    const expected = path.join(root, 'checkout');
    const neighbour = path.join(root, 'checkout-neighbour');
    const source = path.join(root, 'source');
    for (const dir of [expected, neighbour, source]) fs.mkdirSync(dir);
    expect(() => assertH9Isolation(expected, expected, source)).not.toThrow();
    expect(() => assertH9Isolation(neighbour, expected, source)).toThrow();
  });

  it('rejects empty or inaccessible paths instead of accepting unproven identity', () => {
    const root = tempDir('sdlc-h9-missing-');
    const expected = path.join(root, 'checkout');
    const source = path.join(root, 'source');
    fs.mkdirSync(expected);
    fs.mkdirSync(source);
    expect(() => assertH9Isolation('', expected, source)).toThrow();
    expect(() => assertH9Isolation('relative', expected, source)).toThrow();
    expect(() => assertH9Isolation(`${expected}\n${expected}`, expected, source)).toThrow();
    expect(() => assertH9Isolation(expected, '.', source)).toThrow();
    expect(() => assertH9Isolation(expected, expected, '.')).toThrow();
    expect(() => assertH9Isolation(path.join(root, 'missing'), expected, source)).toThrow();
    expect(() => assertH9Isolation(expected, path.join(root, 'missing'), source)).toThrow();
    expect(() => assertH9Isolation(expected, expected, path.join(root, 'missing'))).toThrow();
  });

  it('rejects the source directory through a real link and accepts an alias of the validator', ({ skip }) => {
    const root = tempDir('sdlc-h9-link-');
    const source = path.join(root, 'source');
    const validator = path.join(root, 'validator');
    const sourceAlias = path.join(root, 'source-alias');
    const validatorAlias = path.join(root, 'validator-alias');
    fs.mkdirSync(source);
    fs.mkdirSync(validator);
    try {
      fs.symlinkSync(source, sourceAlias, process.platform === 'win32' ? 'junction' : 'dir');
      fs.symlinkSync(validator, validatorAlias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        skip('Filesystem cannot create real links; a separate real-link control is required');
      }
      throw error;
    }
    expect(() => assertH9Isolation(sourceAlias, sourceAlias, source)).toThrow();
    expect(() => assertH9Isolation(validatorAlias, validator, source)).not.toThrow();
  });
});

describe('Historical Harness acceptance boundaries H1–H10', () => {
  describe('physical source identity', () => {
    prepareAuditSource();
    const isolation = 'private pre-plan copies retain real authority with fresh homes and isolate actual claims';
    const sources: ReturnType<typeof auditSourceCopy>[] = [];
    const preparation: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 2; index++) {
      beforeEach(({ task }) => {
        if (task.name !== isolation) return;
        const started = performance.now();
        let source: ReturnType<typeof auditSourceCopy> | undefined;
        try {
          source = auditSourceCopy();
          sources.push(source);
        } finally {
          preparation.push({ copy: index + 1, elapsedMs: performance.now() - started,
            budgetMs: 60000, completed: source !== undefined, root: source?.root });
          if (process.env.SDLC_TEST_REPORT) write(`${process.env.SDLC_TEST_REPORT}.harness-isolation-preparation.json`,
            JSON.stringify(preparation, null, 2));
        }
      });
    }
    afterEach(() => { sources.length = 0; });

    it(isolation, () => {
      expect(sources).toHaveLength(2);
      const [first, second] = sources;
      expect(fs.realpathSync(first.root)).not.toBe(fs.realpathSync(second.root));
      expect(first.env.XDG_CONFIG_HOME).not.toBe(second.env.XDG_CONFIG_HOME);
      expect(fs.lstatSync(path.join(first.root, '.git')).isSymbolicLink()).toBe(false);
      const gates = first.cli(['status', '--change', 'add-farewell']).json().change.gates;
      expect(gates.filter((gate: { id: string }) => ['intent', 'spec'].includes(gate.id))
        .map((gate: { status: string }) => gate.status)).toEqual(['approved', 'approved']);
      expect(gates.find((gate: { id: string }) => gate.id === 'plan').status).not.toBe('approved');
      const before = sourceSnapshot(second.root);
      expect(before.board).toBe(false);
      const claimed = claimAuditSource(first);
      expect(readBoard(claimed.root).claims[0].state).toBe('held');
      expect(claimed.claim.item.base.commit).toBe(gitModule.git(first.root, ['rev-parse', 'HEAD']).stdout);
      expect(sourceSnapshot(second.root)).toEqual(before);
      const third = auditSourceCopy();
      expect(third.env.XDG_CONFIG_HOME).not.toBe(first.env.XDG_CONFIG_HOME);
      const thirdState = sourceSnapshot(third.root);
      expect(thirdState.head).toBe(before.head);
      expect(thirdState.board).toBe(false);
      const thirdGates = third.cli(['status', '--change', 'add-farewell']).json().change.gates;
      expect(thirdGates.filter((gate: { id: string }) => ['intent', 'spec'].includes(gate.id))
        .map((gate: { status: string }) => gate.status)).toEqual(['approved', 'approved']);
      expect(thirdGates.find((gate: { id: string }) => gate.id === 'plan').status).not.toBe('approved');
      expect(sourceSnapshot(second.root)).toEqual(before);
    }, 120000);

    it('H1 refuses another change trailer before any actual verification or validator', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const validator = vi.fn(async () => ({}));
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'), 'another-change');
      const checks = vi.spyOn(verification, 'runVerification');
      const result = await bridge.verify('one', p.claim.item);
      expect(result.passed).toBe(false);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'harness_identity' }));
      expect(checks).not.toHaveBeenCalled();
      expect(validator).not.toHaveBeenCalled();
    }, 120000);

  });

  it.each(['kind', 'type', 'id'] as const)('H2 refuses executor %s before allocation or preparation', async (reason) => {
    const executor: Executor = { id: 'hosted', type: 'harness', maxRisk: 'medium', capabilities: [] };
    if (reason === 'kind') executor.kinds = ['bugfix'];
    if (reason === 'type') executor.type = 'mesh';
    const item = { executor: reason === 'id' ? 'another' : 'hosted', risk: 'medium', kind: 'feature' } as TaskItem;
    const runtime = { create: vi.fn() };
    const bridge = { prepare: vi.fn(), heartbeat: vi.fn(), verify: vi.fn() } as HarnessHost;
    const adapter = new HarnessAdapter(runtime as never, bridge);
    await expect(adapter.dispatch(executor, item, 'config')).rejects.toMatchObject({ code: 'harness_refused' });
    expect(runtime.create).not.toHaveBeenCalled();
    expect(bridge.prepare).not.toHaveBeenCalled();
  });

  describe('physical source boundaries', () => {
    prepareAuditSource();

    it.each(['dirty', 'base', 'warn', 'off', 'untracked-hook', 'closed'] as const)(
      'H3 refuses isolated source boundary %s before any remote execution', async (reason) => {
        const p = auditProject(reason === 'untracked-hook');
        const runtime = auditRuntime(p);
        if (reason === 'dirty') write(path.join(p.root, 'uncommitted.txt'), 'dirty\n');
        if (reason === 'base') git(p.root, ['commit', '--allow-empty', '-qm', 'base changed']);
        if (reason === 'warn' || reason === 'off') p.config.enforcement.mode = reason;
        if (reason === 'closed') {
          const file = path.join(p.ref.dir, 'tasks.md');
          write(file, read(file).replace('[ ]', '[x]'));
          git(p.root, ['add', 'openspec/changes/add-farewell/tasks.md']);
          git(p.root, ['commit', '-qm', 'task completed']);
          p.claim.item.base.commit = gitModule.git(p.root, ['rev-parse', 'HEAD']).stdout;
        }
        const detail = { dirty: /commit the source/, base: /source base changed/, warn: /blocking agent hooks/,
          off: /blocking agent hooks/, 'untracked-hook': /host git operation failed/, closed: /task is no longer open/ };
        await expect(host(p, runtime).prepare('one', p.claim.item)).rejects.toThrow(detail[reason]);
        expect(runtime.exec).not.toHaveBeenCalled();
        expect(readBoard(p.root).claims[0].state).toBe('held');
      }, 120000);

    it('H4 refuses wrong-branch, dirty and wrong-HEAD actual warm workspaces', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const bridge = host(p, runtime);
      await bridge.prepare('one', p.claim.item);
      const checkout = path.join(runtime.directory('one'), 'project');
      initGitRepo(checkout);
      git(checkout, ['switch', '-c', 'another-branch']);
      await expect(bridge.prepare('one', p.claim.item)).rejects.toThrow(/warm workspace/);
      git(checkout, ['switch', p.claim.item.result.branch]);
      write(path.join(checkout, 'untracked.txt'), 'dirty\n');
      await expect(bridge.prepare('one', p.claim.item)).rejects.toThrow(/warm workspace/);
      fs.unlinkSync(path.join(checkout, 'untracked.txt'));
      git(checkout, ['commit', '--allow-empty', '-qm', 'warm HEAD changed']);
      await expect(bridge.prepare('one', p.claim.item)).rejects.toThrow(/warm workspace/);
      expect(readBoard(p.root).claims[0].state).toBe('held');
    }, 120000);

    it('H5 input exact512KiB reaches transport and one extra byte refuses before transport', async () => {
      const p = auditProject();
      const exec = vi.fn(async (_session: string, argv: string[], _stdin = '') => ({ exitCode: 0,
        stdout: argv.some(word => word.includes('existsSync')) ? 'false' : '', stderr: '' }));
      const runtime = { exec } as unknown as ReturnType<typeof auditRuntime>;
      replaceBundle('input.bundle', LIMIT);
      await expect(host(p, runtime).prepare('one', p.claim.item)).resolves.toBeUndefined();
      expect(Buffer.from(exec.mock.calls[0][2] ?? '', 'base64')).toHaveLength(LIMIT);
      vi.restoreAllMocks();
      exec.mockClear();
      replaceBundle('input.bundle', LIMIT + 1);
      await expect(host(p, runtime).prepare('one', p.claim.item)).rejects.toThrow(/input bundle exceeds 512 KiB/);
      expect(exec).not.toHaveBeenCalled();
    }, 120000);

    it('H5 returned exact512KiB reaches import and one decoded extra byte refuses before Git import', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const bridge = host(p, runtime);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'));
      const actual = runtime.exec.getMockImplementation()!;
      let size = LIMIT;
      runtime.exec.mockImplementation(async (...args) => args[1].some(word => word.includes("b.toString('base64')"))
        ? { exitCode: 0, stdout: Buffer.alloc(size).toString('base64'), stderr: '' } : actual(...args));
      const imports = vi.spyOn(gitModule, 'git');
      expect((await bridge.verify('one', p.claim.item)).passed).toBe(false);
      expect(imports.mock.calls.some(([, argv]) => argv[0] === 'bundle' && argv[1] === 'verify')).toBe(true);
      imports.mockClear();
      size = LIMIT + 1;
      expect((await bridge.verify('one', p.claim.item)).passed).toBe(false);
      expect(imports.mock.calls.some(([, argv]) => argv[0] === 'bundle' && argv[1] === 'verify')).toBe(false);
    }, 120000);

    it('H5 an actually oversized remote result is a candidate failure before validation', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const validator = vi.fn(async () => ({}));
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'), 'add-farewell', randomBytes(600 * 1024));
      await expect(bridge.verify('one', p.claim.item)).resolves.toMatchObject({ passed: false });
      expect(validator).not.toHaveBeenCalled();
    }, 120000);

    it('H5 validation exact512KiB reaches the validator and one extra byte stays candidate-local', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const validator = vi.fn(async (_request: HarnessValidationRequest) => ({}));
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'));
      replaceBundle('validation.bundle', LIMIT);
      expect((await bridge.verify('one', p.claim.item)).passed).toBe(false);
      expect(validator).toHaveBeenCalledOnce();
      expect(validator.mock.calls[0][0].bundle).toHaveLength(LIMIT);
      vi.restoreAllMocks();
      validator.mockClear();
      replaceBundle('validation.bundle', LIMIT + 1);
      await expect(bridge.verify('one', p.claim.item)).resolves.toMatchObject({ passed: false });
      expect(validator).not.toHaveBeenCalled();
    }, 120000);

    it('H6 required MCP checks refuse without a local candidate command or validator', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const validator = vi.fn(async () => ({}));
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'));
      p.config.verify.mcp = [{ name: 'required', server: 'checks', tool: 'run', required: true,
        args: {}, expect: true, wait_seconds: 0 }];
      const checks = vi.spyOn(verification, 'runVerification');
      const result = await bridge.verify('one', p.claim.item);
      expect(result).toMatchObject({ passed: false, problems: [{ code: 'harness_verification_mcp' }] });
      expect(checks).not.toHaveBeenCalled();
      expect(validator).not.toHaveBeenCalled();
    }, 120000);

  });

  it('H8 refuses a requested pair whose successful response contains only one child', async () => {
    const fetcher = vi.fn(async (_url: string, _request: RequestInit) => new Response(JSON.stringify({ sessions: [
      { session_id: 'only-one', status: 'SESSION_STATUS_READY' },
    ] })));
    const runtime = new HarnessRuntime('fixture-only', fetcher as typeof fetch);
    await expect(runtime.fork('parent', 2)).rejects.toMatchObject({ code: 'harness_protocol' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ count: 2 });
  });

  describe('physical source validation', () => {
    prepareAuditSource();

    it('H9 actual command execution roots are isolated from the host source checkout', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const roots: string[] = [];
      const validator = auditValidator(p, roots);
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'));
      const checks = vi.spyOn(verification, 'runVerification');
      const result = await bridge.verify('one', p.claim.item);
      expect(result.passed, JSON.stringify(result)).toBe(true);
      expect(roots).toHaveLength(1);
      expect(path.resolve(roots[0])).not.toBe(path.resolve(p.root));
      expect(checks).toHaveBeenCalledOnce();
      expect(checks.mock.calls[0][0]).toBe(roots[0]);
      const run = (await validator.mock.results[0].value).run;
      assertH9Isolation(run.checks[0].output, roots[0], p.root);
      expect(read(path.join(p.root, 'src/greet.js'))).toBe('// original\n');
    }, 120000);

    it('H10 an actual expired board lease reopens paused work without any heartbeat', async () => {
      const p = auditProject();
      const runtime = { get: vi.fn(async () => ({ id: 'one', status: 'SESSION_STATUS_PAUSED' })) };
      const bridge = host(p, auditRuntime(p));
      const heartbeat = vi.spyOn(bridge, 'heartbeat');
      const adapter = new HarnessAdapter(runtime as never, bridge);
      const expiry = readBoard(p.root).claims[0].expiresAt;
      expect(await adapter.refresh('one')).toBe('paused');
      expect(heartbeat).not.toHaveBeenCalled();
      expect(readBoard(p.root).claims[0].expiresAt).toBe(expiry);
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiry) + 1);
      expect(boardTaskListing(p.root, p.paths, p.config).tasks[0]).toMatchObject({ id: p.claim.item.id, status: 'open' });
      const next = claimTask(p.root, p.paths, p.config,
        { change: p.ref.id, task: '1.1', executor: 'hosted', agent: 'another' });
      expect(next.claim.id).not.toBe(p.claim.claim.id);
      expect(readBoard(p.root).claims.find(claim => claim.id === p.claim.claim.id)?.state).toBe('expired');
      expect(readLog(p.root).filter(entry => entry.event === 'task.lease_expired')).toHaveLength(1);
      expect(heartbeat).not.toHaveBeenCalled();
    }, 120000);
  });
});
