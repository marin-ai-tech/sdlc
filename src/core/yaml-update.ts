import { isDeepStrictEqual } from 'node:util';
import { isMap, isNode, parseDocument, type Document } from 'yaml';
import { readText, writeTextAtomic } from './fs-utils.js';
import { writeYaml } from './yaml-io.js';

/**
 * Writes settings into a YAML file that people also edit by hand. Only the keys whose value changed are written;
 * a key the previous settings had and the new ones lack is removed. Comments, unknown keys and the order of the
 * rest stay as they are, and a file with nothing to change is not rewritten.
 */

type Plain = Record<string, unknown>;
type Path = Array<string>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function currentValue(doc: Document, path: Path): unknown {
  const value = doc.getIn(path, true);
  return isNode(value) ? value.toJS(doc) : value;
}

function applyKey(doc: Document, path: Path, previous: unknown, next: unknown): boolean {
  if (isPlain(next) && isMap(doc.getIn(path, true))) {
    return applyMap(doc, path, isPlain(previous) ? previous : {}, next);
  }
  if (isDeepStrictEqual(currentValue(doc, path), next)) {
    return false;
  }
  doc.setIn(path, next);
  return true;
}

function applyMap(doc: Document, path: Path, previous: Plain, next: Plain): boolean {
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
export function updateYamlFile(file: string, previous: Plain, next: Plain, header?: string): void {
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
