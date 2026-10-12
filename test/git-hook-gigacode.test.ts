import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B89 (0.15.4): GigaCode documents no session variable of its own; its agent shells carry Qwen Code's
 * `QWEN_CODE=1`. So a project that uses GigaCode and not Qwen Code gets a hook that names `gigacode` for that marker,
 * and its commits carry `SDLC-Agent: gigacode`. With both tools (or Qwen Code only) the marker still names `qwen`.
 */

function project(tools: string) {
  const root = tempDir('sdlc-hook-giga-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  const init = cli(['init', '--tools', tools, '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  return { root, env, cli };
}

function commitAs(root: string, env: NodeJS.ProcessEnv, markers: NodeJS.ProcessEnv): string | undefined {
  const file = `f-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  write(path.join(root, file), 'x\n');
  const run = { ...env, ...markers };
  execFileSync('git', ['add', file], { cwd: root, env: run });
  execFileSync('git', ['commit', '-q', '-m', `add ${file}`], { cwd: root, env: run });
  const message = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: root, env: run, encoding: 'utf-8' });
  return /^SDLC-Agent: (.*)$/m.exec(message)?.[1];
}

describe('B89: commits from GigaCode are attributed to GigaCode', () => {
  it('GigaCode only: QWEN_CODE=1 gives SDLC-Agent: gigacode', () => {
    const p = project('gigacode');
    expect(commitAs(p.root, p.env, { QWEN_CODE: '1' })).toBe('gigacode');
    expect(commitAs(p.root, p.env, { QWEN_CODE_SESSION_ID: 's-1' })).toBe('gigacode');
  }, 120000);

  it('negative: Qwen Code only, or both tools, keep SDLC-Agent: qwen', () => {
    const qwen = project('qwen');
    expect(commitAs(qwen.root, qwen.env, { QWEN_CODE: '1' })).toBe('qwen');
    const both = project('qwen,gigacode');
    expect(commitAs(both.root, both.env, { QWEN_CODE: '1' })).toBe('qwen');
  }, 120000);

  it('negative: other agents and a person are unchanged in a GigaCode project', () => {
    const p = project('gigacode');
    expect(commitAs(p.root, p.env, { CLAUDECODE: '1' })).toBe('claude-code');
    expect(commitAs(p.root, p.env, { SDLC_AGENT: 'bot' })).toBe('bot');
    expect(commitAs(p.root, p.env, {})).toBeUndefined();
  }, 120000);

  it('sdlc update rewrites the hook when the tools change', () => {
    const p = project('qwen');
    const file = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.tools = ['gigacode'];
    write(file, stringify(config));
    const update = p.cli(['update', '--json']);
    expect(update.code, update.stdout + update.stderr).toBe(0);
    expect(commitAs(p.root, p.env, { QWEN_CODE: '1' })).toBe('gigacode');
  }, 120000);
});
