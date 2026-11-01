import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin } from '../../src/core/fs-utils.js';

const FORBIDDEN = /^(?:\.git|\.sdlc|\.sdlc\.yaml|\.env(?:\..*)?|node_modules|tokens?(?:\..*)?)$/i;
const HUMAN_STATE = /(?:^|\/)openspec\/(?:roles|executors|sdlc)\.yaml$/;

function snapshot(source: string, folder = ''): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of fs.readdirSync(path.join(source, folder), { withFileTypes: true })) {
    const relative = folder ? `${folder}/${entry.name}` : entry.name;
    if (FORBIDDEN.test(entry.name) || HUMAN_STATE.test(relative) || entry.isSymbolicLink()) {
      throw new Error(`Mutable, private or linked fixture entry: ${relative}`);
    }
    if (entry.isDirectory()) {
      for (const [name, content] of snapshot(source, relative)) files.set(name, content);
    } else if (entry.isFile()) {
      files.set(relative, fs.readFileSync(path.join(source, relative)));
    } else {
      throw new Error(`Non-file fixture entry: ${relative}`);
    }
  }
  return files;
}

function safeTarget(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  if (!isWithin(root, target)) throw new Error(`Fixture target outside root: ${relative}`);
  let ancestor = path.dirname(target);
  while (isWithin(root, ancestor)) {
    if (fs.lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Linked fixture target: ${relative}`);
    }
    if (ancestor === root) break;
    ancestor = path.dirname(ancestor);
  }
  if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error(`Fixture target already exists: ${relative}`);
  return target;
}

/** Snapshot immutable source bytes once; copies never include identities, Git, decisions, tokens or stores. */
export function immutableProjectTemplate(source: string): { files: string[]; copyTo(root: string): void } {
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Linked fixture root.');
  const files = snapshot(path.resolve(source));
  return {
    get files() {
      return [...files.keys()];
    },
    copyTo(destination) {
      const root = path.resolve(destination);
      const targets = [...files].map(([relative, content]) => [safeTarget(root, relative), content] as const);
      for (const [target, content] of targets) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, { flag: 'wx' });
      }
    },
  };
}
