import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseConfig } from '../src/core/config.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B298 (E25, change verify-check-names): a verify command without an explicit name was named by its first word
 * (`npm run typecheck`, `npm test` and `npm run lint` were all `npm`), and names were never checked for uniqueness.
 * A nameless check now gets a name from what it runs, derived names are made distinct, explicit names are kept, and
 * two equal explicit names stop `sdlc verify` (and show in `sdlc doctor`) without breaking the configuration.
 */

type Raw = Record<string, unknown>;

function names(commands: unknown[], mcp?: unknown[]): string[] {
  const verify: Raw = { commands };
  if (mcp) verify.mcp = mcp;
  return parseConfig({ version: 1, verify }).verify.commands.map((command) => command.name);
}

const MCP_TEST = { name: 'test', server: 'github', tool: 'list_runs' };

function project(commands: unknown[]) {
  const root = tempDir('sdlc-check-names-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  const init = cli(['init', '--tools', 'none', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const file = path.join(root, 'openspec', 'sdlc.yaml');
  const config = parse(read(file)) as Raw;
  config.verify = { ...(config.verify as Raw), commands };
  write(file, stringify(config));
  return { root, cli };
}

function doctorChecks(cli: (args: string[]) => ReturnType<typeof runCli>): Array<Record<string, string>> {
  const doctor = cli(['doctor', '--json']);
  return (doctor.json<{ checks?: Array<Record<string, string>> }>().checks ?? []);
}

describe('B298: a check without a name is named by what it runs', () => {
  it('N1 npm scripts get their own names', () => {
    const commands = ['npm run typecheck', 'npm test', 'npm run test:e2e', 'npm run lint'];
    expect(names(commands)).toEqual(['typecheck', 'test', 'test:e2e', 'lint']);
  });

  it('N2 tools, files, modules, make targets; leading assignments are skipped', () => {
    const commands = [
      'npx vitest run', 'pnpm exec eslint .', 'node scripts/check-links.mjs', 'python -m pytest -q', 'make check',
      'CI=1 npm test',
    ];
    expect(names(commands)).toEqual(['vitest', 'eslint', 'check-links', 'pytest', 'check', 'test']);
  });

  it('N3 an inline script keeps the program name; an object without a name is derived the same way', () => {
    expect(names(['node -e "process.exit(0)"'])).toEqual(['node']);
    expect(names([{ run: 'npm run lint' }])).toEqual(['lint']);
  });

  it('N4 a scoped and versioned npx tool loses its scope and version', () => {
    expect(names(['npx @biomejs/biome@1.9.4 check .'])).toEqual(['biome']);
  });
});

describe('B298: check names are distinct', () => {
  it('D1 two runs of the same file', () => {
    const commands = ['node scripts/test-shards.mjs --shard 1/2', 'node scripts/test-shards.mjs --shard 2/2'];
    expect(names(commands)).toEqual(['test-shards', 'test-shards-2']);
  });

  it('D2 an explicit name wins wherever it stands', () => {
    expect(names(['npm test', { name: 'test', run: 'node t.js' }])).toEqual(['test-2', 'test']);
  });

  it('D3 an MCP check name is taken', () => {
    expect(names(['npm test'], [MCP_TEST])).toEqual(['test-2']);
  });

  it('D4 an explicit name is never changed, even when it collides', () => {
    expect(names([{ name: 'unit', run: 'npm test' }])).toEqual(['unit']);
    const both = [{ name: 'unit', run: 'npm test' }, { name: 'unit', run: 'npm run lint' }];
    expect(() => names(both)).not.toThrow();
    expect(names(both)).toEqual(['unit', 'unit']);
  });

  it('D5 negative: the old first-word name never appears for npm commands', () => {
    expect(names(['npm run typecheck', 'npm test'])).not.toContain('npm');
  });
});

describe('B298: the CLI', () => {
  it('C1 verify --list shows distinct derived names', () => {
    const p = project(['node a.js', 'node b.js', 'npm test']);
    const list = p.cli(['verify', '--list', '--json']);
    expect(list.code, list.stdout + list.stderr).toBe(0);
    const listed = list.json<{ commands: Array<{ name: string }> }>().commands.map((command) => command.name);
    expect(listed).toEqual(['a', 'b', 'test']);
  });

  it('C2 two equal explicit names stop verify before any check runs and show in doctor', () => {
    const mark = 'require("fs").writeFileSync("ran.txt", "x")';
    const p = project([
      { name: 'unit', run: `node -e "${mark.replace(/"/g, '\\"')}"` },
      { name: 'unit', run: 'node -e "process.exit(0)"' },
    ]);
    const status = p.cli(['status', '--json']);
    expect(status.code, status.stdout + status.stderr).toBe(0);
    const verify = p.cli(['verify', '--json']);
    expect(verify.code).not.toBe(0);
    const diagnostic = verify.json<{ status: Array<{ code: string; message: string }> }>().status[0];
    expect(diagnostic.code).toBe('duplicate_check_names');
    expect(diagnostic.message).toContain('verify.commands[0]');
    expect(diagnostic.message).toContain('verify.commands[1]');
    expect(fs.existsSync(path.join(p.root, 'ran.txt'))).toBe(false);
    const named = doctorChecks(p.cli).filter((check) => check.check.startsWith('verify names'));
    expect(named).toHaveLength(1);
    expect(named[0].status).toBe('error');
    expect(named[0].message).toContain('unit');
  });

  it('C3 negative: distinct names give no doctor finding', () => {
    const p = project([{ name: 'unit', run: 'node a.js' }, 'npm test']);
    const named = doctorChecks(p.cli).filter((check) => check.check.startsWith('verify names'));
    expect(named).toEqual([]);
  });
});

/** Review round 1 of B298 (Codex c-20261118-170612-b380): findings F1-F5. */

function parsed(commands: unknown[], mcp: unknown[]) {
  const config = parseConfig({ version: 1, verify: { commands, mcp } });
  const mcpNames = (config.verify.mcp ?? []).map((check) => check.name);
  return { commands: config.verify.commands.map((command) => command.name), mcp: mcpNames };
}

const MCP_PLAIN = { server: 'github', tool: 'list_runs' };

describe('B298 review round 1: an unnamed MCP check takes a free name (F1)', () => {
  it('R1a an explicit mcp-2 keeps its name and the unnamed check after it gets another one', () => {
    const { mcp } = parsed([], [{ ...MCP_PLAIN, name: 'mcp-2' }, MCP_PLAIN]);
    expect(mcp[0]).toBe('mcp-2');
    expect(mcp[1]).not.toBe('mcp-2');
    expect(new Set(mcp).size).toBe(2);
  });

  it('R1b an explicit command name is never taken by an unnamed MCP check', () => {
    const result = parsed([{ name: 'mcp-1', run: 'node a.js' }], [MCP_PLAIN]);
    expect(result.commands).toEqual(['mcp-1']);
    expect(result.mcp).not.toContain('mcp-1');
  });

  it('R1c negative: an unnamed MCP check alone keeps its old name', () => {
    expect(parsed([], [MCP_PLAIN]).mcp).toEqual(['mcp-1']);
  });
});

function projectWithChange(commands: unknown[]) {
  const p = project(commands);
  const created = p.cli(['new', 'add-names', '--json']);
  expect(created.code, created.stdout + created.stderr).toBe(0);
  const evidence = path.join(p.root, 'openspec', 'changes', 'add-names', 'verification.md');
  return { ...p, evidence };
}

describe('B298 review round 1: an --only name that matches no check is refused (F2)', () => {
  it('R2a an old check-1 selector stops verify before a run and lists the names there are', () => {
    const p = projectWithChange(['node -e "process.exit(0)"']);
    const verify = p.cli(['verify', '--change', 'add-names', '--only', 'check-1', '--json']);
    expect(verify.code).not.toBe(0);
    const diagnostic = verify.json<{ status: Array<{ code: string; message: string }> }>().status[0];
    expect(diagnostic.code).toBe('unknown_check_names');
    expect(diagnostic.message).toContain('check-1');
    expect(diagnostic.message).toContain('node');
    expect(fs.existsSync(p.evidence)).toBe(false);
  }, 120000);

  it('R2b one unknown name among known ones is refused and named alone', () => {
    const p = projectWithChange(['node -e "process.exit(0)"']);
    const verify = p.cli(['verify', '--change', 'add-names', '--only', 'node,check-1', '--json']);
    expect(verify.code).not.toBe(0);
    const diagnostic = verify.json<{ status: Array<{ code: string; message: string }> }>().status[0];
    expect(diagnostic.code).toBe('unknown_check_names');
    expect(diagnostic.message).toContain('check-1');
    expect(fs.existsSync(p.evidence)).toBe(false);
  }, 120000);

  it('R2c negative: a known name runs as before', () => {
    const p = projectWithChange(['node -e "process.exit(0)"']);
    const verify = p.cli(['verify', '--change', 'add-names', '--only', 'node', '--json']);
    expect(verify.code, verify.stdout + verify.stderr).toBe(0);
    expect(fs.existsSync(p.evidence)).toBe(true);
  }, 120000);
});

function gitPack(checks: unknown[]): { url: string; commit: string } {
  const dir = tempDir('sdlc-names-pack-');
  initGitRepo(dir);
  write(path.join(dir, 'checks.yaml'), stringify({ verify: checks }));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'pack']);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
  return { url: `file:///${dir.replace(/\\/g, '/').replace(/^\//, '')}`, commit };
}

