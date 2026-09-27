import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { SdlcConfig, VerifyCommand } from './config.js';
import { provenance, type ChangeState, type VerifyCommandRecord, type VerifyRecord } from './change-state.js';
import { exists, isFile, readText, writeTextAtomic } from './fs-utils.js';
import { headCommit, isDirty, worktreeFingerprint } from './git.js';
import { stampText, stripProvenance, withProvenance, type HarnessStamp } from './license.js';
import { FINGERPRINT_EXCLUDES } from './lifecycle.js';

/**
 * The playbook's feedback loop, made deterministic: run the project's own
 * checks (build, test, lint...), keep the literal output as evidence, and bind
 * the result to the exact worktree it ran against. The verify gate passes only
 * while that fingerprint still matches, so "tests passed" can never outlive
 * the code it was about.
 */
export interface CheckOutcome extends VerifyCommandRecord {
  output: string;
}

export interface VerificationRun {
  status: 'passed' | 'failed';
  at: string;
  commit?: string;
  dirty: boolean;
  fingerprint?: string;
  checks: CheckOutcome[];
}

function tail(text: string, lines: number): string {
  const all = text.replace(/\r\n?/g, '\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n');
  while (all.length > 0 && all[all.length - 1].trim() === '') all.pop();
  return all.slice(-lines).join('\n');
}

function runCheck(root: string, check: VerifyCommand, timeoutSeconds: number, outputLines: number): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    let size = 0;
    const keep = (buf: Buffer) => {
      chunks.push(buf);
      size += buf.length;
      // Bound memory: keep roughly the last 2 MB, evidence only needs the tail.
      while (size > 2 * 1024 * 1024 && chunks.length > 1) size -= chunks.shift()!.length;
    };
    const child = spawn(check.run, {
      cwd: root,
      shell: true,
      env: { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutSeconds * 1000);
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const finish = (code: number | null, errorText?: string) => {
      clearTimeout(timer);
      const output = tail(Buffer.concat(chunks).toString('utf-8') + (errorText ? `\n${errorText}` : ''), outputLines);
      resolve({
        name: check.name,
        command: check.run,
        exit_code: code,
        duration_ms: Date.now() - started,
        required: check.required,
        ...(timedOut ? { timed_out: true } : {}),
        output,
      });
    };
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(timedOut ? null : code));
  });
}

export async function runVerification(
  root: string,
  config: SdlcConfig,
  options: { only?: string[]; onCheck?: (check: VerifyCommand) => void } = {}
): Promise<VerificationRun> {
  const selected = options.only && options.only.length > 0
    ? config.verify.commands.filter((c) => options.only!.includes(c.name))
    : config.verify.commands;
  // Fingerprint before running: a check that rewrites files (formatters) must
  // not make its own evidence look fresh.
  const fingerprint = worktreeFingerprint(root, FINGERPRINT_EXCLUDES);
  const commit = headCommit(root);
  const dirty = isDirty(root, FINGERPRINT_EXCLUDES);
  const checks: CheckOutcome[] = [];
  for (const check of selected) {
    options.onCheck?.(check);
    checks.push(await runCheck(root, check, check.timeoutSeconds ?? config.verify.timeoutSeconds, config.verify.outputLines));
  }
  const failed = checks.some((c) => c.required && c.exit_code !== 0);
  const partial = !!options.only && options.only.length > 0 && selected.length < config.verify.commands.length;
  return {
    // A partial run is evidence, never a pass for the gate.
    status: failed || partial || selected.length === 0 ? 'failed' : 'passed',
    at: new Date().toISOString(),
    ...(commit ? { commit } : {}),
    dirty,
    ...(fingerprint ? { fingerprint } : {}),
    checks,
  };
}

export function toVerifyRecord(run: VerificationRun): VerifyRecord {
  return {
    status: run.status,
    at: run.at,
    ...(run.commit ? { commit: run.commit } : {}),
    ...(run.fingerprint ? { fingerprint: run.fingerprint } : {}),
    results: run.checks.map(({ output: _output, ...rest }) => rest),
  };
}

const EVIDENCE_START = '<!-- sdlc:evidence:start -->';
const EVIDENCE_END = '<!-- sdlc:evidence:end -->';

function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

