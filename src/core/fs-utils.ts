import * as fs from 'node:fs';
import * as path from 'node:path';

export function exists(target: string): boolean {
  return fs.existsSync(target);
}

export function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

export function readText(target: string): string | undefined {
  try {
    return fs.readFileSync(target, 'utf-8');
  } catch {
    return undefined;
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Writes through a sibling temp file and a rename, so a crash or a concurrent
 * reader never observes a half-written state file.
 */
export function writeTextAtomic(target: string, content: string): void {
  ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, target);
  } catch (error) {
    // Windows can refuse a rename over an open file; fall back to a direct write.
    fs.writeFileSync(target, content, 'utf-8');
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Leaving a stray temp file is harmless.
    }
    if (!exists(target)) throw error;
  }
}

/** Normalizes CRLF so digests and parsers behave the same on every platform. */
export function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Lists every file under `dir`, returned as posix paths relative to `dir`,
 * sorted. Symlinked directories are not followed so a link cycle cannot hang
 * a hook.
 */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(childAbs, childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      } else if (entry.isSymbolicLink()) {
        if (isFile(childAbs)) out.push(childRel);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

/** True when `child` is `parent` or lies inside it (lexically). */
export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
