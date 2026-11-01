import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { READ_TOOLS, WRITE_TOOLS } from '../src/mcp/tools.js';
import { REPO_ROOT } from './helpers.js';

const DOCUMENTS = ['docs/en/11-mcp-use-cases.md', 'docs/en/27-mcp-integrations-example.md',
  'assets/guide/en/mcp.md'];
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

describe('Public MCP documentation matches the declared schemas', () => {
  it.each(DOCUMENTS)('%s inventories every current core read and board write tool', (file) => {
    const document = read(file);
    expect(document).toContain(`${READ_TOOLS.length} core read tools`);
    expect(document).toContain(`${WRITE_TOOLS.length} core board write tools`);
    for (const tool of [...READ_TOOLS, ...WRITE_TOOLS]) expect(document, tool.name).toContain(`\`${tool.name}\``);
    expect(document).not.toMatch(/11 read tools|four board write tools|one CLI process per tool call/i);
  });

  it.each(DOCUMENTS)('%s describes work-item extensions and authenticated export attribution', (file) => {
    const document = read(file);
    const extensionTools = [...READ_TOOLS, ...WRITE_TOOLS].filter((tool) => tool.extensions).map((tool) => tool.name);
    expect(extensionTools.sort()).toEqual(['board_bid', 'board_claim', 'task_export']);
    for (const field of ['ext', 'executor', 'executor_token_required', 'task.exported']) {
      expect(document, field).toContain(`\`${field}\``);
    }
    expect(document).toMatch(/stdio/);
    expect(document).toMatch(/server.token/i);
    expect(document).toMatch(/tokenless/i);
  });

  it.each(DOCUMENTS)('%s explains accepted dynamic plugin tools and protocol-only stdout', (file) => {
    const document = read(file);
    expect(document).toContain('economy__read');
    expect(document).toMatch(/accepted/);
    expect(document).toMatch(/person-only/);
    expect(document).toMatch(/stdout/);
    expect(document).toMatch(/protocol/);
  });
});
