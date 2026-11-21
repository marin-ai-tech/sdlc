import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir, isFile, readText } from './fs-utils.js';
import { harnessStamp } from './license.js';
import { queueEvent } from '../mcp/outbox.js';
import { agentEnvironment } from './agent-env.js';
import { ensureLocalIgnore } from './local-ignore.js';
import { parseLogEntry } from './log-record.js';
import { appendLogRecords, logFile, withLogWriter } from './log-write.js';
import { SdlcError } from './errors.js';
import { drainLogSpool, spoolLogRecord, spooledRecords } from './log-spool.js';
import { deferObservation, isPreparation } from '../plugins/evaluation.js';
import { drainLocalLog } from './log-recovery.js';
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
        ...(input.run ? { run: input.run } : {}),
        ...(input.round ? { round: input.round } : {}),
        ...(input.digest ? { digest: input.digest } : {}),
        ...(agent ? { agent } : {}),
        ...(input.waitingFor ? { waitingFor: input.waitingFor } : {}),
        ...(input.approvals !== undefined ? { approvals: input.approvals } : {}),
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
    let entry;
    let wrote = false;
    try {
        entry = logEntry(config, input, stamp);
        withLogWriter(root, () => {
            const file = logFile(root, 'hook-log.jsonl');
            ensureLocalIgnore(root, ['hook-log.jsonl']);
            appendLogRecords(file, [entry]);
            wrote = true;
        });
        queueEvent(root, config, entry);
    }
    catch (error) {
        if (!wrote && entry && writerUnavailable(error, root)) {
            try {
                spoolLogRecord(root, entry);
                queueEvent(root, config, entry);
                return;
            }
            catch (spoolError) {
                logDiagnostic(spoolError);
                return;
            }
        }
        logDiagnostic(error);
    }
}
function drainHookLog(root, file) {
    drainLocalLog(root, file);
}
function logDiagnostic(error) {
    const detail = error instanceof Error ? error.message : String(error);
    try {
        process.stderr.write(`sdlc: project log pending: ${detail.slice(0, 500)}; run sdlc doctor\n`);
    }
    catch { /* Observation failures never alter a command or hook decision. */ }
}
function writerUnavailable(error, root) {
    if (error instanceof SdlcError && error.code === 'writer_locked')
        return true;
    const failure = error;
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(failure?.code ?? ''))
        return false;
    if (typeof failure.path !== 'string')
        return false;
    // The writer lock lives under the real path of the root (logDirectory), not under a short or linked spelling.
    let real;
    try {
        real = fs.realpathSync(root);
    }
    catch {
        return false;
    }
    const lock = path.join(real, 'openspec', '.sdlc', 'log.lock');
    return failure.path.startsWith(`${lock}.writers${path.sep}`);
}
export function appendLog(root, config, input, stamp = harnessStamp(config), options = {}) {
    if (isPreparation(root) || !config.log.enabled)
        return;
    if (deferObservation(root, () => appendLog(root, config, structuredClone(input), stamp, options)))
        return;
    const file = path.join(root, LOG_PATH);
    let entry;
    let wrote = false;
    try {
        entry = logEntry(config, input, stamp);
        withLogWriter(root, () => {
            logFile(root, 'log.jsonl');
            ensureHookIgnore(root);
            const attributes = path.join(path.dirname(file), '.gitattributes');
            if (!isFile(attributes))
                fs.writeFileSync(attributes, GITATTRIBUTES, 'utf-8');
            try {
                drainHookLog(root, file);
            }
            catch (error) {
                if (options.strict)
                    throw error;
                logDiagnostic(error);
            }
            try {
                drainLogSpool(root, file);
            }
            catch (error) {
                if (options.strict)
                    throw error;
                logDiagnostic(error);
            }
            appendLogRecords(file, [entry]);
            wrote = true;
        });
        if (options.outbox !== false)
            queueEvent(root, config, entry);
    }
    catch (error) {
        if (options.strict)
            throw error;
        if (!wrote && entry && writerUnavailable(error, root)) {
            try {
                spoolLogRecord(root, entry);
                if (options.outbox !== false)
                    queueEvent(root, config, entry);
                return;
            }
            catch (spoolError) {
                logDiagnostic(spoolError);
                return;
            }
        }
        logDiagnostic(error);
    }
}
/** Shared entries in file order, followed by local queue entries in file order; malformed lines are skipped. */
export function readLog(root) {
    const text = [readText(path.join(root, LOG_PATH)), readText(path.join(root, HOOK_LOG_PATH))]
        .filter((part) => part !== undefined).join('\n');
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
    let pending = [];
    try {
        pending = spooledRecords(root);
    }
    catch { /* Doctor reports unsafe spool storage; ordinary log reads remain available. */ }
    for (const entry of pending) {
        if (entry.plugin && pluginIds.has(entry.plugin.eventId))
            continue;
        if (entry.plugin)
            pluginIds.add(entry.plugin.eventId);
        entries.push(entry);
    }
    return entries;
}
