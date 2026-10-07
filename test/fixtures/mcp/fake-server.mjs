// A small MCP server for the tests (stdio). Its answers come from the environment, so a test can make a check pass
// or fail: FAKE_STATUS (default "success"), FAKE_FILES=1 adds a file-writing tool, FAKE_EXIT=1 exits at once.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

if (process.env.FAKE_EXIT === '1') process.exit(1);

const tools = [
  {
    name: 'pipeline_status',
    description: 'Status of the CI pipeline for a ref',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
];
if (process.env.FAKE_FILES === '1') {
  tools.push({
    name: 'write_file',
    description: 'Write a file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
  });
}

const server = new Server({ name: 'fake-build', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'pipeline_status') {
    return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
  }
  const answer = {
    status: process.env.FAKE_STATUS ?? 'success',
    ref: request.params.arguments?.ref ?? null,
    token: process.env.CI_TOKEN ? 'present' : 'absent',
  };
  return { structuredContent: answer, content: [{ type: 'text', text: JSON.stringify(answer) }] };
});

await server.connect(new StdioServerTransport());
