import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

describe('POSIX directory durability (native Windows: NOT RUN)', () => {
  it.skipIf(process.platform === 'win32').each([false, true])('syncs renamed store directory, failure=%s', failure => {
    const root = tempDir('sdlc-directory-ack-');
    const module = new URL('../dist/plugins/activation.js', import.meta.url).href;
    const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
      const flush=fs.fsyncSync;let directory=false;
      fs.fsyncSync=(fd)=>{if(fs.fstatSync(fd).isDirectory()){directory=true;
        ${failure ? "throw Error('directory ack failed');" : ''}}return flush(fd)};
      syncBuiltinESMExports();const {atomicStored}=await import(${JSON.stringify(module)});
      try{atomicStored(${JSON.stringify(root)},'state/economy/store.json',{committed:true});
        console.log(JSON.stringify({directory}));}
      catch(error){console.log(JSON.stringify({code:error.code,directory}));process.exitCode=1;}`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(failure ? 1 : 0);
    expect(JSON.parse(result.stdout)).toMatchObject({ directory: true,
      ...(failure ? { code: 'plugin_indeterminate' } : {}) });
    expect(JSON.parse(fs.readFileSync(`${root}/openspec/.sdlc/plugins/state/economy/store.json`, 'utf8')))
      .toEqual({ committed: true });
  });
});
