import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

const WORKFLOWS = ['help', 'next', 'status', 'explore', 'intent', 'spec', 'plan', 'build', 'verify', 'review', 'release',
  'archive', 'triage'];

function project() {
  const root = tempDir('sdlc-explore-wf-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
  return {
    root,
    cli: (args: string[]) => runCli(args, root, env),
    opencode: (id: string) => read(path.join(root, `.opencode/commands/sdlc-${id}.md`)),
    claude: (id: string) => read(path.join(root, `.claude/skills/sdlc-${id}/SKILL.md`)),
  };
}

describe('an exploration that pauses leaves the note saying where it stopped', () => {
  it('the explore workflow records open questions and marks unfinished sections before waiting, in both tools', () => {
    const p = project();
    for (const [tool, text] of [['opencode', p.opencode('explore')], ['claude', p.claude('explore')]]) {
      expect(text, tool).toMatch(/Open questions/);
      expect(text, tool).toMatch(/_pending:/);
      expect(text, tool).toMatch(/before (you )?(stop|wait)/i);
      expect(text, tool).toMatch(/first pending section/i);
      expect(text, tool).toMatch(/assumptions/i);
    }
  });

  it('a new exploration note has an Open questions section', () => {
    const p = project();
    expect(p.cli(['explore', 'java-to-go', '--json']).code).toBe(0);
    expect(read(path.join(p.root, 'openspec/explorations/java-to-go.md'))).toMatch(/^## Open questions$/m);
  });
});

describe('every workflow talks in the person\'s language', () => {
  it('the shared contract sets the language and keeps the structure parsers rely on', () => {
    const p = project();
    for (const id of WORKFLOWS) {
      for (const [tool, text] of [['opencode', p.opencode(id)], ['claude', p.claude(id)]]) {
        expect(text, `${tool} ${id}`).toMatch(/in the person's language/i);
        expect(text, `${tool} ${id}`).toMatch(/locale/);
        expect(text, `${tool} ${id}`).toMatch(/headings/i);
      }
    }
  });
});
