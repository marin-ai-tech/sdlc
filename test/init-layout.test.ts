import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { Prompter } from '../src/commands/init-wizard.js';
import { initCommand } from '../src/commands/setup.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const TTY = { stdinTTY: true, stdoutTTY: true };
const AGENT = { CLAUDECODE: '1' };
const README = '# Claims\n\nOur project.\n';

/** A folder with only the files that do not count: README, LICENSE, .gitignore. */
function emptyFolder(withGit: boolean) {
  const root = tempDir('sdlc-init-empty-');
  if (withGit) initGitRepo(root);
  write(path.join(root, 'README.md'), README);
  write(path.join(root, 'LICENSE'), 'MIT\n');
  write(path.join(root, '.gitignore'), 'node_modules/\n');
  return root;
}

/** An existing project: code, an architecture document under an alias name, one commit, one uncommitted note. */
function existingProject() {
  const root = tempDir('sdlc-init-existing-');
  initGitRepo(root);
  write(path.join(root, 'README.md'), README);
  write(path.join(root, 'ARCHITECTURE.md'), '# Architecture\n\nModules: api, worker.\n');
  write(path.join(root, 'src/index.js'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'existing project']);
  write(path.join(root, 'notes.txt'), 'uncommitted\n');
  return root;
}

const cliIn = (root: string) => (args: string[], extra: NodeJS.ProcessEnv = {}) =>
  runCli(args, root, humanEnv(tempDir('sdlc-home-'), extra));

const gitOut = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout.trim();
const exists = (...parts: string[]) => fs.existsSync(path.join(...parts));

