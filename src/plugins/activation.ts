import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureLocalIgnore } from '../core/local-ignore.js';
import { fail, parseJson, canonical, LIMITS, type Json } from './api.js';
import { listFilesRecursive } from '../core/fs-utils.js';

export const PLUGIN_ROOT = 'openspec/.sdlc/plugins';

export function pluginStateFiles(root: string): string[] {
  return listFilesRecursive(path.join(root, PLUGIN_ROOT)).map((name) => `${PLUGIN_ROOT}/${name}`);
}

export function storagePath(root: string, relative = '', create = false): string {
  if (relative && (!/^[a-zA-Z0-9_./-]+$/.test(relative)
    || relative.split('/').some((part) => !part || part === '.' || part === '..'))) {
    fail('plugin_path', 'Invalid logical storage path');
  }
  const realRoot = fs.realpathSync(root);
  const parts = (PLUGIN_ROOT + (relative ? `/${relative}` : '')).split('/');
  let current = realRoot;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (!fs.existsSync(current)) {
      try {
        if (fs.lstatSync(current).isSymbolicLink()) fail('plugin_path', 'Dangling storage link');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!create || i === parts.length - 1) continue;
      try { fs.mkdirSync(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) fail('plugin_path', 'Linked plugin storage');
    if (i < parts.length - 1 && !stat.isDirectory()) fail('plugin_path', 'Plugin storage parent is not a directory');
  }
  return current;
}

export function readStored(root: string, relative: string, limit = LIMITS.storeBytes): Json | undefined {
  const file = storagePath(root, relative);
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return fail('plugin_store', 'Plugin storage cannot be read');
  }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) fail('plugin_store', 'Unsafe or oversized plugin store');
    return parseJson(fs.readFileSync(fd), limit);
  } finally { fs.closeSync(fd); }
}

export function atomicStored(root: string, relative: string, value: unknown): void {
  const bytes = Buffer.from(canonical(value, LIMITS.storeBytes));
  const file = storagePath(root, relative, true);
  const temporary = `${relative}.${randomUUID()}.tmp`;
  const tmp = storagePath(root, temporary, true);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      if (!written) fail('plugin_store', 'Incomplete plugin store write');
      offset += written;
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  storagePath(root, relative);
  try { fs.renameSync(tmp, file); }
  catch { fail('plugin_indeterminate', 'Atomic store acknowledgement failed; reconcile the request before retrying'); }
}

export function withPluginLock<T>(root: string, relative: string, action: () => T): T {
  const file = storagePath(root, relative, true);
  let fd: number;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('plugin_busy', 'Plugin writer is busy');
    throw error;
  }
  const nonce = randomUUID();
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce, at: Date.now() }));
    fs.fsyncSync(fd);
    return action();
  } finally {
    fs.closeSync(fd);
    const current = readStored(root, relative);
    if (current && typeof current === 'object' && !Array.isArray(current) && current.nonce === nonce) {
      fs.unlinkSync(storagePath(root, relative));
    }
  }
}

export function withActivation<T>(root: string, action: () => T, recovery = false): T {
  if (!recovery && fs.existsSync(storagePath(root, 'recovery.lock'))) fail('plugin_busy', 'Plugin recovery is active');
  ensureLocalIgnore(root, ['plugins/']);
  return withPluginLock(root, 'activation.lock', () => {
    if (!recovery && fs.existsSync(storagePath(root, 'recovery.lock'))) fail('plugin_busy', 'Plugin recovery is active');
    return action();
  });
}

export function settingsWrite<T>(file: string, hasPlugins: boolean, action: () => T): T {
  const root = path.dirname(path.dirname(path.resolve(file)));
  if (!hasPlugins && !fs.existsSync(storagePath(root))) return action();
  return withActivation(root, action);
}
