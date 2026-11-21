import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SdlcConfig, VerifyCommand } from './config.js';
import {
  provenance, type ChangeState, type RemoteRunReason, type VerifyCommandRecord, type VerifyMcpRecord,
  type VerifyRecord,
} from './change-state.js';
import { exists, isFile, readText, writeTextAtomic } from './fs-utils.js';
import { headCommit, isDirty, worktreeFingerprint } from './git.js';
import { stampText, stripProvenance, withProvenance, type HarnessStamp } from './license.js';
import { renderExtras, type EvidenceExtras } from './verify-extras.js';
import { FINGERPRINT_EXCLUDES } from './lifecycle.js';
import { runOwnedCheck } from './check-lifecycle.js';
import { commandPassed, fingerprintFailureReason, remoteFailureReason } from './verify-reason.js';
import { remoteLogNote, runRemoteCheck } from './verify-remote.js';
import { unstableDigest, unstableEnvironment } from './verify-unstable.js';
import { reuseNote } from './verify-reuse.js';

/**
 * The playbook's feedback loop, made deterministic: run the project's own
 * checks (build, test, lint...), keep the literal output as evidence, and bind
 * the result to the exact worktree it ran against. The verify gate passes only
 * while that fingerprint still matches, so "tests passed" can never outlive
 * the code it was about.
 */
export interface CheckOutcome extends VerifyCommandRecord {
  output: string;
  kept?: boolean;
  cancelled?: 'SIGINT' | 'SIGTERM';
  cleanup_failed?: boolean;
}

/** An MCP check's outcome (B12) with the answer the server gave (`result`). */
export interface McpCheckOutcome extends VerifyMcpRecord {
  result: unknown;
  kept?: boolean;
  /** The commit a `${HEAD}` check asked about, omitted from stored MCP records. */
  commit?: string;
}

export interface VerificationRun {
  id: string;
  started_at: string;
  status: 'passed' | 'failed';
  at: string;
  commit?: string;
  dirty: boolean;
  fingerprint?: string;
  reason?: 'fingerprint_unavailable' | RemoteRunReason;
  /** Set when no check ran and the results are another change's passing run on this fingerprint (B183). */
  reusedFrom?: { change: string; run_id: string };
  /** The digest of the unstable list the run used (B183): a reused source must match today's list. */
  unstableDigest?: string;
  checks: CheckOutcome[];
  /** MCP checks the CLI called after the commands (src/mcp/checks.ts); absent when there are none. */
  mcp?: McpCheckOutcome[];
}



interface CheckContext {
  root: string;
  config: SdlcConfig;
  unstableTests: string;
  changeDir?: string;
  runId: string;
  commit?: string;
  fingerprint?: string;
}

function runCheck(context: CheckContext, check: VerifyCommand): Promise<CheckOutcome> {
  const { root, config, unstableTests } = context;
  const timeout = check.timeoutSeconds ?? config.verify.timeoutSeconds;
  const start = (remoteEnv: Record<string, string> = {}) =>
    runOwnedCheck(root, check, timeout, config.verify.outputLines, unstableTests, remoteEnv);
  if (check.remote !== true) return start();
  const remote = { root, changeDir: context.changeDir, runId: context.runId,
    commit: context.commit, fingerprint: context.fingerprint };
  return runRemoteCheck(remote, check, start);
}

export interface RunVerificationOptions {
  only?: string[];
  onCheck?: (check: VerifyCommand) => void;
  onStart?: (run: Pick<VerificationRun, 'id' | 'started_at' | 'fingerprint' | 'commit'>) => void;
  /** The worktree fingerprint the caller took before any check ran (B183); taken here when absent. */
  fingerprint?: string;
  /** The change folder: a remote check keeps its log under its `verification/remote/` (B252). */
  changeDir?: string;
}

