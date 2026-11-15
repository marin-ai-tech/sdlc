// A small team registry over MCP for the tests (stdio): roles and skills read from the JSON file in
// FAKE_REGISTRY_FILE, served through the contract sdlc expects - list_roles, get_role, list_skills, get_skill.
// The file holds { roles: [{ id, version, title, stages, tools, readonly, skills, body, checksum }],
// skills: [{ id, version, title, files: [{ path, content }], checksum }] }; checksums are given as they are, so a test
// can serve a wrong one.
import * as fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// With `rules: [{ id, version, title, description, paths, tags, body, checksum }]` in the file it also answers
// list_rules and get_rule (0.32.0, team rules); without it the tool list is the same as before.
// With `noRoleTools: true` it lists only the skill tools, as SkillForge does while its sdlc-registry plugin is off
// (B315).
const data = JSON.parse(fs.readFileSync(process.env.FAKE_REGISTRY_FILE, 'utf-8'));
const object = (properties = {}) => ({ type: 'object', properties });
const roleTools = [
  { name: 'list_roles', description: 'Roles of the team', inputSchema: object() },
  { name: 'get_role', description: 'One role', inputSchema: object({ id: { type: 'string' }, locale: { type: 'string' } }) },
];
const tools = [
  ...(data.noRoleTools ? [] : roleTools),
  { name: 'list_skills', description: 'Skills of the team', inputSchema: object() },
  { name: 'get_skill', description: 'One skill', inputSchema: object({ id: { type: 'string' } }) },
  ...(data.rules ? [
    { name: 'list_rules', description: 'Rules of the team', inputSchema: object() },
    { name: 'get_rule', description: 'One rule', inputSchema: object({ id: { type: 'string' } }) },
  ] : []),
];

function answer(value) {
  return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function call(name, args) {
  if (!tools.some((tool) => tool.name === name)) {
    return { isError: true, content: [{ type: 'text', text: `Tool ${name} not found` }] };
  }
  if (name === 'list_roles') {
    return answer({ roles: data.roles.map(({ id, version, title, stages, checksum }) => ({ id, version, title, stages, checksum })) });
  }
  if (name === 'list_skills') {
    return answer({ skills: data.skills.map(({ id, version, title, checksum }) => ({ id, version, title, checksum })) });
  }
  if (name === 'list_rules' && data.rules) {
    return answer({ rules: data.rules.map(({ id, version, tags, paths, checksum }) => ({ id, version, tags, paths, checksum })) });
  }
  const lists = { get_role: data.roles, get_skill: data.skills, get_rule: data.rules };
  const list = lists[name];
  const item = list?.find((entry) => entry.id === args?.id);
  if (!item) return { isError: true, content: [{ type: 'text', text: `not found: ${args?.id}` }] };
  return answer(item);
}

// With `noToolsHandler: true` it is an MCP server with no tools at all: tools/list answers "method not found".
const capabilities = data.noToolsHandler ? {} : { tools: {} };
const server = new Server({ name: 'fake-registry', version: '1.0.0' }, { capabilities });
if (!data.noToolsHandler) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    call(request.params.name, request.params.arguments));
}
await server.connect(new StdioServerTransport());
