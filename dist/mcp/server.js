import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { harnessVersion } from '../core/version.js';
import { callProjectTool, listedTools, resolveProjects } from './projects.js';
import { listResources, readResource } from './resources.js';
import { runCli } from './run-cli.js';
export { callTool, errorResult, resultOf } from './call-tool.js';
/**
 * `sdlc mcp serve` (B13, B46, B48): an MCP server over stdio. Its tools answer exactly what `sdlc <command> --json`
 * prints; its resources are the team's documents, read in this process. stdout carries only protocol messages;
 * logs go to stderr. Nothing here writes a project file.
 */
function log(text) {
    process.stderr.write(`[sdlc mcp] ${text}\n`);
}
/** The server with its handlers over the served projects (one, or several by name). */
export function createServer(projects, run = runCli) {
    const capabilities = { tools: {}, resources: {} };
    const server = new Server({ name: 'sdlc', version: harnessVersion() }, { capabilities });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listedTools(projects) }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        return callProjectTool(request.params.name, request.params.arguments, projects, run);
    });
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: listResources(projects) }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => readResource(projects, request.params.uri));
    return server;
}
/**
 * Serves over stdio until the client closes the connection. `dirs` are the `--project` paths; a path that is not an
 * sdlc project, or two projects with one name, throw before the transport opens.
 */
export async function serveStdio(start = process.cwd(), dirs = []) {
    const projects = resolveProjects(dirs, start);
    const server = createServer(projects);
    server.onerror = (error) => log(error instanceof Error ? error.message : String(error));
    await server.connect(new StdioServerTransport());
    const roots = projects.map((project) => project.root).join(', ');
    log(`serving ${roots} over stdio (version ${harnessVersion()})`);
}