export async function runVerification(
  root: string,
  config: SdlcConfig,
  options: RunVerificationOptions = {}
): Promise<VerificationRun> {
  const selected = options.only && options.only.length > 0
    ? config.verify.commands.filter((c) => options.only!.includes(c.name))
    : config.verify.commands;
  // Fingerprint before running: a check that rewrites files (formatters) must
  // not make its own evidence look fresh.
  const fingerprint = options.fingerprint ?? worktreeFingerprint(root, FINGERPRINT_EXCLUDES);
  const commit = headCommit(root);
  const dirty = isDirty(root, FINGERPRINT_EXCLUDES);
  const id = randomBytes(6).toString('hex');
  const started_at = new Date().toISOString();
  options.onStart?.({ id, started_at, fingerprint, commit });
  const checks: CheckOutcome[] = [];
  const context: CheckContext = { root, config, unstableTests: unstableEnvironment(config.verify.unstable),
    changeDir: options.changeDir, runId: id, commit, fingerprint };
  for (const check of selected) {
    options.onCheck?.(check);
    const outcome = await runCheck(context, check);
    checks.push({ ...outcome, timeout_seconds: check.timeoutSeconds ?? config.verify.timeoutSeconds });
    if (checks[checks.length - 1].cancelled) break;
  }
  const failed = checks.some((c) => c.cancelled || (c.required && !commandPassed(c)));
  const partial = !!options.only && options.only.length > 0 && selected.length < config.verify.commands.length;
  const status: VerificationRun['status'] = failed || partial || selected.length === 0 || !fingerprint
    ? 'failed' : 'passed';
  const reason = fingerprintFailureReason({ status, fingerprint, checks }, partial)
    ?? remoteFailureReason({ status, checks });
  return {
    id,
    started_at,
    // A partial run is evidence, never a pass for the gate.
    status,
    at: new Date().toISOString(),
    ...(commit ? { commit } : {}),
    dirty,
    ...(fingerprint ? { fingerprint } : {}),
    ...(reason ? { reason } : {}),
    unstableDigest: unstableDigest(config.verify.unstable),
    checks,
  };
}

export function toVerifyRecord(run: VerificationRun): VerifyRecord {
  return {
    id: run.id,
    started_at: run.started_at,
    status: run.status,
    at: run.at,
    ...(run.commit ? { commit: run.commit } : {}),
    ...(run.fingerprint ? { fingerprint: run.fingerprint } : {}),
    ...(run.reason ? { reason: run.reason } : {}),
    ...(run.reusedFrom ? { reused_from: run.reusedFrom } : {}),
    ...(run.unstableDigest ? { unstable_digest: run.unstableDigest } : {}),
    results: run.checks.map(({ output: _output, kept: _kept, ...rest }) => rest),
    ...(run.mcp && run.mcp.length > 0
      ? { mcp: run.mcp.map(({ result: _result, kept: _kept, commit: _commit, ...rest }) => rest) } : {}),
  };
}

const EVIDENCE_START = '<!-- sdlc:evidence:start -->';
const EVIDENCE_END = '<!-- sdlc:evidence:end -->';

function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

function escapeMarkdownCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/[\\`*_[\]()<>!|]/g, '\\$&');
}

/** The MCP checks' table rows and answers, next to the commands'. */
function mcpEvidence(run: VerificationRun): { rows: string[]; outputs: string[] } {
  const checks = run.mcp ?? [];
  const rows = checks.map((m) => {
    const result = m.ok ? '✅ ok' : `❌ ${escapeMarkdownCell(m.reason ?? 'failed')}`;
    const suffix = m.commit ? ` @ ${m.commit.slice(0, 12)}` : '';
    const call = `mcp ${m.server}/${m.tool}${suffix}`.replace(/\|/g, '\\|');
    const seconds = (m.duration_ms / 1000).toFixed(1);
    const attempt = m.attempt && m.attempt > 1 ? ` (attempt ${m.attempt})` : '';
    const outcome = `${result}${attempt}${reuseNote(run)}`;
    return `| ${m.name}${m.required ? '' : ' (optional)'} | \`${call}\` | ${outcome} | ${seconds}s |`;
  });
  const outputs = checks.map((m) => {
    const answer = m.kept ? '(kept from earlier run; answer not stored)'
      : m.result === undefined ? '(no answer)' : JSON.stringify(m.result, null, 2);
    return `<details><summary>${m.name} answer</summary>\n\n${fence(answer)}\n\n</details>`;
  });
  return { rows, outputs };
}

/** Required checks, commands and MCP checks together: how many passed out of how many. */
function requiredCounts(run: VerificationRun, config?: SdlcConfig): { passedRequired: number; total: number } {
  const requiredMcp = (run.mcp ?? []).filter((m) => m.required);
  const required = run.checks.filter((c) => c.required);
  const passedRequired = required.filter((c) => commandPassed(c)).length
    + requiredMcp.filter((m) => m.ok).length;
  const total = config
    ? [...config.verify.commands, ...(config.verify.mcp ?? [])].filter((check) => check.required).length
    : required.length + requiredMcp.length;
  return { passedRequired, total };
}

