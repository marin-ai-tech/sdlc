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
const STATE_FILE_WRITE = /\.sdlc\.yaml|\.sdlc\/log\.jsonl/;
const STATE_FILE = /(^|\/)\.sdlc\.yaml$|^openspec\/\.sdlc\/log\.jsonl$/;
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
        reason: 'Gate approvals, rejections, waivers, test unlocks, track selection and backlog priority are human decisions. Ask the responsible person to run the command in their own terminal.',
      };
    }
    if (STATE_FILE_WRITE.test(cmd) && WRITE_OPS.test(cmd)) {
      return {
        decision: 'deny',
        rule: 'state-integrity',
        reason: '.sdlc.yaml and openspec/.sdlc/log.jsonl hold gate approvals, evidence and the audit log; only the sdlc CLI may change them. Use `sdlc` commands instead of editing them.',
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
          reason: `This looks like a production release (matched /${release}/). Production releases need a named release authorization: a release manager runs \`sdlc approve release --change <id>\` after reviewing release.md (or sets SDLC_RELEASE_APPROVAL for this session). The agent prepares the release; it does not authorize it.`,
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
      reason: '.sdlc.yaml and openspec/.sdlc/log.jsonl hold gate approvals, evidence and the audit log; only the sdlc CLI may change them.',
    };
  }

  const isProtected = matcher(config.enforcement.protectedPaths);
  const protectedHit = rels.find(isProtected);
  if (protectedHit) {
    return {
      decision: 'deny',
      rule: 'protected-path',
      reason: `${protectedHit} is a protected path (enforcement.protected_paths in openspec/sdlc.yaml). Change it through its owning process, not in an agent session.`,
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
        reason: `Tests are locked for change '${locking.id}' (fix-first protocol): the failing test is the proof, so fix the code, not ${testHit}. A person can unlock with \`sdlc tests unlock --change ${locking.id}\`.`,
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
            ? `No SDLC change covers this edit (${code[0]}). Nothing is implemented without an accepted plan: start with /sdlc:intent (or \`sdlc new <name>\`), or keep the edit out of scope.`
            : `No active change has an approved plan yet (${pending.join(', ')}). Finish the plan and have an engineer run \`sdlc approve plan --change <id>\` before editing ${code[0]}.`
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
    return `Next backlog item: ${item.id} ${item.title}. Start with \`${start}\`.`;
  }
  const lines = [`SDLC harness (${stampText(harnessStamp(ctx.config))}): active changes in openspec/changes (run \`sdlc status\` for details).`];
  for (const ref of changes.slice(0, 8)) {
    try {
      const view = evaluateChange(ctx.paths.root, ref, ctx.config, { skipFingerprint: true });
      const who = view.next.actor === 'human' ? 'waiting on a person' : view.next.actor === 'agent' ? 'agent' : '';
      lines.push(`- ${view.change}: stage ${view.stage}; next (${who}): ${view.next.message}`);
    } catch (error) {
      lines.push(`- ${ref.id}: cannot evaluate (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (changes.length > 8) lines.push(`- ...and ${changes.length - 8} more`);
  lines.push(`Enforcement mode is ${ctx.config.enforcement.mode}. Gate approvals are made by people with \`sdlc approve\`, never by the agent.`);
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
        return `Change '${view.change}' has all tasks checked but no passing verification for the current code (${verify.reason ?? verify.status}). Run \`sdlc verify --change ${view.change}\` and paste the evidence before finishing.`;
      }
    } catch {
      // Ignore changes that cannot be evaluated here.
    }
  }
  return undefined;
}
