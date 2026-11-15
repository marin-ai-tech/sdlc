// A team registry and an events receiver over Streamable HTTP for the tests (B315, the two-server setup of
// SkillForge). One process, two paths:
//   /registry  list_roles, get_role, list_skills, get_skill (data from FAKE_REGISTRY_FILE) and record_usage
//   /events    report_outcome and record_usage
// Every tool call is appended to FAKE_HTTP_LOG as one JSON line { path, tool, auth }, so a test sees which server
// got which call with which Authorization header. The chosen port is written to FAKE_HTTP_PORT_FILE.
import * as fs from 'node:fs';
import * as http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const data = JSON.parse(fs.readFileSync(process.env.FAKE_REGISTRY_FILE, 'utf-8'));
const logFile = process.env.FAKE_HTTP_LOG;
const object = (properties = {}) => ({ type: 'object', properties });
const usage = { name: 'record_usage', description: 'Usage of a skill', inputSchema: object() };
const toolsByPath = {
  '/registry': [
    { name: 'list_roles', description: 'Roles of the team', inputSchema: object() },
    { name: 'get_role', description: 'One role', inputSchema: object({ id: { type: 'string' } }) },
    { name: 'list_skills', description: 'Skills of the team', inputSchema: object() },
    { name: 'get_skill', description: 'One skill', inputSchema: object({ id: { type: 'string' } }) },
    usage,
  ],
  '/events': [
    { name: 'report_outcome', description: 'Receive one sdlc event', inputSchema: { type: 'object' } },
    usage,
  ],
};

function answer(value) {
  return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function registryCall(name, args) {
  if (name === 'list_roles') {
    const roles = data.roles.map(({ id, version, title, stages, checksum }) => ({ id, version, title, stages, checksum }));
    return answer({ roles });
  }
  if (name === 'list_skills') {
    return answer({ skills: data.skills.map(({ id, version, title, checksum }) => ({ id, version, title, checksum })) });
  }
  const list = { get_role: data.roles, get_skill: data.skills }[name];
  const item = list?.find((entry) => entry.id === args?.id);
  if (!item) return { isError: true, content: [{ type: 'text', text: `not found: ${args?.id}` }] };
  return answer(item);
}

function serverFor(route, auth) {
  const server = new Server({ name: 'fake-http-registry', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsByPath[route] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    fs.appendFileSync(logFile, `${JSON.stringify({ path: route, tool: name, auth })}\n`);
    if (route === '/registry' && name !== 'record_usage') return registryCall(name, args);
    return { content: [{ type: 'text', text: 'ok' }] };
  });
  return server;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      resolve(text ? JSON.parse(text) : undefined);
    });
  });
}

const httpServer = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (!toolsByPath[route]) {
    res.writeHead(404).end();
    return;
  }
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = serverFor(route, req.headers.authorization ?? null);
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
});

httpServer.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.env.FAKE_HTTP_PORT_FILE, String(httpServer.address().port));
});