export function renderEvidence(run: VerificationRun, changeId: string, stamp?: HarnessStamp): string {
  const required = run.checks.filter((c) => c.required);
  const passedRequired = required.filter((c) => c.exit_code === 0).length;
  const rows = run.checks.map((c) => {
    const result = c.timed_out ? '⏱ timed out' : c.exit_code === 0 ? '✅ exit 0' : `❌ exit ${c.exit_code ?? '?'}`;
    return `| ${c.name}${c.required ? '' : ' (optional)'} | \`${c.command.replace(/\|/g, '\\|')}\` | ${result} | ${(c.duration_ms / 1000).toFixed(1)}s |`;
  });
  const outputs = run.checks.map((c) =>
    `<details><summary>${c.name} output (last lines)</summary>\n\n${fence(c.output || '(no output)')}\n\n</details>`
  );
  return [
    EVIDENCE_START,
    '## Automated evidence',
    '',
    `Recorded by \`sdlc verify --change ${changeId}\`. Regenerated on every run; do not edit by hand.`,
    '',
    `- **Result**: ${run.status === 'passed' ? 'PASSED' : 'FAILED'} (${passedRequired}/${required.length} required checks)`,
    `- **Run at**: ${run.at}`,
    `- **Commit**: ${run.commit ? run.commit.slice(0, 12) : 'n/a'}${run.dirty ? ' + uncommitted changes' : ''}`,
    ...(stamp ? [`- **Harness**: ${stampText(stamp)}`] : []),
    '',
    '| Check | Command | Result | Duration |',
    '|---|---|---|---|',
    ...rows,
    '',
    ...outputs,
    EVIDENCE_END,
  ].join('\n');
}

/**
 * Writes the evidence block into `verification.md`, creating the file from
 * the record template when needed. Everything outside the markers (the
 * behavioral verification a verifier writes) is preserved.
 */
export function writeEvidence(
  changeDir: string,
  run: VerificationRun,
  changeId: string,
  template: string,
  stamp?: HarnessStamp
): string {
  const file = path.join(changeDir, 'verification.md');
  const block = renderEvidence(run, changeId, stamp);
  let content = isFile(file) ? readText(file) ?? '' : template.replace(/<change>/g, changeId);
  const start = content.indexOf(EVIDENCE_START);
  const end = content.indexOf(EVIDENCE_END);
  if (start !== -1 && end > start) {
    content = content.slice(0, start) + block + content.slice(end + EVIDENCE_END.length);
  } else if (content.includes('<!-- sdlc:evidence -->')) {
    content = content.replace('<!-- sdlc:evidence -->', block);
  } else {
    content = `${stripProvenance(content).trimEnd()}\n\n${block}\n`;
  }
  if (stamp) content = withProvenance(content, stamp);
  writeTextAtomic(file, content.endsWith('\n') ? content : `${content}\n`);
  return file;
}

export function applyVerifyToState(state: ChangeState, run: VerificationRun, stamp?: HarnessStamp): void {
  state.verify = { ...toVerifyRecord(run), ...provenance(stamp) };
}

export interface DetectedCommand {
  name: string;
  run: string;
  why: string;
}

/**
 * Suggests verification commands from the project's own build files, so
 * `sdlc init` can pre-fill `verify.commands` (a person confirms them).
 */
export function detectVerifyCommands(root: string): DetectedCommand[] {
  const found: DetectedCommand[] = [];
  const pkgFile = path.join(root, 'package.json');
  if (isFile(pkgFile)) {
    try {
      const pkg = JSON.parse(readText(pkgFile) ?? '{}') as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      const runner = exists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
        : exists(path.join(root, 'yarn.lock')) ? 'yarn'
          : exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock')) ? 'bun' : 'npm';
      const cmd = (script: string) => (runner === 'npm' ? (script === 'test' ? 'npm test' : `npm run ${script}`) : `${runner} run ${script}`);
      for (const script of ['build', 'typecheck', 'lint', 'test']) {
        if (scripts[script] && !/no test specified/.test(scripts[script])) {
          found.push({ name: script, run: cmd(script), why: `package.json scripts.${script}` });
        }
      }
    } catch {
      // Ignore unreadable package.json.
    }
  }
  const makefile = path.join(root, 'Makefile');
  if (found.length === 0 && isFile(makefile)) {
    const text = readText(makefile) ?? '';
    for (const target of ['build', 'lint', 'test']) {
      if (new RegExp(`^${target}\\s*:`, 'm').test(text)) found.push({ name: target, run: `make ${target}`, why: 'Makefile target' });
    }
  }
  if (found.length === 0 && (isFile(path.join(root, 'pyproject.toml')) || isFile(path.join(root, 'pytest.ini')))) {
    found.push({ name: 'test', run: 'pytest', why: 'Python project' });
  }
  if (found.length === 0 && isFile(path.join(root, 'go.mod'))) {
    found.push({ name: 'build', run: 'go build ./...', why: 'go.mod' }, { name: 'test', run: 'go test ./...', why: 'go.mod' });
  }
  if (found.length === 0 && isFile(path.join(root, 'Cargo.toml'))) {
    found.push({ name: 'build', run: 'cargo build', why: 'Cargo.toml' }, { name: 'test', run: 'cargo test', why: 'Cargo.toml' });
  }
  return found;
}
