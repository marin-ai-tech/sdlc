/**
 * The judge gate (B19): before a person approves a planning gate, an independent model checks the artifacts by a
 * rubric. `sdlc judge` runs the configured command or MCP tool, records the verdict bound to the artifact digest, and
 * blocks approval until a passing verdict for the current digest — or until `max_loops` failing verdicts (across
 * versions) hand the decision to a person. The judge never approves.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isFile, isWithin, readText } from './fs-utils.js';
import { t } from './i18n.js';
import { lr } from './approval-gate.js';
import { callServerTool } from '../mcp/client.js';
export const JUDGE_TIMEOUT_MS = 60_000;
function gateJudge(config, gate) {
    return config.gates[gate]?.judge;
}
/** Verdicts recorded for the gate (oldest first); empty when none. */
export function judgeVerdicts(state, gate) {
    const raw = state.gates[gate]?.judge;
    if (!Array.isArray(raw))
        return [];
    return raw.filter(isVerdictRecord);
}
function isVerdictRecord(value) {
    if (!value || typeof value !== 'object')
        return false;
    const row = value;
    return typeof row.pass === 'boolean'
        && typeof row.route === 'string'
        && typeof row.rework === 'string'
        && typeof row.digest === 'string'
        && typeof row.at === 'string';
}
/** Failing verdicts for the gate across every artifact version. */
export function failingJudgeCount(state, gate) {
    return judgeVerdicts(state, gate).filter((row) => row.pass === false).length;
}
/**
 * The judge's rework text as part of a sentence: trimmed, without its own end punctuation, which the message
 * templates add ("…the proposal.. Revise" was a defect).
 */
export function reworkText(rework) {
    return rework.trim().replace(/[.!?。]+$/u, '');
}
/** The latest verdict whose digest matches the current artifacts; undefined when none. */
export function currentJudgeVerdict(state, gate, digest) {
    if (!digest)
        return undefined;
    const matches = judgeVerdicts(state, gate).filter((row) => row.digest === digest);
    return matches.length > 0 ? matches[matches.length - 1] : undefined;
}
/** True when the author-critic loop has used every allowed failing verdict. */
export function judgeExhausted(config, state, gate) {
    const judge = gateJudge(config, gate);
    if (!judge)
        return false;
    return failingJudgeCount(state, gate) >= judge.maxLoops;
}
/** True when a passing verdict covers the current digest, or the loop is exhausted. */
export function judgeCleared(config, state, gate, digest) {
    const judge = gateJudge(config, gate);
    if (!judge)
        return true;
    if (judgeExhausted(config, state, gate))
        return true;
    return currentJudgeVerdict(state, gate, digest)?.pass === true;
}
/**
 * Why the gate cannot be approved while the judge still holds it; undefined when no judge or the judge is cleared.
 */
export function judgeBlockReason(config, state, gate, digest) {
    if (!gateJudge(config, gate) || !digest)
        return undefined;
    if (judgeCleared(config, state, gate, digest))
        return undefined;
    const current = currentJudgeVerdict(state, gate, digest);
    if (current && current.pass === false) {
        return lr('gate.judgeRework', { gate, rework: reworkText(current.rework) });
    }
    return lr('gate.judgeRequired', { gate });
}
/** Refuses approval while a configured judge has not cleared the current artifacts. */
export function assertJudgeCleared(config, state, gate, digest) {
    if (!(gate in config.gates))
        return;
    const id = gate;
    if (!gateJudge(config, id))
        return;
    if (judgeCleared(config, state, id, digest))
        return;
    throw new SdlcError('judge_required', { key: 'error.judge_required', params: { gate } }, { key: 'fix.judge_required', params: { gate } });
}
function withKey(action, key, params = {}) {
    return { ...action, key, params, message: t(key, params, 'en') };
}
/**
 * While a judge holds the gate, `next` asks the agent to run it or rework; after max_loops or a pass, the person.
 */
