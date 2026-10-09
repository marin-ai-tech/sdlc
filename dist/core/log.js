import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir, isFile, readText } from './fs-utils.js';
import { harnessStamp } from './license.js';
import { queueEvent } from '../mcp/outbox.js';
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
const GITATTRIBUTES = 'log.jsonl merge=union\n';
export function appendLog(root, config, input, stamp = harnessStamp(config)) {
    if (!config.log.enabled)
        return;
    const file = path.join(root, LOG_PATH);
    try {
        ensureDir(path.dirname(file));
        const attributes = path.join(path.dirname(file), '.gitattributes');
        if (!isFile(attributes))
            fs.writeFileSync(attributes, GITATTRIBUTES, 'utf-8');
        const entry = {
            ts: new Date().toISOString(),
            event: input.event,
            ...(input.change ? { change: input.change } : {}),
            ...(input.by ? { by: input.by } : {}),
            ...(input.detail ? { detail: input.detail } : {}),
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.waitingFor ? { waitingFor: input.waitingFor } : {}),
            sdlc: stamp.version,
            license: stamp.license,
        };
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
        queueEvent(root, config, entry);
    }
    catch {
        // The log is a record, not a gate: failing to write it never fails a command or a hook.
    }
}
/** Entries in file order; malformed lines (for example a bad merge) are skipped. */
export function readLog(root) {
    const text = readText(path.join(root, LOG_PATH));
    if (!text)
        return [];
    const entries = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        try {
            const parsed = JSON.parse(line);
            if (!parsed || typeof parsed.event !== 'string')
                continue;
            // Entries written before the rename from scdl carry the version under `scdl`.
            if (parsed.sdlc === undefined && typeof parsed.scdl === 'string')
                parsed.sdlc = parsed.scdl;
            delete parsed.scdl;
            entries.push(parsed);
        }
        catch {
            // skip
        }
    }
    return entries;
}
