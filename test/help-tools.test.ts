import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * 0.14.5: help knows every supported tool. `sdlc help --json` gives each workflow's invocation for all six tools;
 * the text help shows the invocations of the tools the project is set up for. Every workflow has a title and a
 * description in every locale — a key name never reaches the reader (the i18n key test cannot see these keys,
 * they are built from the workflow id).
 */

function project(tools?: string) {
  const root = tempDir('sdlc-help-tools-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  if (tools !== undefined) expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  return cli;
}

describe('help and the supported tools', () => {
  it('--json gives every workflow its invocation in every tool', () => {
    const workflows = project()(['help', '--json']).json().workflows;
    const next = workflows.find((w: { id: string }) => w.id === 'next');
    expect(next.invocation).toEqual({
      claude: '/sdlc:next', opencode: '/sdlc-next', cursor: '/sdlc-next', codex: '$sdlc-next', qwen: '/sdlc-next',
      gigacode: '/sdlc-next',
    });
    for (const workflow of workflows) expect(Object.keys(workflow.invocation), workflow.id).toHaveLength(6);
  }, 120000);

  it('the text help shows the invocations of the configured tools', () => {
    const text = project('codex,qwen')(['help']).stdout;
    expect(text).toContain('$sdlc-next');
    expect(text).toContain('/sdlc-next');
    expect(text).not.toContain('/sdlc:next');
  }, 120000);

  it('negative: a Claude Code and OpenCode project shows those two, as before', () => {
    const text = project('claude,opencode')(['help']).stdout;
    expect(text).toContain('/sdlc:next · /sdlc-next');
    expect(text).not.toContain('$sdlc-next');
  }, 120000);

  it('negative: malformed existing configuration reports its parse and repair diagnosis', () => {
    const root = tempDir('sdlc-help-broken-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    expect(runCli(['init', '--tools', 'codex', '--json'], root, env).code).toBe(0);
    const file = path.join(root, 'openspec', 'sdlc.yaml');
    const malformed = 'version: 1\ntools: [codex\n';
    fs.writeFileSync(file, malformed);
    const r = runCli(['help'], root, env);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('is not valid YAML');
    expect(r.stderr).toContain('Fix the YAML syntax');
    expect(r.stderr).toContain(file);
    expect(r.stdout).not.toContain('/sdlc:next · /sdlc-next');
    const json = runCli(['help', '--json'], root, env);
    expect(json.code, json.stdout + json.stderr).toBe(1);
    expect(json.json().status[0].code).toBe('invalid_yaml');
    expect(json.json()).not.toHaveProperty('workflows');
    expect(fs.readFileSync(file, 'utf8')).toBe(malformed);
  }, 120000);

  it('negative: genuinely absent configuration shows the default tools', () => {
    const r = project()(['help']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('/sdlc:next · /sdlc-next');
  }, 120000);

  for (const locale of ['en', 'xx']) {
    it(`no workflow shows a key name instead of its title or description (${locale})`, () => {
      const cli = project();
      const text = cli(['help', '--locale', locale]).stdout;
      expect(text).not.toMatch(/workflow\.[\w-]+\.(?:title|description)/);
      const workflows = cli(['help', '--json', '--locale', locale]).json().workflows;
      for (const workflow of workflows) {
        expect(workflow.title, workflow.id).not.toMatch(/^workflow\./);
        expect(workflow.description, workflow.id).not.toMatch(/^workflow\./);
      }
    }, 120000);
  }
});
