import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { HUMAN_COMMANDS } from '../src/core/human-commands.js';
import { humanEnv, runCli, tempDir, write, read } from './helpers.js';

describe('Person-only expected-owner board recovery', () => {
  it('is centrally marked as a human decision', () => {
    expect(HUMAN_COMMANDS).toContain('board recover');
  });

  it('requires the exact observed owner and refuses agent calls without mutation', () => {
    const root = tempDir('sdlc-board-recover-');
    write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(defaultConfig())));
    const child = spawnSync(process.execPath, ['-e', ''], { timeout: 10000 });
    expect(child.status).toBe(0);
    const file = path.join(root, 'openspec/.sdlc/board.lock');
    const raw = JSON.stringify({ pid: child.pid, nonce: 'retired' });
    write(file, raw);
    const expected = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    const env = humanEnv(tempDir('sdlc-board-recovery-home-'));
    const command = ['board', 'recover', '--expect-owner', expected, '--json'];
    const denied = runCli(command, root, { ...env, SDLC_AGENT: 'test-agent' });
    expect(denied.code).toBe(1);
    expect(denied.json().status[0].code).toBe('agent_cannot_recover_board');
    expect(read(file)).toBe(raw);
    const stale = runCli(['board', 'recover', '--expect-owner', `sha256:${'0'.repeat(64)}`, '--json'], root, env);
    expect(stale.code).toBe(1);
    expect(read(file)).toBe(raw);
    const recovered = runCli(command, root, env);
    expect(recovered.code, recovered.stdout + recovered.stderr).toBe(0);
    expect(recovered.json()).toMatchObject({ recovered: true, owner: expected });
    expect(fs.existsSync(file)).toBe(false);
  }, 30000);
});
