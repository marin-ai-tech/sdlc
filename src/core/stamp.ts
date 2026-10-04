import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText, writeTextAtomic } from './fs-utils.js';
import { withProvenance, type HarnessStamp } from './license.js';

/**
 * Keeps the provenance line (sdlc version and license, see core/license.ts)
 * at the end of a change's own markdown artifacts: the files at the top level
 * of the change folder. Delta specs under `specs/` are never stamped, because
 * OpenSpec merges their text into the living specs at archive. The line is
 * excluded from gate digests, so stamping never makes an approval stale.
 *
 * @param files paths relative to the change folder; others are skipped
 * @returns the files that were rewritten
 */
export function stampArtifacts(changeDir: string, files: string[], stamp: HarnessStamp): string[] {
  const stamped: string[] = [];
  for (const rel of [...new Set(files)].sort()) {
    if (rel.includes('/') || rel.includes('\\') || !rel.endsWith('.md')) continue;
    const file = path.join(changeDir, rel);
    const content = readText(file);
    if (content === undefined) continue;
    const next = withProvenance(content, stamp);
    if (next === content) continue;
    writeTextAtomic(file, next);
    stamped.push(rel);
  }
  return stamped;
}

/**
 * Stamping is a record, not a gate: a file that cannot be rewritten (read-only
 * checkout, locked on Windows) is reported instead of failing the command.
 */
export function tryStampArtifacts(
  changeDir: string,
  files: string[],
  stamp: HarnessStamp
): { stamped: string[]; error?: string } {
  try {
    return { stamped: stampArtifacts(changeDir, files, stamp) };
  } catch (error) {
    return { stamped: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Markdown files at the top level of a change folder. */
export function changeMarkdown(changeDir: string): string[] {
  try {
    return fs.readdirSync(changeDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
