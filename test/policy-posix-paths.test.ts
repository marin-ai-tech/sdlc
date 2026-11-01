import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * The policy runs with POSIX path semantics on every platform here: `node:path` is `path.posix`, as on Linux, where
 * `path.resolve` keeps `\` inside a file name. PowerShell on Linux still treats `\` as a separator, so a Windows
 * spelling of a state file must be refused there exactly as on Windows (CI run 41294046450 allowed it on ubuntu).
 */
vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  // A drive-letter path (sdlc's own install folder on Windows) keeps win32 rules; the project root below is spelled
  // as a POSIX path, so every policy path operation on it follows POSIX rules. On Linux nothing has a drive letter.
  const drive = (args: unknown[]) => args.some((arg) => typeof arg === 'string' && /^[A-Za-z]:/.test(arg));
  const pick = (name: string) => (...args: unknown[]) =>
    (drive(args) ? actual.win32 : actual.posix)[name as 'join'](...(args as string[]));
  const names = ['resolve', 'join', 'relative', 'dirname', 'basename', 'extname', 'isAbsolute', 'normalize', 'parse',
    'toNamespacedPath', 'format'];
  const hybrid = { ...actual.posix, ...Object.fromEntries(names.map((name) => [name, pick(name)])) };
  return { ...hybrid, default: hybrid, posix: actual.posix, win32: actual.win32 };
});

const { defaultConfig } = await import('../src/core/config.js');
const { evaluateToolCall, normalizeToolCall } = await import('../src/core/policy.js');
const { projectPaths } = await import('../src/core/project.js');

const HELD = 'version: 1\nkind: feature\nrisk: low\ntakeover:\n  by: Owner\n  at: 2026-10-30\n  note: held\n';
const created: string[] = [];

/**
 * A real folder spelled as a POSIX path (on Windows: without the drive, resolved on the current drive), with a change,
 * the roles file, the project log, an ordinary folder and, when asked, a change a person holds.
 */
function posixRoot(held = false): string {
  const real = fs.realpathSync(fs.mkdtempSync(`${process.env.SDLC_TEST_TMP ?? os.tmpdir()}/sdlc-posix-paths-`));
  created.push(real);
  const put = (relative: string, text: string) => {
    fs.mkdirSync(`${real}/${relative}`.replace(/\/[^/]+$/, ''), { recursive: true });
    fs.writeFileSync(`${real}/${relative}`, text);
  };
  put('openspec/changes/demo/.sdlc.yaml', 'version: 1\n');
  put('openspec/roles.yaml', 'people: []\n');
  put('openspec/.sdlc/log.jsonl', '');
  put('notes/a.txt', 'a\n');
  if (held) put('openspec/changes/held/.sdlc.yaml', HELD);
  return real.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/');
}

const root = posixRoot();
const heldRoot = posixRoot(true);
afterAll(() => {
  for (const real of created) fs.rmSync(real, { recursive: true, force: true });
});

function decide(command: string, project = root) {
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  return evaluateToolCall(normalizeToolCall('Bash', { command }, project), { paths: projectPaths(project), config });
}

describe('Windows spellings of state files under POSIX path semantics', () => {
  it.each([
    'Set-Content openspec\\backlog.md x',
    'echo x >> openspec\\backlog.md',
    'del openspec\\changes\\demo\\.sdlc.yaml',
    'cmd /c mklink /H notes.yaml openspec\\changes\\demo\\.sdlc.yaml',
    'fsutil hardlink create notes.yaml openspec\\roles.yaml',
    'Set-Location openspec\\.sdlc; Remove-Item log.jsonl',
    'cd .\\openspec; Set-Content backlog.md x',
    'Copy-Item -Recurse notes openspec\\changes\\demo',
    'Copy-Item -Recurse openspec\\changes\\demo out',
  ])('refuses %s as state-integrity', (command) => {
    expect(decide(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('refuses a redirect into a change a person holds, spelled with Windows separators', () => {
    expect(decide('echo x > openspec\\changes\\held\\tasks.md', heldRoot))
      .toMatchObject({ decision: 'deny', rule: 'takeover' });
  });

  it.each([
    'Set-Content notes\\readme.txt x',
    'echo x >> notes\\readme.txt',
    'Get-Content openspec\\backlog.md',
    "echo 'see openspec\\backlog.md' >> notes.txt",
  ])('still allows %s, which writes no state file', (command) => {
    expect(decide(command).decision).not.toBe('deny');
  });
});
