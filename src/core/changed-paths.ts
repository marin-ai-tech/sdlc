import { git } from './git.js';
import { SdlcError } from './errors.js';

export type ChangedPaths = { ok: true; files: string[] } | { ok: false };

/** Parse Git's NUL-separated status/path pairs without changing path spelling. */
export function parseChangedPaths(output: string): ChangedPaths {
  if (output === '') return { ok: true, files: [] };
  if (!output.endsWith('\0')) return { ok: false };
  const fields = output.slice(0, -1).split('\0');
  if (fields.length % 2 !== 0) return { ok: false };
  const files: string[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const file = fields[index + 1];
    if (!/^[ADMT]$/.test(status) || file === '') return { ok: false };
    files.push(file);
  }
  return { ok: true, files };
}

/**
 * Read both sides of renames as separate changed paths; an unreadable listing fails closed. The flags pin every
 * local setting that changes the listing: renames, relative paths and submodule ignores.
 */
export function readChangedPaths(root: string, base: string, branch: string): ChangedPaths {
  const diff = git(root, ['diff', '--name-status', '-z', '--no-renames', '--no-relative', '--ignore-submodules=none',
    `${base}..${branch}`]);
  if (!diff.ok) return { ok: false };
  const parsed = parseChangedPaths(diff.stdout);
  if (!parsed.ok) return parsed;
  return { ok: true, files: [...new Set(parsed.files)].sort() };
}

function requiredListing(root: string, args: string[], statuses: boolean): string[] {
  const result = git(root, args);
  if (!result.ok) throw new SdlcError('diff_unavailable', 'Cannot read the required Git changed-file listing.');
  const parsed = statuses ? parseChangedPaths(result.stdout) : parsePathNames(result.stdout);
  if (!parsed.ok) throw new SdlcError('diff_unavailable', 'Git returned an invalid changed-file listing.');
  return parsed.files;
}

function parsePathNames(output: string): ChangedPaths {
  if (output === '') return { ok: true, files: [] };
  if (!output.endsWith('\0')) return { ok: false };
  const files = output.slice(0, -1).split('\0');
  return files.some((file) => file === '') ? { ok: false } : { ok: true, files };
}

/** Committed, working and untracked names share exact NUL framing and refuse unavailable evidence. */
export function readWorkingChangedPaths(root: string, base?: string): string[] {
  const options = ['--name-status', '-z', '--no-renames', '--no-relative', '--ignore-submodules=none'];
  const range = base && git(root, ['cat-file', '-t', base]).stdout === 'tree' ? `${base}..HEAD` : `${base}...HEAD`;
  const files = base ? requiredListing(root, ['diff', ...options, range], true) : [];
  files.push(...requiredListing(root, ['diff', ...options, 'HEAD'], true));
  files.push(...requiredListing(root, ['ls-files', '-z', '--full-name', '--others', '--exclude-standard'], false));
  return [...new Set(files)].sort();
}
