import * as fs from 'node:fs';
import * as path from 'node:path';
import wabtFactory from 'wabt';

export interface GuestOptions {
  imports?: string; memory?: string; table?: string; start?: string;
  alloc?: string; call?: string; grow?: boolean; bytes?: Uint8Array;
}

export async function guest(response: unknown, options: GuestOptions = {}): Promise<Buffer> {
  const wabt = await wabtFactory();
  const bytes = Buffer.from(options.bytes ?? Buffer.from(JSON.stringify(response)));
  const data = [...bytes].map((byte) => `\\${byte.toString(16).padStart(2, '0')}`).join('');
  const wat = ['(module', options.imports ?? '',
    options.memory ?? '(import "sdlc" "memory" (memory 16 1024))',
    '(export "memory" (memory 0))', options.table ?? '', options.start ?? '',
    `(data (i32.const 128) "${data}")`,
    `(func (export "sdlc_alloc") (param i32) (result i32) ${options.alloc ?? '(i32.const 4096)'})`,
    '(func (export "sdlc_call") (param i32 i32) (result i64)',
    options.grow ? '(drop (memory.grow (i32.const 0)))' : '',
    options.call ?? `(i64.or (i64.shl (i64.const 128) (i64.const 32)) (i64.const ${bytes.length}))`,
    '))'].join('\n');
  const module = wabt.parseWat('plugin.wat', wat);
  try { return Buffer.from(module.toBinary({ canonicalize_lebs: true }).buffer); }
  finally { module.destroy(); }
}

export function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format: 'sdlc.plugin/1', name: 'economy', version: '1.0.0', api: '^1.0.0', entry: 'plugin.wasm',
    initialState: {}, schemas: { config: true, state: true, facts: { type: 'object' }, taskExt: true, bidExt: true },
    operations: {
      read: { access: 'read', input: true, output: true },
      record: { access: 'executor', input: true, output: true },
      configure: { access: 'person', input: true, output: true },
    },
    commands: { read: 'read', record: 'record', configure: 'configure' },
    tools: { read: 'read', record: 'record', configure: 'configure' },
    hooks: {}, events: { sampled: true }, ...overrides,
  };
}

export async function packageFiles(root: string, response: unknown = { output: 42 },
  overrides: Record<string, unknown> = {}, options: GuestOptions = {}) {
  const dir = path.join(root, 'packages/economy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sdlc-plugin.json'), JSON.stringify(manifest(overrides), null, 2));
  fs.writeFileSync(path.join(dir, 'plugin.wasm'), await guest(response, options));
  return { dir, source: 'packages/economy' };
}
