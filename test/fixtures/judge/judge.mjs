// A judge for the tests (B19). It reads one JSON request on stdin — { change, gate, rubric, artifacts: [{ path,
// content }] } — and answers one JSON verdict on stdout: { pass, route, rework }.
// It passes when an artifact contains the marker JUDGE-OK. JUDGE_LOG=<path> appends each request as one JSON line.
// JUDGE_GARBAGE=1 answers text that is not JSON. Also served over MCP: `node judge.mjs --mcp` (tool `judge`).
import * as fs from 'node:fs';

function verdict(request) {
  if (process.env.JUDGE_LOG) fs.appendFileSync(process.env.JUDGE_LOG, `${JSON.stringify(request)}\n`);
  const ok = (request.artifacts ?? []).some((artifact) => String(artifact.content).includes('JUDGE-OK'));
  if (ok) return { pass: true, route: 'human', rework: '' };
  return { pass: false, route: 'author', rework: 'Add JUDGE-OK to the proposal.' };
}

async function stdinText() {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

async function serveMcp() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'fake-judge', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'judge', description: 'Judge an artifact by a rubric', inputSchema: { type: 'object' } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const answer = verdict(request.params.arguments ?? {});
    return { structuredContent: answer, content: [{ type: 'text', text: JSON.stringify(answer) }] };
  });
  await server.connect(new StdioServerTransport());
}

if (process.argv.includes('--mcp')) {
  await serveMcp();
} else if (process.env.JUDGE_GARBAGE === '1') {
  await stdinText();
  process.stdout.write('the artifact looks fine to me\n');
} else {
  process.stdout.write(`${JSON.stringify(verdict(JSON.parse(await stdinText())))}\n`);
}
