import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readStore } from '../dist/plugins/store.js';
import { withPluginLock } from '../dist/plugins/activation.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { REPO_ROOT } from './helpers.js';

describe('Non-authoritative recovery file diagnostics', () => {
  it('reports retained files after a real pre-rename crash without using or removing their bytes', async () => {
    const p = await pluginProject();
    const state = readStore(p.root, 'economy')!;
    const request = pluginRequest();
    const storeModule = new URL('../dist/plugins/store.js', import.meta.url).href;
    const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
      fs.renameSync=()=>process.exit(92);syncBuiltinESMExports();
      const {commitStore}=await import(${JSON.stringify(storeModule)});
      commitStore(${JSON.stringify(p.root)},${JSON.stringify(state)},${JSON.stringify(request)},
        {},{output:'retained',state:{uncommitted:true}},[]);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script],
      { cwd: REPO_ROOT, env: p.env, timeout: 10000 });
    expect(child.status, child.stderr?.toString()).toBe(92);
    const directory = path.join(p.root, 'openspec/.sdlc/plugins');
    const stateDir = path.join(directory, 'state/economy');
    const stateTmp = fs.readdirSync(stateDir).find((file) => file.endsWith('.tmp'))!;
    expect(stateTmp).toMatch(/^store\.json\..+\.tmp$/);
    const registryTmp = `registry.json.${randomUUID()}.tmp`;
    fs.copyFileSync(path.join(directory, 'registry.json'), path.join(directory, registryTmp));
    const files = [registryTmp, `state/economy/${stateTmp}`];
    const contents = files.map((file) => fs.readFileSync(path.join(directory, file)));
    const authoritative = fs.readFileSync(path.join(stateDir, 'store.json'));
    const result = p.cli(['plugins', 'recover', 'economy', '--request', request, '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ revision: 0, outcome: { status: 'not_committed' },
      temporaryFilesTruncated: false, temporaryFiles: files.map((file, index) =>
        ({ file, bytes: contents[index].length, authoritative: false })) });
    expect(fs.readFileSync(path.join(stateDir, 'store.json'))).toEqual(authoritative);
    expect(files.map((file) => fs.readFileSync(path.join(directory, file)))).toEqual(contents);
  });

  it('does not inspect or remove a live writer while reporting recovery', async () => {
    const p = await pluginProject();
    const store = path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json');
    const before = fs.readFileSync(store);
    withPluginLock(p.root, 'state/economy/store.lock', () => {
      const result = p.cli(['plugins', 'recover', 'economy', '--json']);
      expect(result.code).toBe(1);
      expect(result.json()).toMatchObject({ status: [{ code: 'plugin_busy' }] });
    });
    expect(fs.readFileSync(store)).toEqual(before);
  });

  it('bounds the temporary-file report without parsing or deleting leftover payloads', async () => {
    const p = await pluginProject();
    const directory = path.join(p.root, 'openspec/.sdlc/plugins');
    for (let index = 0; index < 65; index++) {
      fs.writeFileSync(path.join(directory, `registry.json.${String(index).padStart(2, '0')}.tmp`), 'not JSON');
    }
    const result = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ revision: 0, temporaryFilesTruncated: true });
    expect(result.json().temporaryFiles).toHaveLength(64);
    expect(fs.readdirSync(directory).filter((file) => file.endsWith('.tmp'))).toHaveLength(65);
  });
});
