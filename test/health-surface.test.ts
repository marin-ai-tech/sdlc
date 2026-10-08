import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.3 (docs/ru/23, B66, B67): the health workflow drafts backlog items with source health; the session start
 * shows one line only for a bad finding; the dashboard has a health section; health.degraded and health.recovered
 * go to the log once per change of state.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function project(verify: boolean) {
  const root = tempDir('sdlc-health-surface-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], input?: string) => runCli(args, root, env, input);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const setVerify = (on: boolean) => {
    const config = parse(read(file));
    config.verify.commands = on ? [{ name: 'ok', run: 'node -e 0', required: true }] : [];
    config.enforcement.mode = 'block';
    write(file, stringify(config));
  };
  setVerify(verify);
  const events = (name: string) => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n')
    .map((l) => JSON.parse(l)).filter((e: { event: string }) => e.event === name);
  const session = () => {
    const r = cli(['hook', 'session-start'], JSON.stringify({ cwd: root, source: 'startup' }));
    return r.stdout.trim() ? String(JSON.parse(r.stdout).hookSpecificOutput.additionalContext) : '';
  };
  return { root, cli, setVerify, events, session };
}

describe('B66: the health workflow and subagent', () => {
  it('a drafted backlog item carries source health and the finding', () => {
    const p = project(true);
    const r = p.cli(['backlog', 'add', 'Stronger specs', '--kind', 'chore', '--source-type', 'health',
      '--source-ref', 'quality.rework_reason', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(read(path.join(p.root, 'openspec/backlog.md'))).toContain('health quality.rework_reason');
  }, 180000);

  it('the workflow and the read-only subagent ship with sdlc', () => {
    const workflow = read(path.join(REPO, 'assets/workflows/health.md'));
    expect(workflow).toContain('sdlc health --json');
    expect(workflow).toContain('--source-type health');
    expect(fs.existsSync(path.join(REPO, 'assets/agents/health.md'))).toBe(true);
  });
});

describe('B67: session start, dashboard and events', () => {
  it('a bad finding gives one line at the session start and one health.degraded entry', () => {
    const p = project(false);
    const lines = p.session().split('\n').filter((l) => l.includes('sdlc health'));
    expect(lines).toHaveLength(1);
    expect(p.cli(['health', '--json']).code).toBe(0);
    expect(p.cli(['health', '--json']).code).toBe(0);
    const degraded = p.events('health.degraded');
    expect(degraded.filter((e: { detail?: string }) => e.detail === 'config.no_verify')).toHaveLength(1);
    p.setVerify(true);
    expect(p.cli(['health', '--json']).code).toBe(0);
    expect(p.events('health.recovered').filter((e: { detail?: string }) => e.detail === 'config.no_verify'))
      .toHaveLength(1);
  }, 240000);

  it('negative: no line at session start while every finding is info or warn', () => {
    const p = project(true);
    expect(p.session()).not.toContain('sdlc health');
    expect(p.events('health.degraded')).toHaveLength(0);
  }, 180000);

  it('the dashboard has a health section', () => {
    const p = project(false);
    const json = p.cli(['report', '--format', 'json']);
    expect(json.code, json.stdout + json.stderr).toBe(0);
    const model = JSON.parse(json.stdout);
    expect(model.health.findings.map((f: { id: string }) => f.id)).toContain('config.no_verify');
    const out = path.join(p.root, 'report.html');
    expect(p.cli(['report', '--format', 'html', '--out', out]).code).toBe(0);
    expect(read(out)).toContain('id="health"');
  }, 180000);

  it('health.degraded is among the events a receiver gets by default', async () => {
    const config = await import('../src/mcp/event-config.js');
    expect(config.DEFAULT_EVENT_PATTERNS.some((p: string) => config.patternMatches(p, 'health.degraded'))).toBe(true);
  });
});
