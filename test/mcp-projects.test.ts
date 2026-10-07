import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B46: `sdlc mcp serve --project <path>` (repeatable). A client outside the project (Claude Desktop, a central script)
 * starts the server without a `cd` wrapper. With one project the tools are as before; with several, every tool takes
 * `project` (the name: `project.name` in sdlc.yaml, else the folder name) and `status` without it answers for all.
 * A path that is not an sdlc project, or two projects with one name, stop the server at start.
 */

function project(name?: string) {
  const root = tempDir('sdlc-mcp-proj-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  if (name) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.project = { name };
    write(file, stringify(config));
  }
  expect(runCli(['new', 'add-x', '--json'], root, env).code).toBe(0);
  return { root, env, status: () => runCli(['status', '--json'], root, env).json() };
}

async function serve(args: string[], env: NodeJS.ProcessEnv): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [BIN, 'mcp', 'serve', ...args], cwd: tempDir('sdlc-elsewhere-'),
    env: env as Record<string, string>, stderr: 'pipe',
  });
  const client = new Client({ name: 'sdlc-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

describe('sdlc mcp serve --project', () => {
  it('serves one project from outside its folder, with the tools as before', async () => {
    const p = project('claims');
    const client = await serve(['--project', p.root], p.env);
    try {
      const status = (await client.listTools()).tools.find((tool) => tool.name === 'status');
      expect(Object.keys(status?.inputSchema.properties ?? {})).not.toContain('project');
      const r = await client.callTool({ name: 'status', arguments: {} });
      expect(r.structuredContent).toEqual(p.status());
    } finally {
      await client.close();
    }
  }, 120000);

  it('serves several projects by name; status without a project answers for all', async () => {
    const a = project('claims');
    const b = project();
    const client = await serve(['--project', a.root, '--project', b.root], a.env);
    try {
      const tools = (await client.listTools()).tools;
      for (const tool of tools) expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).toContain('project');
      const one = await client.callTool({ name: 'status', arguments: { project: 'claims' } });
      expect(one.structuredContent).toEqual(a.status());
      const other = await client.callTool({ name: 'status', arguments: { project: path.basename(b.root) } });
      expect(other.structuredContent).toEqual(b.status());
      const all = (await client.callTool({ name: 'status', arguments: {} })).structuredContent as {
        projects: Array<{ project: string; status: unknown }>;
      };
      expect(all.projects.map((x) => x.project)).toEqual(['claims', path.basename(b.root)]);
      expect(all.projects[0].status).toEqual(a.status());
      const missing = await client.callTool({ name: 'next', arguments: {} });
      expect(missing.isError).toBe(true);
      expect(JSON.stringify(missing.content)).toContain('project_required');
      const unknown = await client.callTool({ name: 'status', arguments: { project: 'nope' } });
      expect(unknown.isError).toBe(true);
      expect(JSON.stringify(unknown.content)).toContain('unknown_project');
    } finally {
      await client.close();
    }
  }, 180000);

  it('negative: a folder that is not an sdlc project, or two projects with one name, stop the server', () => {
    const a = project('claims');
    const b = project('claims');
    const notProject = tempDir('sdlc-not-a-project-');
    const bad = runCli(['mcp', 'serve', '--project', notProject], tempDir('sdlc-elsewhere-'), a.env, '');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain(path.basename(notProject));
    const twice = runCli(['mcp', 'serve', '--project', a.root, '--project', b.root], tempDir('sdlc-elsewhere-'), a.env, '');
    expect(twice.code).not.toBe(0);
    expect(twice.stderr).toContain('claims');
  }, 120000);
});
