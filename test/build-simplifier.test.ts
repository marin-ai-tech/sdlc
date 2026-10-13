import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B109 (0.17.0): the build workflow calls the `sdlc-simplifier` subagent by default — after the last task and before
 * `sdlc verify` — instead of only when `stages.build.agents` lists it. `stages.build.simplify: false` turns it off.
 * Listing it in `stages.build.agents` as well does not repeat it. Other workflows do not mention it.
 */

const BUILD = '.claude/skills/sdlc-build/SKILL.md';
const REVIEW = '.claude/skills/sdlc-review/SKILL.md';

function project() {
  const root = tempDir('sdlc-simplifier-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const setBuild = (build: Record<string, unknown>) => {
    const config = parse(read(file));
    config.stages = { ...(config.stages ?? {}), build };
    write(file, stringify(config));
    const r = cli(['update', '--json']);
    return r;
  };
  const skill = (rel: string) => read(path.join(root, rel));
  return { cli, setBuild, skill };
}

describe('B109: the build workflow calls sdlc-simplifier by default', () => {
  it('a new project: the build workflow names the simplifier step before verify', () => {
    const p = project();
    const build = p.skill(BUILD);
    expect(build).toContain('sdlc-simplifier');
    expect(build).toMatch(/sdlc-simplifier[\s\S]*before[\s\S]*sdlc verify/i);
    expect(p.skill(REVIEW)).not.toContain('sdlc-simplifier');
  }, 120000);

  it('stages.build.simplify: false turns it off', () => {
    const p = project();
    const r = p.setBuild({ simplify: false });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.skill(BUILD)).not.toContain('sdlc-simplifier');
  }, 120000);

  it('negative: listing it in stages.build.agents does not repeat it', () => {
    const p = project();
    expect(p.setBuild({ agents: ['sdlc-simplifier'] }).code).toBe(0);
    const line = p.skill(BUILD).split('\n').find((text) => text.startsWith('- Subagents for this stage:')) ?? '';
    expect(line.match(/sdlc-simplifier/g)?.length).toBe(1);
  }, 120000);

  it('negative: simplify must be true or false', () => {
    const p = project();
    const r = p.setBuild({ simplify: 'no' });
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 120000);
});
