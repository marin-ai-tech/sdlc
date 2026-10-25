import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { ClaimResult } from '../core/board.js';
import { heartbeatClaim } from '../core/board.js';
import { readBoard } from '../core/board-store.js';
import type { ChangeRef } from '../core/changes.js';
import type { SdlcConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { isWithin } from '../core/fs-utils.js';
import { git } from '../core/git.js';
import { FINGERPRINT_EXCLUDES } from '../core/lifecycle.js';
import { exportItems, type TaskItem } from '../core/task-contract.js';
import { checkResult } from '../core/task-result.js';
import type { HarnessHost } from './harness-adapter.js';
import { HarnessRuntime } from './harness-runtime.js';
import { candidatePassed, type HarnessCandidateValidator } from './harness-validation.js';

const MAX_BUNDLE = 512 * 1024;
const WORKSPACE = '/workspace/project';
const OBSERVATIONS = ['openspec/.sdlc/log.jsonl', 'openspec/.sdlc/hook-log.jsonl'];

export interface BundleHostOptions {
  root: string;
  ref: ChangeRef;
  config: SdlcConfig;
  claim: ClaimResult;
  runtime: HarnessRuntime;
  tool: 'codex' | 'claude';
  /** Required for verify. Supply an isolated credential-free worker; there is no local execution fallback. */
  validateCandidate?: HarnessCandidateValidator;
}

function refused(detail: string): never {
  throw new SdlcError('harness_refused', { key: 'error.harnessProtocol', params: { detail } });
}

function requiredGit(root: string, args: string[]): string {
  const result = git(root, args);
  if (!result.ok) refused('host git operation failed');
  return result.stdout;
}

/** Small-repository prototype: git bundles cross the API; host credentials and board claim ids never do. */
export class HarnessBundleHost implements HarnessHost {
  constructor(private options: BundleHostOptions) {}

  private assertSource(item: TaskItem): void {
    const { root, ref, config, claim, tool } = this.options;
    if (JSON.stringify(item) !== JSON.stringify(claim.item) || item.executor !== claim.claim.executor) {
      refused('claim mismatch');
    }
    const currentClaim = readBoard(root).claims.find((entry) => entry.id === claim.claim.id);
    if (!currentClaim || currentClaim.state !== 'held' || currentClaim.executor !== item.executor
      || currentClaim.item !== item.id || Date.parse(currentClaim.expiresAt) <= Date.now()) {
      refused('claim is not active');
    }
    const dirty = requiredGit(root, ['status', '--porcelain', '--untracked-files=normal', '--', '.',
      ...OBSERVATIONS.map((file) => `:(exclude)${file}`)]);
    if (dirty || !item.base.commit) refused('commit the source and process records first');
    if (!config.tools.includes(tool) || config.enforcement.mode !== 'block'
      || !config.enforcement.forbidAgentApprovals) refused('source requires installed blocking agent hooks');
    if (requiredGit(root, ['rev-parse', 'HEAD']) !== item.base.commit) refused('source base changed');
    const hooks = tool === 'codex' ? '.codex/hooks.json' : '.claude/settings.json';
    requiredGit(root, ['ls-files', '--error-unmatch', 'openspec/sdlc.yaml', hooks,
      `openspec/changes/${ref.id}/.sdlc.yaml`]);
    const current = exportItems(root, ref, config, item.task.id, item.executor).items[0];
    if (!current || current.id !== item.id) refused('task is no longer open');
  }

  private async checkedExec(session: string, argv: string[], stdin = '', workdir = '/workspace'): Promise<string> {
    const result = await this.options.runtime.exec(session, argv, stdin, workdir);
    if (result.exitCode !== 0) refused('sandbox preparation failed');
    return result.stdout;
  }

  async prepare(session: string, item: TaskItem): Promise<void> {
    this.assertSource(item);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-harness-input-'));
    try {
      const file = path.join(directory, 'input.bundle');
      requiredGit(this.options.root, ['bundle', 'create', file, 'HEAD']);
      const bundle = fs.readFileSync(file);
      if (bundle.length > MAX_BUNDLE) refused('prototype input bundle exceeds 512 KiB');
      await this.checkedExec(session, ['node', '-e', [
        "const fs=require('fs');",
        "fs.writeFileSync(process.argv[1],Buffer.from(fs.readFileSync(0,'utf8'),'base64'));",
      ].join(''), '/workspace/input.bundle'], bundle.toString('base64'));
      await this.prepareRepository(session, item);
    } finally {
      fs.rmSync(path.join(directory, 'input.bundle'), { force: true });
      fs.rmdirSync(directory);
    }
  }

  private async prepareRepository(session: string, item: TaskItem): Promise<void> {
    const exists = await this.checkedExec(session,
      ['node', '-e', "process.stdout.write(String(require('fs').existsSync(process.argv[1])))", `${WORKSPACE}/.git`]);
    if (exists === 'false') {
      await this.checkedExec(session, ['git', 'clone', '--no-checkout', '/workspace/input.bundle', WORKSPACE]);
      await this.checkedExec(session, ['git', '-C', WORKSPACE, 'switch', '-c', item.result.branch, item.base.commit!]);
    } else {
      const head = await this.checkedExec(session, ['git', '-C', WORKSPACE, 'rev-parse', 'HEAD']);
      const dirty = await this.checkedExec(session, ['git', '-C', WORKSPACE, 'status', '--porcelain']);
      const branch = await this.checkedExec(session, ['git', '-C', WORKSPACE, 'symbolic-ref', '--short', 'HEAD']);
      if (head.trim() !== item.base.commit || dirty.trim() || branch.trim() !== item.result.branch) {
        refused('warm workspace is not the approved clean task branch');
      }
    }
    const hooks = this.options.tool === 'codex' ? '.codex/hooks.json' : '.claude/settings.json';
    await this.checkedExec(session, ['node', '-e',
      "if(!require('fs').existsSync(process.argv[1]))process.exit(73)", `${WORKSPACE}/${hooks}`]);
    await this.checkedExec(session, ['sdlc', 'doctor', '--json'], '', WORKSPACE);
  }

  async heartbeat(): Promise<void> {
    const { root, config, claim } = this.options;
    heartbeatClaim(root, config, claim.claim.id, claim.claim.executor);
  }

  async verify(session: string, item: TaskItem): Promise<{ branch: string; passed: boolean }> {
    if (!this.options.validateCandidate) refused('isolated candidate validator is required');
    this.assertSource(item);
    const { runtime, root, ref, config } = this.options;
    const branch = `refs/sdlc/harness/${randomUUID()}`;
    const made = await runtime.exec(session,
      ['git', '-C', WORKSPACE, 'bundle', 'create', '/workspace/result.bundle', item.result.branch,
        `^${item.base.commit}`]);
    if (made.exitCode !== 0) return { branch, passed: false };
    const encoded = await this.checkedExec(session, ['node', '-e', [
      "const b=require('fs').readFileSync(process.argv[1]);",
      `if(b.length>${MAX_BUNDLE})process.exit(72);`,
      "process.stdout.write(b.toString('base64'));",
    ].join(''), '/workspace/result.bundle']);
    if (encoded.length > Math.ceil(MAX_BUNDLE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      refused('invalid candidate bundle');
    }
    return this.inspectBundle(Buffer.from(encoded, 'base64'), item, branch, root, ref, config);
  }

  private async inspectBundle(bundle: Buffer, item: TaskItem, branch: string,
    root: string, ref: ChangeRef, config: SdlcConfig): Promise<{ branch: string; passed: boolean }> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-harness-result-'));
    const file = path.join(directory, 'result.bundle');
    try {
      fs.writeFileSync(file, bundle);
      requiredGit(root, ['bundle', 'verify', file]);
      requiredGit(root, ['fetch', '--no-tags', '--no-write-fetch-head', file, `${item.result.branch}:${branch}`]);
      if (!git(root, ['merge-base', '--is-ancestor', item.base.commit!, branch]).ok) {
        return { branch, passed: false };
      }
      const checked = checkResult(root, ref, config, branch, item.base.commit, item.executor);
      const wrongIdentity = checked.commits.some((commit) => commit.change !== item.change
        || commit.task !== item.task.id || commit.agent !== item.result.trailers['SDLC-Agent']);
      if (!checked.ok || wrongIdentity || (config.verify.mcp?.length ?? 0) > 0) return { branch, passed: false };
      return { branch, passed: await this.validateBundle(directory, branch, config) };
    } finally {
      const safe = isWithin(os.tmpdir(), directory) && !fs.lstatSync(directory).isSymbolicLink()
        && fs.realpathSync(directory) === directory;
      if (safe) {
        fs.rmSync(file, { force: true });
        fs.rmSync(path.join(directory, 'validation.bundle'), { force: true });
        fs.rmSync(path.join(directory, 'validation.index'), { force: true });
        fs.rmSync(path.join(directory, 'validation.index.lock'), { force: true });
        fs.rmdirSync(directory);
      }
    }
  }

  private async validateBundle(directory: string, branch: string, config: SdlcConfig): Promise<boolean> {
    const commit = requiredGit(this.options.root, ['rev-parse', '--verify', `${branch}^{commit}`]);
    const file = path.join(directory, 'validation.bundle');
    requiredGit(this.options.root, ['bundle', 'create', file, branch]);
    const bundle = fs.readFileSync(file);
    if (bundle.length > MAX_BUNDLE) refused('prototype validation bundle exceeds 512 KiB');
    const fingerprint = this.candidateFingerprint(directory, commit);
    const verification = structuredClone(config.verify);
    let evidence: unknown;
    try {
      evidence = await this.options.validateCandidate!({
        bundle, ref: branch, commit, verification: structuredClone(verification),
      });
    } catch {
      refused('isolated candidate validation failed');
    }
    return candidatePassed(evidence, commit, verification, fingerprint);
  }

  private candidateFingerprint(directory: string, commit: string): string {
    const top = requiredGit(this.options.root, ['rev-parse', '--show-toplevel']);
    const prefix = requiredGit(this.options.root, ['rev-parse', '--show-prefix']);
    const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, 'validation.index') };
    const run = (args: string[]) => spawnSync('git', args,
      { cwd: top, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run(['read-tree', commit]).status !== 0) refused('candidate fingerprint unavailable');
    for (const excluded of FINGERPRINT_EXCLUDES) {
      if (run(['--literal-pathspecs', 'rm', '-r', '--cached', '-q', '--ignore-unmatch', '--',
        `${prefix}${excluded}`]).status !== 0) refused('candidate fingerprint unavailable');
    }
    const tree = run(['write-tree']);
    if (tree.status !== 0 || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(tree.stdout.trim())) {
      refused('candidate fingerprint unavailable');
    }
    return `git-tree:${tree.stdout.trim()}`;
  }
}
