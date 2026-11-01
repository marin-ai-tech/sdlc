import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { genesis, commitStore, readStore, receipt } from '../src/plugins/store.js';
import { atomicStored, storagePath } from '../src/plugins/activation.js';
import { tempDir } from './helpers.js';

const request = () => `p1.${Date.now()}.${randomUUID().replaceAll('-', '')}`;
const initial = (root: string) => genesis(root, 'economy', {},
  { source: 'packages/economy', digest: `sha256:${'0'.repeat(64)}` });

describe('Bounded lossless stores', () => {
  it('commits twenty 300KB states while retaining only compact reply receipts', () => {
    const root = tempDir('sdlc-compact-store-');
    let store = initial(root);
    for (let i = 0; i < 20; i++) {
      const id = request();
      store = commitStore(root, store, id, { i }, { output: i, facts: { ok: true },
        state: { payload: String(i).padEnd(300000, 'x') } }, []);
      expect(receipt(store, id, { i })?.result).toEqual({ output: i, facts: { ok: true } });
    }
    expect(store.receipts).toHaveLength(20);
    expect(readStore(root, 'economy')?.revision).toBe(20);
    expect(fs.statSync(storagePath(root, 'state/economy/store.json')).size).toBeLessThan(400000);
  });

  it('refuses pending overflow atomically and allows retry after acknowledgement', () => {
    const root = tempDir('sdlc-pending-bound-');
    let store = initial(root);
    const events = Array.from({ length: 1024 }, (_, i) => ({ id: `e-${i}`, record: { value: i } }));
    store = commitStore(root, store, request(), {}, { output: 'full' }, events);
    const before = fs.readFileSync(storagePath(root, 'state/economy/store.json'));
    const id = request();
    expect(() => commitStore(root, store, id, {}, { output: 'overflow', state: 'bad' },
      [{ id: 'overflow', record: { value: 1 } }])).toThrow(/pending|backpressure/i);
    expect(fs.readFileSync(storagePath(root, 'state/economy/store.json'))).toEqual(before);
    expect(readStore(root, 'economy')?.pending).toHaveLength(1024);
    expect(receipt(readStore(root, 'economy')!, id, {})).toBeUndefined();
    atomicStored(root, 'state/economy/store.json', { ...store, pending: [] });
    const retried = commitStore(root, readStore(root, 'economy')!, id, {}, { output: 'retried' },
      [{ id: 'overflow', record: { value: 1 } }]);
    expect(retried.pending).toHaveLength(1);
    expect(receipt(retried, id, {})?.result).toEqual({ output: 'retried' });
  });

  it('retains the supported payload depth independently of the store envelope', () => {
    const root = tempDir('sdlc-depth-store-');
    let data: any = 'leaf';
    for (let i = 0; i < 31; i++) data = { value: data };
    const store = commitStore(root, initial(root), request(), {}, { output: 'ok', state: data }, []);
    expect(readStore(root, 'economy')?.data).toEqual(data);
    expect(store.revision).toBe(1);
  });

  it('refuses the pending byte bound before the record bound without changing state or receipts', () => {
    const root = tempDir('sdlc-pending-byte-bound-');
    const event = (i: number) => ({ id: `large-${i}`, record: {
      plugin: { payload: { text: 'x'.repeat(60000) } },
    } });
    const store = commitStore(root, initial(root), request(), {}, { output: 'below' },
      Array.from({ length: 17 }, (_, i) => event(i)));
    const file = storagePath(root, 'state/economy/store.json');
    const before = fs.readFileSync(file);
    const id = request();
    expect(() => commitStore(root, store, id, {}, { output: 'overflow', state: 'bad' }, [event(17)]))
      .toThrow(/pending|backpressure/i);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(readStore(root, 'economy')?.pending).toHaveLength(17);
    expect(receipt(readStore(root, 'economy')!, id, {})).toBeUndefined();
  });
});
