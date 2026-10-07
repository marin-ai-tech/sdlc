import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { HUMAN_COMMANDS } from '../src/core/help-catalog.js';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B13: sdlc as an MCP server, so other AI systems read the process the way the CLI's JSON shows it. `sdlc mcp serve`
 * (stdio) offers read-only tools that answer exactly what `sdlc <command> --json` prints. It never offers a decision:
 * no approve, reject, waive, rework, takeover, test unlock, license, backlog order or uninstall.
 */

const INTENT = [
  '# Intent: export', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

// 0.9.1 adds `guide` (how sdlc works): read-only like the rest, a changed requirement.
const READ_TOOLS = ['audit', 'guide', 'help', 'instructions', 'next', 'status', 'trace'];

function project() {
  const root = tempDir('sdlc-mcp-serve-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/intent.md'), INTENT);
  return { root, env, cli };
}

async function connect(root: string, env: NodeJS.ProcessEnv): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, 'mcp', 'serve'],
    cwd: root,
    env: env as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sdlc-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** The JSON a tool answered: the structured content, which must equal the text content. */
function answer(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((part) => part.type === 'text')?.text ?? '';
  expect(JSON.parse(text)).toEqual(result.structuredContent);
  return result.structuredContent;
}

describe('sdlc mcp serve', () => {
  it('offers only read-only tools, none of the human decisions', async () => {
    const p = project();
    const client = await connect(p.root, p.env);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual(READ_TOOLS);
      const decisions = [...HUMAN_COMMANDS, 'adopt', 'verify', 'tests', 'lock', 'license', 'backlog']
        .map((name) => name.replace(/ /g, '_'));
      for (const name of decisions) expect(names, name).not.toContain(name);
    } finally {
      await client.close();
    }
  }, 120000);

  it('answers what the CLI prints with --json', async () => {
    const p = project();
    const client = await connect(p.root, p.env);
    try {
      const status = answer(await client.callTool({ name: 'status', arguments: { change: 'add-export' } }));
      expect(status).toEqual(p.cli(['status', '--change', 'add-export', '--json']).json());
      const next = answer(await client.callTool({ name: 'next', arguments: { change: 'add-export' } }));
      expect(next).toEqual(p.cli(['next', '--change', 'add-export', '--json']).json());
      const trace = answer(await client.callTool({ name: 'trace', arguments: { change: 'add-export' } }));
      expect(trace).toEqual(p.cli(['trace', 'add-export', '--json']).json());
      const args = { artifact: 'intent', change: 'add-export' };
      const instructions = answer(await client.callTool({ name: 'instructions', arguments: args }));
      expect(instructions).toEqual(p.cli(['instructions', 'intent', '--change', 'add-export', '--json']).json());
    } finally {
      await client.close();
    }
  }, 180000);

  it('reports a CLI error as a tool error with its code, and leaves the records unchanged', async () => {
    const p = project();
    const record = read(path.join(p.root, 'openspec/changes/add-export/.sdlc.yaml'));
    const client = await connect(p.root, p.env);
    try {
      const result = await client.callTool({ name: 'status', arguments: { change: 'no-such-change' } });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content[0].text ?? '').toMatch(/"code"/);
    } finally {
      await client.close();
    }
    expect(read(path.join(p.root, 'openspec/changes/add-export/.sdlc.yaml'))).toBe(record);
  }, 120000);
});

describe('sdlc init --mcp', () => {
  it('registers the sdlc server for the chosen tools and keeps other servers', () => {
    const root = tempDir('sdlc-mcp-init-');
    const env = humanEnv(tempDir('sdlc-home-'));
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { jira: { type: 'http', url: 'https://x' } } }));
    expect(runCli(['init', '--tools', 'claude,opencode', '--mcp', '--json'], root, env).code).toBe(0);
    const claude = JSON.parse(read(path.join(root, '.mcp.json')));
    expect(claude.mcpServers.jira).toEqual({ type: 'http', url: 'https://x' });
    expect(claude.mcpServers.sdlc).toMatchObject({ type: 'stdio', command: 'sdlc', args: ['mcp', 'serve'] });
    const opencode = JSON.parse(read(path.join(root, 'opencode.json')));
    expect(opencode.mcp.sdlc).toMatchObject({ type: 'local', command: ['sdlc', 'mcp', 'serve'] });
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).mcp).toMatchObject({ serve: true });
    // update keeps it; uninstall removes only the sdlc entries.
    expect(runCli(['update', '--json'], root, env).code).toBe(0);
    expect(JSON.parse(read(path.join(root, '.mcp.json'))).mcpServers.sdlc).toBeDefined();
    expect(runCli(['uninstall', '--json'], root, env).code).toBe(0);
    const after = JSON.parse(read(path.join(root, '.mcp.json')));
    expect(after.mcpServers.sdlc).toBeUndefined();
    expect(after.mcpServers.jira).toEqual({ type: 'http', url: 'https://x' });
  }, 180000);

  it('negative: without --mcp no MCP configuration is written', () => {
    const root = tempDir('sdlc-mcp-none-');
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
    expect(fs.existsSync(path.join(root, '.mcp.json'))).toBe(false);
    const opencode = path.join(root, 'opencode.json');
    if (fs.existsSync(opencode)) expect(JSON.parse(read(opencode)).mcp?.sdlc).toBeUndefined();
  }, 120000);
});
