import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isWithin } from './fs-utils.js';
import { t } from './i18n.js';

export interface UnstableTest {
  file: string;
  item: string;
  since: string;
}

function invalid(where: string): never {
  throw new SdlcError('invalid_config', { key: 'error.verify_unstable', params: { where } });
}

function validFile(file: string, root: string): boolean {
  if (!file || file.trim() !== file || /[\\*?\[\]{}]/.test(file)) return false;
  if (path.isAbsolute(file) || path.win32.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) return false;
  if (file.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  return isWithin(root, path.resolve(root, file));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseUnstable(value: unknown, root: string, where: (key: string) => string): UnstableTest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(where('verify.unstable'));
  const entries: UnstableTest[] = [];
  const files = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const key = `verify.unstable[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(where(key));
    const entry = raw as Record<string, unknown>;
    for (const field of Object.keys(entry)) {
      if (!['file', 'item', 'since'].includes(field)) invalid(where(`${key}.${field}`));
    }
    if (typeof entry.file !== 'string' || !validFile(entry.file, root) || files.has(entry.file)) {
      invalid(where(`${key}.file`));
    }
    if (typeof entry.item !== 'string' || !/^B\d+$/.test(entry.item)) invalid(where(`${key}.item`));
    if (typeof entry.since !== 'string' || !validDate(entry.since)) invalid(where(`${key}.since`));
    entries.push({ file: entry.file, item: entry.item, since: entry.since });
    files.add(entry.file);
  }
  return entries;
}

export function serializeUnstable(entries: UnstableTest[]): Record<string, unknown> {
  return entries.length > 0 ? { unstable: entries } : {};
}

export function unstableEnvironment(entries: UnstableTest[]): string {
  return entries.map((entry) => entry.file).join('\n');
}

function byFile(a: UnstableTest, b: UnstableTest): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.item !== b.item) return a.item < b.item ? -1 : 1;
  return a.since < b.since ? -1 : a.since > b.since ? 1 : 0;
}

/** B183: the digest of the unstable list a run used; the order in sdlc.yaml does not change it. */
export function unstableDigest(entries: UnstableTest[]): string {
  const sorted = entries.map(({ file, item, since }) => ({ file, item, since })).sort(byFile);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export function unstableWeakeningWarnings(before: UnstableTest[], after: UnstableTest[]): string[] {
  const existing = new Set(before.map((entry) => entry.file));
  return after.filter((entry) => !existing.has(entry.file))
    .map((entry) => t('config.warning.unstable', { file: entry.file, item: entry.item }));
}
