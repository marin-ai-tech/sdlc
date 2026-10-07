import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { humanEnv, read, runCli, tempDir } from './helpers.js';

/**
 * 0.11.0 (B73): the team workflow sets up the agent team — it brings the roles (`sdlc team sync`), learns the project
 * (`sdlc adopt --json`, the documents and the code, or the idea of an empty project) and drafts a `## Project rules`
 * section into each draft role, then hands the acceptance to a person. Both tools get it like the other workflows.
 */

function project() {
  const root = tempDir('sdlc-team-workflow-');
  const env = humanEnv(tempDir('sdlc-home-'));
  expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
  return { file: (rel: string) => read(path.join(root, rel)), root, env };
}

describe('the team workflow', () => {
  it('is generated for both tools and drives sync, the project\'s rules and a person\'s acceptance', () => {
    const p = project();
    for (const rel of ['.claude/skills/sdlc-team/SKILL.md', '.claude/commands/sdlc/team.md',
      '.opencode/commands/sdlc-team.md']) {
      const body = p.file(rel);
      expect(body, rel).toContain('sdlc team sync');
      expect(body, rel).toContain('sdlc adopt --json');
      expect(body, rel).toContain('## Project rules');
      expect(body, rel).toContain('sdlc team accept');
    }
  }, 120000);

  it('the help catalog lists it as an agent workflow', () => {
    const p = project();
    const help = runCli(['help', '--json'], p.root, p.env).json();
    expect(help.workflows.map((w: { id: string }) => w.id)).toContain('team');
  }, 120000);
});
