import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

/**
 * The shape of CHANGELOG.md (a defect of 0.20.0: the `## 0.19.0` heading was lost and its entries sat under 0.20.0 as
 * a second `### Added`). Every version has one `## X.Y.Z — <date>` heading; versions descend; inside a version each
 * kind (`### Added`, `### Changed`, `### Fixed`, ...) appears once; the package version and every release tag the
 * repository has are there.
 */

interface Section {
  version: string;
  kinds: string[];
}

function sections(): Section[] {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  const result: Section[] = [];
  for (const line of text.split('\n')) {
    const version = /^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}\s*$/.exec(line);
    if (version) result.push({ version: version[1], kinds: [] });
    const kind = /^### (\w+)/.exec(line);
    if (kind && result.length > 0) result[result.length - 1].kinds.push(kind[1]);
  }
  return result;
}

const parts = (version: string) => version.split('.').map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

describe('CHANGELOG.md', () => {
  it('each version has one heading, versions descend, and each kind appears once per version', () => {
    const list = sections();
    expect(list.length).toBeGreaterThan(10);
    const versions = list.map((section) => section.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let index = 1; index < versions.length; index += 1) {
      expect(newer(versions[index - 1], versions[index]), `${versions[index - 1]} before ${versions[index]}`)
        .toBeGreaterThan(0);
    }
    for (const section of list) {
      expect(new Set(section.kinds).size, `${section.version}: ${section.kinds.join(', ')}`).toBe(section.kinds.length);
    }
  });

  it('the package version and every release tag have a section', () => {
    const versions = new Set(sections().map((section) => section.version));
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version as string;
    expect(versions.has(pkg), pkg).toBe(true);
    const tags = spawnSync('git', ['tag', '--list', 'v*'], { cwd: REPO_ROOT, encoding: 'utf-8' }).stdout;
    const released = tags.split('\n')
      .map((tag) => tag.trim().replace(/^v/, ''))
      .filter((tag) => /^\d+\.\d+\.\d+$/.test(tag));
    const missing = released.filter((version) => newer(version, '0.4.0') >= 0 && !versions.has(version));
    expect(missing).toEqual([]);
  });
});
