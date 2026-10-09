import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { readText } from './fs-utils.js';
import { stripProvenance } from './license.js';
export const DEFAULT_SIDES = ['simplicity and speed', 'robustness and safety'];
const KEYS = ['debate', 'debate_sides'];
function invalid(key, where) {
    return new SdlcError('invalid_config', { key, params: { p1: where, where } });
}
function parseSides(value, where) {
    if (value === undefined || value === null)
        return [...DEFAULT_SIDES];
    const text = (side) => typeof side === 'string' && side.trim() !== '';
    const ok = Array.isArray(value) && value.length === 2 && value.every(text);
    if (!ok)
        throw invalid('error.debate_sides', where);
    return [String(value[0]).trim(), String(value[1]).trim()];
}
/** `design`: absent = undefined (the lens is off). */
export function parseDesignConfig(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw invalid('error.x_must_be_a_mapping', where('design'));
    const raw = value;
    const unknown = Object.keys(raw).find((key) => !KEYS.includes(key));
    if (unknown !== undefined)
        throw invalid('error.design_unknown_key', where(`design.${unknown}`));
    if (raw.debate !== undefined && typeof raw.debate !== 'boolean') {
        throw invalid('error.x_must_be_true_or_false', where('design.debate'));
    }
    return { debate: raw.debate === true, sides: parseSides(raw.debate_sides, where('design.debate_sides')) };
}
export function debateOn(config) {
    return config.design?.debate === true;
}
/** The lines outside fenced code blocks: a `# comment` in a code sample is not a heading. */
function proseLines(text) {
    let fence = false;
    return text.split(/\r?\n/).filter((line) => {
        if (/^\s*(?:```|~~~)/.test(line)) {
            fence = !fence;
            return false;
        }
        return !fence;
    });
}
/** The lines of `## Debate` up to the next `## ` heading; undefined without it. */
function debateSection(text) {
    const lines = proseLines(text);
    const start = lines.findIndex((line) => /^##\s+debate\s*$/i.test(line.trim()));
    if (start < 0)
        return undefined;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
    return end < 0 ? rest : rest.slice(0, end);
}
/** Text under the `### Decision` heading of the section, trimmed. */
function decisionText(section) {
    const start = section.findIndex((line) => /^###\s+decision\s*:?\s*$/i.test(line.trim()));
    if (start < 0)
        return '';
    const rest = section.slice(start + 1);
    const end = rest.findIndex((line) => /^###\s/.test(line));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
}
/** True when design.md records both positions and the decision. */
export function debateRecorded(changeDir) {
    const text = stripProvenance(readText(path.join(changeDir, 'design.md')) ?? '');
    const section = debateSection(text);
    if (!section)
        return false;
    const positions = section.filter((line) => /^###\s+position\b/i.test(line.trim())).length;
    return positions >= 2 && decisionText(section) !== '';
}
/** Refuses the spec approval while the lens is on and design.md has no complete debate (`debate_required`). */
export function assertDebateRecorded(config, changeDir, gate) {
    if (gate !== 'spec' || !debateOn(config) || debateRecorded(changeDir))
        return;
    throw new SdlcError('debate_required', { key: 'error.debate_required' }, { key: 'fix.debate_required', params: { sides: (config.design?.sides ?? DEFAULT_SIDES).join(' / ') } });
}
