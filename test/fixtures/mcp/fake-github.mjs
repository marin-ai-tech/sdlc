// A small stand-in for the GitHub MCP server (stdio), with the tool names and arguments of github/github-mcp-server.
// FAKE_ISSUES=<JSON list> is what `list_issues` answers (open issues and pull requests of the repository).
// FAKE_GITHUB_CALLS=<path>: every call is appended to that file as one JSON line `{ tool, args }`.
// FAKE_GITHUB_FAIL=1 makes the writing tools (`add_issue_comment`, `update_issue`) answer with an error.
import * as fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const repoArgs = { owner: { type: 'string' }, repo: { type: 'string' } };
const tools = [
  {
    name: 'list_issues',
    description: 'List issues in a GitHub repository',
    inputSchema: {
      type: 'object', properties: { ...repoArgs, state: { type: 'string' } }, required: ['owner', 'repo'],
    },
  },
  {
    name: 'add_issue_comment',
    description: 'Add a comment to an issue',
    inputSchema: {
      type: 'object',
      properties: { ...repoArgs, issue_number: { type: 'number' }, body: { type: 'string' } },
      required: ['owner', 'repo', 'issue_number', 'body'],
    },
  },
  {
    name: 'update_issue',
    description: 'Update an issue',
    inputSchema: {
      type: 'object',
      properties: { ...repoArgs, issue_number: { type: 'number' }, state: { type: 'string' } },
      required: ['owner', 'repo', 'issue_number'],
    },
  },
];

function record(tool, args) {
  const file = process.env.FAKE_GITHUB_CALLS;
  if (file) fs.appendFileSync(file, `${JSON.stringify({ tool, args: args ?? {} })}\n`);
}

function text(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

const server = new Server({ name: 'fake-github', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  record(name, args);
  if (name === 'list_issues') return text(JSON.parse(process.env.FAKE_ISSUES ?? '[]'));
  if (name === 'add_issue_comment' || name === 'update_issue') {
    if (process.env.FAKE_GITHUB_FAIL === '1') return { isError: true, content: [{ type: 'text', text: 'boom' }] };
    return text({ ok: true });
  }
  return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
});

await server.connect(new StdioServerTransport());
