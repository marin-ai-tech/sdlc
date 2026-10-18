import { isMap, isNode, parseDocument, stringify, type YAMLMap } from 'yaml';
import { SdlcError } from './errors.js';

function invalid(setting: string): never {
  throw new SdlcError('invalid_config', { key: 'config.error.invalidSet', params: { setting } });
}

function encoded(value: unknown, setting: string): string {
  const raw = setting.slice(setting.indexOf('=') + 1).trim();
  if (typeof value === 'string' && /[\r\n]/.test(value)) invalid(setting);
  if (raw.includes('\n') || raw.includes('\r')) invalid(setting);
  if (/^[>|]/.test(raw)) invalid(setting);
  return raw || stringify(value, { lineWidth: 0 }).trimEnd();
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

function appendToMap(text: string, map: YAMLMap, depth: number, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (map.flow) {
    const closing = map.range![1] - 1;
    let insertAt = closing;
    while (insertAt > 0 && /[ \t]/.test(text[insertAt - 1])) insertAt--;
    const spacer = map.items.length ? ', ' : '';
    return `${text.slice(0, insertAt)}${spacer}${key}: ${value}${text.slice(insertAt)}`;
  }
  const indent = '  '.repeat(depth);
  const firstKey = map.items[0]?.key;
  const first = isNode(firstKey) && firstKey.range ? lineStart(text, firstKey.range[0]) : text.length;
  let start = text.length;
  let position = first;
  for (const [index, line] of text.slice(first).split('\n').entries()) {
    if (index > 0 && line.trim() && line.match(/^\s*/)?.[0].length! < indent.length) {
      start = position;
      break;
    }
    position += line.length + 1;
  }
  const separator = start === text.length && text.length && !text.endsWith('\n') ? eol : '';
  return `${text.slice(0, start)}${separator}${indent}${key}: ${value}${eol}${text.slice(start)}`;
}

function editOne(text: string, setting: string): string {
  const separator = setting.indexOf('=');
  const path = setting.slice(0, separator).split('.');
  if (separator < 1 || !path.every((part) => /^[\w-]+$/.test(part))) invalid(setting);
  const parsed = parseDocument(setting.slice(separator + 1), { uniqueKeys: true });
  if (parsed.errors.length) invalid(setting);
  let value = encoded(parsed.toJS(), setting);
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) invalid(setting);
  let map: YAMLMap = doc.contents;
  let key = path.at(-1)!;
  let depth = 0;
  for (const [index, part] of path.slice(0, -1).entries()) {
    const child = map.items.find((item) => item.key?.toString() === part)?.value;
    if (child === undefined) {
      key = part;
      for (const nested of path.slice(index + 1).reverse()) value = `{ ${nested}: ${value} }`;
      break;
    }
    if (!isMap(child)) invalid(setting);
    map = child;
    depth++;
  }
  const existing = map.items.find((item) => item.key?.toString() === key);
  if (isNode(existing?.value) && existing.value.range) {
    const [start, end] = existing.value.range;
    return `${text.slice(0, start)}${value}${text.slice(end)}`;
  }
  return appendToMap(text, map, depth, key, value);
}

/** Edit only the lines named by --set, retaining the original line endings and untouched text. */
export function editYamlText(text: string, settings: string[]): string {
  return settings.reduce(editOne, text);
}
