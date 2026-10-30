import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { assertHook, declareOperation, evaluationTime, executePrepared, immutableCandidate,
  isPreparation, prepareEvaluation, runPrepared } from '../dist/plugins/evaluation.js';
import { appendLog, readLog } from '../dist/core/log.js';
import { updateBoard, readBoard } from '../dist/core/board-store.js';
import { callPlugin } from '../dist/plugins/broker.js';
import { git, write } from './helpers.js';
import { git as inspectGit } from '../dist/core/git.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';

async function fixture(decision = 'pass') {
  const p = await pluginProject({ output: { decision }, facts: { remaining: 5 } }, { hooks: { claim: 'read' } });
  write(path.join(p.root, 'openspec/changes/demo/tasks.md'), '# Tasks\n\n- [ ] 1.1 Example\n');
  const args = { task: 'demo#1.1' };
  const binding = { operation: 'claim', args, actor: p.actor, board: true };
  const work = (actual = args) => {
    declareOperation(p.root, p.config, 'claim', actual);
    return updateBoard(p.root, (board) => {
      assertHook(p.root, p.config, 'claim', { task: actual.task });
      const now = evaluationTime(p.root);
      const value = { item: actual.task, change: 'demo', task: '1.1', executor: 'mesh',
        dispatchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), leaseSeconds: 3600 };
      board.dispatches.push(value);
      return value;
    });
  };
  const boardFile = path.join(p.root, 'openspec/.sdlc/board.json');
  const bytes = () => fs.existsSync(boardFile) ? fs.readFileSync(boardFile, 'utf8') : undefined;
  return { ...p, args, binding, work, boardFile, bytes };
}

