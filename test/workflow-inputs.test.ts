import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

/** Workflows whose subject comes from the person's text after the command. */
const NEEDS_INPUT = ['explore', 'intent', 'triage'];

function generated() {
  const root = tempDir('sdlc-inputs-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, humanEnv(tempDir('sdlc-home-'))).code).toBe(0);
  return {
    opencode: (id: string) => read(path.join(root, `.opencode/commands/sdlc-${id}.md`)),
    claude: (id: string) => read(path.join(root, `.claude/skills/sdlc-${id}/SKILL.md`)),
  };
}

describe('a workflow started without its subject asks for it', () => {
  it('explore, intent and triage stop and ask for the subject in plain text, in both tools, before creating anything', () => {
    const files = generated();
    for (const id of NEEDS_INPUT) {
      for (const [tool, text] of [['opencode', files.opencode(id)], ['claude', files.claude(id)]]) {
        expect(text, `${tool} ${id}`).toMatch(/if the input is empty/i);
        expect(text, `${tool} ${id}`).toMatch(/do not invent/i);
        const rule = text.indexOf('If the input is empty');
        expect(rule, `${tool} ${id}: the rule comes before the first step`).toBeLessThan(text.indexOf('1. '));
      }
    }
  });

  it('negative: workflows that work on the current change do not demand a subject', () => {
    const files = generated();
    for (const id of ['status', 'next', 'verify', 'review']) expect(files.opencode(id)).not.toMatch(/if the input is empty/i);
  });
});
