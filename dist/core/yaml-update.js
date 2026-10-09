import { isDeepStrictEqual } from 'node:util';
import { isMap, isNode, parseDocument } from 'yaml';
import { readText, writeTextAtomic } from './fs-utils.js';
import { writeYaml } from './yaml-io.js';
function isPlain(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function currentValue(doc, path) {
    const value = doc.getIn(path, true);
    return isNode(value) ? value.toJS(doc) : value;
}
function applyKey(doc, path, previous, next) {
    if (isPlain(next) && isMap(doc.getIn(path, true))) {
        return applyMap(doc, path, isPlain(previous) ? previous : {}, next);
    }
    if (isDeepStrictEqual(currentValue(doc, path), next)) {
        return false;
    }
    doc.setIn(path, next);
    return true;
}
function applyMap(doc, path, previous, next) {
    let changed = false;
    for (const [key, value] of Object.entries(next)) {
        changed = applyKey(doc, [...path, key], previous[key], value) || changed;
    }
    for (const key of Object.keys(previous)) {
        if (!(key in next) && doc.hasIn([...path, key])) {
            doc.deleteIn([...path, key]);
            changed = true;
        }
    }
    return changed;
}
/**
 * `previous` is what the program knew of the file before the change (it decides which absent keys to remove);
 * `next` is what it wants now. A missing or unreadable file is written whole, with the header.
 */
export function updateYamlFile(file, previous, next, header) {
    const text = readText(file);
    if (text === undefined) {
        writeYaml(file, next, header);
        return;
    }
    const doc = parseDocument(text);
    if (doc.errors.length > 0 || !isMap(doc.contents)) {
        writeYaml(file, next, header);
        return;
    }
    if (applyMap(doc, [], previous, next)) {
        writeTextAtomic(file, doc.toString({ lineWidth: 0 }));
    }
}