describe('Private evaluation protocol (core-owned boundary fixture)', () => {
  it('retains the denying namespace and package identity in the caller diagnostic', async () => {
    const p = await fixture('deny');
    const result = runPrepared(p.root, p.config, p.binding, () => p.work());
    await expect(result).rejects.toMatchObject({ code: 'plugin_refused', message: expect.stringContaining('economy@1.0.0') });
    await expect(result).rejects.toMatchObject({ message: expect.stringContaining(p.snapshot.digest) });
    expect(readBoard(p.root).dispatches).toEqual([]);
  });

  it('requires an authentic non-serializable single-use context before mutation', async () => {
    const p = await fixture();
    expect(() => p.work()).toThrow(/Prepare this operation/);
    expect(p.bytes()).toBeUndefined();
    expect(() => executePrepared({} as never, () => p.work())).toThrow(/Forged/);
    const token = await prepareEvaluation(p.root, p.config, p.binding, () => p.work());
    expect(() => JSON.stringify(token)).toThrow(/cannot be serialized/);
    expect(p.bytes()).toBeUndefined();
    expect(executePrepared(token, () => p.work()).executor).toBe('mesh');
    const committed = p.bytes();
    expect(() => executePrepared(token, () => p.work())).toThrow(/reused/);
    expect(p.bytes()).toBe(committed);
  });

  it('rejects a different core operation input before creating board bytes', async () => {
    const p = await fixture();
    const token = await prepareEvaluation(p.root, p.config, p.binding, () => p.work());
    expect(() => executePrepared(token, () => p.work({ task: 'other#1.1' }))).toThrow(/arguments differ/);
    expect(p.bytes()).toBeUndefined();
    expect(() => executePrepared(token, () => p.work())).toThrow(/reused/);
  });

  it.each(['tasks', 'registry', 'settings', 'package'])('stale %s inputs cannot enter write-on-error', async (kind) => {
    const p = await fixture();
    const token = await prepareEvaluation(p.root, p.config, p.binding, () => p.work());
    if (kind === 'tasks') fs.appendFileSync(path.join(p.root, 'openspec/changes/demo/tasks.md'), '\nChanged');
    if (kind === 'registry') fs.appendFileSync(path.join(p.root, 'openspec/executors.yaml'), '\n# changed registry\n');
    if (kind === 'settings') { p.raw.plugins = {}; fs.writeFileSync(p.file, stringify(p.raw)); }
    if (kind === 'package') fs.writeFileSync(path.join(p.p.dir, 'support.txt'), 'new bytes');
    expect(() => executePrepared(token, () => p.work())).toThrow();
    expect(p.bytes()).toBeUndefined();
    expect(() => executePrepared(token, () => p.work())).toThrow(/reused/);
  });

  it('revocation and a real concurrent namespace transaction invalidate prepared facts', async () => {
    const p = await fixture();
    const token = await prepareEvaluation(p.root, p.config, p.binding, () => p.work());
    await callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, pluginRequest());
    expect(() => executePrepared(token, () => p.work())).toThrow(/changed/);
    expect(p.bytes()).toBeUndefined();
    const next = await prepareEvaluation(p.root, p.config, p.binding, () => p.work());
    expect(p.cli(['plugins', 'revoke', 'economy', '--json']).code).toBe(0);
    expect(() => executePrepared(next, () => p.work())).toThrow(/acceptance/);
    expect(p.bytes()).toBeUndefined();
  });

  it('a clock crossing a new auction boundary preserves every board byte', async () => {
    const p = await fixture();
    const closes = Date.now() + 60_000;
    updateBoard(p.root, (board) => board.auctions.push({ item: 'demo#2.1', change: 'demo', task: '2.1', bids: [],
      openedAt: new Date().toISOString(), closesAt: new Date(closes).toISOString() }));
    const before = p.bytes();
    const token = await prepareEvaluation(p.root, p.config, p.binding, () => p.work());
    const clock = vi.spyOn(Date, 'now').mockReturnValue(closes + 1);
    try { expect(() => executePrepared(token, () => p.work())).toThrow(/clock eligibility/); }
    finally { clock.mockRestore(); }
    expect(p.bytes()).toBe(before);
  });

  it('candidate alias changes refuse even when the source HEAD stays fixed', async () => {
    const p = await fixture();
    write(path.join(p.root, 'code.txt'), 'base');
    git(p.root, ['add', '-A']); git(p.root, ['commit', '-qm', 'fixture base']);
    const base = inspectGit(p.root, ['rev-parse', 'HEAD']).stdout;
    write(path.join(p.root, 'code.txt'), 'candidate');
    git(p.root, ['add', 'code.txt']); git(p.root, ['commit', '-qm', 'fixture candidate']);
    const head = inspectGit(p.root, ['rev-parse', 'HEAD']).stdout;
    git(p.root, ['update-ref', 'refs/heads/result', head]);
    git(p.root, ['reset', '--hard', base]);
    const work = () => {
      declareOperation(p.root, p.config, 'claim', p.args);
      immutableCandidate(p.root, 'refs/heads/result', base, () => ({ head, baseSha: base }));
      return updateBoard(p.root, (board) => { assertHook(p.root, p.config, 'claim', {}); return board.version; });
    };
    const token = await prepareEvaluation(p.root, p.config, p.binding, work);
    git(p.root, ['update-ref', 'refs/heads/result', base]);
    expect(() => executePrepared(token, work)).toThrow(/Candidate/);
    expect(readBoard(p.root).dispatches).toEqual([]);
  });

  it('runPrepared uses the same synchronous core boundary', async () => {
    const p = await fixture();
    expect((await runPrepared(p.root, p.config, p.binding, () => p.work())).executor).toBe('mesh');
    expect(readBoard(p.root).dispatches).toHaveLength(1);
  });

  it('refuses a stale caller config instead of mixing fresh hook settings with an old core closure', async () => {
    const p = await fixture();
    (p.raw.enforcement as Record<string, unknown>).protected_paths = ['src/protected.js'];
    fs.writeFileSync(p.file, stringify(p.raw));
    await expect(runPrepared(p.root, p.config, p.binding, () => p.work())).rejects.toMatchObject({ code: 'plugin_evaluation_stale' });
    expect(p.bytes()).toBeUndefined();
  });

  it('a late external artifact change cannot publish earlier expiry observations or a board write', async () => {
    const p = await fixture();
    const work = () => {
      declareOperation(p.root, p.config, 'claim', p.args);
      return updateBoard(p.root, (board) => {
        assertHook(p.root, p.config, 'claim', {});
        board.dispatches.push({ item: 'demo#1.1', change: 'demo', task: '1.1', executor: 'mesh',
          dispatchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), leaseSeconds: 900 });
        appendLog(p.root, p.config, { event: 'task.test_observation' });
        if (!isPreparation(p.root)) fs.appendFileSync(path.join(p.root, 'openspec/changes/demo/tasks.md'), '\nExternal edit\n');
        return true;
      });
    };
    const token = await prepareEvaluation(p.root, p.config, p.binding, work);
    expect(() => executePrepared(token, work)).toThrow(/inputs changed/);
    expect(p.bytes()).toBeUndefined();
    expect(readLog(p.root)).toEqual([]);
  });

  it('a late external edit cannot publish a non-board verdict or its observation', async () => {
    const p = await fixture();
    const binding = { operation: 'export', args: p.args, actor: p.actor, board: false };
    const work = () => {
      declareOperation(p.root, p.config, 'export', p.args);
      appendLog(p.root, p.config, { event: 'task.test_observation' });
      if (!isPreparation(p.root)) fs.appendFileSync(path.join(p.root, 'openspec/changes/demo/tasks.md'), '\nExternal edit\n');
      return true;
    };
    const token = await prepareEvaluation(p.root, p.config, binding, work);
    expect(() => executePrepared(token, work)).toThrow(/inputs changed/);
    expect(readLog(p.root)).toEqual([]);
  });

  it('never steals an aged live board lock during bounded preparation retries', async () => {
    const p = await fixture();
    const lock = path.join(p.root, 'openspec/.sdlc/board.lock');
    const bytes = `${process.pid} live-owner 2000-01-01T00:00:00.000Z`;
    fs.writeFileSync(lock, bytes);
    fs.utimesSync(lock, 0, 0);
    try {
      await expect(runPrepared(p.root, p.config, p.binding, () => p.work())).rejects.toMatchObject({ code: 'board_locked' });
      expect(fs.readFileSync(lock, 'utf8')).toBe(bytes);
      expect(p.bytes()).toBeUndefined();
    } finally { fs.unlinkSync(lock); }
  });
});
