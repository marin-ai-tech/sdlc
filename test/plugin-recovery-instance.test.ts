import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { processIdentity } from '../src/core/process-identity.js';
import { withRecoveryEntry } from '../src/plugins/recovery-lock.js';
import { storagePath } from '../src/plugins/activation.js';
import { tempDir } from './helpers.js';

describe('Plugin recovery contender identity', () => {
  it('reclaims a partial contender whose PID now belongs to a different proven instance', () => {
    const root = tempDir('sdlc-recovery-instance-');
    const directory = path.dirname(storagePath(root, 'recovery-entries/probe.json', true));
    const instance = `${processIdentity(process.pid)}0`;
    const kind = process.platform === 'win32' ? 'w' : 'l';
    const id = `${process.pid}-${kind}-${createHash('sha256').update(instance).digest('hex')}-${'1'.repeat(32)}`;
    const file = path.join(directory, `${id}.json`);
    fs.writeFileSync(file, '{partial');
    let ran = false;
    withRecoveryEntry(root, () => { ran = true; });
    expect(ran).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
