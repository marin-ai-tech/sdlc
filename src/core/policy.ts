import picomatch from 'picomatch';
import type { SdlcConfig } from './config.js';
import { readChangeState } from './change-state.js';
import { listActiveChanges } from './changes.js';
import { harnessStamp, stampText } from './license.js';
import { evaluateChange, sharedFingerprint, type LifecycleView } from './lifecycle.js';
import type { ProjectPaths } from './project.js';
import { HUMAN_COMMANDS } from './help-catalog.js';
import { nextBacklogItem, readBacklog } from './backlog.js';
import { t } from './i18n.js';
import { quotedCommand } from './human-command.js';
import { removesSdlcCli } from './policy-cli.js';
import { clearsAgentMarker } from './policy-markers.js';
import { handBackLine, shellTakeoverDenial, takeoverDenial } from './takeover.js';
import { hardLinkedStateFiles } from './policy-hardlink.js';
import { guardDenial, guardEditHits, shellGuardWrites } from './policy-guard.js';
import { userGuardEditHits, userShellGuardWrites } from './user-guard.js';
import { editWrites, type EditWrite } from './edit-texts.js';
import { secretEditDenial, shellSecretDenial } from './policy-secrets.js';
import { mcpStageDecision } from './policy-mcp.js';
import { inboxSessionLines } from '../mcp/inbox.js';
import {
  BACKLOG_FILE,
  linkedStateFiles,
  relToRoot,
  shellStateWrites,
  STATE_FILE,
  STATE_FILE_WRITE,
  WRITE_OPS,
} from './policy-shell.js';
import { shellWriteDestinations } from './policy-shell-writes.js';
import { patchFiles } from './policy-patch-files.js';

/**
 * Deterministic guardrails behind the advisory skills - the playbook's
 * "the skill makes violations rare and the hook makes them close to
 * impossible". One engine serves Claude Code hooks and the OpenCode plugin;
 * adapters only translate the tool call in and the decision out.
 *
 * Two classes of rule:
 * - hard rules (protected paths, locked tests, forged approvals, production
 *   release without authorization, the state files and the guard's own
 *   configuration) deny whenever enforcement is not `off`;
 * - process rules (no code before an approved plan) deny in `block` mode and
 *   only remind the agent in `warn` mode.
 */
export type ToolKind = 'edit' | 'bash' | 'read' | 'other';

export interface ToolCall {
  tool: string;
  kind: ToolKind;
  /** Files the call would create or modify, absolute or relative to `cwd`. */
  files: string[];
  command?: string;
  cwd: string;
  /** Edit tools: the text each target file gains and loses (rule `secret-in-edit`, B16). */
  writes?: EditWrite[];
}

export interface Decision {
  decision: 'allow' | 'deny' | 'warn';
  rule?: string;
  reason?: string;
}

const EDIT_TOOLS = new Set(['edit', 'write', 'write_file', 'replace', 'multiedit', 'notebookedit', 'patch',
  'apply_patch', 'str_replace_based_edit_tool', 'create', 'update']);
const BASH_TOOLS = new Set(['bash', 'shell', 'powershell', 'terminal', 'run_command', 'run_shell_command']);
const READ_TOOLS = new Set(['read', 'read_file', 'grep', 'glob', 'ls', 'list', 'webfetch', 'websearch']);

/** An edit tool's input with Codex's patch text (`command`, B82) under `patch`, so its written text is checked. */
function patchInput(input: Record<string, unknown>, lower: string): Record<string, unknown> {
  const command = input.command;
  if (!EDIT_TOOLS.has(lower) || typeof command !== 'string' || typeof input.patch === 'string') return input;
  return { ...input, patch: command };
}

