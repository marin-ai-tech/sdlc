import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Defects of the E2E team run of 2026-10-15 (TodoMVC with Qwen Code; protocol Н1, Н4, Н6, Н7, Н11, Н16):
 *
 * Н11: `sdlc backlog start B1` derived the change id from the title by Latin letters only, so a Russian title gave
 * an empty id and the error did not mention `--change`. Without Latin letters the id falls back to the item id
 * (`b1`); with some, they are used.
 * Н7: CLI events run in an agent session (`change.created`, `backlog.added`, …) carried the person's git identity
 * and no agent. Every log entry written by the CLI in an agent session records `agent`; a person's entries do not.
 * Н16: `sdlc audit` counted agent work only by the `SDLC-Agent` commit trailer (0 of 151 in the run, though agents
 * wrote most of the code). The audit also counts the log entries an agent made (`agentEvents` in JSON).
 * Н4: in a fresh clone `sdlc update` (needed only for the local git hook) rewrote `manifest.json` with the `license`
 * key moved and logged `harness.updated`, so every participant had a dirty tree. An update that changes no file
 * leaves the tree clean.
 * Н6: doctor always warned about Qwen Code's folder trust. Qwen Code 0.25 trusts every folder while
 * `security.folderTrust.enabled` is off (the default) and ignores the project's `.qwen/settings.json` — hooks and
 * `permissions.deny` — only in a folder it does not trust. Doctor reads `~/.qwen/settings.json` and
 * `~/.qwen/trustedFolders.json` (TRUST_FOLDER, TRUST_PARENT, DO_NOT_TRUST; the deepest rule wins).
 * Н1: `init --tools qwen` listed CLAUDE.md as missing and `layout adapt` created it, with AGENTS.md pointing to it.
 * The Claude Code guide belongs to projects with the `claude` tool only.
 */

const AGENT = { QWEN_CODE: '1' };

function project(tools = 'qwen') {
  const root = tempDir('sdlc-todomvc-findings-');
  const home = tempDir('sdlc-home-');
  const env = humanEnv(home);
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const init = cli(['init', '--tools', tools, '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const log = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; by?: string; agent?: string; change?: string });
  return { root, home, env, cli, log, file: (rel: string) => path.join(root, rel) };
}

describe('Н11: backlog start with a title without Latin letters', () => {
  it('a Russian title starts the change as b<n>; a mixed one keeps its Latin words', () => {
    const p = project();
    const add = (title: string) => p.cli(['backlog', 'add', title, '--outcome', 'O', '--accept', 'A', '--json']);
    expect(add('Названия задач обрезаются по краям').code).toBe(0);
    expect(add('Отмена удаления: undo для TodoMVC').code).toBe(0);
    const first = p.cli(['backlog', 'start', 'B1', '--json']);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.json<{ change: { id: string } }>().change.id).toBe('b1');
    expect(fs.existsSync(p.file('openspec/changes/b1/intent.md'))).toBe(true);
    const second = p.cli(['backlog', 'start', 'B2', '--json']);
    expect(second.json<{ change: { id: string } }>().change.id).toBe('undo-todomvc');
  }, 180000);

  it('negative: an explicit bad --change is still refused, and the refusal names --change', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', 'Задача', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    const bad = p.cli(['backlog', 'start', 'B1', '--change', 'Bad Name', '--json']);
    expect(bad.code).not.toBe(0);
    expect(bad.stdout + bad.stderr).toContain('--change');
    expect(fs.existsSync(p.file('openspec/changes/b1'))).toBe(false);
  }, 180000);
});

describe('Н7: the log names the agent of a CLI step', () => {
  it('a change and a backlog item made in an agent session record agent qwen; a person’s do not', () => {
    const p = project();
    expect(p.cli(['new', 'by-agent', '--json'], AGENT).code).toBe(0);
    expect(p.cli(['backlog', 'add', 'Agent item', '--json'], AGENT).code).toBe(0);
    expect(p.cli(['new', 'by-person', '--json']).code).toBe(0);
    const entries = p.log();
    const created = (change: string) => entries.find((e) => e.event === 'change.created' && e.change === change);
    expect(created('by-agent')?.agent).toBe('qwen');
    expect(created('by-agent')?.by).toBeDefined();
    expect(entries.find((e) => e.event === 'backlog.added')?.agent).toBe('qwen');
    expect(created('by-person')).toBeDefined();
    expect(created('by-person')?.agent).toBeUndefined();
    expect(entries.find((e) => e.event === 'harness.initialized')?.agent).toBeUndefined();
    const text = p.cli(['log']).stdout;
    const line = text.split('\n').find((l) => l.includes('change.created') && l.includes('by-agent')) ?? '';
    expect(line).toContain('qwen');
  }, 180000);
});

