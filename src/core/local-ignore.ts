import * as fs from 'node:fs';
import * as path from 'node:path';
import { git } from './git.js';
import { readText } from './fs-utils.js';
import { SdlcError } from './errors.js';

function literalPattern(value: string): string {
  if (/[\r\n]/.test(value)) throw new SdlcError('local_ignore', 'Local state exclusion needs a single-line project path');
  return value.replace(/[\\*?\[\]#! ]/g, '\\$&');
}

/** Reading commands add missing state-file rules to Git's local exclude file. */
export function ensureLocalIgnore(root: string, entries: string[]): void {
  const tracked = readText(path.join(root, 'openspec/.sdlc/.gitignore')) ?? '';
  const present = new Set(tracked.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const result = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (!result.ok) return;
  const file = path.resolve(root, result.stdout);
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return;
  const project = path.relative(top.stdout, root).split(path.sep).join('/');
  const prefix = project ? `${project}/` : '';
  const existing = readText(file) ?? '';
  const local = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const additions = missing.map(entry => literalPattern(`${prefix}openspec/.sdlc/${entry}`))
    .filter(entry => !local.has(entry));
  if (additions.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${separator}${additions.join('\n')}\n`);
}
