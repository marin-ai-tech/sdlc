import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, expect, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { claimTask } from '../../src/core/board.js';
import { resolveChange } from '../../src/core/changes.js';
import { loadConfig } from '../../src/core/config.js';
import { worktreeFingerprint } from '../../src/core/git.js';
import { FINGERPRINT_EXCLUDES } from '../../src/core/lifecycle.js';
import { projectPaths } from '../../src/core/project.js';
import * as verification from '../../src/core/verify.js';
import type { HarnessValidationRequest } from '../../src/executors/harness-validation.js';
import { FILES } from '../farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from '../helpers.js';
import { immutableBoardProject, reportBoardProject } from './immutable-board-project.js';

interface AuditSource {
  root: string;
  env: NodeJS.ProcessEnv;
  cli: (args: string[]) => ReturnType<typeof runCli>;
}

let seed: AuditSource | undefined;
const prepared = new Set<string>();
const seedPhases: Record<string, number> = {};
const caseCliPhases: Array<Record<string, unknown>> = [];
const copies = immutableBoardProject(() => {
  if (!prepared.has('scaffold')) throw new Error('Prepare the immutable Harness scaffold before creating a copy');
  return sourceSeed().root;
}, 'sdlc-harness-audit-');

function sourceSeed(): AuditSource {
  if (!seed) throw new Error('Harness source scaffold is not prepared');
  return seed;
}

function preparation(name: string, action: () => void): void {
  if (prepared.has(name)) return;
  const started = performance.now();
  action();
  seedPhases[name] = performance.now() - started;
  prepared.add(name);
}

function sourceAt(root: string, env: NodeJS.ProcessEnv): AuditSource {
  const cli = (args: string[]) => {
    const started = performance.now();
    const result = runCli([...args, '--json'], root, env);
    caseCliPhases.push({ root, command: args, elapsedMs: performance.now() - started, code: result.code });
    if (process.env.SDLC_TEST_REPORT) {
      write(`${process.env.SDLC_TEST_REPORT}.harness-cli-phases.json`, JSON.stringify(caseCliPhases, null, 2));
    }
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result;
  };
  return { root, env, cli };
}

function configure(root: string, cli: (args: string[]) => unknown): void {
  cli(['init', '--tools', 'codex']);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const raw = parse(read(file));
  raw.enforcement.mode = 'block';
  raw.verify.commands = [{ name: 'candidate', run: 'node check.cjs', required: true }];
  write(file, stringify(raw));
  write(path.join(root, 'check.cjs'), [
    "const fs=require('fs');",
    "if(fs.readFileSync('src/greet.js','utf8').trim()!=='// candidate')process.exit(1);",
    'process.stdout.write(process.cwd());',
  ].join('\n'));
  write(path.join(root, 'openspec/executors.yaml'), stringify({ executors: {
    hosted: { type: 'harness', max_risk: 'medium' },
  } }));
}

function begin(root: string, cli: (args: string[]) => unknown): void {
  cli(['new', 'add-farewell', '--risk', 'medium']);
  const dir = path.join(root, 'openspec/changes/add-farewell');
  write(path.join(dir, 'intent.md'), FILES['intent.md']);
}

function approveSpec(root: string, cli: (args: string[]) => unknown): void {
  const dir = path.join(root, 'openspec/changes/add-farewell');
  for (const file of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) {
    write(path.join(dir, file), FILES[file]);
  }
  cli(['approve', 'spec', '--change', 'add-farewell']);
}

function approvePlan(root: string, cli: (args: string[]) => unknown): void {
  const dir = path.join(root, 'openspec/changes/add-farewell');
  write(path.join(dir, 'plan.md'), FILES['plan.md']);
  write(path.join(dir, 'tasks.md'), '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 Implement farewell\n');
  cli(['approve', 'plan', '--change', 'add-farewell']);
}

function scaffoldSource(): AuditSource {
  const root = tempDir('sdlc-harness-audit-seed-');
  const env = humanEnv(tempDir('sdlc-harness-audit-home-'));
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), '// original\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'initial']);
  const source = sourceAt(root, env);
  return source;
}

