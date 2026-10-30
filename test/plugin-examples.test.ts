import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, serializeConfig } from '../dist/core/config.js';
import { guideArticle, guideIndex } from '../dist/core/guide.js';
import { callPlugin } from '../dist/plugins/broker.js';
import type { Actor, Json } from '../dist/plugins/api.js';
import { capturePackage } from '../dist/plugins/package.js';
import { PluginSchemas } from '../dist/plugins/schema.js';
import { readRegistry } from '../dist/plugins/trust.js';
import { readStore } from '../dist/plugins/store.js';
import { BIN, humanEnv, initGitRepo, REPO_ROOT, tempDir, write } from './helpers.js';

const names = ['economy', 'harness-meta'] as const;
const folder = (name: typeof names[number]) => name === 'harness-meta' ? 'harness' : name;
const request = () => `p1.${Date.now()}.${randomUUID().replaceAll('-', '')}`;

function project(name: typeof names[number]) {
  const root = tempDir('sdlc-real-example-');
  const env = humanEnv(tempDir('sdlc-example-person-'));
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  write(path.join(root, 'openspec/executors.yaml'), 'executors:\n  mesh:\n    type: mesh\n    max_risk: high\n');
  const source = `packages/${name}`;
  fs.cpSync(path.join(REPO_ROOT, 'examples/plugins', folder(name)), path.join(root, source), { recursive: true });
  const snapshot = capturePackage(root, source);
  const raw = serializeConfig(defaultConfig());
  raw.plugins = { [name]: { package: source, digest: snapshot.digest, enabled: true, config: { limit: 3 } } };
  const file = path.join(root, 'openspec/sdlc.yaml');
  fs.writeFileSync(file, stringify(raw));
  const cli = (args: string[]) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 15000,
    });
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  const call = (op: string, input: Json = {}, actor: Actor = { origin: 'cli', executor: 'mesh' }, id?: string) =>
    callPlugin(root, loadConfig(file), name, op, input, actor, id);
  const accept = () => {
    const result = cli(['plugins', 'accept', name, '--expect-digest', snapshot.digest, '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
  };
  return { root, raw, file, snapshot, cli, call, accept };
}

describe('runtime plugin reference packages', () => {
  it.each(names)('Operator can safely enable and disable a plugin: %s', async (name) => {
    const p = project(name);
    const inspected = p.cli(['plugins', 'inspect', name, '--json']);
    expect(inspected.code, inspected.stdout + inspected.stderr).toBe(0);
    expect(inspected.stdout).toContain(p.snapshot.digest);
    await expect(p.call('read')).rejects.toMatchObject({ code: 'plugin_unaccepted' });
    p.accept();
    expect((await p.call('read')).facts).toMatchObject({ remaining: 3 });
    const doctor = p.cli(['doctor', '--json']);
    expect(doctor.stdout).toContain(name);
    const storeFile = path.join(p.root, 'openspec/.sdlc/plugins/state', name, 'store.json');
    const before = fs.readFileSync(storeFile);
    const revoked = p.cli(['plugins', 'revoke', name, '--json']);
    expect(revoked.code, revoked.stdout + revoked.stderr).toBe(0);
    await expect(p.call('read')).rejects.toMatchObject({ code: 'plugin_unaccepted' });
    expect(fs.readFileSync(storeFile)).toEqual(before);
    p.accept();
    p.raw.plugins[name].enabled = false;
    fs.writeFileSync(p.file, stringify(p.raw));
    await expect(p.call('read')).rejects.toMatchObject({ code: 'plugin_disabled' });
  }, 30000);

  it.each(names)('Reference examples execute the real path: %s', async (name) => {
    const p = project(name);
    p.accept();
    const count = name === 'economy' ? 'used' : 'probes';
    const quantity = name === 'economy' ? 'units' : 'samples';
    const stateId = readRegistry(p.root).plugins[name].stateId;
    const store = () => readStore(p.root, name, stateId)!;
    const schemas = new PluginSchemas(p.snapshot.files);
    schemas.check(p.snapshot.manifest.schemas.taskExt!, name === 'economy' ? { budget: 3 } : { profile: 'demo' }, 'taskExt');
    schemas.check(p.snapshot.manifest.schemas.bidExt!, name === 'economy' ? { quote: 2 } : { probe: true }, 'bidExt');
    expect(() => schemas.check(p.snapshot.manifest.schemas.taskExt!, { executor: 'forged' }, 'taskExt')).toThrow();
    const initial = store();
    expect((await p.call('guard')).output).toMatchObject({ decision: 'pass' });
    const subject = { state: { [count]: 999 }, operation: 'reset', nested: { limit: 0 } };
    expect((await p.call('guard', { hook: name === 'economy' ? 'claim' : 'result_accept', subject }))
      .output).toMatchObject({ decision: 'pass' });
    expect(store()).toEqual(initial);
    await expect(p.call('record', { [quantity]: '3' }, undefined, request()))
      .rejects.toMatchObject({ code: 'plugin_schema' });
    await expect(p.call('record', { [quantity]: 1 }, { origin: 'cli', executor: 'unknown' }, request()))
      .rejects.toMatchObject({ code: 'plugin_executor' });
    await expect(p.call('reset', {}, { origin: 'mcp', executor: 'mesh' }, request()))
      .rejects.toMatchObject({ code: 'plugin_person_only' });
    const id = request();
    const recorded = await p.call('record', { [quantity]: 3 }, undefined, id);
    expect(recorded.output).toEqual({ [count]: 3, remaining: 0 });
    expect(recorded.facts).toEqual({ [count]: 3, remaining: 0 });
    expect(store().data).toEqual({ [count]: 3 });
    expect(store().revision).toBe(1);
    expect(await p.call('record', { [quantity]: 3 }, undefined, id)).toEqual(recorded);
    expect(store().revision).toBe(1);
    const beforeGuard = store();
    expect((await p.call('guard')).output).toMatchObject({ decision: 'deny', code: 'demo_limit' });
    expect((await p.call('read')).facts).toMatchObject({ remaining: 0 });
    expect(store()).toEqual(beforeGuard);
    const log = fs.readFileSync(path.join(p.root, 'openspec/.sdlc/log.jsonl'), 'utf8');
    const events = log.trim().split('\n').map((line) => JSON.parse(line));
    const charged = events.filter((event) => event.event === `${name}.${name === 'economy' ? 'charged' : 'probed'}`);
    expect(charged).toHaveLength(1);
    expect(charged[0]).toMatchObject({ plugin: { name, request: id, payload: { [quantity]: 3 } } });
    // A separate person environment is restricted to this temporary project, never the checkout.
    const broker = pathToFileURL(path.join(REPO_ROOT, 'dist/plugins/broker.js')).href;
    const config = pathToFileURL(path.join(REPO_ROOT, 'dist/core/config.js')).href;
    const code = `import {callPlugin} from ${JSON.stringify(broker)};
      import {loadConfig} from ${JSON.stringify(config)};
      const [root,file,name,id] = process.argv.slice(2);
      await callPlugin(root,loadConfig(file),name,'reset',{}, {origin:'cli',person:'Pat Owner'},id);`;
    const resetFile = path.join(p.root, 'reset-example.mjs');
    fs.writeFileSync(resetFile, code);
    const reset = spawnSync(process.execPath, [resetFile, p.root, p.file, name, request()], {
      cwd: p.root, env: humanEnv(tempDir('sdlc-example-reset-')), encoding: 'utf8', timeout: 15000,
    });
    expect(reset.status, reset.stdout + reset.stderr).toBe(0);
    expect(store().data).toEqual({ [count]: 0 });
    expect(store().revision).toBe(2);
  }, 30000);

  it('Author sees actual guarantees', () => {
    const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs/en/33-plugins.md'), 'utf8');
    for (const text of ['sdlc.plugin/1', 'sdlc_alloc', 'sdlc_call', '64 MiB', '1,000 ms', '5,000 ms',
      'OS sandbox', 'total-process', 'power-loss', 'economic accounting', 'result_accept', 'file_edit', 'revoke', 'recover']) {
      expect(doc).toContain(text);
    }
    expect(guideIndex('en').topics.some((topic) => topic.id === 'plugins')).toBe(true);
    expect(guideArticle('plugins', 'en').body).toContain('plugins inspect');
  });

  it('rebuilds both complete reference packages deterministically', () => {
    const inventory = () => names.flatMap((name) => fs.readdirSync(path.join(REPO_ROOT, 'examples/plugins', folder(name)))
      .sort().map((file) => `${name}/${file}:${createHash('sha256')
        .update(fs.readFileSync(path.join(REPO_ROOT, 'examples/plugins', folder(name), file))).digest('hex')}`));
    const before = inventory();
    for (let pass = 0; pass < 2; pass++) {
      const build = spawnSync(process.execPath, ['scripts/build-plugins.mjs'], {
        cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
      });
      expect(build.status, build.stdout + build.stderr).toBe(0);
      expect(inventory()).toEqual(before);
    }
  }, 60000);
});
