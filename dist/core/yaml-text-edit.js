import { isMap, isNode, parseDocument, stringify } from 'yaml';
import { SdlcError } from './errors.js';
function invalid(setting) {
    throw new SdlcError('invalid_config', { key: 'config.error.invalidSet', params: { setting } });
}
function encoded(value, setting) {
    const raw = setting.slice(setting.indexOf('=') + 1).trim();
    if (typeof value === 'string' && /[\r\n]/.test(value))
        invalid(setting);
    if (raw.includes('\n') || raw.includes('\r'))
        invalid(setting);
    if (/^[>|]/.test(raw))
        invalid(setting);
    return raw || stringify(value, { lineWidth: 0 }).trimEnd();
}
function lineStart(text, offset) {
    return text.lastIndexOf('\n', offset - 1) + 1;
}
function appendToMap(text, map, depth, key, value) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (map.flow) {
        const closing = map.range[1] - 1;
        let insertAt = closing;
        while (insertAt > 0 && /[ \t]/.test(text[insertAt - 1]))
            insertAt--;
        const spacer = map.items.length ? ', ' : '';
        return `${text.slice(0, insertAt)}${spacer}${key}: ${value}${text.slice(insertAt)}`;
    }
    const indent = '  '.repeat(depth);
    const firstKey = map.items[0]?.key;
    const first = isNode(firstKey) && firstKey.range ? lineStart(text, firstKey.range[0]) : text.length;
    let start = text.length;
    let position = first;
    for (const [index, line] of text.slice(first).split('\n').entries()) {
        if (index > 0 && line.trim() && line.match(/^\s*/)?.[0].length < indent.length) {
            start = position;
            break;
        }
        position += line.length + 1;
    }
    const separator = start === text.length && text.length && !text.endsWith('\n') ? eol : '';
    return `${text.slice(0, start)}${separator}${indent}${key}: ${value}${eol}${text.slice(start)}`;
}
function editOne(text, setting) {
    const separator = setting.indexOf('=');
    const path = setting.slice(0, separator).split('.');
    if (separator < 1 || !path.every((part) => /^[\w-]+$/.test(part)))
        invalid(setting);
    const parsed = parseDocument(setting.slice(separator + 1), { uniqueKeys: true });
    if (parsed.errors.length)
        invalid(setting);
    let value = encoded(parsed.toJS(), setting);
    const doc = parseDocument(text, { uniqueKeys: true });
    if (doc.errors.length || !isMap(doc.contents))
        invalid(setting);
    let map = doc.contents;
    let key = path.at(-1);
    let depth = 0;
    for (const [index, part] of path.slice(0, -1).entries()) {
        const child = map.items.find((item) => item.key?.toString() === part)?.value;
        if (child === undefined) {
            key = part;
            for (const nested of path.slice(index + 1).reverse())
                value = `{ ${nested}: ${value} }`;
            break;
        }
        if (!isMap(child))
            invalid(setting);
        map = child;
        depth++;
    }
    const existing = map.items.find((item) => item.key?.toString() === key);
    if (isNode(existing?.value) && existing.value.range) {
        const [start, end] = existing.value.range;
        const old = text.slice(start, end);
        const eol = old.endsWith('\r\n') ? '\r\n' : old.endsWith('\n') ? '\n' : '';
        return `${text.slice(0, start)}${value}${eol}${text.slice(end)}`;
    }
    return appendToMap(text, map, depth, key, value);
}
/** Edit only the lines named by --set, retaining the original line endings and untouched text. */
export function editYamlText(text, settings) {
    return settings.reduce(editOne, text);
}
/** Remove one map entry without serializing its neighbors. */
export function removeYamlKey(text, path) {
    const doc = parseDocument(text, { uniqueKeys: true });
    const parent = doc.getIn(path.slice(0, -1), true);
    if (!isMap(parent))
        return text;
    const index = parent.items.findIndex((item) => item.key?.toString() === path.at(-1));
    if (index < 0)
        return text;
    const pair = parent.items[index];
    if (!isNode(pair?.key) || !pair.key.range)
        return text;
    if (parent.flow) {
        if (!parent.range)
            return text;
        if (parent.items.length === 1) {
            return text.slice(0, parent.range[0] + 1) + text.slice(parent.range[1] - 1);
        }
        const nextKey = parent.items[index + 1]?.key;
        if (isNode(nextKey) && nextKey.range) {
            return text.slice(0, pair.key.range[0]) + text.slice(nextKey.range[0]);
        }
        const previousValue = parent.items[index - 1]?.value;
        if (!isNode(previousValue) || !previousValue.range || !isNode(pair.value) || !pair.value.range) {
            return text;
        }
        return text.slice(0, previousValue.range[1]) + text.slice(pair.value.range[1]);
    }
    const start = lineStart(text, pair.key.range[0]);
    const valueEnd = isNode(pair.value) && pair.value.range ? pair.value.range[1] : pair.key.range[1];
    const next = text.indexOf('\n', valueEnd);
    const end = next < 0 ? text.length : next + 1;
    return text.slice(0, start) + text.slice(end);
}
