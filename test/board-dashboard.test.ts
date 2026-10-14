import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B122 (epic E16): the task board on the dashboard. `sdlc dashboard` gets a board section (`id="board"`): the open,
 * claimed and submitted tasks per change, with the executor, the agent and the lease end of each claim, and the
 * count per executor. `sdlc report --format json` carries the same as `board` (only with an executor registry). The
 * dashboard only reads: it writes neither the board file nor the log, and it never shows a claim id.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = { executors: { 'swarm-a': { type: 'board', max_risk: 'medium' } } };

interface BoardModel {
  tasks: { id: string; status: string; executor?: string; agent?: string; expiresAt?: string }[];
  byExecutor: { executor: string; claimed: number; submitted: number }[];
}

function project(registry = true) {
  const root = tempDir('sdlc-board-dashboard-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  const approve = (gate: string) => expect(cli(['approve', gate, '--change', 'add-farewell', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--risk', 'medium', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  approve('intent');
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  approve('spec');
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), OPEN_TASKS);
  if (registry) write(path.join(root, 'openspec/executors.yaml'), stringify(REGISTRY));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planning']);
  approve('plan');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'plan approved']);
  const claim = (lease = '900') => cli(['board', 'claim', '--change', 'add-farewell', '--task', '1.2',
    '--executor', 'swarm-a', '--agent', 'coder-1', '--lease', lease, '--json'], AGENT);
  const dashboard = () => {
    const out = path.join(root, 'reports', 'dashboard.html');
    const r = cli(['dashboard', '--out', out]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return read(out);
  };
  const report = () => {
    const r = cli(['report', '--format', 'json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json<{ board?: BoardModel }>();
  };
  const boardFile = path.join(root, 'openspec/.sdlc/board.json');
  const logFile = path.join(root, 'openspec/.sdlc/log.jsonl');
  return { root, cli, claim, dashboard, report, boardFile, logFile };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The board section of the dashboard page, or '' when there is none. */
function boardSection(html: string): string {
  const start = html.indexOf('id="board"');
  if (start < 0) return '';
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

describe('B122: the task board on the dashboard', () => {
  it('lists claimed tasks with their executor, agent and lease end, and open tasks', () => {
    const p = project();
    const claimed = p.claim();
    expect(claimed.code, claimed.stdout + claimed.stderr).toBe(0);
    const claim = claimed.json<{ claim: { id: string; expiresAt: string } }>().claim;
    const html = p.dashboard();
    const section = boardSection(html);
    expect(section).not.toBe('');
    expect(section).toContain('add-farewell#1.2');
    expect(section).toContain('swarm-a');
    expect(section).toContain('coder-1');
    expect(section).toContain(claim.expiresAt.slice(0, 16));
    expect(section).toContain('add-farewell#1.1');
    expect(html).not.toContain(claim.id);
    const board = p.report().board;
    expect(board?.tasks.find((task) => task.id === 'add-farewell#1.2'))
      .toMatchObject({ status: 'claimed', executor: 'swarm-a', agent: 'coder-1', expiresAt: claim.expiresAt });
    expect(board?.tasks.find((task) => task.id === 'add-farewell#1.1')?.status).toBe('open');
    expect(board?.byExecutor).toEqual([{ executor: 'swarm-a', claimed: 1, submitted: 0 }]);
    expect(JSON.stringify(board)).not.toContain(claim.id);
  }, 240000);

  it('only reads: an expired claim shows as open, and neither the board file nor the log changes', async () => {
    const p = project();
    expect(p.claim('1').code).toBe(0);
    await pause(2500);
    const boardBefore = read(p.boardFile);
    const logBefore = fs.existsSync(p.logFile) ? read(p.logFile) : '';
    const html = p.dashboard();
    const board = p.report().board;
    expect(board?.tasks.find((task) => task.id === 'add-farewell#1.2')?.status).toBe('open');
    expect(boardSection(html)).toContain('add-farewell#1.2');
    expect(read(p.boardFile)).toBe(boardBefore);
    expect(fs.existsSync(p.logFile) ? read(p.logFile) : '').toBe(logBefore);
  }, 240000);

  it('a task dispatched to a representative shows as dispatched, with its executor and lease end', () => {
    const p = project();
    const r = p.cli(['board', 'dispatch', '--change', 'add-farewell', '--task', '1.1', '--executor', 'swarm-a',
      '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const dispatch = r.json<{ dispatch: { expiresAt: string } }>().dispatch;
    const task = p.report().board?.tasks.find((entry) => entry.id === 'add-farewell#1.1');
    expect(task).toMatchObject({ status: 'dispatched', executor: 'swarm-a', expiresAt: dispatch.expiresAt });
    expect(boardSection(p.dashboard())).toContain('dispatched');
  }, 240000);

  it('negative: without an executor registry there is no board section and no board in the report', () => {
    const p = project(false);
    expect(boardSection(p.dashboard())).toBe('');
    expect(p.report()).not.toHaveProperty('board');
  }, 240000);
});
