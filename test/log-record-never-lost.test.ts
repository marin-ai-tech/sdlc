import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { appendLog, readLog } from '../src/core/log.js';
import { spoolLogRecord } from '../src/core/log-spool.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B327 (change log-record-never-lost). The server suite on aff53f8e (shard 3/8) saw plugin-events "concurrent core
 * writers" keep 7 of 8 records of one writer: appendLog catches any error of the write, prints "project log
 * pending; run sdlc doctor" and keeps nothing (src/core/log.ts:146). Every record appended by a process that exits
 * normally must be in the log; the children's stderr is kept so a failing round names its cause.
 */

const ROUNDS = 15;
const WRITERS = 3;
const RECORDS = 8;
const LOG_MODULE = new URL('../dist/core/log.js', import.meta.url).href;

function project() {
  const root = tempDir('sdlc-b327-');
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  const config = defaultConfig();
  write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(config)));
  return { root, config };
}

const SPOOL_DIR = 'openspec/.sdlc/log-spool';

/** What a drain that stopped after its append leaves: every spool file renamed to `<name>.claimed`. */
function claimAll(root: string): void {
  const dir = path.join(root, SPOOL_DIR);
  for (const name of fs.readdirSync(dir)) fs.renameSync(path.join(dir, name), path.join(dir, `${name}.claimed`));
}

function loggedLines(root: string, event: string): number {
  const text = fs.readFileSync(path.join(root, 'openspec/.sdlc/log.jsonl'), 'utf8');
  return text.split('\n').filter((line) => line.includes(`"event":"${event}"`)).length;
}

function shellDecision(root: string, config: ReturnType<typeof defaultConfig>, tool: string, command: string) {
  const call = normalizeToolCall(tool, { command }, root);
  return evaluateToolCall(call, { paths: projectPaths(root), config }).decision;
}

async function writer(root: string, config: unknown, event: string) {
  const script = [
    `const {appendLog}=await import(${JSON.stringify(LOG_MODULE)});`,
    `for(let i=0;i<${RECORDS};i++)`,
    `appendLog(${JSON.stringify(root)},${JSON.stringify(config)},{event:${JSON.stringify(event)},detail:String(i)});`,
  ].join('\n');
  const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: humanEnv(tempDir('sdlc-b327-home-')), timeout: 60000, maxBuffer: 1024 * 1024,
  });
  return child.stderr;
}

describe('B327: a log record is never lost when the log writer is contended', () => {
  it('L1 concurrent writers keep every record, round after round', async () => {
    const { root, config } = project();
    const lost: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const events = Array.from({ length: WRITERS }, (_, index) => `writer.${round}.${index}`);
      const errors = await Promise.all(events.map((event) => writer(root, config, event)));
      const entries = readLog(root);
      for (const [index, event] of events.entries()) {
        const kept = entries.filter((entry) => entry.event === event).map((entry) => entry.detail);
        if (kept.length !== RECORDS) lost.push(`${event}: kept ${kept.join(',')}; stderr ${errors[index].trim()}`);
      }
    }
    expect(lost).toEqual([]);
  }, 600000);

  it('L2 a record appended while a live writer holds the lock past the wait is written after it lets go', async () => {
    const { root, config } = project();
    const module = new URL('../dist/core/log-write.js', import.meta.url).href;
    const holder = spawn(process.execPath, ['--input-type=module', '-e', [
      `const {withLogWriter}=await import(${JSON.stringify(module)});`,
      `withLogWriter(${JSON.stringify(root)},()=>{console.log('holding');`,
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,12000)});',
    ].join('\n')], { env: humanEnv(tempDir('sdlc-b327-holder-')), windowsHide: true });
    const ended = new Promise<number | null>((resolve) => holder.once('exit', resolve));
    const timer = setTimeout(() => holder.kill('SIGKILL'), 30000);
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.once('data', () => resolve());
        holder.once('error', reject);
      });
      const stderr = await writer(root, config, 'contended');
      expect(await ended).toBe(0);
      await writer(root, config, 'after');
      const kept = readLog(root).filter((entry) => entry.event === 'contended').map((entry) => entry.detail);
      expect(kept, stderr).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
      expect(readLog(root).filter((entry) => entry.event === 'after')).toHaveLength(RECORDS);
    } finally {
      clearTimeout(timer);
      if (holder.exitCode === null) holder.kill('SIGKILL');
    }
  }, 120000);
});

