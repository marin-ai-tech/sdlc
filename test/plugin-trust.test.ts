import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';
import { parse, stringify } from 'yaml';
import { capturePackage } from '../dist/plugins/package.js';
import { manifest, packageFiles } from './fixtures/plugin-modules.js';
import { parseManifest } from '../dist/plugins/manifest.js';
import { invoke } from '../dist/plugins/runtime.js';
import { genesis } from '../dist/plugins/store.js';
import { pluginProject } from './fixtures/plugin-project.js';

async function configuredProject() {
  const root = tempDir('sdlc-plugin-trust-');
  const env = humanEnv(tempDir('sdlc-plugin-home-'));
  initGitRepo(root);
  const cli = (args: string[], extra = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const p = await packageFiles(root);
  const snapshot = capturePackage(root, p.source);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(fs.readFileSync(file, 'utf8'));
  config.plugins = { economy: { package: p.source, digest: snapshot.digest, enabled: true, config: {} } };
  fs.writeFileSync(file, stringify(config));
  return { root, cli, p, snapshot, file };
}

describe('Plugin trust: independent CLI acceptance baseline', () => {
  it('No plugins', () => {
    const root = tempDir('sdlc-plugin-empty-');
    const env = humanEnv(tempDir('sdlc-plugin-home-'));
    initGitRepo(root);
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    const result = runCli(['plugins', 'list', '--json'], root, env);
    expect(result.code, result.stderr).toBe(0);
    expect(result.json().plugins).toEqual([]);
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/plugins'))).toBe(false);
    expect(runCli(['help', '--json'], root, env).code).toBe(0);
  });

  it('Acceptance has no executable side effects', async () => {
    const p = await configuredProject();
    expect(p.cli(['plugins', 'list', '--json']).json().plugins[0]).toMatchObject({ active: false, accepted: false });
    const accepted = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    expect(accepted.json()).toMatchObject({ name: 'economy', digest: p.snapshot.digest, status: 'accepted' });
    const store = JSON.parse(fs.readFileSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store).toMatchObject({ revision: 0, data: {}, pending: [], receipts: [] });
    expect(p.cli(['plugins', 'list', '--json']).json().plugins[0].active).toBe(true);
  });

  it('Agent cannot accept or revoke, including with the general approval switch off', async () => {
    const p = await configuredProject();
    const cfg = parse(fs.readFileSync(p.file, 'utf8'));
    cfg.enforcement.forbid_agent_approvals = false;
    fs.writeFileSync(p.file, stringify(cfg));
    const denied = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json'], { SDLC_AGENT: 'test' });
    expect(denied.json().status[0].code).toBe('agent_cannot_approve');
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/plugins/registry.json'))).toBe(false);
  });

  it('Changed package or wrong expected digest', async () => {
    const p = await configuredProject();
    const wrong = p.cli(['plugins', 'accept', 'economy', '--expect-digest', `sha256:${'0'.repeat(64)}`, '--json']);
    expect(wrong.json().status[0].code).toBe('plugin_changed');
    expect(p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']).code).toBe(0);
    fs.writeFileSync(path.join(p.p.dir, 'README.md'), 'A changed supporting file');
    expect(p.cli(['plugins', 'list', '--json']).json().plugins[0]).toMatchObject({ active: false });
    expect(p.cli(['plugins', 'list', '--json']).json().plugins[0].problems.some((x: { code: string }) => x.code === 'plugin_changed')).toBe(true);
  });

  it('retains state identity across revocation and refuses a deleted initialized store', async () => {
    const p = await configuredProject();
    const accept = () => p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    const first = accept().json();
    expect(p.cli(['plugins', 'revoke', 'economy', '--json']).code).toBe(0);
    expect(accept().json().stateId).toBe(first.stateId);
    fs.unlinkSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'));
    expect(accept().json().status[0].code).toBe('plugin_store');
  });

  it('reuses only an exact untouched orphan genesis after an interrupted first acceptance', async () => {
    const p = await pluginProject({ output: 1 }, {}, {}, false);
    const store = genesis(p.root, 'economy', {}, { source: p.p.source, digest: p.snapshot.digest });
    const accepted = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    expect(accepted.json().stateId).toBe(store.stateId);
    const q = await pluginProject({ output: 1 }, {}, {}, false);
    genesis(q.root, 'economy', {}, { source: q.p.source, digest: `sha256:${'f'.repeat(64)}` });
    const refused = q.cli(['plugins', 'accept', 'economy', '--expect-digest', q.snapshot.digest, '--json']);
    expect(refused.json().status[0].code).toBe('plugin_store');
    expect(fs.existsSync(path.join(q.root, 'openspec/.sdlc/plugins/registry.json'))).toBe(false);
  });

  it('doctor validates stored state in a bounded worker without calling a looping allocator', async () => {
    const p = await pluginProject({ output: 1 }, { initialState: { counter: 0 }, schemas: {
      config: true, state: { type: 'object', properties: { counter: { type: 'integer' } }, required: ['counter'], additionalProperties: false }, facts: true,
    } }, { alloc: '(loop $spin (br $spin)) (i32.const 0)' });
    const first = p.cli(['doctor', '--json']).json();
    expect(first.checks.find((check: { check: string }) => check.check === 'plugin runtime economy').status).toBe('ok');
    const file = path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.data.counter = 'corrupt';
    fs.writeFileSync(file, JSON.stringify(raw));
    const before = fs.readFileSync(file);
    const broken = p.cli(['doctor', '--json']).json();
    expect(broken.checks.find((check: { check: string }) => check.check === 'plugin runtime economy'))
      .toMatchObject({ status: 'error', code: 'plugin_schema' });
    expect(fs.readFileSync(file)).toEqual(before);
  });
});

describe('Strict package closure and schemas', () => {
  it.each(['sdlc', 'core', 'gate', 'plugin', 'plugins', 'task', 'mcp', 'constructor', 'prototype', 'Bad_Name'])
    ('Core command collision and invalid namespace: %s', (name) => {
      expect(() => parseManifest(manifest({ name }))).toThrow();
    });

  it.each([{ api: '^2.0.0' }, { initialState: undefined }, { entry: 'plugin.js' },
    { hooks: { claim: 'record' } }, { commands: { invalid: 'missing' } }, { version: 'latest' }])
    ('refuses invalid manifest %j', (override) => expect(() => parseManifest(manifest(override))).toThrow());

  it('Snapshot digest covers supporting bytes, raw manifest formatting, and unsafe links', async () => {
    const root = tempDir('sdlc-plugin-package-');
    const p = await packageFiles(root);
    const first = capturePackage(root, p.source).digest;
    fs.appendFileSync(path.join(p.dir, 'sdlc-plugin.json'), '\n');
    expect(capturePackage(root, p.source).digest).not.toBe(first);
    fs.linkSync(path.join(p.dir, 'plugin.wasm'), path.join(p.dir, 'alias.wasm'));
    expect(() => capturePackage(root, p.source)).toThrow(/unlinked/);
    expect(() => capturePackage(root, '../outside')).toThrow();
  });

  it('Schema compilation refuses remote refs and never inserts defaults or coerces config', async () => {
    const root = tempDir('sdlc-plugin-schema-');
    let p = await packageFiles(root, { output: 1 }, { schemas: {
      config: { type: 'object', properties: { count: { type: 'integer', default: 3 } }, required: ['count'] },
      state: true, facts: true,
    } });
    for (const value of [{}, { count: '3' }]) {
      await expect(invoke(capturePackage(root, p.source), { preflight: true, validate: { kind: 'config', value } }))
        .rejects.toMatchObject({ code: 'plugin_schema' });
    }
    p = await packageFiles(root, { output: 1 }, { schemas: {
      config: { $ref: 'https://example.invalid/never-fetch.json' }, state: true, facts: true,
    } });
    await expect(invoke(capturePackage(root, p.source), { preflight: true })).rejects.toMatchObject({ code: 'plugin_schema' });
  });

  it('resolves captured local schemas while leaving unrelated supporting JSON opaque', async () => {
    const root = tempDir('sdlc-plugin-local-schema-');
    const p = await packageFiles(root, { output: 1 }, { schemas: { config: 'schemas.json#/$defs/config', state: true, facts: true } });
    fs.writeFileSync(path.join(p.dir, 'schemas.json'), JSON.stringify({ $defs: { config: { type: 'object' } } }));
    fs.writeFileSync(path.join(p.dir, 'data.json'), 'A supporting file need not be a schema');
    expect(await invoke(capturePackage(root, p.source), { preflight: true, validate: { kind: 'config', value: {} } })).toBe(null);
  });
});
