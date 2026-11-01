import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultConfig, serializeConfig } from '../dist/core/config.js';
import { parseManifest } from '../dist/plugins/manifest.js';
import { pluginCommands } from '../dist/plugins/catalog.js';
import { listedPluginTools } from '../dist/plugins/mcp.js';
import { manifest } from './fixtures/plugin-modules.js';
import { REPO_ROOT, tempDir, write } from './helpers.js';

const accepted = vi.hoisted(() => ({ snapshot: undefined as unknown }));
vi.mock('../dist/plugins/trust.js', () => ({
  activePlugin: () => ({ snapshot: accepted.snapshot }), readRegistry: () => ({ plugins: {} }),
}));

function configure(input: unknown) {
  const root = tempDir('sdlc-schema-projection-');
  const parsed = parseManifest(manifest({ operations: { read: { access: 'read', input, output: true } },
    commands: { read: 'read' }, tools: { read: 'read' } }));
  const digest = `sha256:${'a'.repeat(64)}`;
  accepted.snapshot = { source: 'packages/economy', digest, manifest: parsed, files: new Map() };
  const config = defaultConfig();
  config.plugins = { economy: { package: 'packages/economy', digest, enabled: true, config: {} } };
  write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(config)));
  return { root, config };
}

describe('Public schema projection with scoped static references', () => {
  it('preserves escaped JSON pointer tokens and literal Unicode property names', () => {
    const input = { $ref: '#/$defs/space~1%CF%80%25%23~0',
      $defs: { 'space/π%#~': { type: 'integer' } } };
    const p = configure(input);
    const [tool] = listedPluginTools([{ name: 'alpha', root: p.root }]);
    expect(tool).toBeDefined();
    const validate = new Ajv2020({ strict: true }).compile(tool.inputSchema);
    expect(validate({ input: 7 })).toBe(true);
    expect(validate({ input: 'wrong' })).toBe(false);
  });

  it('resolves a harmless nested local id and anchor in its actual identifier scope', () => {
    const input = { $id: 'root.json', type: 'object', properties: { value: { $ref: 'child.json#entry' } },
      required: ['value'], additionalProperties: false,
      $defs: { child: { $id: 'child.json', $anchor: 'entry', type: 'integer' } } };
    const p = configure(input);
    const [tool] = listedPluginTools([{ name: 'alpha', root: p.root }]);
    expect(tool).toBeDefined();
    const validate = new Ajv2020({ strict: true }).compile(tool.inputSchema);
    expect(validate({ input: { value: 7 } })).toBe(true);
    expect(validate({ input: { value: 'wrong' } })).toBe(false);
  });

  it('preserves literal ref-shaped plugin data when nesting the public input schema', () => {
    const literal = { $ref: '#literal-data', project: 'plugin data' };
    const p = configure({ const: literal });
    const [tool] = listedPluginTools([{ name: 'alpha', root: p.root }]);
    expect(tool).toBeDefined();
    const validate = new Ajv2020({ strict: true }).compile(tool.inputSchema);
    expect(validate({ input: literal })).toBe(true);
    expect(validate({ input: { $ref: '#/properties/inputliteral-data', project: 'plugin data' } })).toBe(false);
  });

  it('indexes 8000 local anchor references within one second or explicitly refuses a bounded resource limit', () => {
    const source = path.join(REPO_ROOT, 'dist/plugins/catalog.js');
    const require = createRequire(pathToFileURL(source));
    const original = fs.readFileSync(source, 'utf8');
    const relocated = original.replace(/from '([^']+)'/g, (whole, name: string) => {
      if (name.startsWith('node:')) return whole;
      const target = name.startsWith('.') ? fileURLToPath(new URL(name, pathToFileURL(source))) : require.resolve(name);
      return `from '${pathToFileURL(target).href}'`;
    });
    const file = path.join(tempDir('sdlc-schema-perf-'), 'catalog.mjs');
    fs.writeFileSync(file, `${relocated}\nexport { publicSchema };\n`);
    const probe = [
      'const { publicSchema } = await import(process.argv[1]);',
      'const defs = Object.fromEntries(Array.from({length:8000},(_,i)=>[`f${i}`,true]));',
      'defs.last = { $anchor: "entry", type: "integer" };',
      'const input = { $defs: defs, allOf: Array.from({length:8000},()=>({$ref:"#entry"})) };',
      'const started = performance.now(); let error;',
      'try { publicSchema({files:new Map()},input); } catch(e) { error={code:e.code,message:e.message}; }',
      'console.log(JSON.stringify({duration:performance.now()-started,error,bytes:Buffer.byteLength(JSON.stringify(input))}));',
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe, pathToFileURL(file).href], {
      encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
    });
    expect(child.error, 'public projection must finish within its independently killed process').toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.bytes).toBeLessThan(256 * 1024 - 1024);
    expect(result.duration).toBeLessThan(1000);
    if (result.error) {
      expect(result.error.code).toMatch(/^plugin_(schema|limit)$/);
      expect(result.error.message).toMatch(/limit|bound|exceed|too many/i);
    }
  }, 20000);
});
