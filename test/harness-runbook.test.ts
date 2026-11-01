import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

describe('Owner-gated Harness live runbook', () => {
  it('records pending live evidence, owner prerequisites and bounded client deadlines', () => {
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs/en/31-harness-runtime-prototype.md'), 'utf8');
    expect(guide).toMatch(/live acceptance[^\n]*NOT RUN/i);
    for (const prerequisite of ['preview access', 'region', 'cost boundary', 'isolated validator']) {
      expect(guide.toLowerCase()).toContain(prerequisite);
    }
    expect(guide).toContain('30000');
    expect(guide).toContain('90000');
  });

  it('keeps reachable-history review and host-bound result publication explicit', () => {
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs/en/31-harness-runtime-prototype.md'), 'utf8');
    expect(guide).toContain('git rev-list --objects HEAD');
    expect(guide).toContain('DIGITALOCEAN_ACCESS_TOKEN');
    expect(guide.toLowerCase()).toContain('intended repository and branch');
    expect(guide.toLowerCase()).toContain('fatal host');
    expect(guide).toContain('task.result_checked');
  });
});
