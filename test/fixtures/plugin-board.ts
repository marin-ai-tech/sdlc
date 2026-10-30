import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadConfig } from '../../dist/core/config.js';
import { projectPaths } from '../../dist/core/project.js';
import { readBoard } from '../../dist/core/board-store.js';
import { capturePackage } from '../../dist/plugins/package.js';
import { runPrepared } from '../../dist/plugins/evaluation.js';
import type { Hook } from '../../dist/plugins/api.js';
import { FILES } from '../farewell-fixture.js';
import { BIN, REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from '../helpers.js';
import { packageFiles, type GuestOptions } from './plugin-modules.js';

export const BOARD_CHANGE = 'add-farewell';
export const pluginId = () => `p1.${Date.now()}.${randomUUID().replaceAll('-', '')}`;

export async function pluginBoardBase() {
  const root = tempDir('sdlc-hook-approved-fixture-');
  const env = humanEnv(tempDir('sdlc-hook-fixture-person-'));
  initGitRepo(root);
  git(root, ['checkout', '-qb', 'main']);
  write(path.join(root, 'src/greet.js'), '// original\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'initial fixture']);
  const ok = (args: string[]) => {
    const result = runCli([...args, '--json'], root, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result;
  };
  ok(['init', '--tools', 'none']);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const raw = parse(read(file));
  raw.enforcement.mode = 'block';
  raw.verify.commands = [{ name: 'fixture', run: 'node -e "process.exit(0)"', required: true }];
  write(file, stringify(raw));
  write(path.join(root, 'openspec/executors.yaml'), stringify({ executors: {
    'mesh-a': { type: 'mesh', max_risk: 'medium' },
    'mesh-b': { type: 'mesh', max_risk: 'medium' },
  } }));
  ok(['new', BOARD_CHANGE, '--risk', 'medium']);
  const change = (name: string) => path.join(root, 'openspec/changes', BOARD_CHANGE, name);
  write(change('intent.md'), FILES['intent.md']);
  ok(['approve', 'intent', '--change', BOARD_CHANGE]);
  for (const name of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(name), FILES[name]);
  ok(['approve', 'spec', '--change', BOARD_CHANGE]);
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), '# Tasks\n\n## 1. Work\n\n'
    + [1, 2, 3, 4].map((n) => `- [ ] 1.${n} Task ${n}\n`).join(''));
  ok(['approve', 'plan', '--change', BOARD_CHANGE]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved source fixture']);
  return { root, env };
}

export function pluginBoard(base: Awaited<ReturnType<typeof pluginBoardBase>>) {
  const root = tempDir('sdlc-board-plugin-case-');
  fs.cpSync(base.root, root, { recursive: true });
  const paths = projectPaths(root);
  const file = paths.sdlcConfig;
  const config = () => loadConfig(file);
  const ok = (args: string[]) => {
    const result = runCli([...args, '--json'], root, base.env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result.json();
  };
  const rawConfig = (edit: (raw: Record<string, any>) => void) => {
    const raw = parse(read(file));
    edit(raw);
    write(file, stringify(raw));
  };
  const activate = (source: string, settings: unknown = {}, policies?: unknown[]) => {
    const snapshot = capturePackage(root, source);
    rawConfig((raw) => {
      raw.plugins = { economy: { package: source, digest: snapshot.digest, enabled: true, config: settings } };
      if (policies) raw.plugin_policies = policies;
    });
    ok(['plugins', 'accept', 'economy', '--expect-digest', snapshot.digest]);
    return snapshot;
  };
  const guard = async (response: unknown, hooks: Partial<Record<Hook, string>>, guest: GuestOptions = {},
    policies?: unknown[]) => {
    const p = await packageFiles(root, response, { hooks }, guest);
    return activate(p.source, {}, policies);
  };
  const economy = (policies?: unknown[]) => {
    fs.cpSync(path.join(REPO_ROOT, 'examples/plugins/economy'), path.join(root, 'packages/economy'),
      { recursive: true });
    return activate('packages/economy', { limit: 3 }, policies);
  };
  const events = (): Array<Record<string, any>> => {
    const log = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(log) ? read(log).split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const bytes = () => Object.fromEntries([
    'board.json', 'log.jsonl', 'hook-log.jsonl', 'plugins/registry.json', 'plugins/state/economy/store.json',
  ].map((relative) => {
    const target = path.join(root, 'openspec/.sdlc', relative);
    return [relative, fs.existsSync(target) ? fs.readFileSync(target).toString('base64') : null];
  }));
  const prepared = <T>(operation: string, args: unknown, work: () => T, executor = 'mesh-a') =>
    runPrepared(root, config(), { operation, args, actor: { origin: 'cli', executor },
      board: !['export', 'result', 'file_edit', 'stop'].includes(operation) }, work);
  const hook = (event: string, input: Record<string, unknown>) => {
    const result = spawnSync(process.execPath, [BIN, 'hook', event, '--agent', 'codex'], {
      cwd: root, env: base.env, encoding: 'utf8', timeout: 15000,
      input: JSON.stringify({ cwd: root, session_id: 'fixture-session', ...input }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim(), result.stderr).not.toBe('');
    return JSON.parse(result.stdout);
  };
  return { root, paths, file, config, ok, rawConfig, guard, economy, events, bytes, prepared, hook,
    board: () => readBoard(root) };
}

export type PluginBoard = ReturnType<typeof pluginBoard>;