export function renderEvidence(
  run: VerificationRun,
  changeId: string,
  stamp?: HarnessStamp,
  extras?: EvidenceExtras,
  config?: SdlcConfig
): string {
  const mcp = mcpEvidence(run);
  const { passedRequired, total } = requiredCounts(run, config);
  const rows = run.checks.map((c) => {
    const result = commandResult(c);
    const attempt = c.attempt && c.attempt > 1 ? ` (attempt ${c.attempt})` : '';
    const name = `${c.name}${c.required ? '' : ' (optional)'}`;
    const command = c.command.replace(/\|/g, '\\|');
    const seconds = (c.duration_ms / 1000).toFixed(1);
    return `| ${name} | \`${command}\` | ${result}${attempt}${remoteLogNote(c)}${reuseNote(run)} | ${seconds}s |`;
  });
  const outputs = run.checks.map((c) => {
    const output = c.kept
      ? `(kept from earlier run${reuseNote(run)}; output not stored)` : c.output || '(no output)';
    return `<details><summary>${c.name} output (last lines)</summary>\n\n${fence(output)}\n\n</details>`;
  });
  const missingCommands = (config?.verify.commands ?? []).filter((check) =>
    !run.checks.some((result) => result.name === check.name));
  const missingMcp = (config?.verify.mcp ?? []).filter((check) =>
    !(run.mcp ?? []).some((result) => result.name === check.name));
  const missingRows = [
    ...missingCommands.map((check) => `| ${check.name} | \`${check.run}\` | not run | n/a |`),
    ...missingMcp.map((check) => `| ${check.name} | \`mcp ${check.server}/${check.tool}\` | not run | n/a |`),
  ];
  return [
    EVIDENCE_START,
    '## Automated evidence',
    '',
    `Recorded by \`sdlc verify --change ${changeId}\`. Regenerated on every run; do not edit by hand.`,
    '',
    `- **Result**: ${run.status === 'passed' ? 'PASSED' : 'FAILED'} (${passedRequired}/${total} required checks)`,
    `- **Run at**: ${run.at}`,
    `- **Commit**: ${run.commit ? run.commit.slice(0, 12) : 'n/a'}${run.dirty ? ' + uncommitted changes' : ''}`,
    ...(stamp ? [`- **Harness**: ${stampText(stamp)}`] : []),
    '',
    '| Check | Command | Result | Duration |',
    '|---|---|---|---|',
    ...rows,
    ...mcp.rows,
    ...missingRows,
    '',
    ...renderExtras(extras),
    ...outputs,
    ...mcp.outputs,
    EVIDENCE_END,
  ].join('\n');
}

function commandResult(check: CheckOutcome): string {
  if (check.cancelled) return `❌ cancelled ${check.cancelled}`;
  if (check.cleanup_failed) return `❌ cleanup failed (exit ${check.exit_code ?? '?'})`;
  if (check.timed_out) return '⏱ timed out';
  if (check.reason) return `❌ ${check.reason}`;
  if (check.answer_failed) return '❌ answer did not pass';
  return check.exit_code === 0 ? '✅ exit 0' : `❌ exit ${check.exit_code ?? '?'}`;
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
  stamp?: HarnessStamp,
  extras?: EvidenceExtras,
  config?: SdlcConfig
): string {
  const file = path.join(changeDir, 'verification.md');
  const block = renderEvidence(run, changeId, stamp, extras, config);
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
      const hooks = scripts.test ? ['pretest', 'posttest'].filter((hook) => typeof scripts[hook] === 'string') : [];
      const runsInHook = (script: string): string | undefined => hooks.find((hook) => {
        const pattern = new RegExp(
          `(?:^|&&|[;|])\\s*(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?${script}(?=\\s|[;&|]|$)`
        );
        return pattern.test(scripts[hook]);
      });
      for (const script of ['build', 'typecheck', 'lint', 'test']) {
        if (scripts[script] && !/no test specified/.test(scripts[script])) {
          if (script !== 'test' && runsInHook(script)) continue;
          const included = script === 'test' ? ['build', 'typecheck', 'lint'].filter(runsInHook) : [];
          const note = included.map((item) => `${item} runs in ${runsInHook(item)} of test`).join('; ');
          found.push({ name: script, run: cmd(script),
            why: `package.json scripts.${script}${note ? `; ${note}` : ''}` });
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
