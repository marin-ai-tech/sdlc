import { isAlias, isMap, parseDocument, stringify, visit } from 'yaml';
import { SdlcError } from './errors.js';
import { readText, writeTextAtomic } from './fs-utils.js';
import { recordObject } from './record-values.js';
const retained = new WeakMap();
export function malformedGateShape(value) {
    const gate = recordObject(value);
    if (!gate)
        return 'gate';
    if (Object.hasOwn(gate, 'approvals') && !Array.isArray(gate.approvals))
        return 'approvals';
    return undefined;
}
/** Raw gate pairs are write-only: they never enter the typed authority view. */
export function retainOpaqueDecisions(state, file, gates) {
    const source = readText(file);
    if (!source)
        return;
    const document = parseDocument(source);
    const map = document.get('gates', true);
    if (!isMap(map))
        return;
    const raw = recordObject(gates) ?? {};
    const opaque = [];
    let indent = 2;
    for (const pair of map.items) {
        const gate = String(pair.key);
        const shape = malformedGateShape(raw[gate]);
        if (!shape || !pair.key || !pair.value)
            continue;
        const key = pair.key;
        const value = pair.value;
        if (!key.range || !value.range)
            continue;
        const start = source.lastIndexOf('\n', key.range[0] - 1) + 1;
        const prefix = source.slice(start, key.range[0]);
        const block = /^ +$/.test(prefix);
        if (block)
            indent = prefix.length;
        const beginning = block ? withLeadingTrivia(source, start) : key.range[0];
        const text = source.slice(beginning, value.range[2] ?? value.range[1]);
        opaque.push({ gate, shape, text: block ? text : `${' '.repeat(indent)}${text}\n` });
    }
    if (opaque.length)
        retained.set(state, { gates: opaque, anchored: hasAnchors(document), indent });
}
function hasAnchors(document) {
    let found = false;
    visit(document, (_key, node) => {
        if (isAlias(node) || (node && typeof node === 'object' && 'anchor' in node && node.anchor))
            found = true;
    });
    return found;
}
function withLeadingTrivia(source, from) {
    let start = from;
    while (start > 0) {
        const previous = source.lastIndexOf('\n', start - 2) + 1;
        const line = source.slice(previous, start).trim();
        if (line && !line.startsWith('#'))
            break;
        start = previous;
    }
    return start;
}
export function copyOpaqueDecisions(from, to) {
    const opaque = retained.get(from);
    if (opaque)
        retained.set(to, opaque);
}
export function assertGateWritable(state, change, gate, cli = 'sdlc') {
    if (!retained.get(state)?.gates.some((entry) => entry.gate === gate))
        return;
    throw new SdlcError('malformed_gate', { key: 'error.malformed_gate', params: { change, gate } }, { key: 'fix.malformed_gate', params: { change, gate, cli } });
}
/** Replace generated placeholders with exact source slices before the single atomic write. */
export function writeOpaqueDecisions(file, value, state, header) {
    const opaque = retained.get(state);
    if (!opaque) {
        writeTextAtomic(file, `${header}\n${stringify(value, { lineWidth: 0 })}`);
        return;
    }
    if (opaque.anchored) {
        throw unsafeOpaque();
    }
    const gates = Object.assign(Object.create(null), recordObject(value.gates));
    for (const entry of opaque.gates)
        gates[entry.gate] = '__sdlc_opaque__';
    let text = stringify({ ...value, gates }, { lineWidth: 0, indent: opaque.indent });
    const document = parseDocument(text);
    const map = document.get('gates', true);
    if (!isMap(map))
        throw unsafeOpaque();
    const patches = map.items.flatMap((pair) => opaquePatch(text, pair, opaque.gates));
    for (const patch of patches.sort((a, b) => b.start - a.start)) {
        text = text.slice(0, patch.start) + patch.text + text.slice(patch.end);
    }
    if (parseDocument(text).errors.length)
        throw unsafeOpaque();
    writeTextAtomic(file, `${header}\n${text}`);
}
function unsafeOpaque() {
    return new SdlcError('unsafe_opaque_yaml', { key: 'error.unsafe_opaque_yaml' }, { key: 'fix.unsafe_opaque_yaml' });
}
function opaquePatch(text, pair, gates) {
    const entry = gates.find((gate) => gate.gate === String(pair.key));
    if (!entry)
        return [];
    const key = pair.key;
    const value = pair.value;
    const start = text.lastIndexOf('\n', key.range[0] - 1) + 1;
    return [{ start, end: value.range[2] ?? value.range[1], text: entry.text }];
}