describe('init in an empty folder makes it AI-ready', () => {
  it('--layout scaffold creates the agent documents and keeps the files that were there', () => {
    const root = emptyFolder(true);
    const r = cliIn(root)(['init', '--tools', 'opencode', '--layout', 'scaffold', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.json().layout).toMatchObject({ folder: 'empty', action: 'scaffold' });
    expect(r.json().layout.created).toContain('AGENTS.md');
    expect(exists(root, 'AGENTS.md')).toBe(true);
    expect(read(path.join(root, 'README.md'))).toBe(README);
    expect(cliIn(root)(['layout', 'check', '--json']).json().ready).toBe(true);
  }, 120000);

  it('--git-init creates the repository; without it a non-interactive init does not', () => {
    const withFlag = emptyFolder(false);
    expect(cliIn(withFlag)(['init', '--tools', 'none', '--git-init', '--json']).code).toBe(0);
    expect(exists(withFlag, '.git')).toBe(true);
    const without = emptyFolder(false);
    expect(cliIn(without)(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(exists(without, '.git')).toBe(false);
  }, 120000);

  it('an agent may scaffold: nothing is committed', () => {
    const root = emptyFolder(true);
    const r = cliIn(root)(['init', '--tools', 'none', '--layout', 'scaffold', '--json'], AGENT);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(exists(root, 'AGENTS.md')).toBe(true);
  }, 120000);
});

describe('init in an existing project: diagnosis first', () => {
  it('without --layout it reports what differs from the AI-ready layout and changes no document', () => {
    const root = existingProject();
    const r = cliIn(root)(['init', '--tools', 'none', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const layout = r.json().layout;
    expect(layout).toMatchObject({ folder: 'existing', action: 'none' });
    expect(layout.diagnosis.missing).toContain('agents-guide');
    expect(layout.diagnosis.aliases).toContainEqual({ role: 'architecture', path: 'ARCHITECTURE.md' });
    expect(layout.diagnosis.missing).not.toContain('architecture');
    expect(exists(root, 'AGENTS.md')).toBe(false);
    const text = cliIn(existingProject())(['init', '--tools', 'none']).stdout;
    expect(text).toContain('ARCHITECTURE.md');
    expect(text).toContain('--layout worktree');
  }, 120000);

  it('--layout adapt records the existing documents where they are and creates the missing ones', () => {
    const root = existingProject();
    expect(cliIn(root)(['init', '--tools', 'none', '--layout', 'adapt', '--json']).code).toBe(0);
    expect(exists(root, 'AGENTS.md')).toBe(true);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).layout.architecture).toBe('ARCHITECTURE.md');
  }, 120000);

  it('--layout worktree builds the AI-ready project in a new worktree and leaves the main copy untouched', () => {
    const root = existingProject();
    const target = path.join(tempDir('sdlc-init-wt-'), 'claims-ai-ready');
    const statusBefore = gitOut(root, ['status', '--porcelain']);
    const r = cliIn(root)(['init', '--tools', 'opencode', '--layout', 'worktree', '--worktree', target, '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.json().layout).toMatchObject({ folder: 'existing', action: 'worktree' });
    expect(r.json().layout.worktree).toMatchObject({ path: target, branch: 'sdlc/ai-ready' });
    // main copy: nothing written, the uncommitted note still only here
    expect(exists(root, 'openspec')).toBe(false);
    expect(exists(root, 'AGENTS.md')).toBe(false);
    expect(gitOut(root, ['status', '--porcelain'])).toBe(statusBefore);
    // worktree: sdlc installed, documents at canonical places, everything committed by the person
    expect(exists(target, 'openspec/sdlc.yaml')).toBe(true);
    expect(exists(target, '.opencode')).toBe(true);
    expect(exists(target, 'AGENTS.md')).toBe(true);
    expect(exists(target, 'docs/architecture.md')).toBe(true);
    expect(exists(target, 'ARCHITECTURE.md')).toBe(false);
    expect(exists(target, 'notes.txt')).toBe(false);
    expect(gitOut(target, ['status', '--porcelain'])).toBe('');
    expect(gitOut(target, ['log', '-1', '--format=%ae'])).toBe('pat@example.com');
    expect(gitOut(root, ['branch', '--list', 'sdlc/ai-ready'])).toContain('sdlc/ai-ready');
  }, 180000);

  it('negative: an agent cannot create the worktree, and nothing is left behind', () => {
    const root = existingProject();
    const target = path.join(tempDir('sdlc-init-wt-'), 'claims-ai-ready');
    const r = cliIn(root)(['init', '--tools', 'none', '--layout', 'worktree', '--worktree', target, '--json'], AGENT);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_commit');
    expect(exists(target)).toBe(false);
    expect(exists(root, 'openspec')).toBe(false);
    expect(gitOut(root, ['branch', '--list', 'sdlc/ai-ready'])).toBe('');
  }, 120000);

  it('negative: a worktree needs a path and a git repository with a commit', () => {
    const root = existingProject();
    const noPath = cliIn(root)(['init', '--tools', 'none', '--layout', 'worktree', '--json']);
    expect(noPath.code).toBe(1);
    expect(noPath.json().status[0].code).toBe('invalid_option');
    expect(exists(root, 'openspec')).toBe(false);
    const plain = tempDir('sdlc-init-nogit-');
    write(path.join(plain, 'src/index.js'), 'x\n');
    const target = path.join(tempDir('sdlc-init-wt-'), 'x');
    const noGit = cliIn(plain)(['init', '--tools', 'none', '--layout', 'worktree', '--worktree', target, '--json']);
    expect(noGit.code).toBe(1);
    expect(noGit.json().status[0].code).toBe('git_required');
    expect(exists(plain, 'openspec')).toBe(false);
  }, 120000);

  it('negative: an unknown --layout value is refused before anything is written', () => {
    const root = existingProject();
    const r = cliIn(root)(['init', '--tools', 'none', '--layout', 'everything', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('invalid_option');
    expect(exists(root, 'openspec')).toBe(false);
  }, 60000);
});

/** Scripted answers by question topic; records every question. */
function scripted(answers: { git?: boolean; layout?: string; worktree?: string }) {
  const asked: string[] = [];
  const said: string[] = [];
  const prompter: Prompter = {
    async checkbox(message, choices) {
      asked.push(`checkbox:${message}`);
      return choices.filter((c) => c.checked).map((c) => c.value) as never;
    },
    async select(message, choices, initial) {
      asked.push(`select:${message}`);
      if (/AI-ready/i.test(message) && answers.layout) return answers.layout as never;
      return (initial ?? choices[0].value) as never;
    },
    async confirm(message, initial) {
      asked.push(`confirm:${message}`);
      if (/install|codegraph/i.test(message)) return false;
      if (/\bgit\b/i.test(message) && answers.git !== undefined) return answers.git;
      return initial;
    },
    async input(message, initial) {
      asked.push(`input:${message}`);
      if (/worktree/i.test(message) && answers.worktree) return answers.worktree;
      return initial;
    },
    say(text) {
      said.push(text);
    },
  };
  return { prompter, asked, said };
}

/** The real terminal flow with installs answered no and the installer stubbed: a test never runs npm. */
function wizardDeps(prompter: Prompter) {
  const installer = async () => ({ ok: true, output: '' });
  return { prompter, io: TTY, installer };
}

function quiet(): void {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}

afterEach(() => vi.restoreAllMocks());

describe('the init wizard', () => {
  it('in an empty folder offers git and makes the folder AI-ready without asking about the layout', async () => {
    const root = emptyFolder(false);
    const s = scripted({ git: true });
    quiet();
    await initCommand(root, { hooks: true }, wizardDeps(s.prompter));
    expect(s.asked.some((q) => /^confirm:.*\bgit\b/i.test(q))).toBe(true);
    expect(s.asked.some((q) => /^select:.*AI-ready/i.test(q))).toBe(false);
    expect(exists(root, '.git')).toBe(true);
    expect(exists(root, 'AGENTS.md')).toBe(true);
  }, 120000);

  it('negative: in a folder that already has git, no git question is asked', async () => {
    const root = emptyFolder(true);
    const s = scripted({});
    quiet();
    await initCommand(root, { hooks: true }, wizardDeps(s.prompter));
    expect(s.asked.some((q) => /^confirm:.*\bgit\b/i.test(q))).toBe(false);
    expect(exists(root, 'AGENTS.md')).toBe(true);
  }, 120000);

  it('in an existing project shows the diagnosis, then builds the worktree the person names', async () => {
    const root = existingProject();
    const target = path.join(tempDir('sdlc-init-wt-'), 'claims-ai-ready');
    const s = scripted({ layout: 'worktree', worktree: target });
    quiet();
    await initCommand(root, { hooks: true }, wizardDeps(s.prompter));
    const diagnosis = s.said.findIndex((text) => text.includes('ARCHITECTURE.md'));
    const question = s.asked.findIndex((q) => /^select:.*AI-ready/i.test(q));
    expect(diagnosis, 'the diagnosis is shown').toBeGreaterThanOrEqual(0);
    expect(question, 'the layout question is asked').toBeGreaterThanOrEqual(0);
    expect(s.said[diagnosis]).toContain('AGENTS.md');
    expect(exists(target, 'AGENTS.md')).toBe(true);
    expect(exists(target, 'docs/architecture.md')).toBe(true);
    expect(exists(root, 'openspec')).toBe(false);
  }, 180000);

  it('negative: choosing to skip leaves the documents as they are', async () => {
    const root = existingProject();
    const s = scripted({ layout: 'none' });
    quiet();
    await initCommand(root, { hooks: true }, wizardDeps(s.prompter));
    expect(exists(root, 'openspec/sdlc.yaml')).toBe(true);
    expect(exists(root, 'AGENTS.md')).toBe(false);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
  }, 120000);
});
