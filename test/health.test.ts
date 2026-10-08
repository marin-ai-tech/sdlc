import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.3, project health (docs/ru/23, B65, B68): `sdlc health` lists findings with a level, the facts and a
 * recommendation; no single score; thresholds from `health.*` in sdlc.yaml with defaults; exit 0 always.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

interface Finding {
  id: string;
  area: string;
  level: 'info' | 'warn' | 'bad';
  facts: string[];
  recommendation: string;
  params?: Record<string, unknown>;
}

function project(edit?: (config: Record<string, any>) => void) {
  const root = tempDir('sdlc-health-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  edit?.(config);
  write(file, stringify(config));
  const health = (): { findings: Finding[]; counts: Record<string, number> } => {
    const r = cli(['health', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json();
  };
  const ids = () => health().findings.map((f) => f.id);
  return { root, env, cli, health, ids };
}

/** A change whose intent gate was approved and sent back once with `reason`. */
function reworked(p: ReturnType<typeof project>, id: string, reason: string): void {
  expect(p.cli(['new', id, '--json']).code).toBe(0);
  write(path.join(p.root, 'openspec/changes', id, 'intent.md'), INTENT);
  expect(p.cli(['approve', 'intent', '--change', id, '--json']).code).toBe(0);
  const r = p.cli(['rework', 'intent', '--change', id, '--reason', reason, '--note', 'n', '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
}

function logDenials(root: string, rule: string, count: number): void {
  const file = path.join(root, 'openspec/.sdlc/log.jsonl');
  const now = new Date().toISOString();
  const lines = Array.from({ length: count }, () =>
    JSON.stringify({ ts: now, event: 'hook.denied', agent: 'claude', detail: `${rule}: Edit openspec/sdlc.yaml`,
      sdlc: '0.11.3', license: 'community' }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

describe('B65: flow and quality findings', () => {
  it('most reworks for a missing requirement recommend stronger specs', () => {
    const p = project();
    for (const id of ['a1', 'a2', 'a3']) reworked(p, id, 'missing-requirement');
    const out = p.health();
    const finding = out.findings.find((f) => f.id === 'quality.rework_reason');
    expect(finding).toMatchObject({ area: 'quality', level: 'warn' });
    expect(finding!.params?.reason).toBe('missing-requirement');
    expect(finding!.facts.length).toBeGreaterThan(0);
    expect(finding!.recommendation).toMatch(/spec/i);
    // Negative: a healthy configuration has no configuration or overdue findings; no single score.
    expect(out.findings.map((f) => f.id)).not.toContain('config.no_verify');
    expect(out.findings.map((f) => f.id)).not.toContain('flow.overdue');
    expect(out).not.toHaveProperty('score');
  }, 300000);

  it('thresholds come from health.* in sdlc.yaml; an unknown key is a config error', () => {
    const p = project((c) => { c.health = { rework_share: 0.9 }; });
    reworked(p, 'b1', 'missing-requirement');
    reworked(p, 'b2', 'missing-requirement');
    reworked(p, 'b3', 'design-flaw');
    expect(p.ids()).not.toContain('quality.rework_reason');
    const file = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.health = { no_such_threshold: 1 };
    write(file, stringify(config));
    const r = p.cli(['health', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 300000);
});

describe('B68: discipline and configuration signals', () => {
  it('no verification commands is bad and comes first; enforcement off is bad too', () => {
    const p = project((c) => { c.verify.commands = []; c.enforcement.mode = 'off'; });
    const out = p.health();
    const ids = out.findings.map((f) => f.id);
    expect(ids).toContain('config.no_verify');
    expect(ids).toContain('config.enforcement');
    expect(out.findings[0].level).toBe('bad');
    const levels = out.findings.map((f) => ['bad', 'warn', 'info'].indexOf(f.level));
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(out.counts.bad).toBeGreaterThanOrEqual(2);
  }, 180000);

  it('repeated denials of one rule recommend its guide article', () => {
    const p = project();
    logDenials(p.root, 'guard-config', 5);
    const finding = p.health().findings.find((f) => f.id === 'discipline.denials');
    expect(finding).toBeDefined();
    expect(finding!.recommendation).toContain('sdlc guide denials#guard-config');
  }, 180000);

  it('negative: fewer denials than the threshold say nothing', () => {
    const p = project();
    logDenials(p.root, 'guard-config', 4);
    expect(p.ids()).not.toContain('discipline.denials');
  }, 180000);

  it('one person holding every role is a warning; signing off is information', () => {
    const p = project();
    write(path.join(p.root, 'openspec/roles.yaml'), [
      'version: 1', 'signing: off', 'people:', '  pat: { name: Pat Lee, emails: [pat@example.com] }', 'roles:',
      '  product-owner: [pat]', '  engineer: [pat]', '  code-owner: [pat]', '  maintainer: [pat]', '',
    ].join('\n'));
    const findings = p.health().findings;
    expect(findings.find((f) => f.id === 'config.single_person')?.level).toBe('warn');
    expect(findings.find((f) => f.id === 'config.signing')?.level).toBe('info');
  }, 180000);
});
