import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B19: a judge gate. `gates.<g>.judge` names a judge — a command (`run`) or an MCP tool of the registry (`server`,
 * `tool`) — a rubric file and `max_loops` (default 3). `sdlc judge --gate <g> --change <id> [--json]` (any actor, an
 * agent too) sends `{ change, gate, rubric, artifacts: [{ path, content }] }` (a command reads it on stdin, a tool gets
 * it as arguments) and records the verdict `{ pass, route, rework }`, bound to the digest of the gate's artifacts.
 * - While a judge is configured and there is no passing verdict for the current artifacts, the gate is blocked: a
 *   person cannot approve it, and `sdlc next` asks the agent to run the judge or, after a failing verdict, to rework
 *   the artifacts with the judge's instruction. A changed artifact makes any verdict stale.
 * - A passing verdict is evidence only: a person still approves the gate.
 * - The author-critic loop stops after `max_loops` failing verdicts for the gate: then `sdlc next` hands the gate to a
 *   person, who may approve; the judge never approves.
 * - A judge answer that is not a verdict is refused (`judge_invalid_answer`) and records nothing.
 */

const JUDGE = path.join(REPO_ROOT, 'test/fixtures/judge/judge.mjs').replace(/\\/g, '/');
const RUBRIC = '# Spec rubric\n\n- Every requirement has a scenario.\n- RUBRIC-MARKER\n';

function project(judge: Record<string, unknown> | undefined) {
  const root = tempDir('sdlc-judge-');
  const log = path.join(tempDir('sdlc-judge-log-'), 'requests.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { JUDGE_LOG: log });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'docs/rubrics/spec.md'), RUBRIC);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { judges: { type: 'stdio', command: ['node', JUDGE, '--mcp'], stages: [] } } };
  if (judge) config.gates.spec.judge = { rubric: 'docs/rubrics/spec.md', ...judge };
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  expect(cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  const markOk = () => write(change('proposal.md'), `${FILES['proposal.md']}\nJUDGE-OK\n`);
  const judgeRun = (extra: NodeJS.ProcessEnv = {}) =>
    cli(['judge', '--gate', 'spec', '--change', 'add-farewell', '--json'], extra);
  const approve = () => cli(['approve', 'spec', '--change', 'add-farewell', '--json']);
  const next = () => cli(['next', '--change', 'add-farewell', '--json']).json().next;
  const requests = () => (fs.existsSync(log)
    ? read(log).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []);
  return { root, cli, markOk, judgeRun, approve, next, requests, change };
}

const COMMAND = { run: `node ${JUDGE}`, max_loops: 2 };

describe('B19: the judge gate', () => {
  it('negative: without a judge the gate works as before', () => {
    const p = project(undefined);
    expect(p.approve().code).toBe(0);
  }, 240000);

  it('until the judge passes, a person cannot approve; next asks the agent to run the judge', () => {
    const p = project(COMMAND);
    expect(p.approve().code).not.toBe(0);
    const before = p.next();
    expect(before.actor).toBe('agent');
    expect(before.cli).toContain('sdlc judge --gate spec');
  }, 240000);

  it('a failing verdict sends the rework instruction to the agent; a passing one lets the person approve', () => {
    const p = project(COMMAND);
    const failed = p.judgeRun({ CLAUDECODE: '1' });
    expect(failed.code).toBe(1);
    expect(failed.json().verdict).toMatchObject({ pass: false, route: 'author' });
    const rework = p.next();
    expect(rework.actor).toBe('agent');
    expect(JSON.stringify(rework)).toContain('Add JUDGE-OK');
    expect(p.approve().code).not.toBe(0);
    p.markOk();
    const passed = p.judgeRun({ CLAUDECODE: '1' });
    expect(passed.code, passed.stdout + passed.stderr).toBe(0);
    expect(passed.json().verdict.pass).toBe(true);
    expect(p.next().actor).toBe('human');
    const request = p.requests().at(-1);
    expect(request).toMatchObject({ change: 'add-farewell', gate: 'spec' });
    expect(request.rubric).toContain('RUBRIC-MARKER');
    expect(JSON.stringify(request.artifacts)).toContain('proposal.md');
    expect(p.approve().code).toBe(0);
  }, 300000);

  it('a changed artifact makes the passing verdict stale', () => {
    const p = project(COMMAND);
    p.markOk();
    expect(p.judgeRun().code).toBe(0);
    write(p.change('design.md'), `${FILES['design.md']}\nOne more decision.\n`);
    expect(p.approve().code).not.toBe(0);
    expect(p.next().cli).toContain('sdlc judge --gate spec');
  }, 300000);

  it('after max_loops failing verdicts the loop stops and a person decides; the judge never approves', () => {
    const p = project(COMMAND);
    expect(p.judgeRun().code).toBe(1);
    expect(p.next().actor).toBe('agent');
    write(p.change('design.md'), `${FILES['design.md']}\nA try.\n`);
    expect(p.judgeRun().code).toBe(1);
    const escalated = p.next();
    expect(escalated.actor).toBe('human');
    const status = p.cli(['status', '--change', 'add-farewell', '--json']).json();
    const spec = status.change.gates.find((gate: { id: string }) => gate.id === 'spec');
    expect(spec.status).not.toBe('approved');
    expect(p.approve().code).toBe(0);
  }, 300000);

  it('negative: an answer that is not a verdict is refused and records nothing', () => {
    const p = project(COMMAND);
    const garbage = p.judgeRun({ JUDGE_GARBAGE: '1' });
    expect(garbage.code).not.toBe(0);
    expect(garbage.json().status[0].code).toBe('judge_invalid_answer');
    expect(p.next().cli).toContain('sdlc judge --gate spec');
  }, 240000);

  it('a judge can be an MCP tool of the registry', () => {
    const p = project({ server: 'judges', tool: 'judge', max_loops: 2 });
    p.markOk();
    const r = p.judgeRun();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().verdict.pass).toBe(true);
    expect(p.approve().code).toBe(0);
  }, 300000);
});
