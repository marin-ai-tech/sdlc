import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
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
import { git, initGitRepo, read, REPO_ROOT, tempDir, write } from './helpers.js';
import { TEST_MS } from './fixtures/step-bounds.js';

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
  if (contains(sourcePath, expectedPath) || contains(expectedPath, sourcePath)) {
    throw new Error('H9 validator and source directories overlap');
  }
}

/** Physical `inner` equals `outer` or lies inside it; a name that only starts with two dots stays inside. */
function contains(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

/** The saved stdout bytes are the checked output: strict UTF-8 with any BOM kept, equal character for character. */
function assertH9RawOutput(raw: Buffer, checked: string): string {
  const decoded = strictText(raw);
  if (decoded === undefined || decoded !== checked) throw new Error('H9 saved output is not the checked output');
  return decoded;
}

function strictText(raw: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return undefined;
  }
}

/**
 * Where one H9 run keeps its evidence: next to the shard report when there is one, else in the checkout's
 * .sdlc-tmp/test-results/h9. Never under SDLC_TEST_TMP, which is removed when the run ends, and never through a
 * folder that is a link.
 */
function h9EvidenceBase(): string {
  const report = process.env.SDLC_TEST_REPORT ? path.resolve(process.env.SDLC_TEST_REPORT) : undefined;
  const unique = `h9-${process.pid}-${randomBytes(6).toString('hex')}`;
  const folder = report ? path.dirname(report) : path.join(REPO_ROOT, '.sdlc-tmp', 'test-results', 'h9');
  fs.mkdirSync(folder, { recursive: true });
  if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('H9 evidence folder is a link');
  return report ? `${report}.${unique}` : path.join(folder, unique);
}

interface H9Run { stdoutFile: string; raw: Buffer; checked?: string; validator: string; source: string }

/** The validator's run, or undefined when it never returned one. */
async function validatorRun(validator: { mock: { results: Array<{ value: unknown }> } }) {
  try {
    const value = await validator.mock.results[0]?.value as { run?: { checks?: Array<{ output: string }> } };
    return value?.run;
  } catch {
    return undefined;
  }
}

function physicalOrNull(entry: string | undefined): string | null {
  try {
    return entry ? fs.realpathSync.native(entry) : null;
  } catch {
    return null;
  }
}

/**
 * The report names the bytes, their hash, whether they are the checked output, and both spellings of every path.
 * It is written for every run that left bytes, a failed one included, and never replaces a file.
 */
