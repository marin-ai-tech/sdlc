import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

/**
 * B123: lifecycle.ts grew to 686 lines with the 0.18.0 gates (team rule: an outlier must not grow). Each gate's
 * evaluation and next step move into their own modules, behaviour unchanged (the full suite passes unchanged), and
 * lifecycle.ts gets under 600 lines. No new module takes its place as an outlier.
 */

const lines = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n').length;

describe('B123: lifecycle.ts is split', () => {
  it('lifecycle.ts has fewer than 600 lines', () => {
    expect(lines('src/core/lifecycle.ts')).toBeLessThan(600);
  });

  it('negative: no other core module grows past 450 lines to take its place, apart from the known outliers', () => {
    const known = new Set(['lifecycle.ts', 'config.ts', 'backlog.ts']);
    const dir = path.join(REPO_ROOT, 'src/core');
    const big = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !known.has(name))
      .filter((name) => lines(path.join('src/core', name)) > 450);
    expect(big).toEqual([]);
  });
});