/** Normalizes a tool call from either agent's hook payload. */
export function normalizeToolCall(tool: string, input: Record<string, unknown>, cwd: string): ToolCall {
  const lower = tool.toLowerCase();
  const files: string[] = [];
  for (const key of ['file_path', 'filePath', 'notebook_path', 'path', 'target_file']) {
    const v = input[key];
    if (typeof v === 'string' && v) files.push(v);
  }
  // Codex (B82) sends its `apply_patch` text in `tool_input.command`: for an edit tool it is the patch.
  const patchKeys = ['patch', 'patchText', 'patch_text', 'input', ...(EDIT_TOOLS.has(lower) ? ['command'] : [])];
  for (const key of patchKeys) {
    const v = input[key];
    if (typeof v === 'string' && (v.includes('***') || v.includes('+++ '))) files.push(...patchFiles(v));
  }
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : undefined;
  const kind: ToolKind = BASH_TOOLS.has(lower) || (command !== undefined && !EDIT_TOOLS.has(lower))
    ? 'bash'
    : EDIT_TOOLS.has(lower) || (files.length > 0 && !READ_TOOLS.has(lower))
      ? 'edit'
      : READ_TOOLS.has(lower) ? 'read' : 'other';
  const writes = kind === 'edit' ? editWrites(patchInput(input, lower)) : [];
  return {
    tool,
    kind,
    files: [...new Set(files)],
    ...(command ? { command } : {}),
    cwd,
    ...(writes.length > 0 ? { writes } : {}),
  };
}

function matcher(globs: string[]): (p: string) => boolean {
  if (globs.length === 0) return () => false;
  // nocase: on Windows and macOS `SRC/Payments` is the same directory as `src/payments`.
  const m = picomatch(globs, { dot: true, nocase: true });
  return (p) => m(p);
}

/** The binary as agents spell it: `sdlc`, its old name, `sdlc.js` and the Windows shims `sdlc.cmd`, `sdlc.ps1`. */
const CLI_BINARY = String.raw`\b(?:sdlc|scdl)(?:\.(?:js|cmd|ps1|exe))?`;
/** Global options between the binary and the subcommand: `--locale en`, `--locale=ru`, `-h`. */
const GLOBAL_OPTIONS = String.raw`(?:\s+--?[a-z][\w-]*(?:=[^\s;&|]+|\s+[^\s;&|-][^\s;&|]*)?)*`;
/** The CLI and its global options, as the takeover rule matches an sdlc step on a held change. */
const CLI_PREFIX = `${CLI_BINARY}${GLOBAL_OPTIONS}`;
const HUMAN_NAMES = HUMAN_COMMANDS.map((name) => name.replace(/ /g, '\\s+')).join('|');
// Every human-only catalog command is guarded here, including license set.
// Case-insensitive: `SDLC.CMD approve` runs the same command on Windows.
const APPROVAL_COMMAND = new RegExp(`${CLI_BINARY}${GLOBAL_OPTIONS}\\s+(?:${HUMAN_NAMES})\\b`, 'i');
const ADOPT_APPLY_COMMAND = new RegExp(`${CLI_BINARY}${GLOBAL_OPTIONS}\\s+adopt\\b[^;&|\\r\\n]*--apply\\b`, 'i');

