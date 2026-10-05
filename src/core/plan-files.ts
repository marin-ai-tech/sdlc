import * as path from 'node:path';
import picomatch from 'picomatch';
import { isFile, readText } from './fs-utils.js';

/**
 * The files a plan says it changes: the backticked paths under the plan.md heading "## Files that change", up to
 * the next heading of level one or two (sub-headings stay in the section). A small parser of its own, so rules
 * that need the plan's file list (takeover) do not depend on how plan drift reads the whole plan.
 */
const HEADING = /^(#{1,6})\s+(.*)$/;
const FILES_TITLE = /^files\s+that\s+change\s*$/i;
const BACKTICKED = /`([^`\s]+)`/g;
const GLOB_CHARS = /[*?[{]/;

/** One spelling per planned path: forward slashes, no leading `./`. */
function cleanPath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

/** A token that names a path rather than a flag, a URL or a placeholder. */
function looksLikePath(token: string): boolean {
  return token !== '' && !token.startsWith('-') && !token.includes('<') && !token.includes('://');
}

function collect(line: string, files: Set<string>): void {
  for (const match of line.matchAll(BACKTICKED)) {
    const file = cleanPath(match[1]);
    if (looksLikePath(file)) {
      files.add(file);
    }
  }
}

/** Backticked paths in the "Files that change" section of plan text; [] when the section is missing. */
export function filesThatChange(planText: string): string[] {
  const files = new Set<string>();
  let inSection = false;
  for (const line of planText.split(/\r?\n/)) {
    const heading = HEADING.exec(line.trim());
    if (heading && (heading[1].length <= 2 || !inSection)) {
      inSection = heading[1].length === 2 && FILES_TITLE.test(heading[2]);
      continue;
    }
    if (inSection) {
      collect(line, files);
    }
  }
  return [...files];
}

/** The planned files of a change, or undefined when the change has no plan.md. */
export function readPlanFiles(changeDir: string): string[] | undefined {
  const file = path.join(changeDir, 'plan.md');
  if (!isFile(file)) {
    return undefined;
  }
  return filesThatChange(readText(file) ?? '');
}

/**
 * True when a project file (posix, relative to the root) is a planned one: the same path, a file under a planned
 * directory (`src/payments/`) or a match of a planned glob. Case-insensitive, as Windows and macOS paths are.
 */
export function matchesPlanFile(planned: string, rel: string): boolean {
  const want = planned.toLowerCase();
  const file = rel.toLowerCase();
  if (want === file) {
    return true;
  }
  if (want.endsWith('/')) {
    return file.startsWith(want);
  }
  if (GLOB_CHARS.test(want)) {
    return picomatch(want, { dot: true, nocase: true })(file);
  }
  return false;
}
