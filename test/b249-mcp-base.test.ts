import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SdlcError } from '../src/core/errors.js';
import { callTool } from '../src/mcp/call-tool.js';
import { callDirectTool } from '../src/mcp/direct-tools.js';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

// B249 review round 1, F10: `board_submit` over MCP passed `base` on to the result check, where it reached git;
// `board submit --base` on the command line refuses a value that starts with "-". The direct operation now goes
// through the same refusal (assertBaseRef, named `base`) itself, not only through the argument check of the MCP
// server in front of it.

function project() {
  const root = tempDir('sdlc-b249-mcp-base-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude', '--json'], root, humanEnv(tempDir('sdlc-home-'))).code).toBe(0);
  return root;
}

async function failure(run: Promise<unknown>): Promise<SdlcError> {
  const error = await run.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SdlcError);
  return error as SdlcError;
}

const leaked = (root: string) => fs.readdirSync(root).filter((name) => name.startsWith('leaked'));

describe('B249 round 1, F10: board_submit base over MCP', () => {
  it('the direct operation refuses a base that starts with a dash, naming base, and git writes no file', async () => {
    const root = project();
    const args = { claim: 'claim-1', branch: 'result', base: `--output=${path.join(root, 'leaked.txt')}` };
    const error = await failure(callDirectTool('board_submit', args, root, 'rep-a'));
    expect(error.code).toBe('invalid_option');
    expect(error.localizedMessage()).toMatch(/\bbase\b/);
    expect(leaked(root)).toEqual([]);
  }, 240000);

  it('the MCP tool call refuses it too and writes no file', async () => {
    const root = project();
    const args = { claim: 'claim-1', branch: 'result', base: `--output=${path.join(root, 'leaked.txt')}` };
    const result = await callTool('board_submit', args, root, undefined, 'rep-a');
    expect(result.isError).toBe(true);
    expect(leaked(root)).toEqual([]);
  }, 240000);

  it('negative: a plain base passes the refusal and fails later for the unknown claim', async () => {
    const root = project();
    const args = { claim: 'claim-1', branch: 'result', base: 'HEAD' };
    const error = await failure(callDirectTool('board_submit', args, root, 'rep-a'));
    expect(error.code).not.toBe('invalid_option');
  }, 240000);
});
