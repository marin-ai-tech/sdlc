import * as path from 'node:path';
import picomatch from 'picomatch';
import type { SdlcConfig } from './config.js';
import { readChangeState } from './change-state.js';
import { listActiveChanges } from './changes.js';
import { isWithin, toPosix } from './fs-utils.js';
import { harnessStamp, stampText } from './license.js';
import { evaluateChange, sharedFingerprint, type LifecycleView } from './lifecycle.js';
import type { ProjectPaths } from './project.js';
import { HUMAN_COMMANDS } from './help-catalog.js';
import { nextBacklogItem, readBacklog } from './backlog.js';
import { t } from './i18n.js';

/**
 * Deterministic guardrails behind the advisory skills - the playbook's
 * "the skill makes violations rare and the hook makes them close to
 * impossible". One engine serves Claude Code hooks and the OpenCode plugin;
 * adapters only translate the tool call in and the decision out.
 *
 * Two classes of rule:
 * - hard rules (protected paths, locked tests, forged approvals, production
 *   release without authorization) deny whenever enforcement is not `off`;
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
}

export interface Decision {
  decision: 'allow' | 'deny' | 'warn';
  rule?: string;
  reason?: string;
}

const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'patch', 'apply_patch', 'str_replace_based_edit_tool', 'create', 'update']);
const BASH_TOOLS = new Set(['bash', 'shell', 'powershell', 'terminal', 'run_command']);
const READ_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'list', 'webfetch', 'websearch']);

/** Extracts the files a patch touches from the common `*** Update File:` envelope. */
function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const m of patch.matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/gm)) files.push(m[1].trim());
  for (const m of patch.matchAll(/^\+\+\+\s+(?:b\/)?(.+)$/gm)) if (m[1].trim() !== '/dev/null') files.push(m[1].trim());
  return files;
}

/** Normalizes a tool call from either agent's hook payload. */
export function normalizeToolCall(tool: string, input: Record<string, unknown>, cwd: string): ToolCall {
  const lower = tool.toLowerCase();
  const files: string[] = [];
  for (const key of ['file_path', 'filePath', 'notebook_path', 'path', 'target_file']) {
    const v = input[key];
    if (typeof v === 'string' && v) files.push(v);
  }
  for (const key of ['patch', 'patchText', 'patch_text', 'input']) {
    const v = input[key];
    if (typeof v === 'string' && (v.includes('***') || v.includes('+++ '))) files.push(...patchFiles(v));
  }
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : undefined;
  const kind: ToolKind = BASH_TOOLS.has(lower) || (command !== undefined && !EDIT_TOOLS.has(lower))
    ? 'bash'
    : EDIT_TOOLS.has(lower) || (files.length > 0 && !READ_TOOLS.has(lower))
      ? 'edit'
      : READ_TOOLS.has(lower) ? 'read' : 'other';
  return { tool, kind, files: [...new Set(files)], ...(command ? { command } : {}), cwd };
}

function relToRoot(root: string, cwd: string, file: string): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (!isWithin(root, abs)) return undefined;
  return toPosix(path.relative(root, abs));
}

function matcher(globs: string[]): (p: string) => boolean {
  if (globs.length === 0) return () => false;
  const m = picomatch(globs, { dot: true });
  return (p) => m(p);
}

// Every human-only catalog command is guarded here, including license set.
const APPROVAL_COMMAND = new RegExp(
  `\\b(?:sdlc|scdl)(?:\\.js)?\\s+(?:${HUMAN_COMMANDS.map((name) => name.replace(/ /g, '\\s+')).join('|')})\\b`
);
/** Harness records only the CLI writes: per-change `.sdlc.yaml` and the project log. */
const STATE_FILE_WRITE = /\.sdlc\.yaml|\.sdlc\/log\.jsonl|openspec\/roles\.yaml/;
const STATE_FILE = /(^|\/)\.sdlc\.yaml$|^openspec\/\.sdlc\/log\.jsonl$|^openspec\/roles\.yaml$/;
const WRITE_OPS = /(>>?|\btee\b|\bsed\s+-i|\bperl\s+-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bpython[0-9.]*\b|\bnode\b\s+-e|\bdd\b)/;

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
      const view = evaluateChange(ctx.paths.root, ref, ctx.config, full ? { fingerprint } : { skipFingerprint: true });
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

