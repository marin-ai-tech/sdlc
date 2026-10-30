import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { capturePackage } from '../dist/plugins/package.js';
import { listedPluginTools, callPluginTool } from '../dist/plugins/mcp.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';

describe('Project-bound plugin MCP boundary', () => {
  it('Plugin command runs with typed JSON and authenticated project executor', async () => {
    const p = await pluginProject({ output: [1, true] });
    const projects = [{ name: 'alpha', root: p.root }];
    expect(listedPluginTools(projects).map((item) => item.name)).toEqual(['economy__read']);
    expect(listedPluginTools(projects, { project: 'alpha', executor: 'mesh' }).map((item) => item.name))
      .toEqual(['economy__read', 'economy__record']);
    const result = await callPluginTool('economy__record', { input: { nested: [true, 1, null] }, request: pluginRequest() },
      projects, { project: 'alpha', executor: 'mesh' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ plugin: 'economy', output: [1, true] });
    expect(result.structuredContent).toHaveProperty('transaction');
  });

  it('Hidden MCP direct call and Standard client and mutating tool', async () => {
    const p = await pluginProject({ output: 1 }, {}, { call: '(loop $forever (br $forever)) (i64.const 0)' });
    const projects = [{ name: 'alpha', root: p.root }];
    for (const name of ['economy__configure', 'economy__record']) {
      const result = await callPluginTool(name, { input: {}, request: pluginRequest() }, projects);
      expect(result.isError).toBe(true);
      expect(result.structuredContent!.status[0].code).toBe('plugin_access');
    }
    const store = JSON.parse(fs.readFileSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store.revision).toBe(0);
    const q = await pluginProject({ output: 1 }, {}, {}, false);
    expect(listedPluginTools([{ name: 'untrusted', root: q.root }])).toEqual([]);
    expect((await callPluginTool('economy__read', { input: {} }, [{ name: 'untrusted', root: q.root }])).isError).toBe(true);
  }, 15_000);

  it('Executor token for another project and forged routing fields', async () => {
    const p = await pluginProject();
    const projects = [{ name: 'alpha', root: p.root }];
    for (const caller of [{ project: 'beta', executor: 'mesh' }, { executor: 'mesh' }]) {
      expect((await callPluginTool('economy__record', { input: {}, request: pluginRequest() }, projects, caller)).isError).toBe(true);
    }
    for (const field of ['project', 'executor', 'origin', 'request']) {
      const result = await callPluginTool('economy__read', { input: { [field]: 'forged' } }, projects);
      expect(result.isError).toBe(true);
    }
    expect((await callPluginTool('economy__read', { input: {}, executor: 'mesh' }, projects)).isError).toBe(true);
  });

  it('Catalog becomes stale after trust revocation or package edits', async () => {
    const p = await pluginProject();
    const projects = [{ name: 'alpha', root: p.root }];
    expect(listedPluginTools(projects)).toHaveLength(1);
    expect(p.cli(['plugins', 'revoke', 'economy', '--json']).code).toBe(0);
    expect(listedPluginTools(projects)).toEqual([]);
    expect((await callPluginTool('economy__read', { input: {} }, projects)).isError).toBe(true);
    expect(p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']).code).toBe(0);
    fs.writeFileSync(path.join(p.p.dir, 'changed.txt'), 'changed');
    expect((await callPluginTool('economy__read', { input: {} }, projects)).isError).toBe(true);
  });

  it('Reserved or ambiguous name: incompatible cross-project descriptors are omitted and refused', async () => {
    const p = await pluginProject();
    const q = await pluginProject({ output: 1 }, { operations: { read: { access: 'read', input: { type: 'integer' }, output: true } },
      commands: { read: 'read' }, tools: { read: 'read' } });
    const projects = [{ name: 'alpha', root: p.root }, { name: 'beta', root: q.root }];
    expect(listedPluginTools(projects).map((item) => item.name)).not.toContain('economy__read');
    const result = await callPluginTool('economy__read', { input: {}, project: 'alpha' }, projects);
    expect(result.structuredContent!.status[0].code).toBe('plugin_tool_conflict');
  });

  it('Read tool returns a write and disabled plugins remain unavailable', async () => {
    const p = await pluginProject({ output: 1, state: { changed: true } });
    const projects = [{ name: 'alpha', root: p.root }];
    const result = await callPluginTool('economy__read', { input: {} }, projects);
    expect(result.structuredContent!.status[0].code).toBe('plugin_effect');
    p.raw.plugins.economy.enabled = false;
    fs.writeFileSync(p.file, stringify(p.raw));
    expect(listedPluginTools(projects)).toEqual([]);
    expect((await callPluginTool('economy__read', { input: {} }, projects)).isError).toBe(true);
  });

  it('published nested JSON schemas resolve captured references and runtime does not coerce input', async () => {
    const p = await pluginProject({ output: 1 }, { operations: {
      read: { access: 'read', input: 'input.json#/$defs/value', output: true },
    }, commands: { read: 'read' }, tools: { read: 'read' } }, {}, false);
    fs.writeFileSync(path.join(p.p.dir, 'input.json'), JSON.stringify({ $defs: { value: {
      type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false,
    } } }));
    p.raw.plugins.economy.digest = capturePackage(p.root, p.p.source).digest;
    fs.writeFileSync(p.file, stringify(p.raw));
    expect(p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.raw.plugins.economy.digest, '--json']).code).toBe(0);
    const projects = [{ name: 'alpha', root: p.root }];
    const schema = listedPluginTools(projects)[0].inputSchema;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate({ input: { count: 3 } })).toBe(true);
    expect(validate({ input: { count: '3' } })).toBe(false);
    expect((await callPluginTool('economy__read', { input: { count: '3' } }, projects)).isError).toBe(true);
    expect((await callPluginTool('economy__read', { input: { count: 3 } }, projects)).isError).toBeUndefined();
  });
});
