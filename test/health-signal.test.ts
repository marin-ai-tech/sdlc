import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { recordHealthSignals } from '../src/core/health/signal.js';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * Review of 0.11.3 (B67): health.recovered is logged only for a finding that was evaluated. A collector that fails
 * (a broken roles.yaml, a malformed log line) leaves its finding out, and that must not read as "it went away".
 */

function project() {
  const root = tempDir('sdlc-health-signal-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, humanEnv(tempDir('sdlc-home-'))).code).toBe(0);
  const config = loadConfig(path.join(root, 'openspec/sdlc.yaml'));
  const events = (name: string) => fs.readFileSync(path.join(root, 'openspec/.sdlc/log.jsonl'), 'utf-8').trim()
    .split('\n').map((line) => JSON.parse(line)).filter((entry: { event: string }) => entry.event === name);
  return { root, config, events };
}

const BAD = { id: 'config.no_verify', area: 'config' as const, level: 'bad' as const, facts: [{ key: 'x' }] };

describe('health signals', () => {
  it('a finding whose collector failed is not declared recovered; an evaluated one is', () => {
    const p = project();
    recordHealthSignals(p.root, p.config, { drafts: [BAD], evaluated: [BAD.id] });
    recordHealthSignals(p.root, p.config, { drafts: [BAD], evaluated: [BAD.id] });
    expect(p.events('health.degraded')).toHaveLength(1);
    recordHealthSignals(p.root, p.config, { drafts: [], evaluated: [] });
    expect(p.events('health.recovered')).toHaveLength(0);
    recordHealthSignals(p.root, p.config, { drafts: [], evaluated: [BAD.id] });
    expect(p.events('health.recovered')).toHaveLength(1);
  }, 120000);
});
