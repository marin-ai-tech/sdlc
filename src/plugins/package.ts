import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isWithin } from '../core/fs-utils.js';
import { LIMITS, fail, parseJson, type PackageSnapshot } from './api.js';
import { parseManifest } from './manifest.js';

export function hash(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function safeRelative(value: string): boolean {
  return value.length > 0 && value.split('/').every((part) => /^[A-Za-z0-9_.-]+$/.test(part)
    && !['.', '..'].includes(part) && !/[. ]$/.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part));
}

export function contained(root: string, relative: string): string {
  if (!safeRelative(relative)) fail('plugin_path', 'Expected a portable project-relative package path');
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, relative);
  if (!isWithin(realRoot, target) || target === realRoot) fail('plugin_path', 'Package path escapes its root');
  let current = realRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) fail('plugin_path', 'Linked package paths are refused');
  }
  if (!isWithin(realRoot, fs.realpathSync(target))) fail('plugin_path', 'Package real path escapes its root');
  return target;
}

function inventory(dir: string, prefix = '', entries: string[] = [], budget = { entries: 512 }): string[] {
  if (prefix.split('/').length > LIMITS.depth) fail('plugin_limit', 'Package directory nesting limit exceeded');
  const handle = fs.opendirSync(dir);
  try { for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
    if (--budget.entries < 0) fail('plugin_limit', 'Too many package entries');
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!safeRelative(rel)) fail('plugin_path', 'Unsafe package filename');
    const info = fs.lstatSync(path.join(dir, entry.name));
    if (info.isSymbolicLink()) fail('plugin_path', 'Package links are refused');
    if (info.isDirectory()) inventory(path.join(dir, entry.name), rel, entries, budget);
    else if (info.isFile() && info.nlink === 1) entries.push(rel);
    else fail('plugin_path', 'Package requires regular unlinked files');
    if (entries.length > LIMITS.files) fail('plugin_limit', 'Too many package files');
  } } finally { handle.closeSync(); }
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function readFile(file: string, remaining: number): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > remaining) fail('plugin_limit', 'Unsafe package file');
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (bytes.length !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      fail('plugin_changed', 'Package changed while being captured');
    }
    const current = fs.lstatSync(file);
    if (current.isSymbolicLink() || current.ino !== after.ino || current.dev !== after.dev) {
      fail('plugin_changed', 'Package file replaced during capture');
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

export function capturePackage(root: string, source: string): PackageSnapshot {
  const dir = contained(root, source);
  const names = inventory(dir);
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    fail('plugin_path', 'Case-colliding package filenames');
  }
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const name of names) {
    const bytes = readFile(path.join(dir, name), LIMITS.packageBytes - total);
    total += bytes.length;
    files.set(name, bytes);
  }
  if (JSON.stringify(names) !== JSON.stringify(inventory(dir))) fail('plugin_changed', 'Package inventory changed');
  const raw = files.get('sdlc-plugin.json');
  if (!raw) fail('plugin_manifest', 'Package has no sdlc-plugin.json');
  const manifest = parseManifest(parseJson(raw, LIMITS.manifestBytes));
  if (!safeRelative(manifest.entry) || !files.has(manifest.entry)) fail('plugin_manifest', 'Missing Wasm entry');
  if (files.get(manifest.entry)!.length > LIMITS.moduleBytes) fail('plugin_limit', 'Wasm module is too large');
  const records = names.map((name) => ({ path: name, size: files.get(name)!.length, sha256: hash(files.get(name)!) }));
  return { source, manifest, files, digest: `sha256:${hash(JSON.stringify(records))}` };
}
