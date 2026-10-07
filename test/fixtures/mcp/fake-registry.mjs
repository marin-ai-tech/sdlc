// A small team registry over MCP for the tests (stdio): roles and skills read from the JSON file in
// FAKE_REGISTRY_FILE, served through the contract sdlc expects - list_roles, get_role, list_skills, get_skill.
// The file holds { roles: [{ id, version, title, stages, tools, readonly, skills, body, checksum }],
// skills: [{ id, version, title, files: [{ path, content }], checksum }] }; checksums are given as they are, so a test
// can serve a wrong one.
import * as fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const data = JSON.parse(fs.readFileSync(process.env.FAKE_REGISTRY_FILE, 'utf-8'));
const object = (properties = {}) => ({ type: 'object', properties });
const tools = [
  { name: 'list_roles', description: 'Roles of the team', inputSchema: object() },
  { name: 'get_role', description: 'One role', inputSchema: object({ id: { type: 'string' }, locale: { type: 'string' } }) },
  { name: 'list_skills', description: 'Skills of the team', inputSchema: object() },
  { name: 'get_skill', description: 'One skill', inputSchema: object({ id: { type: 'string' } }) },
];

function answer(value) {
  return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function call(name, args) {
  if (name === 'list_roles') {
    return answer({ roles: data.roles.map(({ id, version, title, stages, checksum }) => ({ id, version, title, stages, checksum })) });
  }
  if (name === 'list_skills') {
    return answer({ skills: data.skills.map(({ id, version, title, checksum }) => ({ id, version, title, checksum })) });
  }
  const list = name === 'get_role' ? data.roles : name === 'get_skill' ? data.skills : undefined;
  const item = list?.find((entry) => entry.id === args?.id);
  if (!item) return { isError: true, content: [{ type: 'text', text: `not found: ${args?.id}` }] };
  return answer(item);
}

const server = new Server({ name: 'fake-registry', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => call(request.params.name, request.params.arguments));
await server.connect(new StdioServerTransport());
