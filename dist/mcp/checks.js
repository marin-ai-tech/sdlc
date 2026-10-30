import { hasUncommittedChanges } from '../core/git.js';
import { t } from '../core/i18n.js';
import { FINGERPRINT_EXCLUDES } from '../core/lifecycle.js';
import { findSecrets } from '../core/policy-secrets.js';
import { fingerprintFailureReason } from '../core/verify-reason.js';
import { McpTimeout, parseAnswer, withServer } from './client.js';
import { expandedSecrets } from './registry.js';
/**
 * `verify.mcp` (B12): `sdlc verify` calls each check's tool itself, with the SDK client, so the answer comes from
 * the server and not from the agent. `args` expand `${HEAD}` and `${CHANGE}`; the answer must contain `expect` (a
 * deep subset). A mismatch, a tool error, a timeout (60 s) or an unreachable server fails the check with a reason;
 * a failing required check fails the verification like a failing command. The commands, their order and the
 * fingerprint are untouched: the checks run after them and only add to the outcome.
 * What a server was given (its expanded `env`/`headers`) and anything that looks like a key or token is masked in
 * the answer and the reason before they reach the evidence, the JSON answer or the inbox.
 * B111: `${HEAD}` is the last commit, while verify checks the working tree. With uncommitted changes outside
 * openspec/ a check whose arguments use `${HEAD}` is not called: it fails with a reason to commit (and push) first.
 */
export const CHECK_TIMEOUT_MS = 60_000;
const MASK = '[redacted]';
const HEAD_VAR = '${HEAD}';
/** Whether any string in `value` (nested in arrays and objects) uses `${HEAD}`. */
export function usesHead(value) {
    if (typeof value === 'string')
        return value.includes(HEAD_VAR);
    if (Array.isArray(value))
        return value.some((item) => usesHead(item));
    if (value && typeof value === 'object')
        return Object.values(value).some((item) => usesHead(item));
    return false;
}
/**
 * B111: whether code outside openspec/ is uncommitted, for `CheckVars.dirty`. One git call, and only when one of
 * `checks` uses `${HEAD}`: the other checks run as before whatever the working tree holds.
 */
