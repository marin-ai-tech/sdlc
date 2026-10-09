import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordAwaiting } from './core/awaiting.js';
import { loadConfig } from './core/config.js';
import { isFile, isWithin, toPosix } from './core/fs-utils.js';
import { resolveLocale, setLocale, systemLocale, t } from './core/i18n.js';
import { appendLog } from './core/log.js';
import { evaluateToolCall, normalizeToolCall, sessionSummary, stopCheck } from './core/policy.js';
import { findProjectRoot, projectPaths } from './core/project.js';
import { sessionHealthLine } from './core/health/signal.js';
import { cursorAllow, cursorDefault, cursorDeny, fromCursor } from './hook-cursor.js';
async function readStdin() {
    if (process.stdin.isTTY)
        return '';
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf-8');
}
/** Whether this run already answered (Cursor gets a default answer otherwise). */
let answered = false;
function write(obj) {
    answered = true;
    process.stdout.write(`${JSON.stringify(obj)}\n`);
}
/** One reminder per session and rule, so `warn` mode does not repeat itself on every edit. */
function firstTimeThisSession(sessionId, key) {
    if (!sessionId)
        return true;
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'default';
    const file = path.join(os.tmpdir(), `sdlc-hook-${safe}.json`);
    let seen = [];
    try {
        seen = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch {
        // first reminder in this session
    }
    if (seen.includes(key))
        return false;
    try {
        fs.writeFileSync(file, JSON.stringify([...seen, key]));
    }
    catch {
        // best effort
    }
    return true;
}
/** The reason the agent reads: the rule, its text, and the guide section that explains the rule. */
function hookReason(decision) {
    const text = `[sdlc:${decision.rule}] ${decision.reason ?? ''}`.trim();
    const section = decision.rule ? `denials#${decision.rule}` : 'denials';
    return `${text} ${t('hook.guideHint', { section })}`;
}
/** Cursor's answer: deny, or allow with the warning once per conversation (like the Claude Code reminder). */
function respondCursor(decision, sessionId) {
    if (decision.decision === 'allow') {
        write(cursorAllow());
        return false;
    }
    const reason = hookReason(decision);
    if (decision.decision === 'deny') {
        write(cursorDeny(reason));
        return true;
    }
    const first = firstTimeThisSession(sessionId, decision.rule ?? 'warn');
    write(cursorAllow(first ? reason : undefined));
    return first;
}
/** Answers the agent; returns true when a denial or a (first) warning was delivered. */
function respondPreTool(agent, decision, sessionId) {
    if (agent === 'cursor')
        return respondCursor(decision, sessionId);
    if (decision.decision === 'allow') {
        if (agent === 'opencode')
            write({ decision: 'allow' });
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
function decisionDetail(root, call, decision) {
    const files = call.files
        .map((f) => (path.isAbsolute(f) ? f : path.resolve(call.cwd, f)))
        .filter((f) => isWithin(root, f))
        .map((f) => toPosix(path.relative(root, f)));
    return `${decision.rule ?? 'policy'}: ${call.tool}${files.length > 0 ? ` ${files.slice(0, 5).join(', ')}` : ''}`;
}
function applyHookLocale(configLocale) {
    setLocale(resolveLocale({
        env: process.env,
        config: configLocale,
        system: systemLocale(),
    }));
}
function agentOf(flag) {
    return flag === 'opencode' || flag === 'cursor' || flag === 'codex' || flag === 'qwen'
        || flag === 'gigacode' ? flag : 'claude';
}
/** The session-start context in the agent's format. */
function writeContext(agent, summary) {
    if (agent === 'opencode')
        write({ context: summary });
    else if (agent === 'cursor')
        write({ additional_context: summary });
    else
        write({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: summary } });
}
/** The stop reminder in the agent's format; Cursor sends a follow-up message to the agent. */
function writeStop(agent, message) {
    if (agent === 'opencode')
        write({ decision: 'warn', reason: message });
    else if (agent === 'cursor')
        write({ followup_message: `[sdlc] ${message}` });
    else
        write({ decision: 'block', reason: `[sdlc] ${message}` });
}
export async function runHook(event, agentFlag) {
    const agent = agentOf(agentFlag);
    answered = false;
    await dispatch(event, agent);
    if (agent === 'cursor' && !answered)
        write(cursorDefault(event));
}
async function readInput(agent) {
    try {
        const raw = await readStdin();
        const parsed = raw.trim() ? JSON.parse(raw) : {};
        return agent === 'cursor' ? fromCursor(parsed) : parsed;
    }
    catch {
        return undefined;
    }
}
function hookProject(input) {
    const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const root = findProjectRoot(cwd);
    if (!root)
        return undefined;
    const paths = projectPaths(root);
    if (!isFile(paths.sdlcConfig))
        return undefined;
    const config = loadConfig(paths.sdlcConfig);
    applyHookLocale(config.locale);
    return { cwd, root, paths, config };
}
function preTool(agent, input, project) {
    const { root, config } = project;
    const call = normalizeToolCall(String(input.tool_name ?? ''), input.tool_input ?? {}, project.cwd);
    const decision = evaluateToolCall(call, { paths: project.paths, config });
    const logged = !input.skip_log;
    if (respondPreTool(agent, decision, input.session_id) && config.log.hookDecisions && logged) {
        appendLog(root, config, {
            event: decision.decision === 'deny' ? 'hook.denied' : 'hook.warned',
            agent,
            detail: decisionDetail(root, call, decision),
        });
    }
}
function sessionStart(agent, project) {
    const { root, paths, config } = project;
    if (!config.enforcement.sessionContext)
        return;
    const overview = sessionSummary({ paths, config }, (view) => recordAwaiting(root, config, view));
    if (!overview)
        return;
    // B67: one line only while a bad health finding exists (light evaluation; never fails the hook).
    const health = sessionHealthLine(root, paths, config);
    writeContext(agent, health ? `${overview}\n${health}` : overview);
}
function stop(agent, input, project) {
    if (input.stop_hook_active)
        return;
    const message = stopCheck({ paths: project.paths, config: project.config });
    if (message)
        writeStop(agent, message);
}
async function dispatch(event, agent) {
    const input = await readInput(agent);
    if (!input)
        return;
    try {
        const project = hookProject(input);
        if (!project)
            return;
        if (event === 'pre-tool')
            preTool(agent, input, project);
        else if (event === 'session-start')
            sessionStart(agent, project);
        else if (event === 'stop')
            stop(agent, input, project);
    }
    catch (error) {
        if (process.env.SDLC_HOOK_DEBUG) {
            process.stderr.write(`sdlc hook error: ${error instanceof Error ? error.stack : String(error)}\n`);
        }
    }
}