function projectWithPack(commands: unknown[]) {
  const pack = gitPack([{ name: 'unit', run: 'node -e "process.exit(0)"' }]);
  const p = project(commands);
  const file = path.join(p.root, 'openspec', 'sdlc.yaml');
  const config = parse(read(file)) as Raw;
  config.packs = [{ name: 'corp', git: pack.url, ref: pack.commit }];
  write(file, stringify(config));
  const sync = p.cli(['team', 'sync', '--json']);
  expect(sync.code, sync.stdout + sync.stderr).toBe(0);
  const accept = p.cli(['team', 'accept', '--pack', 'corp', '--json']);
  expect(accept.code, accept.stdout + accept.stderr).toBe(0);
  return p;
}

describe('B298 review round 1: a pack check name is checked like the others (F3)', () => {
  it('R3a a project check named like an accepted pack check shows in doctor; verify names the pack', () => {
    const p = projectWithPack([{ name: 'corp/unit', run: 'node -e "process.exit(0)"' }]);
    const named = doctorChecks(p.cli).filter((check) => check.check.startsWith('verify names'));
    expect(named).toHaveLength(1);
    expect(named[0].message).toContain('corp/unit');
    const verify = p.cli(['verify', '--json']);
    expect(verify.code).not.toBe(0);
    const diagnostic = verify.json<{ status: Array<{ code: string; message: string }> }>().status[0];
    expect(diagnostic.code).toBe('duplicate_check_names');
    expect(diagnostic.message).toContain('verify.commands[0]');
    expect(diagnostic.message).toContain('corp');
    expect(diagnostic.message).not.toContain('verify.commands[1]');
  }, 300000);

  it('R3b negative: a project check named like the pack check without the pack prefix is no finding', () => {
    const p = projectWithPack([{ name: 'unit', run: 'node -e "process.exit(0)"' }]);
    const named = doctorChecks(p.cli).filter((check) => check.check.startsWith('verify names'));
    expect(named).toEqual([]);
  }, 300000);
});

describe('B298 review round 1: derived names (F4, F5)', () => {
  it('R4 a script name keeps its own hyphens', () => {
    expect(names(['npm run lint--strict'])).toEqual(['lint--strict']);
  });

  it('R5 an env prefix and the package manager\'s own options are skipped', () => {
    const commands = ['env CI=1 npm test', 'npm --silent run lint', 'npm --prefix web run build'];
    expect(names(commands)).toEqual(['test', 'lint', 'build']);
  });
});
