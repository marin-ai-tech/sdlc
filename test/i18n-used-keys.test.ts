import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog } from '../src/core/i18n.js';
import { REPO_ROOT } from './helpers.js';

/**
 * Every message key the code names literally — `t('key')`, `lr('key')`, `{ key: 'key' }` — is in the catalog, so a
 * person never reads a raw key. (0.20.1: `sdlc team list` used `t('team.sync.none')`, which did not exist, and no test
 * noticed; the gap was closed before release.)
 */

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const LITERAL_KEYS = [/\bt\(\s*'([\w.-]+)'/g, /\blr\(\s*'([\w.-]+)'/g, /\bkey:\s*'([a-z][\w-]*\.[\w.-]+)'/g];

describe('message keys in the code', () => {
  it('every key named in src/ exists in the catalog', () => {
    const known = catalog('en');
    const missing: string[] = [];
    for (const file of sources(path.join(REPO_ROOT, 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of LITERAL_KEYS) {
        for (const match of text.matchAll(pattern)) {
          if (!(match[1] in known)) missing.push(`${path.relative(REPO_ROOT, file)}: ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
