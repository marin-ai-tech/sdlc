import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * B238: the copy check under POSIX path rules, where only the backslash-as-separator spelling sees a Windows-style
 * path. An uncertain copy must not end the inspection of the copies after it, an uncertain copy whose static prefix
 * lies inside a state folder counts, and no outcome depends on a localized reason (review of fix-posix-0-30-0: F8, F10,
 * F12).
 */
const reasons = vi.hoisted(() => ({ prefix: '' }));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  const drive = (args: unknown[]) => args.some((arg) => typeof arg === 'string' && /^[A-Za-z]:/.test(arg));
  const pick = (name: string) => (...args: unknown[]) =>
    (drive(args) ? actual.win32 : actual.posix)[name as 'join'](...(args as string[]));
  const names = ['resolve', 'join', 'relative', 'dirname', 'basename', 'extname', 'isAbsolute', 'normalize', 'parse',
    'toNamespacedPath', 'format'];
  const hybrid = { ...actual.posix, ...Object.fromEntries(names.map((name) => [name, pick(name)])) };
  return { ...hybrid, default: hybrid, posix: actual.posix, win32: actual.win32 };
});

vi.mock('../src/core/i18n.js', async () => {
  const actual = await vi.importActual<typeof import('../src/core/i18n.js')>('../src/core/i18n.js');
  // A translated catalog: every reason reads differently from the English text the code was written against.
  const t = (...args: Parameters<typeof actual.t>) => `${reasons.prefix}${actual.t(...args)}`;
  return { ...actual, t };
});

const { defaultConfig } = await import('../src/core/config.js');
const { evaluateToolCall, normalizeToolCall } = await import('../src/core/policy.js');
const { projectPaths } = await import('../src/core/project.js');

const created: string[] = [];

function posixRoot(): string {
  // These fixtures intentionally omit the drive; keep them on the process's current drive on Windows.
  const parent = process.platform === 'win32' ? `${process.cwd()}/.sdlc-tmp` : process.env.SDLC_TEST_TMP ?? os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const real = fs.realpathSync(fs.mkdtempSync(`${parent}/sdlc-copy-typed-`));
  created.push(real);
  const put = (relative: string, text: string) => {
    fs.mkdirSync(`${real}/${relative}`.replace(/\/[^/]+$/, ''), { recursive: true });
    fs.writeFileSync(`${real}/${relative}`, text);
  };
  put('openspec/changes/demo/.sdlc.yaml', 'version: 1\n');
  put('notes/a.txt', 'a\n');
  put('source[1]/a.txt', 'a\n');
  put('cash$literal/a.txt', 'a\n');
  return real.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/');
}

const root = posixRoot();
afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function decide(command: string, tool = 'Bash') {
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  return evaluateToolCall(normalizeToolCall(tool, { command }, root), { paths: projectPaths(root), config });
}

const DENIED = [
  // B238.C1: a harmless first copy with a dollar sign, then a recursive copy of a change folder spelled with `\`.
  'cp -R cash\\$x d; cp -R openspec\\changes\\demo out',
  'cp notes\\$x d && cp -R openspec\\changes\\demo out',
  // B238.C2: a change folder spelled with `\` whose last segment is a variable.
  'cp -R openspec\\changes\\$ID out',
  'cp -R openspec\\changes\\${ID} out',
  // Review of card A: every uncertain copy and every operand counts, not only the first.
  'cp notes\\$x d; cp -R openspec\\changes\\$ID out',
  'cp -R notes\\$x d; cp -R openspec\\changes\\$ID out',
  'cp -R notes\\$a openspec\\changes\\$ID out',
  'cp -R openspec\\changes\\$ID \\$T',
  "sh -c 'cp -R notes\\$x d; cp -R openspec\\changes\\$ID out'",
  // The other state folders, by the same rule as the policy's own list.
  'cp -R openspec\\.sdlc\\inbox\\$ID out',
  'cp -R openspec\\.sdlc\\plugins\\$ID out',
  // A state folder as the destination counts like a source.
  'cp notes/a.txt openspec\\changes\\$ID',
  // Review round 1: PowerShell's cp and xcopy expand a quoted wildcard themselves, and the policy is not told the shell.
  "cp -R 'openspec/changes/*' out",
  'cp -R "openspec/changes/*" out',
  "cp -R 'openspec/changes/d?mo' out",
  'cmd /c xcopy "openspec\\changes\\demo\\*" out /E /I',
];

const ALLOWED = [
  // B238.C3: literal globs and quoted metacharacters outside every state folder.
  "cp -R 'source[1]' out",
  'cp -R source\\[1\\] out',
  "cp -R 'cash$literal' out",
  'cp -R cash\\$literal out',
  'cp notes/a.txt out.txt',
  // Negative of the review cases: several uncertain copies, all outside every state folder.
  'cp notes\\$x d; cp notes\\$y e',
  'cp -R notes\\$a notes\\$b out',
];

describe.each([['English', ''], ['a translated catalog', '[xx] ']])('with %s', (_name, prefix) => {
  it.each(DENIED)('B238.C1, C2: refuses %s', (command) => {
    reasons.prefix = prefix;
    expect(decide(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('review round 1: the PowerShell tool refuses a quoted wildcard over a state folder', () => {
    reasons.prefix = prefix;
    for (const command of ["cp -R 'openspec/changes/*' out", "cp -Recurse 'openspec/changes/d?mo' out"]) {
      expect(decide(command, 'PowerShell'), command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it.each(ALLOWED)('B238.C3: allows %s', (command) => {
    reasons.prefix = prefix;
    expect(decide(command).decision).toBe('allow');
  });

  it('B238.C1: the forward-slash forms stay refused', () => {
    reasons.prefix = prefix;
    expect(decide('cp -R openspec/changes/demo out')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(decide('cp -R openspec/changes/$ID out')).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('B238.C4: no localized reason text decides a copy', () => {
  it('the source of the copy check compares no reason string', () => {
    const source = ['state-copy.ts', 'policy-spellings.ts']
      .map((file) => fs.readFileSync(`${process.cwd()}/src/core/${file}`, 'utf-8')).join('\n');
    expect(source).not.toMatch(/reason\s*(?:===|!==|==|!=)/);
    expect(source).not.toMatch(/===\s*t\('hook\./);
  });
});