describe('Н16: the audit counts agent work in the log', () => {
  it('agentEvents counts the entries an agent made, next to the commit trailers', () => {
    const p = project();
    expect(p.cli(['new', 'by-agent', '--json'], AGENT).code).toBe(0);
    expect(p.cli(['new', 'by-person', '--json']).code).toBe(0);
    const audit = p.cli(['audit', '--json']);
    expect(audit.code, audit.stdout + audit.stderr).toBe(0);
    const events = audit.json<{ agentEvents: { agent: number; total: number; byAgent: Record<string, number> } }>()
      .agentEvents;
    expect(events.agent).toBeGreaterThanOrEqual(1);
    expect(events.byAgent.qwen).toBe(events.agent);
    expect(events.total).toBeGreaterThan(events.agent);
    expect(p.cli(['audit']).stdout).toMatch(/agent/i);
  }, 180000);
});

describe('Н4: sdlc update in a fresh clone leaves the tree clean', () => {
  it('the clone gets the git hook; manifest and log stay as committed', () => {
    const p = project();
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'adopt sdlc']);
    const clone = tempDir('sdlc-clone-');
    execFileSync('git', ['clone', '-q', p.root, clone]);
    expect(fs.existsSync(path.join(clone, '.git/hooks/prepare-commit-msg'))).toBe(false);
    const update = runCli(['update', '--json'], clone, p.env);
    expect(update.code, update.stdout + update.stderr).toBe(0);
    expect(fs.existsSync(path.join(clone, '.git/hooks/prepare-commit-msg'))).toBe(true);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: clone, encoding: 'utf8' });
    expect(status).toBe('');
  }, 180000);
});

describe('Н6: doctor reads Qwen Code folder trust', () => {
  const qwenCheck = (p: ReturnType<typeof project>) => {
    const homeEnv = { HOME: p.home, USERPROFILE: p.home };
    const doctor = p.cli(['doctor', '--json'], homeEnv).json<{ checks: { check: string; status: string; message: string }[] }>();
    return doctor.checks.find((c) => c.check === 'qwen');
  };
  const trust = (p: ReturnType<typeof project>, enabled: boolean | undefined, folders?: Record<string, string>) => {
    if (enabled !== undefined) {
      write(path.join(p.home, '.qwen/settings.json'), JSON.stringify({ security: { folderTrust: { enabled } } }));
    }
    if (folders) write(path.join(p.home, '.qwen/trustedFolders.json'), JSON.stringify(folders));
  };

  it('folder trust off (the default) or the folder trusted: ok', () => {
    const off = project();
    expect(qwenCheck(off)?.status).toBe('ok');
    const folder = project();
    trust(folder, true, { [folder.root]: 'TRUST_FOLDER' });
    expect(qwenCheck(folder)?.status).toBe('ok');
    const parent = project();
    trust(parent, true, { [path.dirname(parent.root)]: 'TRUST_FOLDER' });
    expect(qwenCheck(parent)?.status).toBe('ok');
    const viaChild = project();
    trust(viaChild, true, { [path.join(viaChild.root, 'src')]: 'TRUST_PARENT' });
    expect(qwenCheck(viaChild)?.status).toBe('ok');
  }, 240000);

  it('negative: trust on and the folder not trusted, or DO_NOT_TRUST deeper than a trusted parent: warn', () => {
    const none = project();
    trust(none, true, { [tempDir('sdlc-other-')]: 'TRUST_FOLDER' });
    const warned = qwenCheck(none);
    expect(warned?.status).toBe('warn');
    expect(warned?.message).toMatch(/not trusted/i);
    expect(warned?.message).toMatch(/permissions\.deny/);
    const denied = project();
    trust(denied, true, { [path.dirname(denied.root)]: 'TRUST_FOLDER', [denied.root]: 'DO_NOT_TRUST' });
    expect(qwenCheck(denied)?.status).toBe('warn');
  }, 240000);
});

describe('Н1: the Claude Code guide only with the claude tool', () => {
  it('a Qwen-only project: no claude-guide role, no CLAUDE.md, AGENTS.md names Qwen Code and not CLAUDE.md', () => {
    const p = project();
    const roles = p.cli(['layout', 'check', '--json']).json<{ roles: { role: string }[] }>().roles.map((r) => r.role);
    expect(roles).not.toContain('claude-guide');
    expect(roles).toContain('agents-guide');
    expect(p.cli(['layout', 'adapt', '--json']).code).toBe(0);
    expect(fs.existsSync(p.file('CLAUDE.md'))).toBe(false);
    const agents = read(p.file('AGENTS.md'));
    expect(agents).not.toContain('CLAUDE.md');
    expect(agents).not.toContain('Claude Code');
    expect(agents).toContain('Qwen Code');
    expect(read(p.file('README.md'))).not.toContain('CLAUDE.md');
  }, 180000);

  it('negative: with the claude tool the guide is created and linked as before', () => {
    const p = project('claude,qwen');
    expect(p.cli(['layout', 'adapt', '--json']).code).toBe(0);
    expect(fs.existsSync(p.file('CLAUDE.md'))).toBe(true);
    const agents = read(p.file('AGENTS.md'));
    expect(agents).toContain('CLAUDE.md');
    expect(agents).toContain('Claude Code');
    expect(agents).toContain('Qwen Code');
  }, 180000);
});