/** The seed contains only source/Git scaffolding, before initialization or any lifecycle decision. */
export function prepareAuditSource(): void {
  beforeAll(function scaffoldHarnessSource() {
    preparation('scaffold', () => {
      seed = scaffoldSource();
    });
  });
  afterAll(reportAuditPreparation);
}

function reportAuditPreparation(): void {
  reportBoardProject('harness', copies);
  const report = process.env.SDLC_TEST_REPORT;
  if (!report) return;
  write(`${report}.harness-preparation.json`, JSON.stringify({ seedPhasesMs: seedPhases,
    actualSeedPreparationMs: Object.values(seedPhases).reduce((sum, ms) => sum + ms, 0),
    captureAndCopies: copies.measurements() }, null, 2));
}

/** Every case gets a physical repository copy and a new human home; no held board is ever copied. */
export function auditSourceCopy(): AuditSource {
  const source = sourceAt(copies.create(), humanEnv(tempDir('sdlc-harness-audit-home-')));
  configure(source.root, source.cli);
  begin(source.root, source.cli);
  source.cli(['approve', 'intent', '--change', 'add-farewell']);
  approveSpec(source.root, source.cli);
  return source;
}

/** Plan approval, committed source and the actual claim always belong to this fresh physical case. */
export function claimAuditSource(source: AuditSource, untrackedHooks = false) {
  const { root, env, cli } = source;
  approvePlan(root, cli);
  if (untrackedHooks) write(path.join(root, '.gitignore'), '/.codex/hooks.json\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved source']);
  const paths = projectPaths(root);
  const config = loadConfig(path.join(root, 'openspec/sdlc.yaml'));
  const ref = resolveChange(paths, 'add-farewell');
  const claim = claimTask(root, paths, config, { change: ref.id, task: '1.1', executor: 'hosted', agent: 'codex' });
  return { root, env, paths, config, ref, claim };
}

export function auditProject(untrackedHooks = false) {
  return claimAuditSource(auditSourceCopy(), untrackedHooks);
}

export type AuditProject = ReturnType<typeof auditProject>;

/** Native local transport for trusted fixture code only; it is not an OS isolation boundary. */
export function auditRuntime(p: AuditProject) {
  const root = tempDir('sdlc-harness-audit-remote-');
  const directory = (session: string) => path.join(root, session);
  const exec = vi.fn(async (session: string, argv: string[], stdin = '', workdir = '/workspace') => {
    const sandbox = directory(session);
    fs.mkdirSync(sandbox, { recursive: true });
    const map = (value: string) => value.replace(/^\/workspace(?=\/|$)/, sandbox);
    if (argv[0] === 'sdlc') {
      const result = runCli(argv.slice(1), map(workdir), p.env);
      return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
    }
    const result = spawnSync(argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1).map(map), {
      cwd: map(workdir), env: p.env, input: stdin, encoding: 'utf8', timeout: 15000,
    });
    return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  });
  return { exec, directory };
}

export function candidate(checkout: string, change = 'add-farewell', payload?: Buffer): void {
  initGitRepo(checkout);
  write(path.join(checkout, 'src/greet.js'), '// candidate\n');
  if (payload) fs.writeFileSync(path.join(checkout, 'src/payload.bin'), payload);
  git(checkout, ['add', 'src']);
  git(checkout, ['commit', '-qm', [
    'candidate', '', `SDLC-Change: ${change}`, 'SDLC-Task: 1.1', 'SDLC-Agent: hosted/codex',
  ].join('\n')]);
}

export function auditValidator(p: AuditProject, roots: string[]) {
  return vi.fn(async (request: HarnessValidationRequest) => {
    const directory = tempDir('sdlc-harness-audit-validator-');
    const file = path.join(directory, 'candidate.bundle');
    const checkout = path.join(directory, 'checkout');
    fs.writeFileSync(file, request.bundle);
    fs.mkdirSync(checkout);
    initGitRepo(checkout);
    git(checkout, ['fetch', '-q', file, `${request.ref}:refs/heads/candidate`]);
    git(checkout, ['switch', '--detach', request.commit]);
    roots.push(checkout);
    const run = await verification.runVerification(checkout, { ...p.config, verify: request.verification });
    return { run, fingerprint: worktreeFingerprint(checkout, FINGERPRINT_EXCLUDES) };
  });
}
