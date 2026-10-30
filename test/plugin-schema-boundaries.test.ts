import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { loadConfig, saveConfig } from '../dist/core/config.js';
import { parsePlugins } from '../dist/plugins/config.js';
import { capturePackage } from '../dist/plugins/package.js';
import { invoke } from '../dist/plugins/runtime.js';
import { callPluginTool, listedPluginTools } from '../dist/plugins/mcp.js';
import { packageFiles } from './fixtures/plugin-modules.js';
import { pluginProject } from './fixtures/plugin-project.js';
import { tempDir } from './helpers.js';

const exposure = (input: unknown) => ({
  operations: { read: { access: 'read', input, output: true } },
  commands: { read: 'read' }, tools: { read: 'read' },
});
const field = (name: string) => ({
  type: 'object', properties: { [name]: { type: 'string' } }, required: [name],
});

async function preflight(input: unknown, documents: Record<string, unknown> = {}) {
  const root = tempDir('sdlc-schema-routing-');
  const p = await packageFiles(root, { output: 42 }, exposure(input), { call: '(unreachable)' });
  for (const [name, document] of Object.entries(documents)) {
    fs.writeFileSync(path.join(p.dir, name), JSON.stringify(document));
  }
  return invoke(capturePackage(root, p.source), { preflight: true });
}

describe('Operation schema routing ownership', () => {
  it.each(['project', 'executor', 'origin', 'request'])('preflight refuses root declaration %s', async (name) => {
    await expect(preflight(field(name))).rejects.toMatchObject({ code: 'plugin_schema' });
    await expect(preflight({ type: 'object', properties: { [name]: true } }))
      .rejects.toMatchObject({ code: 'plugin_schema' });
  });

  it.each(['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas'])
    ('preflight follows root-applying %s schemas', async (keyword) => {
      const blocked = field('request');
      const input = keyword === 'dependentSchemas'
        ? { type: 'object', dependentSchemas: { payload: blocked } }
        : ['allOf', 'anyOf', 'oneOf'].includes(keyword) ? { [keyword]: [blocked] }
        : keyword === 'if' ? { if: blocked, then: true }
        : keyword === 'then' ? { if: true, then: blocked }
        : keyword === 'else' ? { if: false, else: blocked } : { [keyword]: blocked };
      await expect(preflight(input)).rejects.toMatchObject({ code: 'plugin_schema' });
    });

  it('follows inline pointers, package-local references and anchors at the input root', async () => {
    await expect(preflight({ $ref: '#/$defs/input', $defs: { input: field('project') } }))
      .rejects.toMatchObject({ code: 'plugin_schema' });
    await expect(preflight('input.json#/$defs/input', {
      'input.json': { $defs: { input: { allOf: [{ $ref: 'routing.json#routing' }] } } },
      'routing.json': { $anchor: 'routing', ...field('origin') },
    })).rejects.toMatchObject({ code: 'plugin_schema' });
  });

  it('follows the effective local $id scope of a referenced input fragment', async () => {
    await expect(preflight('input.json#/$defs/input', {
      'input.json': { $id: 'scope/input.json', $defs: { input: { $ref: '#/$defs/routing' },
        routing: field('origin') } },
    })).rejects.toMatchObject({ code: 'plugin_schema' });
  });

  it('leaves object elements of a plugin-owned array outside root routing declarations', async () => {
    await expect(preflight({ type: 'array', items: field('executor') })).resolves.toBeNull();
  });

  it('refuses root required names even when their declaration is composed separately', async () => {
    await expect(preflight({ type: 'object', properties: { executor: true },
      allOf: [{ required: ['executor'] }] })).rejects.toMatchObject({ code: 'plugin_schema' });
    await expect(preflight({ type: 'object', dependentRequired: { data: ['executor'] } }))
      .rejects.toMatchObject({ code: 'plugin_schema' });
  });

  it('refuses real acceptance before publishing unusable MCP descriptors or creating state', async () => {
    const p = await pluginProject({ output: 42 }, exposure(field('executor')), { call: '(unreachable)' }, false);
    const acceptance = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(acceptance.code, acceptance.stdout + acceptance.stderr).toBe(1);
    expect(acceptance.json().status[0].code).toBe('plugin_schema');
    expect(listedPluginTools([{ name: 'alpha', root: p.root }])).toEqual([]);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/plugins/registry.json'))).toBe(false);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'))).toBe(false);
  });

  it('keeps nested identity-like plugin data valid in the public descriptor and actual MCP call', async () => {
    const input = { type: 'object', properties: { data: { $ref: '#/$defs/payload' } }, required: ['data'],
      additionalProperties: false, $defs: { payload: { type: 'object', required: ['project', 'executor', 'origin', 'request'],
        properties: { project: { type: 'string' }, executor: { type: 'string' }, origin: { type: 'string' },
          request: { type: 'string' } }, additionalProperties: false } } };
    const p = await pluginProject({ output: 42 }, exposure(input));
    const projects = [{ name: 'alpha', root: p.root }];
    const [tool] = listedPluginTools(projects);
    expect(tool.name).toBe('economy__read');
    const value = { data: { project: 'plugin-project', executor: 'plugin-executor', origin: 'plugin-origin',
      request: 'plugin-request' } };
    expect(new Ajv2020({ strict: true }).compile(tool.inputSchema)({ input: value })).toBe(true);
    const result = await callPluginTool(tool.name, { input: value }, projects);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ output: 42 });
    for (const name of ['project', 'executor', 'origin', 'request']) {
      const forged = await callPluginTool(tool.name, { input: { ...value, [name]: 'forged' } }, projects);
      expect(forged.structuredContent!.status[0].code).toBe('plugin_input');
    }
  });
});

describe('Null configuration contract', () => {
  it('defaults only absent configuration and preserves explicit null through parse/save/load', async () => {
    const p = await pluginProject(undefined, {}, {}, false);
    const setting = p.raw.plugins.economy;
    const { config: _config, ...absent } = setting;
    expect(parsePlugins({ economy: absent })!.economy.config).toEqual({});
    expect(() => parsePlugins({ economy: { ...setting, config: undefined } })).toThrow();
    expect(parsePlugins({ economy: { ...setting, config: null } })!.economy.config).toBeNull();
    p.raw.plugins.economy.config = null;
    fs.writeFileSync(p.file, stringify(p.raw));
    const config = loadConfig(p.file);
    expect(config.plugins!.economy.config).toBeNull();
    config.log.hookDecisions = !config.log.hookDecisions;
    saveConfig(p.file, config);
    expect(loadConfig(p.file).log.hookDecisions).toBe(config.log.hookDecisions);
    expect(loadConfig(p.file).plugins!.economy.config).toBeNull();
  });

  it('accepts a real null-schema package and passes null unchanged into worker validation', async () => {
    const p = await pluginProject({ output: 'null config accepted' }, {
      schemas: { config: { type: 'null' }, state: true, facts: { type: 'object' } },
    }, {}, false);
    p.raw.plugins.economy.config = null;
    fs.writeFileSync(p.file, stringify(p.raw));
    const accepted = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    const result = await callPluginTool('economy__read', { input: {} }, [{ name: 'alpha', root: p.root }]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ output: 'null config accepted' });
    await expect(invoke(p.snapshot, { preflight: true, validate: { kind: 'config', value: {} } }))
      .rejects.toMatchObject({ code: 'plugin_schema' });
  });
});
