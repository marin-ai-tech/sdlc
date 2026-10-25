import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin } from './fs-utils.js';

/** Git stores the link itself; include every link and target needed to reproduce the evaluated bytes. */
export function coveredSnapshotPaths(root: string, includes: string[]): string[] | undefined {
  const files = new Set<string>();
  try {
    for (const include of includes) {
      let current = path.resolve(root, include);
      const seen = new Set<string>();
      for (let hop = 0; hop < 40; hop++) {
        if (!isWithin(root, current) || seen.has(current)) return undefined;
        seen.add(current);
        const parts = path.relative(root, current).split(path.sep);
        let redirected = false;
        for (let depth = 1; depth <= parts.length; depth++) {
          const prefix = path.join(root, ...parts.slice(0, depth));
          if (!fs.lstatSync(prefix).isSymbolicLink()) continue;
          files.add(path.relative(root, prefix).replace(/\\/g, '/'));
          current = path.resolve(path.dirname(prefix), fs.readlinkSync(prefix), ...parts.slice(depth));
          redirected = true;
          break;
        }
        if (!redirected) {
          files.add(path.relative(root, current).replace(/\\/g, '/'));
          break;
        }
        if (hop === 39) return undefined;
      }
    }
    return [...files];
  } catch { return undefined; }
}

interface Entry { mode: string; oid: string }

/** Resolve links only in the immutable tree, including absolute links whose targets remain in this project. */
export function checkpointReader(top: string, tree: string, root: string): (relative: string) => string | undefined {
  const entries = new Map<string, Entry | undefined>();
  const blobs = new Map<string, string | undefined>();
  const run = (args: string[]) => spawnSync('git', args,
    { cwd: top, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const entry = (relative: string): Entry | undefined => {
    if (!entries.has(relative)) {
      const result = run(['--literal-pathspecs', 'ls-tree', '-z', tree, '--', relative]);
      const match = result.status === 0 ? /^([0-7]{6}) (?:blob|tree|commit) ([0-9a-f]{40,64})\t/.exec(result.stdout) : null;
      entries.set(relative, match ? { mode: match[1], oid: match[2] } : undefined);
    }
    return entries.get(relative);
  };
  const blob = (oid: string): string | undefined => {
    if (!blobs.has(oid)) {
      const result = run(['cat-file', 'blob', oid]);
      blobs.set(oid, result.status === 0 ? result.stdout : undefined);
    }
    return blobs.get(oid);
  };
  return (relative) => {
    let current = path.resolve(top, relative);
    const seen = new Set<string>();
    for (let hop = 0; hop < 40; hop++) {
      if (!isWithin(root, current) || seen.has(current)) return undefined;
      seen.add(current);
      const parts = path.relative(top, current).split(path.sep);
      let redirected = false;
      for (let depth = 1; depth <= parts.length; depth++) {
        const prefix = parts.slice(0, depth).join('/');
        const item = entry(prefix);
        if (!item) return undefined;
        if (item.mode === '120000') {
          const target = blob(item.oid);
          if (target === undefined || target.includes('\0')) return undefined;
          current = path.resolve(top, path.dirname(prefix), target, ...parts.slice(depth));
          redirected = true;
          break;
        }
        if (depth === parts.length) return ['100644', '100755'].includes(item.mode) ? blob(item.oid) : undefined;
        if (item.mode !== '040000') return undefined;
      }
      if (!redirected) return undefined;
    }
    return undefined;
  };
}
