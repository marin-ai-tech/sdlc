import * as path from 'node:path';
import { isFile, readText } from './fs-utils.js';

function manifest(root: string, file: string): string | undefined {
  const target = path.join(root, file);
  return isFile(target) ? readText(target) ?? undefined : undefined;
}

function tomlName(text: string, section: string): string | undefined {
  const header = new RegExp(`^\\[${section}\\]\\s*$`, 'm');
  const start = header.exec(text);
  if (!start) return undefined;
  const body = text.slice(start.index + start[0].length).split(/^\s*\[/m, 1)[0];
  return /^\s*name\s*=\s*["']([^"']+)["']/m.exec(body)?.[1];
}

export function projectNameFromManifest(root: string): string {
  const pkg = manifest(root, 'package.json');
  if (pkg) {
    try {
      const name = (JSON.parse(pkg) as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) return name.replace(/^@[^/]+\//, '');
    } catch { /* Ignore an invalid manifest. */ }
  }
  const python = manifest(root, 'pyproject.toml');
  if (python) {
    const name = tomlName(python, 'project');
    if (name) return name;
  }
  const rust = manifest(root, 'Cargo.toml');
  if (rust) {
    const name = tomlName(rust, 'package');
    if (name) return name;
  }
  const go = manifest(root, 'go.mod');
  const module = go ? /^\s*module\s+(\S+)/m.exec(go)?.[1] : undefined;
  if (module) return module.split('/').at(-1)!;
  return path.basename(root);
}
