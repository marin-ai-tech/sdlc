import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig } from '../src/core/config.js';
import { checkCoverage, parseCoverage, parseFindings } from '../src/core/review.js';
import { readAsset } from '../src/integrations/assets.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

const REQUIRED = ['bugs', 'security', 'compliance', 'adversarial', 'edge-cases', 'verification-gaps'];

const FULL_COVERAGE = [
  '## Coverage',
  '- bugs: 1 finding',
  '- security: none found — checked: input validation on greet(), no secrets in logs',
  '- compliance: none found — checked: every spec scenario has a test',
  '- adversarial: none found — checked: empty and very long names, unicode',
  '- edge-cases: none found — checked: null, undefined, whitespace-only names',
  '- verification-gaps: none found — checked: tests cover both branches',
].join('\n');

const FINDINGS = '## Findings\n\n### F1 [nit][bugs] Trailing space in message\n- **Where**: src/greet.js:2\n- **Status**: fixed (trimmed)\n';

describe('lens coverage (core)', () => {
  it('parses coverage lines: counts, "none found" with its checked evidence', () => {
    const entries = parseCoverage(`# Review\n\n${FULL_COVERAGE}\n\n## Plan drift\n- bugs: 9 findings\n`);
    expect(entries.map((e) => e.name)).toEqual(REQUIRED);
    expect(entries[0]).toMatchObject({ name: 'bugs', findings: 1 });
    expect(entries[1].none).toMatch(/input validation/);
  });

  it('reports missing names, "none found" without evidence, and counts that disagree with the findings', () => {
    const coverage = parseCoverage('## Coverage\n- bugs: 2 findings\n- security: none found\n- compliance: none found — checked:\n');
    const result = checkCoverage(parseFindings(FINDINGS), coverage, REQUIRED);
    expect(result.missing).toEqual(['adversarial', 'edge-cases', 'verification-gaps']);
    expect(result.unchecked.sort()).toEqual(['compliance', 'security']);
    expect(result.mismatched).toEqual([{ name: 'bugs', declared: 2, actual: 1 }]);
  });

  it('negative: full coverage has nothing to report', () => {
    expect(checkCoverage(parseFindings(FINDINGS), parseCoverage(FULL_COVERAGE), REQUIRED)).toEqual({ missing: [], unchecked: [], mismatched: [] });
  });

  it('a deferred finding keeps the registry id it points to', () => {
    const [linked, bare] = parseFindings('### F1 [nit][bugs] A\n- **Status**: deferred (D7)\n### F2 [nit][bugs] B\n- **Status**: deferred\n');
    expect(linked).toMatchObject({ status: 'accepted', deferredTo: 'D7' });
    expect(bare.deferredTo).toBeUndefined();
  });
});

describe('lens configuration', () => {
  it('new configs list the passes and lenses and require coverage', () => {
    const c = defaultConfig();
    expect(c.review.passes).toEqual(['bugs', 'security', 'compliance']);
    expect(c.review.lenses).toEqual(['adversarial', 'edge-cases', 'verification-gaps']);
    expect(c.review.requireLensCoverage).toBe(true);
  });

  it('negative: an existing sdlc.yaml without the key does not start requiring coverage', () => {
    expect(parseConfig({ version: 1, review: { policy: 'REVIEW.md' } }).review.requireLensCoverage).toBe(false);
    expect(parseConfig({ version: 1 }).review.requireLensCoverage).toBe(false);
    expect(parseConfig({ version: 1, review: { require_lens_coverage: true, lenses: ['adversarial'] } }).review).toMatchObject({ requireLensCoverage: true, lenses: ['adversarial'] });
  });

  it('REVIEW.md, the review record template, the workflow and the reviewer describe the lenses', () => {
    const policy = readAsset('project', 'REVIEW.md');
    expect(policy).toMatch(/^## Lenses/m);
    for (const lens of ['adversarial', 'edge-cases', 'verification-gaps']) expect(policy, lens).toContain(lens);
    expect(readAsset('records', 'review.md')).toMatch(/^## Coverage/m);
    const workflow = readAsset('workflows', 'review.md');
    expect(workflow).toMatch(/lens/i);
    expect(workflow).toMatch(/## Coverage|Coverage/);
    expect(workflow).toMatch(/sdlc defer add/);
    expect(readAsset('agents', 'reviewer.md')).toMatch(/lens/i);
  });
});

describe('sdlc review check with lenses and deferred links (CLI)', () => {
  function project(config?: string) {
    const root = tempDir('sdlc-lens-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const cli = (args: string[]) => runCli(args, root, env);
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    if (config) write(path.join(root, 'openspec/sdlc.yaml'), config);
    expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
    const review = (body: string) => write(path.join(root, 'openspec/changes/add-farewell/review.md'), `# Review: add-farewell\n\n${body}\n`);
    return { root, cli, review };
  }

  it('context lists the passes and lenses', () => {
    const { cli } = project();
    const ctx = cli(['review', 'context', '--change', 'add-farewell', '--json']).json();
    expect(ctx).toMatchObject({ passes: ['bugs', 'security', 'compliance'], lenses: ['adversarial', 'edge-cases', 'verification-gaps'], requireLensCoverage: true });
  });

  it('a new project blocks a review with missing coverage, and passes with full coverage', () => {
    const { cli, review } = project();
    review(FINDINGS);
    const missing = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(missing.code).toBe(1);
    expect(missing.json().coverage).toMatchObject({ enforced: true, missing: REQUIRED });
    review(`${FINDINGS}\n${FULL_COVERAGE}`);
    const ok = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(ok.code, ok.stdout).toBe(0);
    expect(ok.json().coverage).toMatchObject({ missing: [], unchecked: [] });
  });

  it('negative: an existing project (no require_lens_coverage key) only warns', () => {
    const { cli, review } = project('version: 1\nschema: sdlc\ntools: []\n');
    review(FINDINGS);
    const r = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(r.code, r.stdout).toBe(0);
    expect(r.json().coverage).toMatchObject({ enforced: false });
    expect(r.json().coverage.missing.length).toBeGreaterThan(0);
  });

  it('a deferred finding must point at an existing registry item', () => {
    const { cli, review } = project();
    expect(cli(['defer', 'add', 'Localize the farewell', '--why', 'after launch', '--change', 'add-farewell', '--finding', 'F2', '--json']).code).toBe(0);
    const linked = '### F2 [nit][compliance] Not localized\n- **Status**: deferred (D1)\n';
    review(`${FINDINGS}\n${linked}\n${FULL_COVERAGE.replace('compliance: none found — checked: every spec scenario has a test', 'compliance: 1 finding')}`);
    const ok = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(ok.code, ok.stdout).toBe(0);

    review(`${FINDINGS}\n${linked.replace('D1', 'D9')}\n${FULL_COVERAGE.replace('compliance: none found — checked: every spec scenario has a test', 'compliance: 1 finding')}`);
    const broken = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(broken.code).toBe(1);
    expect(broken.json().deferred.missing).toEqual([expect.objectContaining({ id: 'D9' })]);
  });

  it('negative: "deferred" without an id is a warning, not a block', () => {
    const { cli, review } = project();
    review(`${FINDINGS}\n### F2 [nit][compliance] Not localized\n- **Status**: deferred\n\n${FULL_COVERAGE.replace('compliance: none found — checked: every spec scenario has a test', 'compliance: 1 finding')}`);
    const r = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(r.code, r.stdout).toBe(0);
    expect(r.json().deferred.unlinked).toEqual([expect.objectContaining({ id: 'F2' })]);
  });
});