export function evaluateToolCall(call: ToolCall, ctx: PolicyContext): Decision {
  const { config, paths } = ctx;
  const env = ctx.env ?? process.env;
  const mode = config.enforcement.mode;
  if (mode === 'off') return { decision: 'allow' };
  const soft = (rule: string, reason: string): Decision =>
    ({ decision: mode === 'block' ? 'deny' : 'warn', rule, reason });

  if (call.kind === 'bash' && call.command) {
    const cmd = call.command;
    if (config.enforcement.forbidAgentApprovals && APPROVAL_COMMAND.test(cmd)) {
      return {
        decision: 'deny',
        rule: 'separation-of-duties',
        reason: t('hook.separationOfDuties'),
      };
    }
    if (STATE_FILE_WRITE.test(cmd) && WRITE_OPS.test(cmd)) {
      return {
        decision: 'deny',
        rule: 'state-integrity',
        reason: t('hook.stateIntegrityBash'),
      };
    }
    const release = config.release.commands.find((p) => new RegExp(p, 'i').test(cmd));
    if (release) {
      if (env.SDLC_RELEASE_APPROVAL) return { decision: 'allow' };
      const changes = snapshots(ctx, true);
      const authorized = changes.filter((c) => gateOk(c.view, 'release'));
      if (authorized.length === 0) {
        return {
          decision: 'deny',
          rule: 'release-gate',
          reason: t('hook.releaseGate', { pattern: release }),
        };
      }
    }
    return { decision: 'allow' };
  }

  if (call.kind !== 'edit' || call.files.length === 0) return { decision: 'allow' };
  const rels = call.files
    .map((f) => relToRoot(paths.root, call.cwd, f))
    .filter((r): r is string => r !== undefined);
  if (rels.length === 0) return { decision: 'allow' };

  if (rels.some((r) => STATE_FILE.test(r))) {
    return {
      decision: 'deny',
      rule: 'state-integrity',
      reason: t('hook.stateIntegrityEdit'),
    };
  }

  const isProtected = matcher(config.enforcement.protectedPaths);
  const protectedHit = rels.find(isProtected);
  if (protectedHit) {
    return {
      decision: 'deny',
      rule: 'protected-path',
      reason: t('hook.protectedPath', { path: protectedHit }),
    };
  }

  const isTest = matcher(config.enforcement.testPaths);
  const isExempt = matcher(config.enforcement.exemptPaths);
  const needsChanges = rels.some(isTest) || (config.enforcement.requireApprovedPlan && rels.some((r) => !isExempt(r)));
  if (!needsChanges) return { decision: 'allow' };
  const changes = snapshots(ctx);

  const testHit = rels.find(isTest);
  if (testHit) {
    const locking = changes.find((c) => c.testsLocked);
    if (locking) {
      return {
        decision: 'deny',
        rule: 'tests-locked',
        reason: t('hook.testsLocked', { change: locking.id, path: testHit }),
      };
    }
  }

  if (config.enforcement.requireApprovedPlan) {
    const code = rels.filter((r) => !isExempt(r));
    if (code.length > 0) {
      const approved = changes.filter((c) => gateOk(c.view, 'plan'));
      if (approved.length === 0) {
        const pending = changes.map((c) => c.id);
        return soft(
          'plan-gate',
          pending.length === 0
            ? t('hook.planGateNone', { path: code[0] })
            : t('hook.planGatePending', { changes: pending.join(', '), path: code[0] }),
        );
      }
    }
  }
  return { decision: 'allow' };
}

/** Short lifecycle summary injected at session start (Claude SessionStart / OpenCode session). */
export function sessionSummary(ctx: PolicyContext): string | undefined {
  const changes = listActiveChanges(ctx.paths);
  if (changes.length === 0) {
    const item = nextBacklogItem(readBacklog(ctx.paths.root));
    if (!item) return undefined;
    const start = `${ctx.config.cli} backlog start ${item.id}`;
    return t('session.backlogNext', { id: item.id, title: item.title, start });
  }
  const stamp = stampText(harnessStamp(ctx.config));
  const lines = [t('session.header', { stamp })];
  for (const ref of changes.slice(0, 8)) {
    try {
      const view = evaluateChange(ctx.paths.root, ref, ctx.config, { skipFingerprint: true });
      const who = view.next.actor === 'human'
        ? t('session.whoPerson')
        : view.next.actor === 'agent' ? t('session.whoAgent') : '';
      const message = view.next.key ? t(view.next.key, view.next.params) : view.next.message;
      lines.push(t('session.changeLine', { change: view.change, stage: view.stage, who, message }));
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      lines.push(t('session.evalError', { id: ref.id, error: err }));
    }
  }
  if (changes.length > 8) lines.push(t('session.more', { count: changes.length - 8 }));
  lines.push(t('session.enforcement', { mode: ctx.config.enforcement.mode }));
  return lines.join('\n');
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