export function uncommittedCode(root, checks) {
    if (!checks.some((check) => usesHead(check.args)))
        return false;
    return hasUncommittedChanges(root, FINGERPRINT_EXCLUDES);
}
/** `${HEAD}` and `${CHANGE}` in every string of `value`. */
export function expandArgs(value, vars) {
    if (typeof value === 'string') {
        return value.replace(/\$\{HEAD\}/g, vars.head ?? '').replace(/\$\{CHANGE\}/g, vars.change);
    }
    if (Array.isArray(value))
        return value.map((item) => expandArgs(item, vars));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandArgs(item, vars)]));
    }
    return value;
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function childKey(key, child) {
    if (typeof child === 'number')
        return `${key}[${child}]`;
    return key ? `${key}.${child}` : child;
}
/** The first place where `actual` does not contain `expected`: objects by key, arrays item by item, else equal. */
export function subsetMismatch(expected, actual, key = '') {
    if (isObject(expected)) {
        if (Object.hasOwn(expected, '$any')) {
            const matches = Array.isArray(actual) &&
                actual.some((item) => subsetMismatch(expected.$any, item) === undefined);
            return matches ? undefined : { key: key || '(answer)', expected, actual };
        }
        if (!isObject(actual))
            return { key: key || '(answer)', expected, actual };
        for (const [name, value] of Object.entries(expected)) {
            const found = subsetMismatch(value, actual[name], childKey(key, name));
            if (found)
                return found;
        }
        return undefined;
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) {
            return { key: key || '(answer)', expected, actual };
        }
        for (let i = 0; i < expected.length; i += 1) {
            const found = subsetMismatch(expected[i], actual[i], childKey(key, i));
            if (found)
                return found;
        }
        return undefined;
    }
    return Object.is(expected, actual) ? undefined : { key: key || '(answer)', expected, actual };
}
/** `text` with each secret replaced by the mask. */
function maskText(text, secrets) {
    const known = [...secrets, ...findSecrets(text).map((finding) => finding.value)].filter((value) => value.length > 0);
    return known.reduce((out, secret) => out.split(secret).join(MASK), text);
}
/** `value` with every string masked. */
export function maskSecrets(value, secrets) {
    if (typeof value === 'string')
        return maskText(value, secrets);
    if (Array.isArray(value))
        return value.map((item) => maskSecrets(item, secrets));
    if (isObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskSecrets(item, secrets)]));
    }
    return value;
}
function errorText(error) {
    if (error instanceof McpTimeout)
        return t('verify.mcpTimeout', { seconds: Math.round(error.ms / 1000) });
    return error instanceof Error ? error.message : String(error);
}
/** A list in a pending condition accepts any of its values. */
export function pendingMatch(expected, actual) {
    if (Array.isArray(expected))
        return expected.some((item) => pendingMatch(item, actual));
    if (isObject(expected)) {
        if (Object.hasOwn(expected, '$any')) {
            return Array.isArray(actual) && actual.some((item) => pendingMatch(expected.$any, item));
        }
        if (!isObject(actual))
            return false;
        return Object.entries(expected).every(([key, value]) => pendingMatch(value, actual[key]));
    }
    return Object.is(expected, actual);
}
function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Retry pending results on the same connection, within the configured wait and the overall connection limit. */
async function finalAnswer(check, server, args) {
    const waitMs = check.wait_seconds * 1000;
    const started = Date.now();
    const limit = CHECK_TIMEOUT_MS + waitMs;
    return withServer(server, limit, async (client) => {
        let delay = 1000;
        while (true) {
            const raw = await client.callTool({ name: check.tool, arguments: args }, undefined, { timeout: CHECK_TIMEOUT_MS });
            const answer = parseAnswer(raw);
            const pending = !answer.isError && check.wait_while !== undefined &&
                pendingMatch(check.wait_while, answer.result);
            if (!pending)
                return { answer, pending: false };
            const remaining = waitMs - (Date.now() - started);
            if (remaining <= 0)
                return { answer, pending: true };
            await pause(Math.min(delay, remaining));
            delay = Math.min(delay * 2, 15_000);
        }
    });
}
async function callCheck(check, server, vars) {
    const args = expandArgs(check.args, vars);
    try {
        const { answer, pending } = await finalAnswer(check, server, args);
        if (answer.isError) {
            return { ok: false, reason: t('verify.mcpToolError', { text: answer.text ?? '' }), result: answer.result };
        }
        if (pending) {
            const reason = `Still pending after ${check.wait_seconds} seconds`;
            return { ok: false, reason, result: answer.result };
        }
        const miss = subsetMismatch(check.expect, answer.result);
        if (!miss)
            return { ok: true, result: answer.result };
        const actual = JSON.stringify(miss.actual) ?? 'null';
        const params = { key: miss.key, expected: JSON.stringify(miss.expected), actual };
        return { ok: false, reason: t('verify.mcpMismatch', params), result: answer.result };
    }
    catch (error) {
        const reason = t('verify.mcpUnreachable', { server: server.name, error: errorText(error) });
        return { ok: false, reason, result: null };
    }
}
/** The check's verdict: not called for an unknown server or for `${HEAD}` with uncommitted code (B111). */
async function verdictFor(check, server, vars) {
    if (!server)
        return { ok: false, reason: t('verify.mcpUnknownServer', { server: check.server }), result: null };
    if (vars.dirty && usesHead(check.args))
        return { ok: false, reason: t('verify.mcpHeadDirty'), result: null };
    return callCheck(check, server, vars);
}
/** One check, run and masked. */
async function runCheck(check, servers, vars) {
    const started = Date.now();
    const server = servers.find((item) => item.name === check.server);
    const verdict = await verdictFor(check, server, vars);
    const secrets = server ? expandedSecrets(server, process.env) : [];
    const base = { name: check.name, server: check.server, tool: check.tool, required: check.required, ok: verdict.ok };
    const reason = verdict.reason === undefined ? {} : { reason: maskText(verdict.reason, secrets) };
    return { ...base, ...reason, duration_ms: Date.now() - started, result: maskSecrets(verdict.result, secrets) };
}
/** The checks `--only` selects (all without it), in the file's order. */
export function selectedChecks(config, only) {
    const checks = config.verify.mcp ?? [];
    return only && only.length > 0 ? checks.filter((check) => only.includes(check.name)) : checks;
}
/** Runs the checks one after the other. */
export async function runMcpChecks(config, checks, vars) {
    const servers = config.mcp?.servers ?? [];
    const outcomes = [];
    for (const check of checks)
        outcomes.push(await runCheck(check, servers, vars));
    return outcomes;
}
/**
 * The run with its MCP checks: it passes only when the commands passed (or there are none) and every required
 * MCP check is ok; a run that skipped checks (`--only`) never passes.
 */
export function withMcpChecks(run, config, mcp) {
    const total = (config.verify.mcp ?? []).length;
    if (total === 0)
        return run;
    // Without commands, `runVerification` reports `failed` for running nothing; the MCP checks decide then.
    const commandsOk = config.verify.commands.length === 0 || run.status === 'passed';
    const mcpOk = mcp.length === total && mcp.every((check) => check.ok || !check.required);
    const passed = !!run.fingerprint && commandsOk && mcpOk;
    const status = passed ? 'passed' : 'failed';
    const partial = run.checks.length !== config.verify.commands.length || mcp.length !== total;
    const reason = fingerprintFailureReason({ ...run, status, mcp }, partial);
    const { reason: _previousReason, ...rest } = run;
    return { ...rest, status, mcp, ...(reason ? { reason } : {}) };
}
