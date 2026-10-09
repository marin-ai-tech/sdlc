import { t } from '../core/i18n.js';
import { findSecrets } from '../core/policy-secrets.js';
import { callServerTool, McpTimeout } from './client.js';
import { expandedSecrets } from './registry.js';
/**
 * `verify.mcp` (B12): `sdlc verify` calls each check's tool itself, with the SDK client, so the answer comes from
 * the server and not from the agent. `args` expand `${HEAD}` and `${CHANGE}`; the answer must contain `expect` (a
 * deep subset). A mismatch, a tool error, a timeout (60 s) or an unreachable server fails the check with a reason;
 * a failing required check fails the verification like a failing command. The commands, their order and the
 * fingerprint are untouched: the checks run after them and only add to the outcome.
 * What a server was given (its expanded `env`/`headers`) and anything that looks like a key or token is masked in
 * the answer and the reason before they reach the evidence, the JSON answer or the inbox.
 */
export const CHECK_TIMEOUT_MS = 60_000;
const MASK = '[redacted]';
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
async function callCheck(check, server, vars) {
    const args = expandArgs(check.args, vars);
    try {
        const answer = await callServerTool(server, check.tool, args, CHECK_TIMEOUT_MS);
        if (answer.isError) {
            return { ok: false, reason: t('verify.mcpToolError', { text: answer.text ?? '' }), result: answer.result };
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
/** One check, run and masked. */
async function runCheck(check, servers, vars) {
    const started = Date.now();
    const server = servers.find((item) => item.name === check.server);
    const verdict = server
        ? await callCheck(check, server, vars)
        : { ok: false, reason: t('verify.mcpUnknownServer', { server: check.server }), result: null };
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
    const passed = commandsOk && mcpOk;
    return { ...run, status: passed ? 'passed' : 'failed', mcp };
}