export function judgeNext(view, config, state, next) {
    if (next.action !== 'approve-gate' || !next.gate)
        return next;
    const gate = next.gate;
    if (!gateJudge(config, gate))
        return next;
    const evaluation = view.gates.find((item) => item.id === gate);
    const digest = evaluation?.digest;
    if (judgeCleared(config, state, gate, digest)) {
        if (!judgeExhausted(config, state, gate))
            return next;
        const last = judgeVerdicts(state, gate).filter((row) => !row.pass).at(-1);
        if (!last)
            return next;
        return withKey({ actor: 'human', action: 'approve-gate', gate, workflow: next.workflow, cli: next.cli }, 'next.judgeEscalated', { gate, rework: reworkText(last.rework), change: view.change });
    }
    const current = currentJudgeVerdict(state, gate, digest);
    if (current && current.pass === false) {
        return withKey({
            actor: 'agent',
            action: 'revise-artifact',
            gate,
            workflow: next.workflow,
            cli: `sdlc judge --gate ${gate} --change ${view.change}`,
        }, 'next.judgeRework', { gate, rework: reworkText(current.rework), change: view.change });
    }
    return withKey({
        actor: 'agent',
        action: 'validate',
        gate,
        workflow: next.workflow,
        cli: `sdlc judge --gate ${gate} --change ${view.change}`,
    }, 'next.judgeRun', { gate, change: view.change });
}
/** Append a verdict on the gate; creates the gate record when needed. */
export function recordJudgeVerdict(state, gate, verdict, digest) {
    const row = {
        pass: verdict.pass,
        route: verdict.route,
        rework: verdict.rework,
        digest,
        at: new Date().toISOString(),
    };
    const current = state.gates[gate] ?? {};
    const judge = [...judgeVerdicts(state, gate), row];
    state.gates[gate] = { ...current, judge };
    return row;
}
/** Parse a judge answer into a verdict; throws `judge_invalid_answer` otherwise. */
export function parseJudgeVerdict(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalidAnswer();
    }
    const raw = value;
    if (typeof raw.pass !== 'boolean')
        throw invalidAnswer();
    if (typeof raw.route !== 'string')
        throw invalidAnswer();
    if (typeof raw.rework !== 'string')
        throw invalidAnswer();
    return { pass: raw.pass, route: raw.route, rework: raw.rework };
}
function invalidAnswer() {
    return new SdlcError('judge_invalid_answer', { key: 'error.judge_invalid_answer' }, { key: 'fix.judge_invalid_answer' });
}
/** Rubric file text; the path must stay inside the project root. */
export function readJudgeRubric(root, rubric) {
    const resolved = path.resolve(root, rubric);
    if (!isWithin(root, resolved)) {
        throw new SdlcError('judge_rubric_outside', { key: 'error.judge_rubric_outside', params: { rubric } });
    }
    const text = readText(resolved);
    if (text === undefined || !isFile(resolved)) {
        throw new SdlcError('judge_rubric_missing', { key: 'error.judge_rubric_missing', params: { rubric } });
    }
    return text;
}
/** Artifact payloads for the judge request (paths relative to the change folder). */
export function judgeArtifacts(changeDir, files) {
    return files.map((rel) => {
        const normalized = rel.replace(/\\/g, '/');
        return { path: normalized, content: readText(path.join(changeDir, rel)) ?? '' };
    });
}
/** Run the configured command judge: `run` on stdin JSON, stdout JSON (like verify: a shell string), as an agent. */
export function runJudgeCommand(root, run, request, timeoutMs = JUDGE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const errChunks = [];
        const child = spawn(run, {
            cwd: root,
            shell: true,
            // The judge runs as an agent: a judge command can never approve or unlock in the name of who ran it.
            env: { ...process.env, SDLC_AGENT: 'judge' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        }, timeoutMs);
        child.stdout?.on('data', (buf) => chunks.push(buf));
        child.stderr?.on('data', (buf) => errChunks.push(buf));
        child.stdin?.write(JSON.stringify(request));
        child.stdin?.end();
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(new SdlcError('judge_failed', { key: 'error.judge_failed', params: { detail: error.message } }));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new SdlcError('judge_timeout', { key: 'error.judge_timeout', params: { seconds: timeoutMs / 1000 } }));
                return;
            }
            if (code !== 0) {
                const err = Buffer.concat(errChunks).toString('utf-8').trim().slice(0, 200);
                reject(new SdlcError('judge_failed', { key: 'error.judge_failed', params: { detail: err || `exit ${code ?? '?'}` } }));
                return;
            }
            try {
                resolve(parseJudgeVerdict(JSON.parse(Buffer.concat(chunks).toString('utf-8'))));
            }
            catch (error) {
                if (error instanceof SdlcError)
                    reject(error);
                else
                    reject(invalidAnswer());
            }
        });
    });
}
/** Run the configured MCP tool judge; arguments are the request object. */
export async function runJudgeMcp(config, judge, request, timeoutMs = JUDGE_TIMEOUT_MS) {
    const server = (config.mcp?.servers ?? []).find((item) => item.name === judge.server);
    if (!server) {
        throw new SdlcError('judge_server_missing', { key: 'error.judge_server_missing', params: { server: judge.server } });
    }
    try {
        const answer = await callServerTool(server, judge.tool, request, timeoutMs);
        if (answer.isError) {
            throw new SdlcError('judge_failed', { key: 'error.judge_failed', params: { detail: String(answer.result ?? 'tool error') } });
        }
        return parseJudgeVerdict(answer.result);
    }
    catch (error) {
        if (error instanceof SdlcError)
            throw error;
        throw new SdlcError('judge_failed', { key: 'error.judge_failed', params: { detail: error instanceof Error ? error.message : String(error) } });
    }
}
/** Dispatch to the command or MCP runner for the gate's judge. */
export async function runConfiguredJudge(root, config, judge, request) {
    if (judge.kind === 'command')
        return runJudgeCommand(root, judge.run, request);
    return runJudgeMcp(config, judge, request);
}
