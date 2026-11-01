import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStore } from '../dist/plugins/store.js';
import { atomicStored, storagePath } from '../dist/plugins/activation.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';

function nested(depth: number): any {
  let result: any = 'leaf';
  for (let i = 0; i < depth; i++) result = { child: result };
  return result;
}

describe('Actual guest response and persisted state depth', () => {
  it('replays a retained v1 full receipt through the real CLI without leaking state or repeating effects', async () => {
    const p = await pluginProject({ output: 'original', facts: { valid: true }, state: { saved: 1 } });
    const request = pluginRequest();
    const args = ['economy', 'record', '--executor', 'mesh', '--request', request, '--json'];
    const first = p.cli(args);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    const store = readStore(p.root, 'economy')!;
    const legacy = { ...store, receipts: store.receipts.map(item => ({ ...item, result: {
      output: 'original', facts: { valid: true }, state: { saved: 1 }, events: [],
    } })) };
    atomicStored(p.root, 'state/economy/store.json', legacy);
    const file = storagePath(p.root, 'state/economy/store.json');
    const before = fs.readFileSync(file);
    const replay = p.cli(args);
    expect(replay.code, replay.stdout + replay.stderr).toBe(0);
    expect(replay.json()).toMatchObject({ request, output: 'original', facts: { valid: true } });
    expect(replay.json()).not.toHaveProperty('state');
    expect(replay.json()).not.toHaveProperty('events');
    expect(fs.readFileSync(file)).toEqual(before);
    expect(readStore(p.root, 'economy')).toMatchObject({ revision: 1, data: { saved: 1 }, pending: [] });
  }, 60000);

  it.each([32, 33])('actual record command handles guest state at depth%s atomically', async depth => {
    const data = nested(depth);
    const p = await pluginProject({ output: 'stored', state: data });
    const file = storagePath(p.root, 'state/economy/store.json');
    const before = fs.readFileSync(file);
    const request = pluginRequest();
    const args = ['economy', 'record', '--executor', 'mesh', '--request', request, '--json'];
    const result = p.cli(args);
    if (depth === 33) {
      expect(result.code).toBe(1);
      expect(result.json().status[0].code).toBe('plugin_invalid');
      expect(fs.readFileSync(file)).toEqual(before);
      expect(readStore(p.root, 'economy')).toMatchObject({ revision: 0, receipts: [], pending: [] });
      return;
    }
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(readStore(p.root, 'economy')?.data).toEqual(data);
    expect(readStore(p.root, 'economy')?.receipts[0].result).toEqual({ output: 'stored' });
    expect(p.cli(args).json()).toMatchObject({ request, output: 'stored' });
    expect(readStore(p.root, 'economy')?.revision).toBe(1);
  }, 60000);
});