function writeH9Report(base: string, run: H9Run): string {
  const decoded = strictText(run.raw);
  const spelled = { output: decoded?.trim() ?? null, validator: run.validator, source: run.source };
  const physical = Object.fromEntries(Object.entries(spelled)
    .map(([key, entry]) => [key, physicalOrNull(entry ?? undefined)]));
  const report = {
    platform: process.platform,
    tmp: process.env.SDLC_TEST_TMP ?? os.tmpdir(),
    stdoutFile: run.stdoutFile,
    bytes: run.raw.length,
    sha256: createHash('sha256').update(run.raw).digest('hex'),
    rawBase64: run.raw.toString('base64'),
    checkedOutput: run.checked ?? null,
    savedIsChecked: decoded !== undefined && decoded === run.checked,
    spelled,
    physical,
  };
  const file = `${base}.json`;
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return file;
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

  it('negative: saved bytes that differ from the checked output are refused', () => {
    const checked = path.join(tempDir('sdlc-h9-raw-'), 'checkout');
    const raw = Buffer.from(checked, 'utf8');
    expect(assertH9RawOutput(raw, checked)).toBe(checked);
    const changed = Buffer.from(raw);
    changed[changed.length - 1] ^= 1;
    expect(() => assertH9RawOutput(changed, checked)).toThrow(/not the checked output/);
    expect(() => assertH9RawOutput(Buffer.concat([raw, Buffer.from('\n')]), checked)).toThrow();
    expect(() => assertH9RawOutput(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]), checked)).toThrow();
    expect(() => assertH9RawOutput(Buffer.concat([raw, Buffer.from([0xff])]), checked)).toThrow();
    expect(() => assertH9RawOutput(Buffer.alloc(0), checked)).toThrow();
  });

  function reportFixture() {
    const root = tempDir('sdlc-h9-report-');
    const validator = path.join(root, 'validator');
    const source = path.join(root, 'source');
    fs.mkdirSync(validator);
    fs.mkdirSync(source);
    const run = { stdoutFile: path.join(root, 'x.stdout'), raw: Buffer.from(validator), checked: validator,
      validator, source };
    return { root, validator, run };
  }

  it('a report names the bytes and their hash, and never replaces an existing report', () => {
    const { root, validator, run } = reportFixture();
    const base = path.join(root, 'h9');
    const report = JSON.parse(read(writeH9Report(base, run)));
    expect(report.sha256).toBe(createHash('sha256').update(validator).digest('hex'));
    expect(Buffer.from(report.rawBase64, 'base64').toString('utf8')).toBe(validator);
    expect(report.physical.output).toBe(fs.realpathSync.native(validator));
    expect(report.savedIsChecked).toBe(true);
    expect(() => writeH9Report(base, run)).toThrow(/EEXIST/);
    expect(JSON.parse(read(`${base}.json`)).sha256).toBe(report.sha256);
  });

  // Review round 1 (Codex c-20261118-111554-ea4a): findings 1 and 2.
  it('negative: a validator inside the source, or the source inside the validator, is refused', () => {
    const root = tempDir('sdlc-h9-overlap-');
    const source = path.join(root, 'source');
    const inner = path.join(source, '.git', 'h9-validator');
    const outer = path.join(root, 'outer');
    const nested = path.join(outer, 'source');
    const dotted = path.join(source, '..nested');
    for (const dir of [inner, nested, dotted]) fs.mkdirSync(dir, { recursive: true });
    expect(() => assertH9Isolation(inner, inner, source)).toThrow(/overlap/);
    expect(() => assertH9Isolation(outer, outer, nested)).toThrow(/overlap/);
    expect(() => assertH9Isolation(dotted, dotted, source)).toThrow(/overlap/);
  });

  it('a failed run that left bytes still gets a report naming the mismatch', () => {
    const { root, run } = reportFixture();
    const failed = JSON.parse(read(writeH9Report(path.join(root, 'failed'), { ...run, checked: undefined })));
    expect(failed.savedIsChecked).toBe(false);
    expect(failed.checkedOutput).toBeNull();
    const invalid = JSON.parse(read(writeH9Report(path.join(root, 'invalid'), { ...run, raw: Buffer.from([0xff]) })));
    expect(invalid.savedIsChecked).toBe(false);
    expect(invalid.spelled.output).toBeNull();
  });

  it('negative: a report never writes through a planted link', ({ skip }) => {
    const { root, run } = reportFixture();
    const target = path.join(root, 'target.txt');
    write(target, 'kept\n');
    try {
      fs.symlinkSync(target, path.join(root, 'linked.json'), 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        skip('Filesystem cannot create file links; a separate real-link control is required');
      }
      throw error;
    }
    expect(() => writeH9Report(path.join(root, 'linked'), run)).toThrow(/EEXIST/);
    expect(read(target)).toBe('kept\n');
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
    }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);

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
      }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);

    it('H5 an actually oversized remote result is a candidate failure before validation', async () => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const validator = vi.fn(async () => ({}));
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'), 'add-farewell', randomBytes(600 * 1024));
      await expect(bridge.verify('one', p.claim.item)).resolves.toMatchObject({ passed: false });
      expect(validator).not.toHaveBeenCalled();
    }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);

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

    it('H9 actual command execution roots are isolated from the host source checkout', async ({ annotate }) => {
      const p = auditProject();
      const runtime = auditRuntime(p);
      const roots: string[] = [];
      const validator = auditValidator(p, roots);
      const bridge = host(p, runtime, validator);
      await bridge.prepare('one', p.claim.item);
      candidate(path.join(runtime.directory('one'), 'project'));
      const checks = vi.spyOn(verification, 'runVerification');
      const evidence = h9EvidenceBase();
      const stdoutFile = `${evidence}.stdout`;
      vi.stubEnv('SDLC_H9_RAW', stdoutFile);
      let result: Awaited<ReturnType<typeof bridge.verify>>;
      let checked: string | undefined;
      try {
        result = await bridge.verify('one', p.claim.item);
      } finally {
        vi.unstubAllEnvs();
        // Every run that left bytes keeps a report, a failed one included.
        checked = (await validatorRun(validator))?.checks?.[0]?.output;
        if (fs.existsSync(stdoutFile)) {
          const raw = fs.readFileSync(stdoutFile);
          const report = writeH9Report(evidence, { stdoutFile, raw, checked, validator: roots[0], source: p.root });
          await annotate(`H9 evidence ${report} sha256 ${createHash('sha256').update(raw).digest('hex')}`);
        }
      }
      expect(result.passed, JSON.stringify(result)).toBe(true);
      expect(roots).toHaveLength(1);
      expect(path.resolve(roots[0])).not.toBe(path.resolve(p.root));
      expect(checks).toHaveBeenCalledOnce();
      expect(checks.mock.calls[0][0]).toBe(roots[0]);
      expect(checked).toBeDefined();
      const saved = assertH9RawOutput(fs.readFileSync(stdoutFile), checked!);
      assertH9Isolation(saved, roots[0], p.root);
      expect(read(path.join(p.root, 'src/greet.js'))).toBe('// original\n');
    }, TEST_MS['audit-harness-runtime']);

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
    }, TEST_MS['audit-harness-runtime']);
  });
});
