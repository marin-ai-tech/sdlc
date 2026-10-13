// A small knowledge server (stdio MCP) for the tests: one resource and one tool.
// FAKE_KB_TEXT is the text of the resource `kb://glossary` (default: a short glossary).
// FAKE_KB_FAIL=1 makes both the resource and the tool answer with an error.
// The tool `search_docs` answers `Answer for: <query>`.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const failing = process.env.FAKE_KB_FAIL === '1';
const glossary = process.env.FAKE_KB_TEXT ?? '# Glossary\n\nClaim: a request for payment under a policy.\n';

const server = new Server({ name: 'fake-knowledge', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: 'kb://glossary', name: 'Glossary', mimeType: 'text/markdown' }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (failing) throw new Error('knowledge server is down');
  if (request.params.uri !== 'kb://glossary') throw new Error(`unknown resource ${request.params.uri}`);
  return { contents: [{ uri: 'kb://glossary', mimeType: 'text/markdown', text: glossary }] };
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'search_docs',
    description: 'Search the team documentation',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (failing) return { isError: true, content: [{ type: 'text', text: 'down' }] };
  const query = request.params.arguments?.query ?? '';
  return { content: [{ type: 'text', text: `Answer for: ${query}` }] };
});

await server.connect(new StdioServerTransport());