describe('B327 spool recovery and protection', () => {
  it('a busy writer leaves a visible record and the next append drains it', async () => {
    const { root, config } = project();
    const module = new URL('../dist/core/log-write.js', import.meta.url).href;
    const holder = spawn(process.execPath, ['--input-type=module', '-e', [
      `const {withLogWriter}=await import(${JSON.stringify(module)});`,
      `withLogWriter(${JSON.stringify(root)},()=>{console.log('holding');`,
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,11000)});',
    ].join('\n')], { env: humanEnv(tempDir('sdlc-b327-holder-')), windowsHide: true });
    const ended = new Promise<number | null>((resolve) => holder.once('exit', resolve));
    const timer = setTimeout(() => holder.kill('SIGKILL'), 30000);
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.once('data', () => resolve());
        holder.once('error', reject);
      });
      const start = Date.now();
      appendLog(root, config, { event: 'spooled.once' });
      expect(Date.now() - start).toBeLessThan(12000);
      const dir = path.join(root, 'openspec/.sdlc/log-spool');
      expect(fs.readdirSync(dir)).toHaveLength(1);
      const saved = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8');
      expect(JSON.parse(saved).event).toBe('spooled.once');
      expect(readLog(root).filter((entry) => entry.event === 'spooled.once')).toHaveLength(1);
      expect(await ended).toBe(0);
      appendLog(root, config, { event: 'after.spool' });
      const lines = fs.readFileSync(path.join(root, 'openspec/.sdlc/log.jsonl'), 'utf8');
      expect(lines.match(/"event":"spooled.once"/g)).toHaveLength(1);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      clearTimeout(timer);
      if (holder.exitCode === null) holder.kill('SIGKILL');
    }
  }, 40000);

  // Review round 1 (Codex c-20261118-155742-8164, finding 4) changed this requirement: only a claimed file (a drain
  // that stopped between its append and its unlink) is checked against the log; an unclaimed one is always appended.
  it('removes an already acknowledged claimed spool record without appending a duplicate', () => {
    const { root, config } = project();
    appendLog(root, config, { event: 'already.logged' });
    const file = path.join(root, 'openspec/.sdlc/log.jsonl');
    spoolLogRecord(root, JSON.parse(fs.readFileSync(file, 'utf8').trim()));
    claimAll(root);
    appendLog(root, config, { event: 'drain.duplicate' });
    expect(fs.readFileSync(file, 'utf8').match(/"event":"already.logged"/g)).toHaveLength(1);
    expect(readLog(root).filter((entry) => entry.event === 'already.logged')).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, 'openspec/.sdlc/log-spool'))).toEqual([]);
  });

  it('keeps malformed spool bytes and doctor reports the file and pending count', () => {
    const { root, config } = project();
    spoolLogRecord(root, { ts: new Date().toISOString(), event: 'waiting', sdlc: 'test', license: 'test' });
    const dir = path.join(root, 'openspec/.sdlc/log-spool');
    const bad = '0-0-00000000-0000-4000-8000-000000000000.json';
    write(path.join(dir, bad), '{bad\n');
    const result = runCli(['doctor', '--json'], root, humanEnv(tempDir('sdlc-b327-doctor-')));
    const checks = result.json<{ checks: Array<{ status: string; message: string }> }>().checks;
    expect(checks).toContainEqual(expect.objectContaining({ status: 'warn', message: expect.stringContaining('1') }));
    expect(checks).toContainEqual(expect.objectContaining({ status: 'error', message: expect.stringContaining(bad) }));
    appendLog(root, config, { event: 'after.malformed' });
    expect(fs.readdirSync(dir)).toEqual([bad]);
    expect(fs.readFileSync(path.join(root, 'openspec/.sdlc/log.jsonl'), 'utf8')).not.toContain('{bad');
  }, 30000);

  it('guards spool writes and creates no spool during uncontended appends', () => {
    const { root, config } = project();
    const call = normalizeToolCall('Write', { file_path: 'openspec/.sdlc/log-spool/x.json', content: '{}' }, root);
    expect(evaluateToolCall(call, { paths: projectPaths(root), config }))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    appendLog(root, config, { event: 'ordinary' });
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/log-spool'))).toBe(false);
  });
});

