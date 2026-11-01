import * as fs from 'node:fs';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { pluginProject } from './fixtures/plugin-project.js';

function value(depth: number): any {
  let result: any = 'leaf';
  for (let i = 0; i < depth; i++) result = { child: result };
  return result;
}

describe('Depth through actual public plugin commands', () => {
  it('accepts configuration/input depth32 and refuses depth33 at the guest boundary', async () => {
    const p = await pluginProject({ output: 42 }, {}, {}, false);
    p.raw.plugins.economy.config = value(32);
    fs.writeFileSync(p.file, stringify(p.raw));
    const accepted = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    const read = p.cli(['economy', 'read', '--input-json', JSON.stringify(value(32)), '--json']);
    expect(read.code, read.stdout + read.stderr).toBe(0);
    expect(read.json()).toMatchObject({ plugin: 'economy', output: 42 });
    const denied = p.cli(['economy', 'read', '--input-json', JSON.stringify(value(33)), '--json']);
    expect(denied.code).toBe(1);
    expect(denied.json().status[0].code).toBe('plugin_invalid');
  }, 60000);
});
