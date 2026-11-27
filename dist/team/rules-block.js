import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { RULES_END, RULES_START } from './rules.js';
/**
 * The team rules block of AGENTS.md. sdlc owns only the text between `<!-- sdlc:rules:start -->` and
 * `<!-- sdlc:rules:end -->`; the person's text around it is never changed. Since 0.32.1 (B317) the block holds no
 * registry rule: SkillForge installs those (`skillforge sync --type rule`), so a 0.32.0 block that holds them is
 * emptied by `sdlc update`, and doctor names every rule still in it. A file without the markers is left alone.
 */
export function agentsGuidePath(config) {
    return config.layout?.['agents-guide'] ?? 'AGENTS.md';
}
export function renderRulesBlock() {
    return [
        RULES_START,
        '## Team rules',
        '',
        'Registry rules are installed by SkillForge (`skillforge sync --type rule --runtime <agent>`), not in this block.',
        '',
        RULES_END,
    ].join('\n');
}
/** Where `marker` stands alone on its line, from `from` on; -1 when it never does (review F2: prose may quote it). */
function markerLine(text, marker, from) {
    for (let at = text.indexOf(marker, from); at >= 0; at = text.indexOf(marker, at + 1)) {
        const after = text.slice(at + marker.length);
        const ownLine = (at === 0 || text[at - 1] === '\n') && /^(?:\r?\n|$)/.test(after);
        if (ownLine)
            return at;
    }
    return -1;
}
function locate(text) {
    const start = markerLine(text, RULES_START, 0);
    const endMarker = start < 0 ? -1 : markerLine(text, RULES_END, start + RULES_START.length);
    if (start < 0 || endMarker < 0)
        return undefined;
    return { start, end: endMarker + RULES_END.length };
}
/**
 * Empties the block; true when the file changed. Only the block is replaced, in the line endings it already had, so
 * the text around it stays byte for byte (review F3); a block that differs only in line endings is left alone.
 */
export function applyRulesBlock(root, config) {
    const file = path.join(root, agentsGuidePath(config));
    const raw = readText(file);
    const found = raw === undefined ? undefined : locate(raw);
    if (raw === undefined || !found)
        return false;
    const region = raw.slice(found.start, found.end);
    if (region.replace(/\r\n/g, '\n') === renderRulesBlock())
        return false;
    const block = region.includes('\r\n') ? renderRulesBlock().replace(/\n/g, '\r\n') : renderRulesBlock();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeTextAtomic(file, `${raw.slice(0, found.start)}${block}${raw.slice(found.end)}`);
    return true;
}
/** For doctor and update: the `###` headings inside the block, outside code fences (review F4). */
export function rulesInBlock(root, config) {
    const raw = readText(path.join(root, agentsGuidePath(config)));
    const found = raw === undefined ? undefined : locate(raw);
    if (raw === undefined || !found)
        return [];
    const names = [];
    let fenced = false;
    for (const line of raw.slice(found.start, found.end).split(/\r?\n/)) {
        if (/^\s*(?:```|~~~)/.test(line))
            fenced = !fenced;
        const heading = fenced ? null : /^###[ \t]+(.+)$/.exec(line);
        if (!heading)
            continue;
        const id = /\(([a-z0-9-]+)\)\s*$/.exec(heading[1]);
        names.push(id ? id[1] : heading[1].trim());
    }
    return names;
}
