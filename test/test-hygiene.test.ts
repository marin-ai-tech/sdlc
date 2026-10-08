import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { humanEnv, initGitRepo, git, runCli, tempDir } from './helpers.js';

/**
 * 0.11.3 (docs/ru/23).
 * B77: a test that drives the init wizard must not reach the machine: every `initCommand` call that answers prompts
 *      passes a stub `installer` and a stub `probe` (directly or through a helper that does).
 * B44: two `sdlc doctor --json` runs on an unchanged project print the same JSON, also under parallel load.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin/sdlc.js');

/** The argument text of every `name(` call in `source`, up to its balanced closing parenthesis. */
function callArguments(source: string, name: string): string[] {
  const out: string[] = [];
  let from = source.indexOf(`${name}(`);
  while (from !== -1) {
    let depth = 0;
    let end = from + name.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') depth -= 1;
      if (depth === 0) break;
    }
    out.push(source.slice(from + name.length + 1, end));
    from = source.indexOf(`${name}(`, end);
  }
  return out;
}

/** The body of `function helper(` in `source`, when the test defines one. */
function helperBody(source: string, helper: string): string {
  const start = source.indexOf(`function ${helper}(`);
  if (start === -1) return '';
  // The body starts after the parameter list, whose types may contain braces of their own.
  const params = callArguments(source.slice(start), `function ${helper}`)[0] ?? '';
  const open = source.indexOf('{', start + `function ${helper}(`.length + params.length);
  let depth = 0;
  for (let end = open; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
    if (depth === 0) return source.slice(open, end + 1);
  }
  return '';
}

function stubbed(source: string, args: string): boolean {
  const helper = /\b(\w+)\(\s*[\w.]*prompter/.exec(args)?.[1];
  const text = helper ? `${args}\n${helperBody(source, helper)}` : args;
  return /\binstaller\b/.test(text) && /\bprobe\b/.test(text);
}

describe('B77: wizard tests never install or index anything', () => {
  it('every initCommand call that answers prompts passes a stub installer and probe', () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(path.join(REPO, 'test')).filter((f) => f.endsWith('.test.ts'))) {
      const source = fs.readFileSync(path.join(REPO, 'test', name), 'utf-8');
      for (const args of callArguments(source, 'initCommand')) {
        if (!/prompter/.test(args)) continue;
        if (!stubbed(source, args)) offenders.push(`${name}: initCommand(${args.replace(/\s+/g, ' ').slice(0, 90)})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function runAsync(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('sdlc doctor did not finish')); }, 240000);
    child.on('close', () => { clearTimeout(timer); resolve(stdout); });
  });
}

describe('B44: doctor is deterministic under load', () => {
  it('parallel sdlc doctor --json runs print the same JSON', async () => {
    const root = tempDir('sdlc-doctor-load-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    const stable = (out: string) => out.replace(/"(generatedAt|until|ts|at|durationMs|duration_ms)": "?[^",\n]*"?/g,
      '"$1": 0');
    const outputs = await Promise.all(Array.from({ length: 8 }, () => runAsync(['doctor', '--json'], root, env)));
    const distinct = [...new Set(outputs.map(stable))];
    expect(distinct, distinct.join('\n-----\n')).toHaveLength(1);
  }, 300000);
});
