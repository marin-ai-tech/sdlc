import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { BIN, git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B48: the sdlc MCP server offers the team's knowledge as read-only resources: context packs (`sdlc://context/<file>`,
 * with owner, source, updated and stale in `_meta`), living specs (`sdlc://spec/<capability>`), change artifacts
 * (`sdlc://change/<id>/<artifact>`) and documents for agents (`sdlc://doc/<path>`: REVIEW.md, AGENTS.md and the
 * layout documents). Never: state files, configuration, the log, the inbox, anything under .claude or .opencode,
 * or a file outside the project.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function project() {
  const root = tempDir('sdlc-mcp-res-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
  expect(runCli(['new', 'add-x', '--json'], root, env).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-x/intent.md'), '# Intent: x\n\nThe intent.\n');
  write(path.join(root, 'openspec/specs/auth/spec.md'), '# auth\n\n### Requirement: Login\n');
  write(path.join(root, 'AGENTS.md'), '# Agents\n\nRules.\n');
  write(path.join(root, 'docs/context/payments.md'), [
    '---', 'owner: alice', 'source: https://wiki.corp.example/payments', `updated: ${today()}`, 'fresh_days: 30',
    'stages: [build]', '---', '', 'Refunds never exceed the charge.', '',
  ].join('\n'));
  write(path.join(root, 'docs/context/old.md'), [
    '---', 'owner: bob', 'source: wiki', 'updated: 2020-01-01', 'fresh_days: 30', 'stages: [build]', '---', '', 'Old.', '',
  ].join('\n'));
  return { root, env };
}

async function connect(root: string, env: NodeJS.ProcessEnv): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [BIN, 'mcp', 'serve'], cwd: root, env: env as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sdlc-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

async function text(client: Client, uri: string): Promise<string> {
  const r = await client.readResource({ uri });
  const first = r.contents[0] as { text?: string };
  return first.text ?? '';
}

describe('sdlc MCP resources', () => {
  it('lists context packs with their marks, specs, change artifacts and agent documents', async () => {
    const p = project();
    const client = await connect(p.root, p.env);
    try {
      const resources = (await client.listResources()).resources;
      const uris = resources.map((r) => r.uri);
      for (const uri of ['sdlc://context/payments.md', 'sdlc://context/old.md', 'sdlc://spec/auth',
        'sdlc://change/add-x/intent', 'sdlc://doc/AGENTS.md', 'sdlc://doc/REVIEW.md']) {
        expect(uris, uri).toContain(uri);
      }
      const old = resources.find((r) => r.uri === 'sdlc://context/old.md');
      expect(old?._meta).toMatchObject({ owner: 'bob', updated: '2020-01-01', stale: true });
      const fresh = resources.find((r) => r.uri === 'sdlc://context/payments.md');
      expect(fresh?._meta).toMatchObject({ owner: 'alice', stale: false });
    } finally {
      await client.close();
    }
  }, 120000);

  it('reads them: a context pack without its header, the others as they are', async () => {
    const p = project();
    const client = await connect(p.root, p.env);
    try {
      expect((await text(client, 'sdlc://context/payments.md')).trim()).toBe('Refunds never exceed the charge.');
      expect(await text(client, 'sdlc://spec/auth')).toContain('Requirement: Login');
      expect(await text(client, 'sdlc://change/add-x/intent')).toContain('The intent.');
      expect(await text(client, 'sdlc://doc/AGENTS.md')).toContain('Rules.');
    } finally {
      await client.close();
    }
  }, 120000);

  it('negative: state, configuration and anything outside the project are never offered or read', async () => {
    const p = project();
    const client = await connect(p.root, p.env);
    try {
      const uris = (await client.listResources()).resources.map((r) => r.uri).join('\n');
      for (const banned of ['.sdlc.yaml', 'log.jsonl', 'inbox', 'roles.yaml', 'sdlc.yaml', '.claude', '.opencode',
        'manifest.json']) {
        expect(uris, banned).not.toContain(banned);
      }
      for (const uri of ['sdlc://doc/openspec/sdlc.yaml', 'sdlc://doc/openspec/changes/add-x/.sdlc.yaml',
        'sdlc://doc/../outside.md', 'sdlc://doc/.claude/settings.json', 'sdlc://change/add-x/.sdlc',
        'sdlc://context/../../openspec/roles.yaml']) {
        await expect(client.readResource({ uri }), uri).rejects.toThrow();
      }
    } finally {
      await client.close();
    }
  }, 120000);
});
