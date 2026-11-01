import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { preloadCli } from './audit-decision-preload.js';
import { decisionProject } from './e20-decision-fixture.js';
import { read, runCli, tempDir, write } from './helpers.js';

function artifactDigest(files: Array<{ path: string; text: string }>): string {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.text}\0`);
  return `sha256:${hash.digest('hex')}`;
}

describe('Gate read retro audit R1–R7', () => {
  it('R1 reconstructs QA, review and release digests including their extra identities', () => {
    const p = decisionProject();
    const state = parse(read(p.stateFile));
    state.verify = { status: 'passed', at: '2026-10-29T00:00:00Z', commit: 'abc',
      fingerprint: 'git-tree:recorded', results: [] };
    write(p.stateFile, stringify(state));
    write(path.join(p.dir, 'verification.md'), '# Verification\n\nLiteral evidence.\n');
    for (const gate of ['qa', 'review', 'release']) {
      const out = p.cli(['gate', 'read', gate, '--change', 'demo', '--json']);
      expect(out.code, out.stdout + out.stderr).toBe(0);
      const snapshot = out.json().snapshot;
      const identity = gate === 'qa' ? snapshot.verification : snapshot.fingerprint;
      expect(identity).toBeTruthy();
      if (gate === 'qa') expect(identity).toBe(['passed', '2026-10-29T00:00:00Z', 'abc', 'git-tree:recorded'].join('\0'));
      const expected = createHash('sha256').update(identity).update('\0').update(artifactDigest(snapshot.files));
      expect(snapshot.digest).toBe(`sha256:${expected.digest('hex')}`);
      const plain = p.cli(['gate', 'read', gate, '--change', 'demo']);
      expect(plain.stdout).toContain(gate === 'qa' ? 'Verification: passed\\u0000' : snapshot.fingerprint);
    }
  }, 120000);

  it('R2 missing planning artifacts return exit zero with no snapshot and no writes', () => {
    const p = decisionProject();
    fs.rmSync(path.join(p.dir, 'intent.md'));
    const state = read(p.stateFile);
    const logFile = path.join(p.root, 'openspec/.sdlc/log.jsonl');
    const log = read(logFile);
    const out = p.cli(['gate', 'read', 'intent', '--change', 'demo', '--json']);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json()).not.toHaveProperty('snapshot');
    expect(read(p.stateFile)).toBe(state);
    expect(read(logFile)).toBe(log);
  }, 120000);

  it.each(['verify', 'imaginary'])('R3 refuses invalid approval gate %s', (gate) => {
    const p = decisionProject();
    const out = p.cli(['gate', 'read', gate, '--change', 'demo', '--json']);
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.json().status[0].code).toBe('invalid_gate');
  }, 120000);

  it('R4 an actual escaping covered junction fails read-only with unsafe_path', () => {
    const p = decisionProject();
    const outside = tempDir('sdlc-outside-gate-');
    write(path.join(outside, 'spec.md'), read(path.join(p.dir, 'specs/greeting/spec.md')));
    const state = read(p.stateFile);
    const folder = path.join(p.dir, 'specs/greeting');
    const target = path.join(folder, 'spec.md');
    const body = ['const original = fs.realpathSync;', 'let changed = false;',
      'fs.realpathSync = function(file) {',
      `  if (!changed && String(file) === ${JSON.stringify(target)} && new Error().stack.includes('digestText')) {`,
      '    changed = true;', `    fs.rmSync(${JSON.stringify(folder)}, { recursive: true });`,
      `    fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(folder)}, `
        + `${JSON.stringify(process.platform === 'win32' ? 'junction' : 'dir')});`,
      '  }', '  return original.apply(this, arguments);', '};'].join('\n');
    const out = preloadCli(p, ['gate', 'read', 'spec', '--change', 'demo', '--json'], body);
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.json().status[0].code).toBe('unsafe_path');
    expect(read(p.stateFile)).toBe(state);
  }, 120000);

  it('R4 an unreadable covered file produces artifact_unreadable instead of empty captured content', () => {
    const p = decisionProject();
    const file = path.join(p.dir, 'intent.md');
    const body = ['const original = fs.readFileSync;', 'fs.readFileSync = function(file) {',
      `  if (String(file) === ${JSON.stringify(file)} && new Error().stack.includes('digestText')) {`,
      "    throw Object.assign(new Error('controlled I/O denial'), { code: 'EACCES' });", '  }',
      '  return original.apply(this, arguments);', '};'].join('\n');
    const state = read(p.stateFile);
    const out = preloadCli(p, ['gate', 'read', 'intent', '--change', 'demo', '--json'], body);
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.json().status[0].code).toBe('artifact_unreadable');
    expect(out.json()).not.toHaveProperty('snapshot');
    expect(read(p.stateFile)).toBe(state);
  }, 120000);

  it('R6 a real CLI controlled read race hashes and returns the captured read, without rereading content', () => {
    const p = decisionProject();
    const file = path.join(p.dir, 'intent.md');
    const before = read(file).trimEnd();
    const body = ['const original = fs.readFileSync;', 'let changed = false;',
      'fs.readFileSync = function(file) {', '  const content = original.apply(this, arguments);',
      `  if (!changed && String(file) === ${JSON.stringify(file)} && new Error().stack.includes('digestText')) {`,
      '    changed = true;', `    fs.writeFileSync(file, '# Intent: Replacement after capture\\n');`,
      '  }', '  return content;', '};'].join('\n');
    const out = preloadCli(p, ['gate', 'read', 'intent', '--change', 'demo', '--json'], body);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const snapshot = out.json().snapshot;
    expect(snapshot.files).toEqual([{ path: 'intent.md', text: before }]);
    expect(snapshot.digest).toBe(artifactDigest(snapshot.files));
    expect(read(file)).toContain('Replacement after capture');
    expect(snapshot.files[0].text).not.toContain('Replacement after capture');
  }, 120000);

  it('R7 leaves a valid queued event untouched and starts no delivery transport', () => {
    const p = decisionProject();
    const configFile = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(configFile));
    const marker = path.join(tempDir('sdlc-delivery-probe-'), 'started');
    const server = path.join(tempDir('sdlc-delivery-server-'), 'server.mjs');
    write(server, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'started');`);
    config.mcp = { servers: { sink: { type: 'stdio', command: ['node', server], stages: [] } } };
    config.events = [{ server: 'sink', tool: 'report_event', on: ['gate.*'] }];
    write(configFile, stringify(config));
    const outbox = path.join(p.root, '.git/sdlc/outbox/pending.json');
    const event = { id: 'pending', project: 'test', event: 'gate.intent.approved', change: 'demo', gate: 'intent',
      at: '2026-10-29', sdlc: '0.29.0' };
    write(outbox, JSON.stringify({ event, receivers: ['sink/report_event'] }));
    const before = read(outbox);
    const out = runCli(['gate', 'read', 'intent', '--change', 'demo', '--json'], p.root, p.env);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    expect(read(outbox)).toBe(before);
  }, 120000);
});