describe('B327 review round 1 (Codex c-20261118-155742-8164)', () => {
  const record = (event: string) => ({ ts: '2026-11-18T12:00:00.000Z', event, sdlc: 'test', license: 'test' });

  it.each([
    ['Bash', 'rm -rf openspec/.sdlc/log-*'],
    ['Bash', 'rm -f openspec/.sdlc/log-spool/*'],
    ['PowerShell', 'Remove-Item -Recurse openspec/.sdlc/log-*'],
    ['PowerShell', 'Remove-Item openspec/.sdlc/log-spool/*.json'],
  ])('R1 %s `%s` cannot delete the spool or its records', (tool, command) => {
    const { root, config } = project();
    spoolLogRecord(root, record('pending'));
    expect(shellDecision(root, config, tool, command)).toBe('deny');
  });

  it('R1 negative: a glob delete outside the harness state stays allowed', () => {
    const { root, config } = project();
    spoolLogRecord(root, record('pending'));
    expect(shellDecision(root, config, 'Bash', 'rm -rf build/log-*')).not.toBe('deny');
    expect(shellDecision(root, config, 'Bash', 'ls openspec/.sdlc/log-*')).toBe('allow');
  });

  it('R2 a spool write keeps its record when the Git exclude file cannot be written', () => {
    const { root } = project();
    const exclude = path.join(root, '.git/info/exclude');
    fs.rmSync(exclude, { force: true });
    fs.mkdirSync(exclude, { recursive: true });
    expect(() => spoolLogRecord(root, record('no.exclude'))).not.toThrow();
    expect(fs.readdirSync(path.join(root, SPOOL_DIR))).toHaveLength(1);
    expect(readLog(root).filter((entry) => entry.event === 'no.exclude')).toHaveLength(1);
  });

  it('R3 an unusable spool does not cost the appending command its own record', () => {
    const { root, config } = project();
    write(path.join(root, SPOOL_DIR), 'not a folder\n');
    appendLog(root, config, { event: 'own.record' });
    expect(loggedLines(root, 'own.record')).toBe(1);
  });

  it('R4 two spool files with the same record are both appended', () => {
    const { root, config } = project();
    spoolLogRecord(root, record('twice'));
    spoolLogRecord(root, record('twice'));
    expect(readLog(root).filter((entry) => entry.event === 'twice')).toHaveLength(2);
    appendLog(root, config, { event: 'drain' });
    expect(loggedLines(root, 'twice')).toBe(2);
    expect(fs.readdirSync(path.join(root, SPOOL_DIR))).toEqual([]);
  });

  it('R4 an unclaimed spool record equal to a logged line is appended, a claimed one is not', () => {
    const { root, config } = project();
    spoolLogRecord(root, record('same'));
    appendLog(root, config, { event: 'first.drain' });
    spoolLogRecord(root, record('same'));
    appendLog(root, config, { event: 'second.drain' });
    expect(loggedLines(root, 'same')).toBe(2);
    spoolLogRecord(root, record('same'));
    claimAll(root);
    appendLog(root, config, { event: 'third.drain' });
    expect(loggedLines(root, 'same')).toBe(2);
  });
});
