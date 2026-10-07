import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordAwaiting } from './core/awaiting.js';
import { loadConfig } from './core/config.js';
import { isFile, isWithin, toPosix } from './core/fs-utils.js';
import { resolveLocale, setLocale, systemLocale, t } from './core/i18n.js';
import { appendLog } from './core/log.js';
import { evaluateToolCall, normalizeToolCall, sessionSummary, stopCheck, type Decision, type ToolCall } from './core/policy.js';
import { findProjectRoot, projectPaths } from './core/project.js';

/**
 * `sdlc hook <event> [--agent claude|opencode]` - the single policy
 * dispatcher behind Claude Code hooks and the OpenCode plugin.
 *
 * Reads the tool call JSON on stdin and answers in the caller's format. It
 * fails open: a missing project, a harness that is not initialized, or any
 * internal error allows the action, because a broken guardrail must not
 * wedge every edit (`sdlc doctor` surfaces those problems instead).
 * That empty answer is a decision: the OpenCode plugin and the Claude Code
 * PreToolUse command let the call through, but a hook that cannot run is
 * retried once with the same input and then blocks the call (OpenCode: spawn
 * error, signal, non-zero exit, output that is not JSON; Claude Code: a
 * non-zero exit, blocked with exit 2); only a CLI that is not installed at all
 * lets the call through there.
 */
type HookEvent = 'pre-tool' | 'session-start' | 'stop';
type Agent = 'claude' | 'opencode';

interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
  source?: string;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function write(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** One reminder per session and rule, so `warn` mode does not repeat itself on every edit. */
function firstTimeThisSession(sessionId: string | undefined, key: string): boolean {
  if (!sessionId) return true;
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'default';
  const file = path.join(os.tmpdir(), `sdlc-hook-${safe}.json`);
  let seen: string[] = [];
  try {
    seen = JSON.parse(fs.readFileSync(file, 'utf-8')) as string[];
  } catch {
    // first reminder in this session
  }
  if (seen.includes(key)) return false;
  try {
    fs.writeFileSync(file, JSON.stringify([...seen, key]));
  } catch {
    // best effort
  }
  return true;
}

/** The reason the agent reads: the rule, its text, and the guide section that explains the rule. */
function hookReason(decision: Decision): string {
  const text = `[sdlc:${decision.rule}] ${decision.reason ?? ''}`.trim();
  const section = decision.rule ? `denials#${decision.rule}` : 'denials';
  return `${text} ${t('hook.guideHint', { section })}`;
}

/** Answers the agent; returns true when a denial or a (first) warning was delivered. */
function respondPreTool(agent: Agent, decision: Decision, sessionId: string | undefined): boolean {
  if (decision.decision === 'allow') {
    if (agent === 'opencode') write({ decision: 'allow' });
    return false;
  }
  const reason = hookReason(decision);
  if (agent === 'opencode') {
    if (decision.decision === 'warn' && !firstTimeThisSession(sessionId, decision.rule ?? 'warn')) {
      write({ decision: 'allow' });
      return false;
    }
    write({ decision: decision.decision, rule: decision.rule, reason });
    return true;
  }
  if (decision.decision === 'deny') {
    write({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    return true;
  }
  if (firstTimeThisSession(sessionId, decision.rule ?? 'warn')) {
    write({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reason } });
    return true;
  }
  return false;
}

/**
 * Log detail for a hook decision: the rule, the tool and the project files it
 * targeted. Shell command text is never logged; it can carry secrets.
 */
function decisionDetail(root: string, call: ToolCall, decision: Decision): string {
  const files = call.files
    .map((f) => (path.isAbsolute(f) ? f : path.resolve(call.cwd, f)))
    .filter((f) => isWithin(root, f))
    .map((f) => toPosix(path.relative(root, f)));
  return `${decision.rule ?? 'policy'}: ${call.tool}${files.length > 0 ? ` ${files.slice(0, 5).join(', ')}` : ''}`;
}

function applyHookLocale(configLocale: string | undefined): void {
  setLocale(resolveLocale({
    env: process.env,
    config: configLocale,
    system: systemLocale(),
  }));
}

export async function runHook(event: string, agentFlag: string | undefined): Promise<void> {
  const agent: Agent = agentFlag === 'opencode' ? 'opencode' : 'claude';
  let input: HookInput = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? (JSON.parse(raw) as HookInput) : {};
  } catch {
    return;
  }
  try {
    const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const root = findProjectRoot(cwd);
    if (!root) return;
    const paths = projectPaths(root);
    if (!isFile(paths.sdlcConfig)) return;
    const config = loadConfig(paths.sdlcConfig);
    applyHookLocale(config.locale);
    const ctx = { paths, config };

    switch (event as HookEvent) {
      case 'pre-tool': {
        const call = normalizeToolCall(String(input.tool_name ?? ''), input.tool_input ?? {}, cwd);
        const decision = evaluateToolCall(call, ctx);
        if (respondPreTool(agent, decision, input.session_id) && config.log.hookDecisions) {
          appendLog(root, config, {
            event: decision.decision === 'deny' ? 'hook.denied' : 'hook.warned',
            agent,
            detail: decisionDetail(root, call, decision),
          });
        }
        return;
      }
      case 'session-start': {
        if (!config.enforcement.sessionContext) return;
        const summary = sessionSummary(ctx, (view) => recordAwaiting(root, config, view));
        if (!summary) return;
        if (agent === 'opencode') write({ context: summary });
        else write({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: summary } });
        return;
      }
      case 'stop': {
        if (input.stop_hook_active) return;
        const message = stopCheck(ctx);
        if (!message) return;
        if (agent === 'opencode') write({ decision: 'warn', reason: message });
        else write({ decision: 'block', reason: `[sdlc] ${message}` });
        return;
      }
      default:
        return;
    }
  } catch (error) {
    if (process.env.SDLC_HOOK_DEBUG) {
      process.stderr.write(`sdlc hook error: ${error instanceof Error ? error.stack : String(error)}\n`);
    }
  }
}
