import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shellWriteDestinations } from '../src/core/policy-shell-writes.js';
import { mcpTables, setMcpTables } from '../src/integrations/codex-toml.js';
import { humanCommandPatterns } from '../src/integrations/codex.js';
import { qwenDeny } from '../src/integrations/qwen-settings.js';
import { tempDir, write } from './helpers.js';

/**
 * B84 (0.14.2): hardening after the 0.14.0 review. More shell writers count for the plan gate (git, patch, downloads,
 * Invoke-Expression, Start-Process, one-line interpreters); the second layer of Codex and Qwen covers the `scdl`
 * alias, Windows `.cmd` shims and `adopt --apply`; Codex's TOML merge does not read a multi-line string as tables.
 */

function project(files: Record<string, string> = {}) {
  const root = tempDir('sdlc-b84-');
  for (const [rel, content] of Object.entries(files)) write(path.join(root, rel), content);
  return { root, dests: (command: string) => shellWriteDestinations(command, root, root).sort() };
}

const PATCH = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');

describe('B84: git, patch and downloads write files', () => {
  const cases: Array<[string, string[]]> = [
    ['git checkout -- src/a.ts', ['src/a.ts']],
    ['git checkout HEAD~1 -- src/a.ts src/b.ts', ['src/a.ts', 'src/b.ts']],
    ['git restore src/a.ts', ['src/a.ts']],
    ['git restore --source HEAD~2 --worktree src/a.ts', ['src/a.ts']],
    ['git mv src/a.ts src/b.ts', ['src/a.ts', 'src/b.ts']],
    ['git -C src checkout -- a.ts', ['src/a.ts']],
    ['curl -o src/a.ts https://example.com/a', ['src/a.ts']],
    ['curl -sSL --output src/a.ts https://example.com/a', ['src/a.ts']],
    ['wget -O src/a.ts https://example.com/a', ['src/a.ts']],
    ['Invoke-WebRequest https://example.com/a -OutFile src/a.ts', ['src/a.ts']],
    ['iwr https://example.com/a -OutF src/a.ts', ['src/a.ts']],
  ];
  for (const [command, expected] of cases) {
    it(command, () => {
      expect(project().dests(command)).toEqual(expected);
    });
  }

  it('git apply and patch write the files their patch names', () => {
    const p = project({ 'fix.patch': PATCH });
    expect(p.dests('git apply fix.patch')).toEqual(['src/a.ts']);
    expect(p.dests('patch -p1 < fix.patch')).toEqual(['src/a.ts']);
    expect(p.dests('patch -p1 -i fix.patch')).toEqual(['src/a.ts']);
  });

  it('negative: reads, branch switches, staged-only restores and discarded downloads write nothing', () => {
    const p = project({ 'fix.patch': PATCH });
    for (const command of ['git checkout main', 'git checkout -b feature', 'git restore --staged src/a.ts',
      'git apply --check fix.patch', 'git apply --stat fix.patch', 'curl https://example.com/a',
      'curl -o /dev/null https://example.com/a', 'git diff src/a.ts', 'git show HEAD:src/a.ts']) {
      expect(p.dests(command), command).toEqual([]);
    }
  });
});

describe('B84: commands inside strings and one-line interpreters', () => {
  const cases: Array<[string, string[]]> = [
    ['iex "Set-Content src/a.ts x"', ['src/a.ts']],
    ["Invoke-Expression 'Set-Content src/a.ts x'", ['src/a.ts']],
    ['Start-Process powershell -ArgumentList "-Command Set-Content src/a.ts x"', ['src/a.ts']],
    ["node -e \"require('fs').writeFileSync('src/a.ts', 'x')\"", ['src/a.ts']],
    ["node -e \"fs.appendFileSync('src/a.ts', 'x')\"", ['src/a.ts']],
    ["python -c \"open('src/a.ts', 'w').write('x')\"", ['src/a.ts']],
    ["python3 -c \"open('src/a.ts', mode='a').write('x')\"", ['src/a.ts']],
  ];
  for (const [command, expected] of cases) {
    it(command, () => {
      expect(project().dests(command)).toEqual(expected);
    });
  }

  it('negative: reading interpreters and a message about iex write nothing', () => {
    for (const command of ["node -e \"console.log(require('fs').readFileSync('src/a.ts', 'utf8'))\"",
      "python -c \"print(open('src/a.ts').read())\"", 'git commit -m "use iex Set-Content src/a.ts later"']) {
      expect(project().dests(command), command).toEqual([]);
    }
  });
});

describe('B84: the second layer covers every spelling of the cli', () => {
  it("Codex's rules forbid sdlc, scdl and their .cmd shims, and adopt --apply", () => {
    const patterns = humanCommandPatterns('sdlc').map((words) => words.join(' '));
    for (const expected of ['sdlc approve', 'scdl approve', 'sdlc.cmd approve', 'scdl.cmd approve',
      'sdlc adopt --apply', 'scdl tests unlock']) {
      expect(patterns, expected).toContain(expected);
    }
  });

  it('negative: a configured cli other than sdlc is spelled as configured only', () => {
    const patterns = humanCommandPatterns('npx --no-install sdlc').map((words) => words.join(' '));
    expect(patterns).toContain('npx --no-install sdlc approve');
    expect(patterns).toContain('npx --no-install sdlc adopt --apply');
    expect(patterns.some((p) => p.startsWith('scdl'))).toBe(false);
  });

  it("Qwen's deny rules cover the same spellings", () => {
    const deny = qwenDeny('sdlc');
    for (const expected of ['Bash(sdlc approve *)', 'Bash(scdl approve *)', 'Bash(sdlc.cmd approve *)',
      'Bash(sdlc adopt --apply)', 'Bash(sdlc adopt --apply *)']) {
      expect(deny, expected).toContain(expected);
    }
  });
});

describe("B84: Codex's TOML merge and multi-line strings", () => {
  it('a header-looking line inside a multi-line string is not a table', () => {
    const text = [
      '[profiles.x]', 'notes = """', '[mcp_servers.sdlc]', 'not a table', '"""', '',
      '[mcp_servers.sdlc]', 'command = "sdlc"', '',
    ].join('\n');
    expect(mcpTables(text).sdlc).toBe('[mcp_servers.sdlc]\ncommand = "sdlc"');
    const removed = setMcpTables(text, { sdlc: undefined });
    expect(removed).toContain('notes = """\n[mcp_servers.sdlc]\nnot a table\n"""');
    expect(removed).not.toContain('command = "sdlc"');
  });

  it("negative: a literal multi-line string ('''...''') is skipped too", () => {
    const text = ["prompt = '''", '[mcp_servers.mine]', "'''", '[mcp_servers.sdlc]', 'command = "sdlc"', ''].join('\n');
    expect(Object.keys(mcpTables(text))).toEqual(['sdlc']);
  });
});
