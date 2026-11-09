import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, git, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * B265: tests run on a pushed commit on the private server. `remote-test.mjs` is what `sdlc verify` calls on this
 * host, and the verify fingerprint hashes the files on disk, so a state the server did not test must never reach ssh.
 * The fake ssh is a function parameter on purpose: an environment variable that replaces ssh would let a verify pass
 * with nothing tested.
 */

const ORIGIN = 'ssh://tester@server.example/home/tester/git/x.git';
const SCRIPT = 'echo server\nmain "$@"\n';

interface SshResult { status: number | null; signal: string | null }
interface SshCall { args: string[]; script: string }

function project(origin: string | null = ORIGIN): string {
  const root = tempDir('sdlc-remote-test-');
  initGitRepo(root);
  write(path.join(root, 'scripts/sandbox/test.sh'), SCRIPT);
  write(path.join(root, 'a.txt'), 'a\n');
  write(path.join(root, '.gitignore'), 'ignored.txt\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'first']);
  if (origin) git(root, ['remote', 'add', 'origin', origin]);
  return root;
}

async function remote(root: string, args: string[], result: SshResult = { status: 0, signal: null }) {
  const runner = await import('../scripts/sandbox/remote-test.mjs');
  const calls: SshCall[] = [];
  const messages: string[] = [];
  const code: number = runner.runRemoteTest({
    cwd: root,
    args,
    log: (message: string) => messages.push(message),
    ssh: (sshArgs: string[], script: string) => {
      calls.push({ args: sshArgs, script });
      return result;
    },
  });
  return { code, calls, messages: messages.join('\n') };
}

function head(root: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' });
  return r.stdout.trim();
}

describe('B265: remote-test refuses a state the server would not test', () => {
  it('a modified tracked file is refused and ssh is not called', async () => {
    const root = project();
    write(path.join(root, 'a.txt'), 'changed\n');
    const r = await remote(root, ['npm', 'run', 'typecheck']);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.messages).toContain('a.txt');
  });

  it('an untracked file is refused and ssh is not called', async () => {
    const root = project();
    write(path.join(root, 'new.txt'), 'new\n');
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it('a staged change that matches nothing on HEAD is refused', async () => {
    const root = project();
    write(path.join(root, 'a.txt'), 'staged\n');
    git(root, ['add', 'a.txt']);
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it('settings and index flags that hide a change from git status do not hide it here', async () => {
    const hidden = project();
    git(hidden, ['config', 'status.showUntrackedFiles', 'no']);
    write(path.join(hidden, 'new.txt'), 'new\n');
    expect((await remote(hidden, [])).calls).toEqual([]);

    const flagged = project();
    git(flagged, ['update-index', '--assume-unchanged', 'a.txt']);
    write(path.join(flagged, 'a.txt'), 'changed\n');
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: flagged, encoding: 'utf-8' });
    expect(status.stdout).toBe('');
    const r = await remote(flagged, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it('negative: an ignored file does not refuse', async () => {
    const root = project();
    write(path.join(root, 'ignored.txt'), 'local\n');
    const r = await remote(root, []);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
  });

  it('a replaced commit does not hide what the server would test', async () => {
    const root = project();
    const real = head(root);
    write(path.join(root, 'a.txt'), 'evil\n');
    git(root, ['add', 'a.txt']);
    const tree = spawnSync('git', ['write-tree'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
    const fake = spawnSync('git', ['commit-tree', tree, '-m', 'fake'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
    git(root, ['replace', real, fake]);
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it('an ignored file added by force is refused: the fingerprint would name another tree', async () => {
    const root = project();
    write(path.join(root, 'ignored.txt'), 'local\n');
    git(root, ['add', '-f', 'ignored.txt']);
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it.each(['--assume-unchanged', '--skip-worktree'])(
    'content staged under %s and restored on disk is refused: the fingerprint would name another tree',
    async (flag) => {
      const root = project();
      write(path.join(root, 'a.txt'), 'evil\n');
      git(root, ['add', 'a.txt']);
      git(root, ['update-index', flag, 'a.txt']);
      write(path.join(root, 'a.txt'), 'a\n');
      const r = await remote(root, []);
      expect(r.code).toBe(2);
      expect(r.calls).toEqual([]);
    },
  );

  it('a comparison that could not run says so instead of blaming an index flag', async () => {
    const root = tempDir('sdlc-remote-test-');
    initGitRepo(root);
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.messages).toContain('could not compare');
    expect(r.messages).not.toContain('index flag');
  });

  it('a comparison from the real index that fails is a refusal, never a pass', async () => {
    const root = project();
    write(path.join(root, '.git/index'), 'garbage\n');
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.messages).toContain('could not compare');
  });

  it('a comparison from the commit that fails is a refusal, never a pass', async () => {
    const root = project();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
    const object = path.join(root, '.git/objects', tree.slice(0, 2), tree.slice(2));
    fs.chmodSync(object, 0o644);
    fs.rmSync(object);
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.messages).toContain('could not compare');
  });

  it.each([
    'ssh://git@github.com/owner/repo.git',
    'ssh://git@GitHub.com/owner/repo.git',
    'https://github.com/owner/repo',
    'git@github.com:owner/repo.git',
    'ssh://-oProxyCommand=x@host/repo.git',
    'ssh://user@-oProxyCommand=x/repo.git',
    'ssh://user@host:22/repo.git',
    'ssh://user@host/repo;touch.git',
    'ssh://host/repo.git',
    '/local/path/repo.git',
  ])('origin %s is refused and ssh is not called', async (origin) => {
    const r = await remote(project(origin), []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it('a missing origin is refused and ssh is not called', async () => {
    const r = await remote(project(null), []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it.each(['a;b', '$(x)', 'a b', "it's", '"q"', '`x`', 'a|b', 'a&b', 'a>b', '', 'a\nb'])(
    'the argument %j crosses a remote shell, so it is refused and ssh is not called',
    async (argument) => {
      const r = await remote(project(), ['npm', argument]);
      expect(r.code).toBe(2);
      expect(r.calls).toEqual([]);
    },
  );
});

describe('B265: remote-test runs the pushed commit and reports its result', () => {
  it.each(['C:/Users/x/Git/evidence', 'c:/x', 'D:\\x', '--pack-destination=C:/Users/x/Git/evidence', '-o=D:/x'])(
    'a path of this host (%s), as Git Bash rewrites /evidence, means nothing on the server and is refused',
    async (argument) => {
      const r = await remote(project(), ['npm', 'pack', '--pack-destination', argument]);
      expect(r.code).toBe(2);
      expect(r.calls).toEqual([]);
      expect(r.messages).toContain('MSYS_NO_PATHCONV');
    },
  );

  it('negative: a URL, a relative path and a shard number still pass', async () => {
    const command = ['git', 'ls-remote', 'https://example.com/a', '--url=https://example.com/b', 'scripts/x',
      '--shard', '1/4'];
    const r = await remote(project(), command);
    expect(r.code).toBe(0);
    expect(r.calls[0].args.slice(-command.length)).toEqual(command);
  });

  it('a clean tree calls ssh once with the target, the repository, HEAD and the command in order', async () => {
    const root = project();
    const command = ['node', 'scripts/test-shards.mjs', '--shard', '1/4', '--workers', '2'];
    const r = await remote(root, command);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].args).toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
      '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6', 'tester@server.example',
      'bash', '-s', '--', '/home/tester/git/x.git', head(root), ...command]);
  });

  it('no command sends only the repository and HEAD: the server runs the whole suite', async () => {
    const root = project();
    const r = await remote(root, []);
    expect(r.calls[0].args.slice(-4)).toEqual(['-s', '--', '/home/tester/git/x.git', head(root)]);
  });

  it('the script sent to the server is the blob at HEAD', async () => {
    const r = await remote(project(), []);
    expect(r.calls[0].script).toBe(SCRIPT);
  });

  it('a commit with no test.sh is refused: there is nothing it could run on the server', async () => {
    const root = project();
    git(root, ['rm', '-q', 'scripts/sandbox/test.sh']);
    git(root, ['commit', '-q', '-m', 'no tools']);
    const r = await remote(root, []);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it.each(['', 'run() { echo x; }\n', 'echo first\nmain "$@"\necho after\n'])(
    'a test.sh of %j would exit 0 with nothing run, so it is refused',
    async (content) => {
      const root = project();
      write(path.join(root, 'scripts/sandbox/test.sh'), content);
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'broken tools']);
      const r = await remote(root, []);
      expect(r.code).toBe(2);
      expect(r.calls).toEqual([]);
      expect(r.messages).toContain('main');
    },
  );

  it.each([0, 1, 3, 75, 255])('exit code %i passes through', async (status) => {
    const r = await remote(project(), [], { status, signal: null });
    expect(r.code).toBe(status);
  });

  it('negative: ssh ended by a signal, or never started, is never a pass', async () => {
    expect((await remote(project(), [], { status: null, signal: 'SIGTERM' })).code).toBe(1);
    expect((await remote(project(), [], { status: null, signal: null })).code).toBe(1);
  });

  it('ssh that could not start names the reason and is not a pass', async () => {
    const failure = { status: null, signal: null, error: new Error('spawn ssh ENOENT') };
    const r = await remote(project(), [], failure);
    expect(r.code).toBe(1);
    expect(r.messages).toContain('spawn ssh ENOENT');
  });

  it('ssh starts outside the repository, so a program in its root is not the one that runs', () => {
    const text = read(path.join(REPO_ROOT, 'scripts/sandbox/remote-test.mjs'));
    expect(text).toMatch(/spawnSync\('ssh'[^)]*cwd: os\.homedir\(\)/);
  });
});

describe('B265: the tools in the repository', () => {
  const tools = path.join(REPO_ROOT, 'scripts/sandbox');

  it('negative: no server address and no login in the tracked tools', () => {
    for (const name of fs.readdirSync(tools)) {
      const text = read(path.join(tools, name));
      expect(text.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) ?? [], name).toEqual([]);
      const logins = (text.match(/[\w.-]+@[\w.-]+/g) ?? []).filter((login) => login !== 'sandbox@localhost');
      expect(logins, name).toEqual([]);
    }
  });

  it('test.sh keeps the limits this server shares with the other projects', () => {
    const text = read(path.join(tools, 'test.sh'));
    const limits = ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges',
      '--memory 3g', '--cpus 2', '--cpu-shares 256', '--pids-limit 1024'];
    for (const limit of limits) expect(text).toContain(limit);
    expect(text).not.toMatch(/--privileged|--network host|\/var\/run\/docker\.sock/);
  });

  it('the waits and the limit of one command fit inside the limit of a verify command', () => {
    const text = read(path.join(tools, 'test.sh'));
    const seconds = (name: string): number => {
      const value = new RegExp(`^${name}=(\\d+)$`, 'm').exec(text)?.[1];
      expect(value, name).toBeDefined();
      return Number(value);
    };
    const VERIFY_LIMIT = 3600;
    const waits = seconds('LOCK_WAIT_SECONDS') + seconds('MEMORY_WAIT_SECONDS') + seconds('COMMAND_LIMIT_SECONDS');
    expect(waits, 'a command that had no build can use its whole limit').toBeLessThanOrEqual(
      seconds('TOTAL_LIMIT_SECONDS'),
    );
    const control = seconds('CONTROL_LIMIT_SECONDS');
    const afterTotal = control + seconds('LOG_LIMIT_SECONDS') + control;
    expect(seconds('TOTAL_LIMIT_SECONDS') + afterTotal, 'the kill, the logs and the removal after it').toBeLessThan(
      VERIFY_LIMIT,
    );
    expect(seconds('COMMAND_LIMIT_SECONDS'), 'the slowest shard took 1254 s').toBeGreaterThan(1254);
    expect(seconds('SUITE_LIMIT_SECONDS'), 'the owner accepts 2 hours for a whole suite').toBe(7200);
    expect(seconds('BUILD_LIMIT_SECONDS')).toBeGreaterThan(0);
    expect(seconds('POLL_SECONDS')).toBeGreaterThan(0);
    expect(seconds('DISK_FLOOR_MB')).toBeLessThan(seconds('DISK_NEEDED_MB'));
  });

  /** Making the folder, mounting it and removing it are all this host does there; `rm` and `chmod -R` follow no link. */
  const EVIDENCE_LINES = [
    'mkdir -p "$RUN/scratch/home" "$RUN/scratch/tmp" "$RUN/evidence"',
    '-v "$RUN/evidence:/evidence" \\',
    'remove_folder "$RUN/evidence" > /dev/null',
  ];

  function evidenceLinesOutsideTheRule(text: string): string[] {
    return text.split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#') && line.includes('evidence') && !EVIDENCE_LINES.includes(line));
  }

  it('no host file is written or read inside a folder the container can write', () => {
    const text = read(path.join(tools, 'test.sh'));
    expect(evidenceLinesOutsideTheRule(text)).toEqual([]);
    for (const line of EVIDENCE_LINES) expect(text, line).toContain(line);
  });

  it.each([
    'docker logs "$NAME" > "$RUN/evidence/run.log" 2>&1 || true',
    'cut -c1-200 "$RUN"/evidence/run.log',
    'cat >"${RUN}/evidence/x"',
  ])('negative: the rule catches %s', (line) => {
    expect(evidenceLinesOutsideTheRule(line)).toEqual([line]);
  });
});

describe('B265: windows-only keeps Windows behaviour checked on this host', () => {
  /** A test that runs only on Windows: skipped when the platform is not win32, or run only when it is. */
  const WINDOWS_ONLY = [/\.skipIf\(process\.platform !== 'win32'\)/, /\.runIf\(process\.platform === 'win32'\)/];

  function testFiles(folder: string): string[] {
    return fs.readdirSync(path.join(REPO_ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${folder}/${entry.name}`;
      if (entry.isDirectory()) return testFiles(relative);
      return relative.endsWith('.test.ts') ? [relative] : [];
    });
  }

  it('the list is exactly the test files with a Windows-only condition', async () => {
    const runner = await import('../scripts/sandbox/windows-only.mjs');
    const expected = testFiles('test')
      .filter((file) => WINDOWS_ONLY.some((pattern) => pattern.test(read(path.join(REPO_ROOT, file)))))
      .sort();
    expect([...runner.WINDOWS_ONLY_FILES].sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  /**
   * Every file that mentions a platform is classified by a person. A new one fails here until it is: a condition this
   * test cannot read (a helper, an early return) still names the platform somewhere in the file.
   */
  const MENTIONS_PLATFORM = /win32|process\.platform|os\.platform|platform\(\)/;

  it('a file that mentions a platform is on a list: run here, or stated to need no run here', async () => {
    const runner = await import('../scripts/sandbox/windows-only.mjs');
    const classified = [...runner.WINDOWS_ONLY_FILES, ...runner.WINDOWS_BRANCH_FILES, ...runner.NOT_RUN_HERE_FILES];
    const mentioning = testFiles('test').filter((file) => MENTIONS_PLATFORM.test(read(path.join(REPO_ROOT, file))));
    expect([...classified].sort()).toEqual(mentioning.sort());
  });

  it('negative: a file is never on two lists, and a file on no list is not silently accepted', async () => {
    const runner = await import('../scripts/sandbox/windows-only.mjs');
    const classified = [...runner.WINDOWS_ONLY_FILES, ...runner.WINDOWS_BRANCH_FILES, ...runner.NOT_RUN_HERE_FILES];
    expect(new Set(classified).size).toBe(classified.length);
    expect(runner.WINDOWS_BRANCH_FILES).toContain('test/stop-check-errors.test.ts');
    expect(runner.WINDOWS_BRANCH_FILES).not.toContain('test/plugin-directory-durability.test.ts');
  });

  it('a Windows run covers the branch files as well as the Windows-only ones', async () => {
    const runner = await import('../scripts/sandbox/windows-only.mjs');
    const ran: string[][] = [];
    runner.runWindowsOnly({
      platform: 'win32',
      log: () => undefined,
      run: (args: string[]) => {
        ran.push(args);
        return 0;
      },
    });
    expect(ran[1]).toEqual(expect.arrayContaining(runner.WINDOWS_BRANCH_FILES));
    expect(ran[1]).not.toEqual(expect.arrayContaining(['test/plugin-directory-durability.test.ts']));
  });

  it('negative: a platform other than Windows is refused, because every case there would skip and pass', async () => {
    const runner = await import('../scripts/sandbox/windows-only.mjs');
    const ran: string[][] = [];
    const code = runner.runWindowsOnly({
      platform: 'linux',
      log: () => undefined,
      run: (args: string[]) => {
        ran.push(args);
        return 0;
      },
    });
    expect(code).toBe(2);
    expect(ran).toEqual([]);
  });

  it('on Windows it compiles, then runs the list, and a failure of either is the result', async () => {
    const runner = await import('../scripts/sandbox/windows-only.mjs');
    const firstFile: string = runner.WINDOWS_ONLY_FILES[0];
    const attempt = (failing?: string) => {
      const ran: string[][] = [];
      const code = runner.runWindowsOnly({
        platform: 'win32',
        log: () => undefined,
        run: (args: string[]) => {
          ran.push(args);
          return failing && args.includes(failing) ? 5 : 0;
        },
      });
      return { code, ran };
    };
    const clean = attempt();
    expect(clean.code).toBe(0);
    expect(clean.ran).toHaveLength(2);
    expect(clean.ran[0]).toContain('compile');
    expect(clean.ran[1]).toEqual(expect.arrayContaining(runner.WINDOWS_ONLY_FILES));

    const compileFails = attempt('compile');
    expect(compileFails.code).toBe(5);
    expect(compileFails.ran).toHaveLength(1);
    const testsFail = attempt(firstFile);
    expect(testsFail.code).toBe(5);
    expect(testsFail.ran).toHaveLength(2);
  });
});
