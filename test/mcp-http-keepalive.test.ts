import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN, git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * `sdlc mcp serve --http` kept Node's default keep-alive of 5 seconds. A client that reused its connection after about
 * that long (an executor between two board calls, or a test waiting for a CLI command) met a closed socket:
 * `fetch failed` / `ECONNRESET`, seen twice in the full suite on test/e2e-0235-board.test.ts. The server keeps idle
 * connections open long enough for clients that pause between calls, and says so in its Keep-Alive header.
 */

const TOKEN = 'server-token-0123456789';
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

function serve(root: string, env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, [BIN, 'mcp', 'serve', '--http', '127.0.0.1:0'], { cwd: root, env });
  running.push(child);
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`no URL in 60 s: ${stderr}`)), 60000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(stderr)?.[0];
      if (!url) return;
      clearTimeout(timer);
      resolve(url);
    });
  });
}

describe('MCP over HTTP keeps idle connections for clients that pause', () => {
  it('the Keep-Alive header promises at least 60 seconds', async () => {
    const root = tempDir('sdlc-keepalive-');
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'), { SDLC_MCP_TOKEN: TOKEN });
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    const url = await serve(root, env);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
    });
    await response.text();
    const header = response.headers.get('keep-alive') ?? '';
    const seconds = Number(/timeout=(\d+)/.exec(header)?.[1] ?? 0);
    expect(seconds, header).toBeGreaterThanOrEqual(60);
  }, 120000);
});
