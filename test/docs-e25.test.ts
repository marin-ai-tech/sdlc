import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

/**
 * The documentation names what the verification epic (0.34.0) shipped: the unstable group, failed-only reruns,
 * remote checks, evidence reuse, the unstable health window, plugin slow close and the log spool. A partial verify run
 * now merges with earlier results on the same code, so no page may still say that `--only` never passes the gate.
 */

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function markdown(rel: string): string[] {
  const full = path.join(REPO_ROOT, rel);
  if (fs.statSync(full).isFile()) return [rel];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) return markdown(child);
    return entry.name.endsWith('.md') ? [child] : [];
  });
}

function missing(rel: string, terms: string[]): string[] {
  const text = read(rel);
  return terms.filter((term) => !text.includes(term)).map((term) => `${rel}: ${term}`);
}

const GUIDE_VERIFY = ['verify.unstable', '--failed', 'remote: true', 'remote_unavailable', 'remote_no_answer',
  'remote_dirty', 'verify.reuse', '--no-reuse'];
const GUIDE_REFERENCE = ['verify.unstable', 'SDLC_UNSTABLE_TESTS', '--failed', 'unstable_days', 'remote: true',
  'verify.reuse', '--no-reuse', 'plugin_slow_close', 'log-spool'];
const ARCHITECTURE = ['verify-merge.ts', 'verify-reuse.ts', 'verify-remote.ts', 'verify-unstable.ts', 'log-spool'];
const CHAPTER = ['verify.unstable', '--failed'];

describe('E25 documentation', () => {
  it('D1 the sdlc guide verify page names every shipped verify feature', () => {
    expect(missing('assets/guide/en/verify.md', GUIDE_VERIFY)).toEqual([]);
  });

  it('D2 the sdlc guide config and health pages name the new keys', () => {
    const config = missing('assets/guide/en/config.md', ['verify.unstable', 'verify.reuse', 'remote: true']);
    const health = missing('assets/guide/en/health.md', ['unstable_days']);
    expect([...config, ...health]).toEqual([]);
  });

  it('D3 the reference guide names every shipped feature', () => {
    expect(missing('docs/en/05-guide.md', GUIDE_REFERENCE)).toEqual([]);
  });

  it('D4 the architecture names the modules that hold the new rules', () => {
    expect(missing('docs/en/04-architecture.md', ARCHITECTURE)).toEqual([]);
  });

  it('D5 the QA chapter of the course and the handbook teaches the unstable group and failed-only reruns', () => {
    const course = missing('docs/en/course/07-qa-review-release.md', CHAPTER);
    const handbook = missing('docs/en/handbook/07-qa-review-release.md', CHAPTER);
    expect([...course, ...handbook]).toEqual([]);
  });

  it('D6 negative: no page says that an --only run never passes the gate', () => {
    const stale = /verify --only[^\n]*never passes the gate|never passes the gate[^\n]*--only/i;
    const pages = [...markdown('docs/en'), ...markdown('assets/guide/en'), 'README.md'];
    const hits = pages.filter((rel) => read(rel).split('\n').some((line) => stale.test(line)));
    expect(hits).toEqual([]);
  });
});
