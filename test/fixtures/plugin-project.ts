import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'yaml';
import { expect } from 'vitest';
import { defaultConfig, serializeConfig, loadConfig } from '../../dist/core/config.js';
import { capturePackage } from '../../dist/plugins/package.js';
import { humanEnv, initGitRepo, runCli, tempDir, write } from '../helpers.js';
import { packageFiles, type GuestOptions } from './plugin-modules.js';

export const pluginRequest = (at = Date.now()) => `p1.${at}.${randomUUID().replaceAll('-', '')}`;

export async function pluginProject(response: unknown = { output: 42 }, overrides: Record<string, unknown> = {},
  options: GuestOptions = {}, accept = true) {
  const root = tempDir('sdlc-plugin-project-');
  const env = humanEnv(tempDir('sdlc-plugin-person-'));
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  write(path.join(root, 'openspec/executors.yaml'), 'executors:\n  mesh:\n    type: mesh\n    max_risk: high\n');
  const p = await packageFiles(root, response, overrides, options);
  const snapshot = capturePackage(root, p.source);
  const raw = serializeConfig(defaultConfig());
  raw.plugins = { economy: { package: p.source, digest: snapshot.digest, enabled: true, config: {} } };
  const file = path.join(root, 'openspec/sdlc.yaml');
  fs.writeFileSync(file, stringify(raw));
  const cli = (args: string[]) => runCli(args, root, env);
  if (accept) {
    const result = cli(['plugins', 'accept', 'economy', '--expect-digest', snapshot.digest, '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
  }
  return { root, file, p, snapshot, raw, cli, config: loadConfig(file), actor: { origin: 'cli' as const, executor: 'mesh' } };
}
