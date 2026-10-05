import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

function project(tools = 'claude,opencode') {
  const root = tempDir('sdlc-wf-070-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const init = runCli(['init', '--tools', tools], root, env);
  expect(init.code, init.stderr).toBe(0);
  return {
    root,
    init,
    texts: (id: string) => [
      ['opencode', read(path.join(root, `.opencode/commands/sdlc-${id}.md`))],
      ['claude', read(path.join(root, `.claude/skills/sdlc-${id}/SKILL.md`))],
    ],
  };
}

describe('workflow /sdlc-backlog', () => {
  it('is generated for both tools and works only through the backlog commands', () => {
    for (const [tool, text] of project().texts('backlog')) {
      for (const command of ['sdlc backlog list', 'sdlc backlog next', 'sdlc backlog add', 'sdlc backlog edit',
        'sdlc backlog epic add', 'sdlc backlog start']) {
        expect(text, `${tool}: ${command}`).toContain(command);
      }
      expect(text, tool).toMatch(/never edit `?openspec\/backlog\.md`? directly/i);
    }
  });

  it('decomposes with the person\'s confirmation and leaves order and removal to the person', () => {
    for (const [tool, text] of project().texts('backlog')) {
      expect(text, tool).toMatch(/confirm/i);
      expect(text, tool).toMatch(/outcome/i);
      expect(text, tool).toMatch(/acceptance/i);
      expect(text, tool).toMatch(/sdlc backlog move/);
      expect(text, tool).toMatch(/sdlc backlog drop/);
      expect(text, tool).toMatch(/(only|a) person|human/i);
    }
  });

  it('negative: the workflow does not ask the agent to run the human-only commands itself', () => {
    for (const [tool, text] of project().texts('backlog')) {
      expect(text, tool).not.toMatch(/^\s*(?:\d+\.\s*)?Run `sdlc backlog (move|drop)/im);
    }
  });
});

describe('workflow /sdlc-adopt', () => {
  it('is generated for both tools: layout first, documents filled from the code, settings drafted', () => {
    for (const [tool, text] of project().texts('adopt')) {
      for (const command of ['sdlc layout check', 'sdlc layout adapt', 'sdlc layout scaffold', 'sdlc adopt']) {
        expect(text, `${tool}: ${command}`).toContain(command);
      }
      expect(text, tool).toMatch(/AGENTS\.md/);
      expect(text, tool).toMatch(/fill[^.\n]*from the code/i);
      expect(text, tool).toMatch(/file (reference|path)/i);
      expect(text, tool).toMatch(/to check/i);
    }
  });

  it('applying the settings is the person\'s step; conversion is only proposed', () => {
    for (const [tool, text] of project().texts('adopt')) {
      expect(text, tool).toMatch(/sdlc adopt --apply/);
      expect(text, tool).toMatch(/(only|a) person|human/i);
      expect(text, tool).toMatch(/layout convert/);
      expect(text, tool).toMatch(/propose|suggest/i);
    }
  });

  it('negative: the agent is not told to run adopt --apply or layout convert --apply itself', () => {
    for (const [tool, text] of project().texts('adopt')) {
      expect(text, tool).not.toMatch(/^\s*(?:\d+\.\s*)?Run `sdlc adopt --apply/im);
      expect(text, tool).not.toMatch(/^\s*(?:\d+\.\s*)?Run `sdlc layout convert[^`]*--apply/im);
    }
  });
});

describe('init points to /sdlc-adopt', () => {
  it('the init output offers the adopt workflow in each chosen tool\'s form', () => {
    const both = project().init.stdout;
    expect(both).toMatch(/\/sdlc:adopt/);
    expect(both).toMatch(/\/sdlc-adopt/);
  });

  it('negative: only the chosen tool is named', () => {
    const p = project('opencode');
    expect(p.init.stdout).toMatch(/\/sdlc-adopt/);
    expect(p.init.stdout).not.toMatch(/\/sdlc:adopt/);
    expect(fs.existsSync(path.join(p.root, '.claude'))).toBe(false);
  });
});
