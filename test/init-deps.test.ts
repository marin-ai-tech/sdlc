import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askInitChoices, type Prompter } from '../src/commands/init-wizard.js';
import { initCommand } from '../src/commands/setup.js';
import { codegraphIndexCommand, detectDependencies, installCommand, type CommandResult, type DependencyStatus } from '../src/core/dependencies.js';
import { openspecPackageDir } from '../src/core/openspec-schema.js';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

const TTY = { stdinTTY: true, stdoutTTY: true };
const BUNDLED = JSON.parse(fs.readFileSync(path.join(openspecPackageDir()!, 'package.json'), 'utf-8')).version as string;
const OPENSPEC_INSTALL = ['npm', 'install', '-g', `@fission-ai/openspec@${BUNDLED}`];
const CODEGRAPH_INSTALL = ['npm', 'install', '-g', '@colbymchenry/codegraph'];

/** A probe that knows which tools are "on PATH" and records what was asked. */
function probe(found: Record<string, string>) {
  const calls: string[] = [];
  const fn = (command: string, args: string[]): CommandResult => {
    calls.push(`${command} ${args.join(' ')}`);
    return command in found ? { ok: true, output: found[command] } : { ok: false, output: `${command}: not found` };
  };
  return { fn, calls };
}

/** An installer that records commands (and whether settings were already written) instead of running npm. */
function installer(root: string, ok = true) {
  const calls: Array<{ command: string[]; cwd: string; settingsWritten: boolean }> = [];
  const fn = async (command: string[], cwd: string): Promise<CommandResult> => {
    calls.push({ command, cwd, settingsWritten: fs.existsSync(path.join(root, 'openspec/sdlc.yaml')) });
    return ok ? { ok: true, output: 'added 1 package' } : { ok: false, output: 'npm ERR! network unreachable' };
  };
  return { fn, calls };
}

function scripted(answers: { tools?: string[]; installOpenSpec?: boolean; installCodegraph?: boolean; index?: boolean; confirm?: boolean } = {}) {
  const asked: string[] = [];
  const said: string[] = [];
  const prompter: Prompter = {
    async checkbox(message, choices) {
      asked.push(`checkbox:${message}`);
      return (answers.tools ?? choices.filter((c) => c.checked).map((c) => c.value)) as never;
    },
    async select(message, _choices, initial) {
      asked.push(`select:${message}`);
      return initial as never;
    },
    async confirm(message, initial) {
      asked.push(`confirm:${message}`);
      if (/^install openspec cli\b/i.test(message)) return answers.installOpenSpec ?? initial;
      if (/^install codegraph\b/i.test(message)) return answers.installCodegraph ?? initial;
      if (/^index /i.test(message)) return answers.index ?? initial;
      if (/(write|confirm|settings)/i.test(message)) return answers.confirm ?? true;
      return initial;
    },
    async input(message, initial) {
      asked.push(`input:${message}`);
      return initial;
    },
    say(text) {
      said.push(text);
    },
  };
  return { prompter, asked, said };
}

