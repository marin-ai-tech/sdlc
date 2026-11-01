import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BIN, REPO_ROOT, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

describe('Visible literal command drafts', () => {
  it('drafts argument-safe editable answers without recording a decision', async () => {
    const drafts = await import('../src/core/command-draft.js');
    const root = tempDir('sdlc-answer-draft-');
    const state = path.join(root, '.sdlc.yaml');
    write(state, 'pending: true\n');
    const answer = 'Keep "quotes", O\'Brien; $(touch injected) `echo injected` & | < >';
    for (const shell of ['posix', 'powershell'] as const) {
      const draft = drafts.answerDraft({ cli: 'sdlc', change: 'e20', question: '1', answer, shell });
      expect(draft.answer).toBe(answer);
      expect(draft.command).toContain('answer');
      expect(draft.command).toContain('1');
      expect(draft.command).not.toMatch(/\bapprove\b|\bwaive\b|\breject\b/);
    }
    expect(read(state)).toBe('pending: true\n');
    expect(fs.existsSync(path.join(root, 'injected'))).toBe(false);
  });

  it.runIf(process.platform === 'win32')('PowerShell round-trips metacharacters as arguments in a real shell', async () => {
    const drafts = await import('../src/core/command-draft.js');
    const answer = 'O\'Brien "quoted"; $(throw "injected") `n & | < >';
    const root = tempDir('sdlc-answer-file-');
    const env = humanEnv(tempDir('sdlc-answer-file-home-'));
    initGitRepo(root);
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    expect(runCli(['new', 'e20', '--json'], root, env).code).toBe(0);
    write(path.join(root, 'openspec/changes/e20/intent.md'), '# Intent\n\n## Open questions\n- Which answer?\n');
    const draft = drafts.answerDraft({ cli: 'sdlc', change: 'e20', question: '1', answer, shell: 'powershell' });
    expect(draft.files).toHaveLength(1);
    expect(draft.files[0].content).toBe(answer);
    expect(draft.command).not.toContain(answer);
    for (const file of draft.files) write(path.join(root, file.path), file.content);
    write(path.join(root, 'sdlc.cmd'), `@"${process.execPath}" "${BIN}" %*\r\n`);
    const nativeEnv = { ...env, PATH: root + path.delimiter + env.PATH };
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', draft.command + ' --json'], {
      cwd: root, env: nativeEnv, encoding: 'utf-8', timeout: 20000,
    });
    expect(result.status, result.stderr).toBe(0);
    const listed = runCli(['answer', '--list', '--change', 'e20', '--json'], root, env).json();
    expect(listed.questions[0].answer).toBe(answer);
  }, 120000);

  it.runIf(process.platform !== 'win32')('POSIX round-trips metacharacters as arguments in a real shell', async () => {
    const drafts = await import('../src/core/command-draft.js');
    const answer = 'O\'Brien "quoted"; $(touch injected) `echo injected` & | < >';
    const draft = drafts.answerDraft({ cli: 'sdlc', change: 'e20', question: '1', answer, shell: 'posix' });
    const command = draft.command.replace(/^sdlc\b/, 'capture_args');
    const script = 'capture_args() { printf "%s\\0" "$@"; }; ' + command;
    const result = spawnSync('sh', ['-c', script], { encoding: 'utf-8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split('\0')).toContain(answer);
  });

  it('refuses an unvalidated CLI program instead of interpolating shell code', async () => {
    const drafts = await import('../src/core/command-draft.js');
    expect(() => drafts.answerDraft({
      cli: 'sdlc; injected', change: 'e20', question: '1', answer: 'draft', shell: 'posix',
    })).toThrow();
  });

  it('commit drafts retain change/task trailers and never add AI attribution or execute a commit', async () => {
    const drafts = await import('../src/core/command-draft.js');
    const draft = drafts.commitDraft({
      change: 'e20', task: '9.2', message: 'Preserve literal "answers"',
      paths: ['src/a b.ts', 'src/odd;name.ts'], shell: 'powershell',
    });
    expect(draft.commands).toHaveLength(2);
    expect(draft.commands[0]).toMatch(/^git add -- /);
    expect(draft.commands[1]).toMatch(/^git commit /);
    expect(draft.message).toContain('SDLC-Change: e20');
    expect(draft.message).toContain('SDLC-Task: 9.2');
    expect(draft.message).not.toMatch(/SDLC-Agent|Co-Authored-By|Codex|Claude|AI/);
  });

  it('native-shell commit drafts round-trip exact paths and messages without running git', async () => {
    const drafts = await import('../src/core/command-draft.js');
    const shell = process.platform === 'win32' ? 'powershell' : 'posix';
    const paths = ['src/a b.ts', 'src/O\'Brien;$(touch injected).ts'];
    const draft = drafts.commitDraft({ change: 'e20', task: '9.2', message: 'Keep "literal"; $HOME', paths, shell });
    const root = tempDir('sdlc-commit-file-');
    for (const file of draft.files) write(path.join(root, file.path), file.content);
    const captureFile = path.join(root, 'capture.cjs');
    write(captureFile, [
      'const fs = require("node:fs");',
      'const words = process.argv.slice(2);',
      'const content = words[0] === "commit" ? fs.readFileSync(words[2], "utf8") : null;',
      'process.stdout.write(JSON.stringify({ words, content }));',
    ].join('\n'));
    const quote = (value: string) => drafts.quoteDraftArgument(value, shell);
    const capture = `${shell === 'powershell' ? '& ' : ''}${quote(process.execPath)} ${quote(captureFile)}`;
    for (const [index, command] of draft.commands.entries()) {
      const script = command.replace(/^git\b/, capture);
      const args = shell === 'powershell' ? ['-NoProfile', '-NonInteractive', '-Command', script] : ['-c', script];
      const result = spawnSync(shell === 'powershell' ? 'powershell.exe' : 'sh', args, {
        cwd: root, encoding: 'utf-8', timeout: 10000,
      });
      expect(result.status, result.stderr).toBe(0);
      const captured = JSON.parse(result.stdout);
      expect(captured.words).toEqual(index === 0 ? ['add', '--', ...paths] : ['commit', '-F', draft.files[0].path]);
      if (index === 1) expect(captured.content).toBe(draft.message);
    }
    expect(read(path.join(root, draft.files[0].path))).toBe(draft.message);
    expect(draft.files[0].content).toContain('Keep "literal"; $HOME');
  });

  it('workflow contract reserves commit execution and makes answer drafts editable', () => {
    const contract = read(path.join(REPO_ROOT, 'assets/workflows/_contract.md'));
    expect(contract).toMatch(/editable.*draft|draft.*editable/i);
    expect(contract).toMatch(/commit.*(person|project rules)|project rules.*commit/i);
    const backlog = read(path.join(REPO_ROOT, 'assets/workflows/backlog.md'));
    expect(backlog).toMatch(/granularity/i);
    expect(backlog).toMatch(/already.*(choice|chosen)|explicit.*choice/i);
  });
});
