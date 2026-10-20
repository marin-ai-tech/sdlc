import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';
import { anchors, localLinks, markdownFiles, slug } from './docs-markdown.js';

/**
 * Every relative link in the published documentation reaches an existing file, and every #anchor names a heading
 * of that file. Rewriting headings for readability breaks anchors first, so the whole set is checked each run.
 */

const DOCS = [path.join(REPO_ROOT, 'README.md'), ...markdownFiles(path.join(REPO_ROOT, 'docs', 'en'))];

function brokenLinks(file: string): string[] {
  const text = fs.readFileSync(file, 'utf-8');
  const broken: string[] = [];
  for (const { line, target } of localLinks(text)) {
    const [rel, anchor] = target.split('#') as [string, string | undefined];
    const dest = rel === '' ? file : path.resolve(path.dirname(file), decodeURIComponent(rel));
    const where = `${path.relative(REPO_ROOT, file)}:${line} -> ${target}`;
    if (!fs.existsSync(dest)) {
      broken.push(`${where} (no such file)`);
      continue;
    }
    if (anchor && dest.endsWith('.md') && !anchors(fs.readFileSync(dest, 'utf-8')).has(anchor)) {
      broken.push(`${where} (no such heading)`);
    }
  }
  return broken;
}

describe('documentation links', () => {
  it('every relative link and anchor in README.md and docs/en resolves', () => {
    expect(DOCS.flatMap(brokenLinks)).toEqual([]);
  });

  it('computes anchors the way GitHub does', () => {
    expect(slug('Supported tools')).toBe('supported-tools');
    expect(slug('4.5. Deterministic enforcement (hooks and plugin)')).toBe('45-deterministic-enforcement-hooks-and-plugin');
    expect(slug('🚀 Quick start')).toBe('-quick-start');
    expect(slug('`sdlc verify` and evidence')).toBe('sdlc-verify-and-evidence');
    expect([...anchors('# A\n## A\n```\n# not a heading\n```\n')]).toEqual(['a', 'a-1']);
  });

  it('negative: a missing file and a missing heading are both reported', () => {
    const dir = fs.mkdtempSync(path.join(REPO_ROOT, 'node_modules', '.docs-links-'));
    try {
      fs.writeFileSync(path.join(dir, 'b.md'), '# Real heading\n');
      const a = path.join(dir, 'a.md');
      fs.writeFileSync(a, '[x](b.md#real-heading) [y](b.md#gone) [z](c.md) `[w](d.md)`\n');
      expect(brokenLinks(a).map((s) => s.replace(/^.*-> /, ''))).toEqual([
        'b.md#gone (no such heading)',
        'c.md (no such file)',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
