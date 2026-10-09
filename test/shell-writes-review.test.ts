import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { shellWriteDestinations } from '../src/core/policy-shell-writes.js';
import { projectPaths } from '../src/core/project.js';
import { registryServerTable, setMcpTables } from '../src/integrations/codex-toml.js';
import { tempDir, write } from './helpers.js';

/**
 * 0.14.0 review of B82 (shell writes under the plan gate): text inside quotes and here-strings is content, not
 * commands; the common writers Codex uses on Windows are writes; pushd/popd are followed; an apply_patch run through
 * the shell is read; Codex's user-level files are guarded; shell writes respect protected paths.
 */

function dests(command: string, cwd = ''): string[] {
  const root = tempDir('sdlc-shell-writes-');
  return shellWriteDestinations(command, root, path.join(root, cwd)).sort();
}

describe('quoted text is content, not commands', () => {
  const cases: Array<[string, string[]]> = [
    ["Set-Content -LiteralPath 'openspec/changes/demo/intent.md' -Value 'Users -> admins'",
      ['openspec/changes/demo/intent.md']],
    ["Set-Content -Path 'openspec/x.md' -Value \"line one\n> Note\nCopy a b\nMove c d\"", ['openspec/x.md']],
    ["Set-Content openspec/x.md @\"\n<div>x</div>\ntee src/a.ts\n\"@", ['openspec/x.md']],
    ["Set-Content openspec/x.md @'\nUsers -> admins\n'@", ['openspec/x.md']],
    ['git commit -m "a -> b"', []],
    ['node -e "[1].map(x => x)"', []],
    ['rg "a > b" src', []],
    ["echo 'x' > 'src/my file.ts'", ['src/my file.ts']],
  ];
  for (const [command, expected] of cases) {
    it(JSON.stringify(command), () => {
      expect(dests(command)).toEqual(expected);
    });
  }
});

describe('the common writers are writes', () => {
  const cases: Array<[string, string[]]> = [
    ["[IO.File]::WriteAllText('src/a.ts', 'x')", ['src/a.ts']],
    ['[System.IO.File]::AppendAllText("src/a.ts", "x")', ['src/a.ts']],
    ['sc src/a.ts x', ['src/a.ts']],
    ["'x' | Tee-Object -FilePath src/a.ts", ['src/a.ts']],
    ['Rename-Item src/old.ts new.ts', ['src/new.ts', 'src/old.ts']],
    ['Set-Content -Pa src/a.ts -Va x', ['src/a.ts']],
    ['Copy-Item x.ts -Dest src/a.ts', ['src/a.ts']],
    ["'x' | Out-File -FileP src/a.ts", ['src/a.ts']],
    ['& { Set-Content src/a.ts x }', ['src/a.ts']],
    ['if (1) { Set-Content src/a.ts x }', ['src/a.ts']],
    ["sed -i 's/a/b/' src/a.ts", ['src/a.ts']],
    ["perl -pi -e 's/a/b/' src/a.ts", ['src/a.ts']],
    ['touch src/a.ts', ['src/a.ts']],
    ['truncate -s 0 src/a.ts', ['src/a.ts']],
    ['dd if=/dev/zero of=src/a.ts count=1', ['src/a.ts']],
  ];
  for (const [command, expected] of cases) {
    it(command, () => {
      expect(dests(command)).toEqual(expected);
    });
  }

  it('negative: reads and searches stay no targets', () => {
    for (const command of ['sed -n 1,5p src/a.ts', "sed 's/a/b/' src/a.ts", 'Get-Content src/a.ts',
      '[IO.File]::ReadAllText("src/a.ts")', 'Select-String -Path src/a.ts -Pattern x', 'cat src/a.ts']) {
      expect(dests(command), command).toEqual([]);
    }
  });
});

describe('the directory is followed', () => {
  it('pushd/popd and Push-Location/Pop-Location', () => {
    expect(dests('pushd openspec; popd; echo x > src/a.ts')).toEqual(['src/a.ts']);
    expect(dests('Push-Location openspec; Pop-Location; Set-Content src/a.ts x')).toEqual(['src/a.ts']);
    expect(dests('pushd openspec && echo x > notes.md')).toEqual(['openspec/notes.md']);
  });
});

describe('an apply_patch run through the shell', () => {
  it('its files are targets', () => {
    const command = "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: src/a.ts\n+x\n*** End Patch\nEOF";
    expect(dests(command)).toEqual(['src/a.ts']);
  });

  it('negative: another here-document body is still text', () => {
    expect(dests("cat > openspec/x.md <<'EOF'\n*** Add File: src/a.ts\nEOF")).toEqual(['openspec/x.md']);
  });
});

function policy() {
  const root = tempDir('sdlc-shell-writes-policy-');
  const home = tempDir('sdlc-shell-writes-home-');
  write(path.join(root, 'src/app.js'), 'a\n');
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  config.enforcement.protectedPaths = ['infra/**'];
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const ctx = { paths: projectPaths(root), config, env };
  const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
  const edit = (file: string) => evaluateToolCall(normalizeToolCall('Write', { file_path: file }, root), ctx);
  return { root, home: home.replace(/\\/g, '/'), shell, edit };
}

