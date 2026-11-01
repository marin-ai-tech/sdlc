import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeVerifyProbe, quotedProgramFixture } from './native-verify-probe.js';
import { write } from './helpers.js';

describe.skipIf(process.platform !== 'win32')('Native Windows verification startup', () => {
  it('runs one exact quoted executable path containing spaces and retains its real result/output', () => {
    const program = quotedProgramFixture();
    const direct = spawnSync(program, [], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    expect(direct.status).toBe(0);
    expect(direct.stdout.trim().length).toBeGreaterThan(0);
    const p = nativeVerifyProbe(`"${program}"`, 10);
    const out = p.run();
    expect(out.status, out.stderr).toBe(0);
    const result = out.result();
    expect(result.checks[0].exit_code).toBe(direct.status);
    expect(result.checks[0].output).toContain(direct.stdout.trim());
    expect(result.checks[0]).not.toHaveProperty('timed_out');
  }, 50000);

  it('resolves PowerShell to an absolute existing executable', () => {
    const p = nativeVerifyProbe('node -e 0', 10);
    const out = p.run();
    expect(out.status, out.stderr).toBe(0);
    expect(out.result().checks[0].exit_code).toBe(0);
    expect(path.isAbsolute(out.invocation().executable)).toBe(true);
    expect(fs.statSync(out.invocation().executable).isFile()).toBe(true);
  }, 50000);

  it('actual delayed initialization does not consume the real two-second command deadline', () => {
    const p = nativeVerifyProbe('node marker.cjs', 2, 'Start-Sleep -Milliseconds 2500\n');
    const marker = path.join(p.root, 'started');
    write(path.join(p.root, 'marker.cjs'), "require('node:fs').writeFileSync('started', 'command started');\n");
    const out = p.run();
    expect(out.status, out.stderr).toBe(0);
    expect(fs.existsSync(marker), JSON.stringify(out.result())).toBe(true);
    expect(out.result().checks[0]).toMatchObject({ exit_code: 0 });
    expect(out.result().checks[0]).not.toHaveProperty('timed_out');
  }, 50000);
});
