import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { callTool } from '../src/mcp/call-tool.js';
import { humanEnv, initGitRepo, tempDir, write } from './helpers.js';

describe('Authenticated caller context', () => {
  it('actual CLI actor ignores hostile MCP environment identity', () => {
    const root = tempDir('sdlc-hostile-env-');
    initGitRepo(root);
    const module = new URL('../dist/plugins/broker.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const {cliActor}=await import(${JSON.stringify(module)});console.log(JSON.stringify(cliActor(${JSON.stringify(root)})))`],
    { env: humanEnv(tempDir('sdlc-caller-home-'), { SDLC_MCP_ORIGIN: '1', SDLC_MCP_EXECUTOR: 'forged' }),
      encoding: 'utf8', timeout: 10000 });
    expect(child.status, child.stderr).toBe(0);
    const actor = JSON.parse(child.stdout);
    expect(actor.origin).toBe('cli');
    expect(actor.executor).toBeUndefined();
    expect(actor.person).toContain('pat@example.com');
  });

  it('refuses tokenless export attribution before running a command or logging', async () => {
    const root = tempDir('sdlc-tokenless-export-');
    let called = false;
    const result = await callTool('task_export', { change: 'work', executor: 'forged' }, root,
      async () => { called = true; return { code: 0, stdout: '{}', stderr: '' }; });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: [{ code: 'executor_token_required' }] });
    expect(called).toBe(false);
  });

  it('default direct board read returns values without protocol stdout writes', async () => {
    const root = tempDir('sdlc-mcp-pure-');
    initGitRepo(root);
    write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(defaultConfig())));
    const result = await callTool('board_list', {}, root);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ tasks: [] });
  }, 30000);
});
