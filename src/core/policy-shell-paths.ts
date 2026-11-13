import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin, toPosix } from './fs-utils.js';

export function relToRoot(root: string, cwd: string, file: string): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (isWithin(root, abs)) return toPosix(path.relative(root, abs));
  if (process.platform !== 'win32') return undefined;
  try {
    const physicalRoot = fs.realpathSync.native(root);
    const physicalTarget = physicalPath(abs);
    if (physicalTarget && isWithin(physicalRoot, physicalTarget)) {
      return toPosix(path.relative(physicalRoot, physicalTarget));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Resolve existing ancestors so an absent target can still be checked against its physical project root. */
function physicalPath(target: string): string | undefined {
  let current = path.resolve(target);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** An outside-looking Windows path needs physical proof before it can be treated as outside the project. */
export function uncertainWindowsPath(root: string, cwd: string, file: string): boolean {
  if (process.platform !== 'win32') return false;
  const absoluteFile = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (isWithin(root, absoluteFile)) return false;
  try {
    fs.realpathSync.native(root);
    return physicalPath(absoluteFile) === undefined;
  } catch {
    return true;
  }
}