function repo() {
  const root = tempDir('sdlc-deps-');
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Pat Lee']);
  git(root, ['config', 'user.email', 'pat@example.com']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

const missing = (): DependencyStatus[] => [
  { id: 'openspec', name: 'OpenSpec CLI', found: false, install: OPENSPEC_INSTALL },
  { id: 'codegraph', name: 'codegraph', found: false, install: CODEGRAPH_INSTALL, indexed: false },
];
const defaults = (dependencies?: DependencyStatus[]) =>
  ({ tools: ['claude' as const], mode: 'warn' as const, statusline: false, opsx: false, language: '', ...(dependencies ? { dependencies } : {}) });

afterEach(() => vi.restoreAllMocks());

describe('optional tools: detection and install commands', () => {
  it('OpenSpec is pinned to the bundled version; codegraph comes from npm', () => {
    expect(installCommand('openspec')).toEqual(OPENSPEC_INSTALL);
    expect(installCommand('codegraph')).toEqual(CODEGRAPH_INSTALL);
  });

  it('indexing connects codegraph only to the chosen tools, without its own prompts (a bare codegraph init picked Claude Code)', () => {
    expect(codegraphIndexCommand(['opencode'])).toEqual(['codegraph', 'install', '--target', 'opencode', '--location', 'local', '--yes', '--init']);
    expect(codegraphIndexCommand(['claude', 'opencode'])).toEqual(['codegraph', 'install', '--target', 'claude,opencode', '--location', 'local', '--yes', '--init']);
    expect(codegraphIndexCommand([])).toEqual(['codegraph', 'init', '--yes']);
  });

  it('missing tools are reported with their install command; only the PATH commands are probed', () => {
    const p = probe({});
    const status = detectDependencies(repo(), p.fn);
    expect(status.map((s) => [s.id, s.found])).toEqual([['openspec', false], ['codegraph', false]]);
    expect(status[0].install).toEqual(OPENSPEC_INSTALL);
    expect(p.calls).toEqual(['openspec --version', 'codegraph --version']);
  });

  it('found tools report their version; codegraph reports whether the project is indexed', () => {
    const root = repo();
    fs.mkdirSync(path.join(root, '.codegraph'));
    const status = detectDependencies(root, probe({ openspec: 'openspec 1.13.2\n', codegraph: 'codegraph v1.6.1' }).fn);
    expect(status[0]).toMatchObject({ found: true, version: '1.13.2' });
    expect(status[1]).toMatchObject({ found: true, version: '1.6.1', indexed: true });
  });
});

describe('the wizard offers what is missing', () => {
  it('asks to install each missing tool right after the tools question, then about the index; the summary shows the commands', async () => {
    const s = scripted({ installOpenSpec: true, installCodegraph: true, index: true });
    const choices = await askInitChoices(s.prompter, defaults(missing()));
    expect(choices).toMatchObject({ install: ['openspec', 'codegraph'], index: true });
    expect(s.asked.slice(0, 4).map((q) => q.split(':')[0])).toEqual(['checkbox', 'confirm', 'confirm', 'confirm']);
    expect(s.asked[1]).toMatch(/OpenSpec/);
    expect(s.asked[2]).toMatch(/codegraph/);
    expect(s.asked[3]).toMatch(/index/i);
    const summary = s.said.at(-1)!;
    expect(summary).toContain(OPENSPEC_INSTALL.join(' '));
    expect(summary).toContain(CODEGRAPH_INSTALL.join(' '));
  });

  it('negative: declining codegraph means no index question; declining both installs nothing', async () => {
    const s = scripted({ installOpenSpec: false, installCodegraph: false });
    const choices = await askInitChoices(s.prompter, defaults(missing()));
    expect(choices).toMatchObject({ install: [], index: false });
    expect(s.asked.some((q) => /^confirm:index /i.test(q))).toBe(false);
  });

  it('negative: tools that are found and indexed are not offered', async () => {
    const s = scripted();
    const found: DependencyStatus[] = [
      { id: 'openspec', name: 'OpenSpec CLI', found: true, version: '1.13.2', install: OPENSPEC_INSTALL },
      { id: 'codegraph', name: 'codegraph', found: true, version: '1.6.1', install: CODEGRAPH_INSTALL, indexed: true },
    ];
    await askInitChoices(s.prompter, defaults(found));
    expect(s.asked.some((q) => /^confirm:(install (openspec cli|codegraph)|index )/i.test(q))).toBe(false);
  });
});

describe('interactive init installs only what the person chose', () => {
  const quiet = () => {
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));
    return err;
  };

  it('yes to everything: the installs and the index run after the settings are written', async () => {
    const root = repo();
    const inst = installer(root);
    quiet();
    await initCommand(root, { hooks: true }, {
      prompter: scripted({ installOpenSpec: true, installCodegraph: true, index: true }).prompter,
      io: TTY, probe: probe({}).fn, installer: inst.fn,
    });
    expect(inst.calls.map((c) => c.command)).toEqual([OPENSPEC_INSTALL, CODEGRAPH_INSTALL, codegraphIndexCommand(['claude', 'opencode'])]);
    expect(inst.calls.every((c) => c.settingsWritten)).toBe(true);
    expect(path.resolve(inst.calls[2].cwd)).toBe(path.resolve(root));
  }, 120000);

  it('an OpenCode-only project indexes with codegraph for OpenCode only (no .claude)', async () => {
    const root = repo();
    const inst = installer(root);
    quiet();
    await initCommand(root, { hooks: true }, {
      prompter: scripted({ tools: ['opencode'], installOpenSpec: false, installCodegraph: false, index: true }).prompter,
      io: TTY, probe: probe({ codegraph: '1.6.1' }).fn, installer: inst.fn,
    });
    expect(inst.calls.map((c) => c.command)).toEqual([codegraphIndexCommand(['opencode'])]);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  }, 120000);

  it('negative: no to everything runs nothing', async () => {
    const root = repo();
    const inst = installer(root);
    quiet();
    await initCommand(root, { hooks: true }, {
      prompter: scripted({ installOpenSpec: false, installCodegraph: false }).prompter,
      io: TTY, probe: probe({}).fn, installer: inst.fn,
    });
    expect(inst.calls).toEqual([]);
    expect(fs.existsSync(path.join(root, 'openspec/sdlc.yaml'))).toBe(true);
  }, 120000);

  it('a failed install warns with the command to run by hand, and init still succeeds', async () => {
    const root = repo();
    const err = quiet();
    await initCommand(root, { hooks: true }, {
      prompter: scripted({ installOpenSpec: false, installCodegraph: true, index: false }).prompter,
      io: TTY, probe: probe({}).fn, installer: installer(root, false).fn,
    });
    expect(fs.existsSync(path.join(root, 'openspec/sdlc.yaml'))).toBe(true);
    expect(err.join('')).toContain(CODEGRAPH_INSTALL.join(' '));
    expect(process.exitCode ?? 0).toBe(0);
  }, 120000);

  it('negative: agent sessions and flags never probe, ask or install', async () => {
    for (const [opts, io] of [[{ hooks: true }, { ...TTY, agent: 'claude-code' }], [{ tools: 'claude', hooks: true }, TTY]] as const) {
      const root = repo();
      const p = probe({});
      const inst = installer(root);
      const s = scripted({ installOpenSpec: true, installCodegraph: true, index: true });
      quiet();
      await initCommand(root, opts, { prompter: s.prompter, io, probe: p.fn, installer: inst.fn });
      expect(p.calls).toEqual([]);
      expect(inst.calls).toEqual([]);
      expect(s.asked).toEqual([]);
    }
  }, 180000);
});

describe('sdlc doctor', () => {
  it('reports the OpenSpec CLI and codegraph with the command to install them when missing', () => {
    const root = repo();
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    const narrowPath = [path.dirname(process.execPath), ...(process.platform === 'win32' ? ['C:\\Windows\\System32'] : ['/usr/bin', '/bin'])]
      .join(path.delimiter);
    const r = runCli(['doctor', '--json'], root, { ...env, PATH: narrowPath, Path: narrowPath });
    const checks = r.json<{ checks: Array<{ check: string; status: string; fix?: string }> }>().checks;
    const cli = checks.find((c) => c.check === 'openspec cli');
    const cg = checks.find((c) => c.check === 'codegraph');
    expect(cli).toMatchObject({ status: 'warn' });
    expect(cli?.fix).toContain(OPENSPEC_INSTALL.join(' '));
    expect(cg).toMatchObject({ status: 'warn' });
    expect(cg?.fix).toContain(CODEGRAPH_INSTALL.join(' '));
  }, 120000);
});
