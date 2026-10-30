import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../dist/plugins/manifest.js';
import { manifest } from './fixtures/plugin-modules.js';
import { REPO_ROOT } from './helpers.js';

const coreEvents = ['adopt', 'backlog', 'change', 'config', 'deferred', 'executor', 'exploration',
  'gate', 'harness', 'health', 'hook', 'layout', 'license', 'question', 'summary', 'task', 'tests', 'track', 'verify'];
const Ajv = createRequire(import.meta.url)('ajv/dist/2020');
const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas/contracts/plugin-manifest.schema.json'), 'utf8'));
const validManifest = new Ajv({ strict: false }).compile(schema);

describe('Reserves actual core event producer namespaces', () => {
  it.each(coreEvents)('refuses the core event namespace %s in loader and published contract', (name) => {
    const value = manifest({ name });
    expect(() => parseManifest(value)).toThrow(/reserved/);
    expect(validManifest(value)).toBe(false);
  });

  it('keeps the reservation inventory tied to producers, constants and wrapper calls', () => {
    const result = spawnSync(process.execPath, ['test/fixtures/core-event-inventory.mjs'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    expect(result.status, result.stderr).toBe(0);
    const inventory = JSON.parse(result.stdout);
    expect(inventory.namespaces.map((entry: { name: string }) => entry.name)).toEqual(coreEvents);
    // These pass-through wrappers are covered by their known callers in the same inventory.
    // A new unresolved producer requires an explicit audit, instead of silently skipping it.
    expect(inventory.unresolved.map((entry: { source: string; call: string; expression: string }) =>
      `${entry.source.split(':')[0]}|${entry.call}|${entry.expression}`).sort()).toEqual([
      'src/cli/context.ts|appendHistory|event', 'src/cli/context.ts|appendLog|event',
      'src/commands/backlog.ts|appendLog|event', 'src/commands/setup.ts|appendLog|event',
      'src/core/init-layout.ts|appendLog|event',
    ].sort());
  });
});
