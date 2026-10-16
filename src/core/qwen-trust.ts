import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

function withoutComments(source: string): string {
  let output = '';
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      output += char;
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      output += ' ';
    } else output += char;
  }
  return output;
}

function readJson(file: string): unknown {
  try { return JSON.parse(withoutComments(fs.readFileSync(file, 'utf8'))) as unknown; } catch { return undefined; }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Qwen Code 0.25 uses the deepest applicable folder rule, with denials winning ties. */
export function qwenFolderTrusted(root: string): boolean {
  const home = path.join(os.homedir(), '.qwen');
  const settings = object(readJson(path.join(home, 'settings.json')));
  const security = object(settings.security);
  if (object(security.folderTrust).enabled !== true) return true;
  const rules = object(readJson(path.join(home, 'trustedFolders.json')));
  const target = normalize(root);
  let bestDepth = -1;
  let trusted = false;
  for (const [spelling, value] of Object.entries(rules)) {
    if (!['TRUST_FOLDER', 'TRUST_PARENT', 'DO_NOT_TRUST'].includes(String(value))) continue;
    const rulePath = normalize(spelling);
    const applies = value === 'TRUST_PARENT' ? normalize(path.dirname(rulePath)) : rulePath;
    if (!contains(applies, target)) continue;
    const depth = applies.length;
    if (depth > bestDepth || (depth === bestDepth && value === 'DO_NOT_TRUST')) {
      bestDepth = depth;
      trusted = value !== 'DO_NOT_TRUST';
    }
  }
  return trusted;
}