/** Joins `\`-newline (sh) and backtick-newline (PowerShell) continuations, so a split command reads as one. */
function joinContinuations(command: string): string {
  return command.replace(/[\\`]\r?\n/g, ' ');
}

/** One spelling per path before matching: forward slashes, no `/./` segments, no doubled slashes. */
function normalizePaths(command: string): string {
  return command
    .replace(/\\/g, '/')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/\/{2,}/g, '/');
}

/** The reason for a state-file denial: the backlog has its own, pointing at the backlog commands. */
function stateReason(backlog: boolean, edit: boolean): string {
  if (backlog) return t('hook.backlogIntegrity');
  return t(edit ? 'hook.stateIntegrityEdit' : 'hook.stateIntegrityBash');
}

export interface PolicyContext {
  paths: ProjectPaths;
  config: SdlcConfig;
  env?: NodeJS.ProcessEnv;
}

interface ChangeSnapshot {
  id: string;
  view?: LifecycleView;
  testsLocked: boolean;
  kind: string;
}

function snapshots(ctx: PolicyContext, full = false): ChangeSnapshot[] {
  const fingerprint = full ? sharedFingerprint(ctx.paths.root) : undefined;
  return listActiveChanges(ctx.paths).map((ref) => {
    try {
      // The hook never needs the names of the people who may approve (roles.yaml lookups): skipPeople.
      const options = full ? { fingerprint, skipPeople: true } : { skipFingerprint: true, skipPeople: true };
      const view = evaluateChange(ctx.paths.root, ref, ctx.config, options);
      return { id: ref.id, view, testsLocked: view.testsLocked, kind: view.kind };
    } catch {
      // A broken change must not wedge every edit in the repo; surface it via `sdlc doctor`.
      const state = safeState(ref.dir);
      return { id: ref.id, testsLocked: state?.tests_locked === true, kind: state?.kind ?? 'feature' };
    }
  });
}

function safeState(dir: string) {
  try {
    return readChangeState(dir);
  } catch {
    return undefined;
  }
}

function gateOk(view: LifecycleView | undefined, id: string): boolean {
  const g = view?.gates.find((x) => x.id === id);
  return !!g && (g.status === 'approved' || g.status === 'waived' || g.status === 'n/a');
}

/** A shell write to a state file, by its path text or (after `cd`, by glob, through a link) by what it resolves to. */
function stateWriteDenial(spelled: string, ctx: PolicyContext, cwd: string): Decision | undefined {
  if (STATE_FILE_WRITE.test(spelled) && WRITE_OPS.test(spelled)) {
    const backlogOnly = spelled.toLowerCase().includes(BACKLOG_FILE) && !/\.sdlc|roles\.yaml/i.test(spelled);
    return { decision: 'deny', rule: 'state-integrity', reason: stateReason(backlogOnly, false) };
  }
  const hits = shellStateWrites(spelled, ctx.paths.root, cwd);
  if (hits.length === 0) return undefined;
  const backlogOnly = hits.every((hit) => hit.toLowerCase() === BACKLOG_FILE);
  return { decision: 'deny', rule: 'state-integrity', reason: stateReason(backlogOnly, false) };
}

/**
 * Shell commands: cleared agent markers, human-only CLI steps, removing the CLI, writes to state files and to the
 * guard's configuration, a change a person holds, releases without an approved release gate.
 */
function evaluateCommand(
  command: string,
  ctx: PolicyContext,
  env: NodeJS.ProcessEnv,
  cwd: string,
  soft: Soft,
): Decision {
  const cmd = joinContinuations(command);
  // First: a command that clears the markers would also slip past the CLI's own agent check.
  if (clearsAgentMarker(cmd)) {
    return { decision: 'deny', rule: 'agent-marker', reason: t('hook.agentMarker') };
  }
  if (ctx.config.enforcement.forbidAgentApprovals &&
      (APPROVAL_COMMAND.test(cmd) || ADOPT_APPLY_COMMAND.test(cmd))) {
    return {
      decision: 'deny',
      rule: 'separation-of-duties',
      reason: t('hook.separationOfDuties', { command: quotedCommand(cmd) }),
    };
  }
  if (removesSdlcCli(cmd)) return { decision: 'deny', rule: 'cli-removal', reason: t('hook.cliRemoval') };
  const spelled = normalizePaths(cmd);
  const stateDenial = stateWriteDenial(spelled, ctx, cwd);
  if (stateDenial) return stateDenial;
  // The guard's own configuration (B41): the files that switch the rules on; also the user-level ones (B42).
  // The review policy may live where `review.policy` says (B75).
  const policy = [ctx.config.review.policy];
  const guardHits = [
    ...shellGuardWrites(spelled, ctx.paths.root, cwd, policy),
    ...userShellGuardWrites(spelled, cwd, env),
  ];
  const guard = guardDenial(guardHits);
  if (guard) return guard;
  // A key or token the command writes (B16): a shell write has no reliable target, so no exemption applies.
  const secret = shellSecretDenial(cmd);
  if (secret) return secret;
  // A change a person holds: no shell writes to its paths, no sdlc steps on it but the read-only ones.
  const held = shellTakeoverDenial(ctx.paths, spelled, cwd, CLI_PREFIX);
  if (held) return held;
  // 0.14.0 (B82): the files a command writes count for tests-locked and the plan gate, like an edit's.
  const written = shellWriteDestinations(cmd, ctx.paths.root, cwd);
  const protectedHit = written.find(matcher(ctx.config.enforcement.protectedPaths));
  if (protectedHit) {
    return { decision: 'deny', rule: 'protected-path', reason: t('hook.protectedPath', { path: protectedHit }) };
  }
  const gated = codeGateDenial(written, ctx, soft);
  if (gated) return gated;
  return releaseDecision(cmd, ctx, env);
}

/** A release command without an approved release gate (and without SDLC_RELEASE_APPROVAL) is denied. */
function releaseDecision(cmd: string, ctx: PolicyContext, env: NodeJS.ProcessEnv): Decision {
  const release = ctx.config.release.commands.find((p) => new RegExp(p, 'i').test(cmd));
  if (!release || env.SDLC_RELEASE_APPROVAL) return { decision: 'allow' };
  const authorized = snapshots(ctx, true).filter((c) => gateOk(c.view, 'release'));
  if (authorized.length > 0) return { decision: 'allow' };
  return {
    decision: 'deny',
    rule: 'release-gate',
    reason: t('hook.releaseGate', { pattern: release }),
  };
}

/** Every rule; a call the other rules allow may still be a registry MCP server out of stage (B43). */
export function evaluateToolCall(call: ToolCall, ctx: PolicyContext): Decision {
  const decision = evaluateRules(call, ctx);
  if (decision.decision !== 'allow') return decision;
  const stages = () => snapshots(ctx).flatMap((change) => (change.view ? [change.view.stage] : []));
  return mcpStageDecision(call.tool, ctx.config, stages) ?? decision;
}

function evaluateRules(call: ToolCall, ctx: PolicyContext): Decision {
  const { config, paths } = ctx;
  const env = ctx.env ?? process.env;
  const mode = config.enforcement.mode;
  if (mode === 'off') return { decision: 'allow' };
  const soft: Soft = (rule: string, reason: string): Decision =>
    ({ decision: mode === 'block' ? 'deny' : 'warn', rule, reason });

  if (call.kind === 'bash' && call.command) {
    return evaluateCommand(call.command, ctx, env, call.cwd, soft);
  }

  if (call.kind !== 'edit' || call.files.length === 0) return { decision: 'allow' };
  const rels = call.files
    .map((f) => relToRoot(paths.root, call.cwd, f))
    .filter((r): r is string => r !== undefined);
  // A link (or a new file in a linked directory) that resolves to a state file is that state file; so is a hard link.
  const stateHits = [
    ...rels.filter((r) => STATE_FILE.test(r)),
    ...linkedStateFiles(call.files, paths.root, call.cwd),
    ...hardLinkedStateFiles(call.files, paths.root, call.cwd),
  ];
  if (stateHits.length > 0) {
    return {
      decision: 'deny',
      rule: 'state-integrity',
      reason: stateReason(stateHits.every((r) => r.toLowerCase() === BACKLOG_FILE), true),
    };
  }
  // User-level agent settings (B42) lie outside the project: checked on the absolute paths, before `rels` alone.
  const userHits = userGuardEditHits(call.files, call.cwd, env);
  const policy = [config.review.policy];
  const guard = guardDenial([...guardEditHits(call.files, rels, paths.root, call.cwd, policy), ...userHits]);
  if (guard) return guard;
  if (rels.length === 0) return { decision: 'allow' };

  const isProtected = matcher(config.enforcement.protectedPaths);
  const protectedHit = rels.find(isProtected);
  if (protectedHit) {
    return {
      decision: 'deny',
      rule: 'protected-path',
      reason: t('hook.protectedPath', { path: protectedHit }),
    };
  }

  // A change a person holds: no agent edits in its folder and planned files (in the project, without a plan).
  const held = takeoverDenial(paths, rels);
  if (held) return held;
  // A key, token or password the edit adds (B16): a hard rule, like the ones above.
  const secret = secretEditDenial(call.writes, paths.root, call.cwd, config.enforcement.secretAllow);
  if (secret) return secret;

  return codeGateDenial(rels, ctx, soft) ?? { decision: 'allow' };
}

/** A rule of the enforcement mode: `deny` in block mode, `warn` otherwise. */
type Soft = (rule: string, reason: string) => Decision;

/** Tests-locked: a test file written while a change has its tests locked. */
function testsLockedDenial(rels: string[], changes: ChangeSnapshot[], isTest: (p: string) => boolean) {
  const testHit = rels.find(isTest);
  if (testHit === undefined) return undefined;
  const locking = changes.find((c) => c.testsLocked);
  if (!locking) return undefined;
  const reason = t('hook.testsLocked', { change: locking.id, path: testHit });
  const denial: Decision = { decision: 'deny', rule: 'tests-locked', reason };
  return denial;
}

/** The plan gate: code (a path that is not exempt) written while no change has an approved plan. */
function planGateDenial(code: string[], changes: ChangeSnapshot[], soft: Soft): Decision | undefined {
  if (code.length === 0) return undefined;
  if (changes.some((c) => gateOk(c.view, 'plan'))) return undefined;
  const pending = changes.map((c) => c.id);
  const reason = pending.length === 0
    ? t('hook.planGateNone', { path: code[0] })
    : t('hook.planGatePending', { changes: pending.join(', '), path: code[0] });
  return soft('plan-gate', reason);
}

/**
 * Tests-locked and the plan gate for root-relative paths an edit or (0.14.0, B82) a shell command writes; the exempt
 * paths (`openspec/**` and the like) stay writable before the plan.
 */
function codeGateDenial(rels: string[], ctx: PolicyContext, soft: Soft): Decision | undefined {
  const { enforcement } = ctx.config;
  const isTest = matcher(enforcement.testPaths);
  const isExempt = matcher(enforcement.exemptPaths);
  const code = enforcement.requireApprovedPlan ? rels.filter((r) => !isExempt(r)) : [];
  if (!rels.some(isTest) && code.length === 0) return undefined;
  const changes = snapshots(ctx);
  return testsLockedDenial(rels, changes, isTest) ?? planGateDenial(code, changes, soft);
}

/** Session start with no active change: the next backlog item, then the open inbox items. */
function idleSummary(ctx: PolicyContext, inbox: string[]): string[] {
  const item = nextBacklogItem(readBacklog(ctx.paths.root));
  if (!item) return inbox;
  const start = `${ctx.config.cli} backlog start ${item.id}`;
  return [t('session.backlogNext', { id: item.id, title: item.title, start }), ...inbox];
}

/** The last line of every session summary: the agent can be asked how sdlc works (0.9.1). */
function withGuideLine(lines: string[]): string {
  return [...lines, t('session.guide')].join('\n');
}

/**
 * Short lifecycle summary injected at session start (Claude SessionStart / OpenCode session). `observe` sees every
 * evaluated view, so the hook can record the gates that wait for a person without evaluating twice.
 */
export function sessionSummary(ctx: PolicyContext, observe?: (view: LifecycleView) => void): string {
  const changes = listActiveChanges(ctx.paths);
  // MCP results kept for the agent from outside its session (the inbox): one line per open item.
  const inbox = inboxSessionLines(ctx.paths.root, ctx.config.cli);
  if (changes.length === 0) return withGuideLine(idleSummary(ctx, inbox));
  const stamp = stampText(harnessStamp(ctx.config));
  const lines = [t('session.header', { stamp })];
  for (const ref of changes.slice(0, 8)) {
    try {
      const view = evaluateChange(ctx.paths.root, ref, ctx.config, { skipFingerprint: true });
      observe?.(view);
      const who = view.next.actor === 'human'
        ? t('session.whoPerson')
        : view.next.actor === 'agent' ? t('session.whoAgent') : '';
      const message = view.next.key ? t(view.next.key, view.next.params) : view.next.message;
      lines.push(t('session.changeLine', { change: view.change, stage: view.stage, who, message }));
      const handBack = handBackLine(ref.dir, view.change);
      if (handBack) lines.push(handBack);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      lines.push(t('session.evalError', { id: ref.id, error: err }));
    }
  }
  if (changes.length > 8) lines.push(t('session.more', { count: changes.length - 8 }));
  lines.push(...inbox);
  lines.push(t('session.enforcement', { mode: ctx.config.enforcement.mode }));
  return withGuideLine(lines);
}

/** Stop-time check: a change whose tasks are all done must carry fresh verification evidence. */
export function stopCheck(ctx: PolicyContext): string | undefined {
  if (!ctx.config.enforcement.verifyBeforeStop || ctx.config.enforcement.mode === 'off') return undefined;
  const fingerprint = sharedFingerprint(ctx.paths.root);
  for (const ref of listActiveChanges(ctx.paths)) {
    try {
      const view = evaluateChange(ctx.paths.root, ref, ctx.config, { fingerprint });
      const verify = view.gates.find((g) => g.id === 'verify');
      const planOk = gateOk(view, 'plan');
      if (planOk && view.tasks.total > 0 && view.tasks.remaining === 0 && verify && verify.status !== 'passed' && verify.required) {
        return t('hook.verifyBeforeStop', {
          change: view.change,
          detail: verify.reason ?? verify.status,
        });
      }
    } catch {
      // Ignore changes that cannot be evaluated here.
    }
  }
  return undefined;
}
