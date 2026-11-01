import * as path from 'node:path';
import { expect } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

export function decisionProject(highRisk = false) {
  const root = tempDir('sdlc-e20-decisions-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (highRisk) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.gates.intent = { approvers: ['product-owner'], high_risk_approvers: ['tech-lead'] };
    write(file, stringify(config));
  }
  expect(cli(['new', 'demo', ...(highRisk ? ['--risk', 'high'] : []), '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/demo');
  for (const [file, text] of Object.entries(FILES)) write(path.join(dir, file), text);
  const stateFile = path.join(dir, '.sdlc.yaml');
  const gate = () => cli(['status', '--change', 'demo', '--json']).json().change.gates
    .find((item: { id: string }) => item.id === 'intent');
  return { root, env, cli, dir, stateFile, gate };
}
