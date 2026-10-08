import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadConfig, parseConfig, serializeConfig } from '../src/core/config.js';
import { collectHealth, healthReport } from '../src/core/health/index.js';
import { orderFindings, type FindingDraft } from '../src/core/health/model.js';
import { DEFAULT_HEALTH, parseHealth, serializeHealth } from '../src/core/health/thresholds.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/** 0.11.3 (B65, B68): the core of `sdlc health` - thresholds, order, collectors, light form, no writes. */

const DAY = 86_400_000;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function project() {
  const root = tempDir('sdlc-health-core-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  write(file, stringify(config));
  return { root, cli, file };
}

function snapshot(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (entry.split(/[\\/]/)[0] === '.git') continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isFile()) out.set(entry, stat.mtimeMs * 1e6 + stat.size);
  }
  return out;
}

describe('health thresholds', () => {
  it('fill in the defaults and serialize back only what differs', () => {
    expect(parseHealth(undefined, 'h')).toBeUndefined();
    const parsed = parseHealth({ wait_hours: 12, rework_share: 0.5 }, 'h')!;
    expect(parsed).toEqual({ ...DEFAULT_HEALTH, waitHours: 12 });
    expect(serializeHealth(parsed)).toEqual({ health: { wait_hours: 12 } });
    expect(serializeHealth({ ...DEFAULT_HEALTH })).toEqual({});
    const config = parseConfig({ health: { denials: 2 } }, 'sdlc.yaml');
    expect(config.health?.denials).toBe(2);
    expect(serializeConfig(config).health).toEqual({ denials: 2 });
    expect(serializeConfig(parseConfig({}, 'sdlc.yaml'))).not.toHaveProperty('health');
  });

  it('negative: unknown keys and values of the wrong type are invalid_config', () => {
    for (const value of [
      { nope: 1 }, { wait_hours: '48' }, { wait_hours: 0 }, { first_pass_rate: 1.5 }, { rework_share: -0.1 },
      { denials: 2.5 }, { reapprovals: 0 }, { window_days: true }, [1], 'x',
    ]) {
      expect(codeOf(() => parseHealth(value, 'h')), JSON.stringify(value)).toBe('invalid_config');
    }
    expect(codeOf(() => parseConfig({ health: { lock_days: null } }, 'f'))).toBe('invalid_config');
  });
});

describe('health findings', () => {
  it('order bad, warn, info, then by id; findings without facts are left out', () => {
    const draft = (id: string, level: FindingDraft['level'], facts = 1): FindingDraft => ({
      id, area: 'config', level, facts: Array.from({ length: facts }, () => ({ key: 'health.fact.signing' })),
    });
    const drafts = [draft('b.x', 'info'), draft('a.y', 'warn'), draft('z.z', 'bad'), draft('a.a', 'warn', 0)];
    const order = orderFindings(drafts).map((d) => `${d.level}:${d.id}`);
    expect(order).toEqual(['bad:z.z', 'warn:a.y', 'info:b.x']);
    const report = healthReport(orderFindings(drafts), 'ru');
    expect(report.counts).toEqual({ bad: 1, warn: 1, info: 1 });
    expect(report.findings[2].facts[0]).toMatch(/[а-я]/i);
  });

  it('stalled changes, locked tests and lite-track deltas; the light form skips the doctor; nothing is written', () => {
    const p = project();
    expect(p.cli(['new', 'slow-one', '--json']).code).toBe(0);
    expect(p.cli(['new', 'fix-x', '--kind', 'bugfix', '--risk', 'low', '--json']).code).toBe(0);
    expect(p.cli(['tests', 'lock', '--change', 'fix-x', '--json']).code).toBe(0);
    const state = path.join(p.root, 'openspec/changes/fix-x/.sdlc.yaml');
    const record = parse(read(state));
    record.track = 'lite';
    write(state, stringify(record));
    write(path.join(p.root, 'openspec/changes/fix-x/specs/calc/spec.md'), '## ADDED Requirements\n');
    const config = loadConfig(p.file);
    const paths = projectPaths(p.root);
    const before = snapshot(p.root);
    const today = collectHealth(p.root, paths, config, { light: true }).map((d) => d.id);
    expect(today).toContain('discipline.lite_behaviour');
    expect(today).not.toContain('flow.stalled');
    expect(today).not.toContain('discipline.test_lock');
    const later = collectHealth(p.root, paths, config, { light: true, now: new Date(Date.now() + 20 * DAY) });
    const ids = later.map((d) => d.id);
    expect(ids).toContain('flow.stalled');
    expect(ids).toContain('discipline.test_lock');
    expect(ids).not.toContain('config.doctor');
    const stalled = later.find((d) => d.id === 'flow.stalled')!;
    expect(stalled.facts.map((f) => f.params?.change).sort()).toEqual(['fix-x', 'slow-one']);
    expect(collectHealth(p.root, paths, config).map((d) => d.id)).toContain('config.doctor');
    expect(snapshot(p.root)).toEqual(before);
  }, 240000);

  it('a gate overdue in the log and still waiting is bad; a collector that fails is skipped', () => {
    const p = project();
    expect(p.cli(['new', 'late', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/late/intent.md'), [
      '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
      'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
      '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
    ].join('\n'));
    expect(p.cli(['next', '--change', 'late', '--json']).code).toBe(0);
    const logFile = path.join(p.root, 'openspec/.sdlc/log.jsonl');
    const entries = read(logFile).trim().split('\n').map((l) => JSON.parse(l));
    const awaiting = entries.find((e: { event: string }) => e.event === 'gate.intent.awaiting');
    expect(awaiting, read(logFile)).toBeDefined();
    const old = new Date(Date.now() - 3 * DAY).toISOString();
    const lines = entries.map((e: { event: string }) => JSON.stringify(e === awaiting ? { ...e, ts: old } : e));
    lines.push(JSON.stringify({ ...awaiting, event: 'gate.intent.overdue', ts: new Date().toISOString() }));
    write(logFile, `${lines.join('\n')}\n`);
    write(path.join(p.root, 'openspec/deferred-work.md'), 'not a registry\n### D1 [open] Old item\n- **Created**: x\n');
    // A roles.yaml that does not parse makes the roles collectors throw: they are skipped, the rest still report.
    write(path.join(p.root, 'openspec/roles.yaml'), 'version: 1\nsigning: off\npeople: 3\n');
    const drafts = collectHealth(p.root, projectPaths(p.root), loadConfig(p.file), { light: true });
    const ids = drafts.map((d) => d.id);
    expect(ids[0]).toBe('flow.overdue');
    expect(ids).toContain('flow.wait');
    expect(ids).not.toContain('flow.deferred');
    expect(ids).not.toContain('config.signing');
  }, 240000);
});
