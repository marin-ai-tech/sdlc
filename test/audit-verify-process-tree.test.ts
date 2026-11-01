import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REPO_ROOT, read, write } from './helpers.js';
import { nativeVerifyProbe } from './native-verify-probe.js';

describe('Native CI inventory (remote execution is separate evidence)', () => {
  it('runs the unchanged full suite on Windows Node24 and retains Linux20/22/24 with failure propagation', () => {
    const workflow = parse(fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'));
    const job = workflow.jobs.test;
    const matrix = job.strategy.matrix;
    const pairs = matrix.include ?? matrix.os?.flatMap((os: string) => matrix.node.map((node: number) => ({ os, node })));
    expect(pairs).toEqual(expect.arrayContaining([
      { os: 'ubuntu-latest', node: 20 }, { os: 'ubuntu-latest', node: 22 },
      { os: 'ubuntu-latest', node: 24 }, { os: 'windows-latest', node: 24 },
    ]));
    expect(job['runs-on']).toBe('${{ matrix.os }}');
    expect(job.strategy['fail-fast']).toBe(false);
    const command = job.steps.find((step: { run?: string }) => step.run?.includes('npm test'));
    expect(command.run).toContain('npm ci');
    expect(command.run).toMatch(/^\s*npm test\s*$/m);
    expect(command['continue-on-error']).not.toBe(true);
    expect(job['continue-on-error']).not.toBe(true);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform !== 'win32')('Native process audit P3/P4/P5', () => {
  it('P3 names actual ConstrainedLanguage/Add-Type startup refusal and never passes an unrun command', () => {
    const prefix = "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n";
    const p = nativeVerifyProbe('node marker.cjs', 10, prefix);
    const marker = path.join(p.root, 'started');
    write(path.join(p.root, 'marker.cjs'), "require('node:fs').writeFileSync('started', 'should not run');\n");
    const out = p.run();
    expect(out.status, out.stderr).toBe(0);
    expect(out.result().status).toBe('failed');
    expect(out.result().checks[0].exit_code).toBe(1);
    expect(out.result().checks[0].output).toMatch(/ConstrainedLanguage|Add-Type|constrained language/i);
    expect(fs.existsSync(marker)).toBe(false);
  }, 50000);

  it('P4/P5 normal command exit kills a ready lingering descendant while an unrelated process survives', () => {
    const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 40000)'],
      { stdio: 'ignore', windowsHide: true });
    const p = nativeVerifyProbe('node parent.cjs', 10);
    write(path.join(p.root, 'child.cjs'), [
      "require('node:fs').writeFileSync('child.pid', String(process.pid));", 'setTimeout(() => {}, 30000);',
    ].join('\n'));
    write(path.join(p.root, 'parent.cjs'), [
      "const fs = require('node:fs');", "require('node:child_process').spawn(process.execPath, ['child.cjs'],",
      "  { stdio: 'inherit', windowsHide: true });", 'const timer = setInterval(() => {',
      "  if (fs.existsSync('child.pid')) { clearInterval(timer); process.exit(0); }", '}, 10);',
    ].join('\n'));
    let child = 0;
    try {
      const out = p.run();
      expect(out.status, out.stderr).toBe(0);
      child = Number(fs.readFileSync(path.join(p.root, 'child.pid'), 'utf8'));
      expect(out.result().checks[0].exit_code).toBe(0);
      expect(out.result().checks[0]).not.toHaveProperty('timed_out');
      expect(alive(child)).toBe(false);
      expect(alive(unrelated.pid!)).toBe(true);
    } finally {
      unrelated.kill('SIGKILL');
      if (child && alive(child)) process.kill(child, 'SIGKILL');
    }
  }, 50000);
});

describe('Runtime documentation', () => {
  it.each(['assets/guide/en/verify.md', 'docs/en/04-architecture.md', 'docs/en/05-guide.md'])(
    '%s names runtime prerequisites, cancellation and the accepted containment limit', (file) => {
      const text = read(path.join(REPO_ROOT, file));
      expect(text).toContain('PowerShell');
      expect(text).toContain('Add-Type');
      expect(text).toMatch(/ps.*pid=.*ppid=.*pgid=/);
      expect(text).toContain('30000 ms');
      expect(text).toContain('SIGINT');
      expect(text).toContain('SIGTERM');
      expect(text).toMatch(/reparented.*(?:orphan|POSIX)|POSIX.*reparented/s);
      expect(text).toContain('SIGKILL');
    });
});
