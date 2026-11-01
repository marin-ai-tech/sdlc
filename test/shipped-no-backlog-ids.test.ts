import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

/**
 * Text that reaches users (workflows, guide, generated plugin, schemas, English docs, examples, licenses, README,
 * recent changelog sections) must not name this repository's own backlog: an instruction such as "the approved
 * package choice of epic E20 is already explicit" would steer every user's agent by a local plan it cannot see.
 * Two-digit epics and three-digit items are this backlog's ids. Shorter ids (E1, B12) stay allowed because the docs
 * use them in command examples; a release reference such as "(0.12.0, B25)" is refused at any length.
 */

const BACKLOG_ID = /\b(E[1-9]\d+|B[1-9]\d{2,})\b/g;
const RELEASE_REF = /\(\d+\.\d+\.\d+, [EB]\d+\)/g;
const SHIPPED_DIRS = ['assets', 'plugin', 'schemas', 'docs/en', 'examples', 'LICENSES'];
const SHIPPED_FILES = [
  'README.md', 'PRIVACY.md', 'NOTICE.md', 'LICENSE', 'COMMERCIAL-LICENSE.md', 'CONTRIBUTING.md',
  '.claude-plugin/marketplace.json',
];
const BINARY = new Set(['.png', '.wasm', '.ico', '.jpg', '.gif']);
/** Released changelog sections from this heading down predate the rule and stay as published. */
const CHANGELOG_RULE_FROM = '## 0.29.0';

function shippedFiles(dir: string): string[] {
  const full = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !BINARY.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
}

function hits(rel: string, text: string): string[] {
  return text.split(/\r?\n/).flatMap((line, index) =>
    [...line.matchAll(BACKLOG_ID), ...line.matchAll(RELEASE_REF)].map((m) => `${rel}:${index + 1}: ${m[0]}`));
}

function recentChangelog(): string {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  const end = text.indexOf(CHANGELOG_RULE_FROM);
  return end < 0 ? text : text.slice(0, end);
}

describe('Shipped text names no local backlog ids', () => {
  it('finds none in workflows, guide, plugin, schemas, docs, examples, licenses and README', () => {
    const files = [...SHIPPED_DIRS.flatMap(shippedFiles), ...SHIPPED_FILES];
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((rel) => hits(rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')));
    expect(found).toEqual([]);
  });

  it('finds none in changelog sections newer than the rule', () => {
    expect(hits('CHANGELOG.md', recentChangelog())).toEqual([]);
  });

  it('still allows short example ids and refuses a local id', () => {
    expect(hits('x', 'sdlc backlog epic edit E1 --granularity package; sdlc backlog move B12 --top')).toEqual([]);
    expect(hits('x', "E20's approved package choice")).toEqual(['x:1: E20']);
    expect(hits('x', 'fixed in B207')).toEqual(['x:1: B207']);
    expect(hits('x', 'an example shipped with sdlc (0.12.0, B25).')).toEqual(['x:1: (0.12.0, B25)']);
  });
});
