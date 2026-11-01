import * as fs from 'node:fs';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { readStore } from '../dist/plugins/store.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';

describe('Lossless pending events are operationally visible', () => {
  it('actual guest progress continues with logging disabled, doctor reports backlog, recovery drains it', async () => {
    const p = await pluginProject({ output: 'committed', state: { counter: 1 },
      events: [{ name: 'sampled', data: { keep: true } }] });
    p.raw.log = { ...(p.raw.log as object), enabled: false };
    fs.writeFileSync(p.file, stringify(p.raw));
    for (let i = 0; i < 2; i++) {
      const result = p.cli(['economy', 'record', '--executor', 'mesh', '--request', pluginRequest(), '--json']);
      expect(result.code, result.stdout + result.stderr).toBe(0);
    }
    const store = readStore(p.root, 'economy')!;
    expect(store.revision).toBe(2);
    expect(store.pending).toHaveLength(2);
    const check = p.cli(['doctor', '--json']).json().checks
      .find((entry: { check: string }) => entry.check === 'plugin economy pending events');
    expect(check).toMatchObject({ status: 'warn', code: 'plugin_log_pending' });
    expect(check.message).toContain('2 records');
    expect(check.message).toContain(`${Buffer.byteLength(JSON.stringify(store.pending))} bytes`);
    expect(check.message).toContain(store.pending[0].record.ts);
    p.raw.log = { ...(p.raw.log as object), enabled: true };
    fs.writeFileSync(p.file, stringify(p.raw));
    const recovered = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(recovered.code, recovered.stdout + recovered.stderr).toBe(0);
    expect(recovered.json().projection).toMatchObject({ projected: 2, pending: 0 });
    expect(readStore(p.root, 'economy')).toMatchObject({ revision: 2, pending: [] });
  }, 120000);
});
