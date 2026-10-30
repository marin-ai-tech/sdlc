import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir, isFile, readText } from './fs-utils.js';
import { harnessStamp } from './license.js';
import { queueEvent } from '../mcp/outbox.js';
import { agentEnvironment } from './agent-env.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { parseLogEntry } from './log-record.js';
import { appendLogRecords, logFile, withLogWriter } from './log-write.js';
import { deferObservation, isPreparation } from '../plugins/evaluation.js';
/**
 * Append-only project log: one JSON object per line in
 * `openspec/.sdlc/log.jsonl`. It records what the harness did and decided
 * across all changes (setup, gate decisions, verification runs, archives,
 * hook denials), and every entry carries the sdlc version and the license
 * the project uses sdlc under. The log is committed with the project; the
 * `merge=union` attribute written next to it lets branches append
 * concurrently without merge conflicts.
 */
export const LOG_PATH = 'openspec/.sdlc/log.jsonl';
export const HOOK_LOG_PATH = 'openspec/.sdlc/hook-log.jsonl';
const GITATTRIBUTES = 'log.jsonl merge=union\n';
export function ensureHookIgnore(root) {
    const file = path.join(root, 'openspec/.sdlc/.gitignore');
    ensureDir(path.dirname(file));
    const text = readText(file) ?? '';
    if (text.split(/\r?\n/).includes('hook-log.jsonl'))
        return;
    const separator = text && !text.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${text}${separator}hook-log.jsonl\n`, 'utf-8');
}
function logEntry(config, input, stamp) {
    const agent = input.agent ?? agentEnvironment();
    return {
        ts: new Date().toISOString(), event: input.event,
        ...(input.change ? { change: input.change } : {}),
        ...(input.by ? { by: input.by } : {}),
        ...(input.detail ? { detail: input.detail } : {}),
        ...(input.digest ? { digest: input.digest } : {}),
        ...(agent ? { agent } : {}),
        ...(input.waitingFor ? { waitingFor: input.waitingFor } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.task ? { task: input.task } : {}),
        ...(input.executor ? { executor: input.executor } : {}),
        ...(input.plugin ? { plugin: input.plugin } : {}),
        sdlc: stamp.version, license: stamp.license,
    };
}
/** Hook processes only append; the next ordinary log write drains the local queue. */
export function appendHookLog(root, config, input) {
    if (!config.log.enabled || !config.log.hookDecisions)
        return;
    appendLocalLog(root, config, input);
}
/** Reading commands queue observations without changing the tracked project log. */
export function appendLocalLog(root, config, input, stamp = harnessStamp(config)) {
    if (isPreparation(root) || !config.log.enabled)
        return;
    if (deferObservation(root, () => appendLocalLog(root, config, structuredClone(input), stamp)))
        return;
    try {
        const entry = logEntry(config, input, stamp);
        withLogWriter(root, () => {
            const file = logFile(root, 'hook-log.jsonl');
            ensureLocalIgnore(root, ['hook-log.jsonl']);
            appendLogRecords(file, [entry]);
        });
        queueEvent(root, config, entry);
    }
    catch {
        // Logging cannot prevent a hook decision.
    }
}
function drainHookLog(root, file) {
    const queue = path.join(root, HOOK_LOG_PATH);
    const drained = `${queue}.${process.pid}.${Date.now()}.drain`;
    try {
        fs.renameSync(queue, drained);
    }
    catch {
        return;
    }
    try {
        const records = fs.readFileSync(drained, 'utf8').split('\n').filter((line) => line.trim())
            .flatMap((line) => { try {
            const parsed = parseLogEntry(JSON.parse(line));
            return parsed ? [parsed] : [];
        }
        catch {
            return [];
        } });
        appendLogRecords(file, records);
        fs.rmSync(drained);
    }
    catch {
        try {
            fs.renameSync(drained, queue);
        }
        catch { /* keep the drain for recovery */ }
    }
}
export function appendLog(root, config, input, stamp = harnessStamp(config)) {
    if (isPreparation(root) || !config.log.enabled)
        return;
    if (deferObservation(root, () => appendLog(root, config, structuredClone(input), stamp)))
        return;
    const file = path.join(root, LOG_PATH);
    try {
        const entry = logEntry(config, input, stamp);
        withLogWriter(root, () => {
            logFile(root, 'log.jsonl');
            ensureHookIgnore(root);
            const attributes = path.join(path.dirname(file), '.gitattributes');
            if (!isFile(attributes))
                fs.writeFileSync(attributes, GITATTRIBUTES, 'utf-8');
            drainHookLog(root, file);
            appendLogRecords(file, [entry]);
        });
        queueEvent(root, config, entry);
    }
    catch {
        // The log is a record, not a gate: failing to write it never fails a command or a hook.
    }
}
/** Shared entries in file order, followed by local queue entries in file order; malformed lines are skipped. */
export function readLog(root) {
    const text = [readText(path.join(root, LOG_PATH)), readText(path.join(root, HOOK_LOG_PATH))]
        .filter((part) => part !== undefined).join('\n');
    if (!text)
        return [];
    const entries = [];
    const pluginIds = new Set();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        try {
            const parsed = parseLogEntry(JSON.parse(line));
            if (!parsed)
                continue;
            if (parsed.plugin) {
                if (pluginIds.has(parsed.plugin.eventId))
                    continue;
                pluginIds.add(parsed.plugin.eventId);
            }
            entries.push(parsed);
        }
        catch {
            // skip
        }
    }
    return entries;
}
