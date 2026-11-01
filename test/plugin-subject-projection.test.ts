import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../dist/core/config.js';
import { capturePackage } from '../dist/plugins/package.js';
import { evaluateHooks } from '../dist/plugins/hooks.js';
import { pluginProject } from './fixtures/plugin-project.js';

describe('Guest extension visibility', () => {
  it('actual two Wasm hooks see only their current namespace at host contract positions', async () => {
    const prefix = '{"output":{"decision":"pass"},"facts":{"seen":';
    const start = 128 + Buffer.byteLength(prefix);
    const call = [
      `(memory.copy (i32.const ${start}) (local.get 0) (local.get 1))`,
      `(i32.store8 (i32.add (i32.const ${start}) (local.get 1)) (i32.const 125))`,
      `(i32.store8 (i32.add (i32.const ${start + 1}) (local.get 1)) (i32.const 125))`,
      `(i64.or (i64.shl (i64.const 128) (i64.const 32))`,
      `(i64.extend_i32_u (i32.add (local.get 1) (i32.const ${Buffer.byteLength(prefix) + 2}))))`,
    ].join('\n');
    const p = await pluginProject({}, { hooks: { claim: 'read', bid: 'read' } }, { bytes: Buffer.from(prefix), call });
    const second = path.join(p.root, 'packages/other');
    fs.cpSync(p.p.dir, second, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(second, 'sdlc-plugin.json'), 'utf8'));
    manifest.name = 'other';
    fs.writeFileSync(path.join(second, 'sdlc-plugin.json'), JSON.stringify(manifest));
    const snapshot = capturePackage(p.root, 'packages/other');
    p.raw.plugins.other = { enabled: true, package: 'packages/other', digest: snapshot.digest, config: {} };
    fs.writeFileSync(p.file, stringify(p.raw));
    const accepted = p.cli(['plugins', 'accept', 'other', '--expect-digest', snapshot.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    const ext = { economy: { keep: 1, ext: { other: 'plugin-owned nested data' } },
      other: { keep: 2 }, retired: { secret: 'historical disabled namespace' } };
    for (const hook of ['claim', 'bid'] as const) {
      const result = await evaluateHooks(p.root, loadConfig(p.file), hook,
        { task: { id: 'work#1.1', ext }, bid: { ext } }, { origin: 'mcp', executor: 'mesh' });
      for (const name of ['economy', 'other']) {
        const seen = result.facts[`${name}.seen`] as any;
        expect(Object.keys(seen.input.subject.task.ext)).toEqual([name]);
        expect(Object.keys(seen.input.subject.bid.ext)).toEqual([name]);
        expect(seen.input.subject.task.ext[name]).toEqual(ext[name as 'economy' | 'other']);
        expect(JSON.stringify(seen)).not.toContain('historical disabled namespace');
      }
    }
    expect(ext.retired.secret).toBe('historical disabled namespace');
    expect(ext.economy.ext.other).toBe('plugin-owned nested data');
  }, 60000);
});
