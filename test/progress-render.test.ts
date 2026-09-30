import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

const TASKS = '# Tasks\n\n## 1. Work\n\n- [x] 1.1 First, verify it\n- [x] 1.2 Second, verify it\n- [ ] 1.3 Third, verify it\n- [ ] 1.4 Fourth, verify it\n';

function project() {
  const root = tempDir('sdlc-progress-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

describe('terminal rendering of stages and progress', () => {
  it('status --change draws a stage stepper and a task bar', () => {
    const { root, cli } = project();
    cli(['new', 'add-export']);
    write(path.join(root, 'openspec/changes/add-export/tasks.md'), TASKS);
    const out = cli(['status', '--change', 'add-export']).stdout;
    const stepper = out.split('\n').find((l) => /intent/.test(l) && /archive/.test(l) && /●/.test(l))!;
    expect(stepper).toBeDefined();
    expect(stepper.indexOf('intent')).toBeLessThan(stepper.indexOf('spec'));
    expect(stepper.indexOf('verify')).toBeLessThan(stepper.indexOf('review'));
    expect(stepper).toMatch(/intent ●/);
    expect(stepper).toMatch(/archive ○/);
    expect(out).toMatch(/[█▓#]+[░.-]+\s+2\/4/);
  });

  it('backlog list draws a progress bar per epic', () => {
    const { cli } = project();
    cli(['backlog', 'epic', 'add', 'Claims']);
    cli(['backlog', 'add', 'A', '--epic', 'E1', '--outcome', 'o', '--accept', 'a']);
    cli(['backlog', 'add', 'B', '--epic', 'E1']);
    cli(['backlog', 'done', 'B1', '--note', 'shipped']);
    const out = cli(['backlog', 'list']).stdout;
    expect(out.split('\n').find((l) => /E1/.test(l) && /Claims/.test(l))).toMatch(/[█▓#]+[░.-]+\s+1\/2/);
  });
});

describe('Mermaid in the markdown report', () => {
  it('draws the lifecycle of each active change and the backlog epics', () => {
    const { cli } = project();
    cli(['new', 'add-export']);
    cli(['backlog', 'epic', 'add', 'Claims "self" [service]']);
    cli(['backlog', 'add', 'A', '--epic', 'E1']);
    const md = cli(['report', '--format', 'md']).stdout;
    const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const all = blocks.join('\n');
    expect(all).toMatch(/add-export/);
    expect(all).toMatch(/Claims/);
  });

  it('negative: text from people cannot break the diagram syntax', () => {
    const { cli } = project();
    cli(['backlog', 'epic', 'add', 'Evil"] --> X["pwn']);
    cli(['backlog', 'add', 'A', '--epic', 'E1']);
    const md = cli(['report', '--format', 'md']).stdout;
    const all = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    expect(all).not.toContain('"] --> X["');
    expect(all).not.toMatch(/-->\s*X\[/);
  });
});