describe("Codex's user-level files are the guard's configuration", () => {
  it('an agent cannot write ~/.codex/config.toml or hooks.json, by shell or by edit', () => {
    const p = policy();
    const deny = { decision: 'deny', rule: 'guard-config' };
    expect(p.shell(`Add-Content ${p.home}/.codex/config.toml 'x'`)).toMatchObject(deny);
    expect(p.shell("Set-Content ~/.codex/hooks.json '{}'")).toMatchObject(deny);
    expect(p.edit(`${p.home}/.codex/config.toml`)).toMatchObject(deny);
  });

  it('CODEX_HOME is followed', () => {
    const p = policy();
    const other = tempDir('sdlc-codex-home-').replace(/\\/g, '/');
    const root = tempDir('sdlc-shell-writes-policy-');
    const config = defaultConfig();
    config.enforcement.requireApprovedPlan = false;
    const env = { HOME: p.home, USERPROFILE: p.home, CODEX_HOME: other };
    const ctx = { paths: projectPaths(root), config, env };
    const call = normalizeToolCall('Write', { file_path: `${other}/config.toml` }, root);
    expect(evaluateToolCall(call, ctx)).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it('negative: other files under ~/.codex stay writable', () => {
    const p = policy();
    expect(p.edit(`${p.home}/.codex/AGENTS.md`).decision).not.toBe('deny');
  });
});

describe('shell writes respect protected paths', () => {
  it('a write to a protected path through the shell is denied like an edit', () => {
    const p = policy();
    expect(p.edit('infra/x.tf')).toMatchObject({ decision: 'deny', rule: 'protected-path' });
    expect(p.shell("Set-Content infra/x.tf 'x'")).toMatchObject({ decision: 'deny', rule: 'protected-path' });
    expect(p.shell('echo x > infra/x.tf')).toMatchObject({ decision: 'deny', rule: 'protected-path' });
  });

  it('negative: reading a protected path is allowed', () => {
    expect(policy().shell('cat infra/x.tf').decision).toBe('allow');
  });
});

describe("PowerShell's all-streams redirect", () => {
  it('npm test *> $null is not a write to the project', () => {
    expect(policy().shell('npm test *> $null').decision).toBe('allow');
  });
});

describe("Codex's TOML", () => {
  it("a person's comment before the next table survives replacing and removing sdlc's table", () => {
    const text = '[mcp_servers.sdlc]\ncommand = "sdlc"\n\n# my server\n[mcp_servers.mine]\ncommand = "x"\n';
    const replaced = setMcpTables(text, { sdlc: '[mcp_servers.sdlc]\ncommand = "npx"' });
    expect(replaced).toContain('# my server\n[mcp_servers.mine]');
    expect(setMcpTables(text, { sdlc: undefined })).toContain('# my server\n[mcp_servers.mine]');
  });

  it('U+007F is escaped in strings', () => {
    const table = registryServerTable({ name: 'x', type: 'stdio', command: ['a\u007fb'], env: {} } as never);
    expect(table).not.toContain('\u007f');
    expect(table).toContain('\\u007F');
  });
});

/** Review follow-up: cases a first fix broke or missed. */
describe('follow-up: no new false positives', () => {
  for (const command of ['npm test 2>&1', 'git status 2>&1', 'npx vitest run > /dev/null 2>&1', 'node x.js 2>&-',
    'npm test 1>&2', 'npm test *>&1']) {
    it(command, () => {
      expect(dests(command)).toEqual([]);
    });
  }
});

describe('follow-up: no new bypasses', () => {
  const cases: Array<[string, string[]]> = [
    ["echo 'x\\' > src/a.ts", ['src/a.ts']],
    ["Write-Output 'C:\\tmp\\'; echo x > src/a.ts", ['src/a.ts']],
    ['New-Item -ItemType File src/a.ts', ['src/a.ts']],
    ['Set-Content -Encoding utf8 src/a.ts x', ['src/a.ts']],
    ['try { Set-Content src/a.ts x } catch { }', ['src/a.ts']],
    ['if (Test-Path x) { Set-Content src/a.ts x }', ['src/a.ts']],
    ['if ($a) { Get-Content x } else { Set-Content src/a.ts x }', ['src/a.ts']],
    ['foreach ($f in $files) { Set-Content src/a.ts x }', ['src/a.ts']],
    ['bash -c "echo x > src/a.ts"', ['src/a.ts']],
    ["sh -c 'cp b.ts src/a.ts'", ['src/a.ts']],
    ['cmd /c "echo x > src\\a.ts"', ['src/a.ts']],
    ['powershell -Command "Set-Content src/a.ts x"', ['src/a.ts']],
    ["pwsh -c 'Set-Content src/a.ts x'", ['src/a.ts']],
    ["sed -i.bak 's/a/b/' src/a.ts", ['src/a.ts']],
    ['echo "x <<EOF" > src/a.ts', ['src/a.ts']],
  ];
  for (const [command, expected] of cases) {
    it(command, () => {
      expect(dests(command)).toEqual(expected);
    });
  }

  it('negative: a message that only mentions a shell is still text', () => {
    expect(dests('git commit -m "run bash -c \'echo x > src/a.ts\' later"')).toEqual([]);
  });
});

describe("follow-up: Codex's TOML keeps the person's comments on both sides", () => {
  it("commented keys at the end of a person's table before sdlc's table survive removing sdlc's", () => {
    const text = '[mcp_servers.mine]\ncommand = "x"\n# args = ["y"]\n\n[mcp_servers.sdlc]\ncommand = "sdlc"\n';
    expect(setMcpTables(text, { sdlc: undefined })).toContain('command = "x"\n# args = ["y"]');
    const replaced = setMcpTables(text, { sdlc: '[mcp_servers.sdlc]\ncommand = "npx"' });
    expect(replaced).toContain('# args = ["y"]');
    expect(replaced).toContain('command = "npx"');
    expect(replaced).not.toContain('command = "sdlc"');
  });
});
