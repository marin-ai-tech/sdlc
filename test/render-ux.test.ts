import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAsset, splitFrontmatter, WORKFLOW_IDS } from '../src/integrations/assets.js';
import { renderBody, type Surface } from '../src/integrations/render.js';
import { renderClaudePlugin } from '../src/integrations/plugin.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

const SURFACES: Surface[] = ['skill', 'plugin-skill', 'claude-command', 'opencode-command', 'claude-agent', 'opencode-agent'];
const render = (body: string, surface: Surface, cli = 'sdlc') => renderBody(body, { surface, cli });

describe('tool placeholders (render)', () => {
  it('{{tool:ask}} names the question tool of each surface; shared skills name both', () => {
    expect(render('Use {{tool:ask}}.', 'claude-command')).toMatch(/AskUserQuestion/);
    expect(render('Use {{tool:ask}}.', 'plugin-skill')).toMatch(/AskUserQuestion/);
    expect(render('Use {{tool:ask}}.', 'opencode-command')).toMatch(/`question` tool/);
    expect(render('Use {{tool:ask}}.', 'opencode-command')).not.toMatch(/AskUserQuestion/);
    const shared = render('Use {{tool:ask}}.', 'skill');
    expect(shared).toMatch(/AskUserQuestion/);
    expect(shared).toMatch(/`question`/);
  });

  it('{{tool:todo}} names the todo list tool of each surface', () => {
    expect(render('{{tool:todo}}', 'claude-command')).toMatch(/TodoWrite/);
    expect(render('{{tool:todo}}', 'opencode-command')).toMatch(/todowrite/);
    expect(render('{{tool:todo}}', 'opencode-command')).not.toMatch(/TodoWrite/);
    const shared = render('{{tool:todo}}', 'skill');
    expect(shared).toMatch(/TodoWrite/);
    expect(shared).toMatch(/todowrite/);
  });

  it('{{inject:<args>}} inlines live CLI output where the tool supports it, with a fallback instruction', () => {
    for (const surface of ['skill', 'plugin-skill', 'claude-command', 'opencode-command'] as Surface[]) {
      const out = render('State:\n{{inject:status --json}}', surface, 'npx sdlc');
      expect(out, surface).toContain('!`npx sdlc status --json`');
      expect(out, surface).toMatch(/If the output above is missing, run `npx sdlc status --json`/);
    }
    for (const surface of ['claude-agent', 'opencode-agent'] as Surface[]) {
      const out = render('{{inject:status --json}}', surface);
      expect(out, surface).not.toContain('!`');
      expect(out, surface).toContain('`sdlc status --json`');
    }
  });

  it('negative: an unknown tool placeholder is an error', () => {
    expect(() => render('{{tool:nope}}', 'skill')).toThrow(/tool:nope/);
  });
});

describe('workflows use the placeholders', () => {
  const body = (id: string) => splitFrontmatter(readAsset('workflows', `${id}.md`)).body;

  it('help is a workflow that shows the catalog and the current state', () => {
    expect(WORKFLOW_IDS).toContain('help');
    expect(body('help')).toContain('{{inject:help --json}}');
    expect(body('help')).toContain('{{inject:status --json}}');
  });

  it('status and next inline the live state', () => {
    expect(body('status')).toMatch(/\{\{inject:status --json\}\}/);
    expect(body('next')).toMatch(/\{\{inject:next --json\}\}/);
  });

  it('clarifying workflows ask with choices; build mirrors tasks.md into the todo list', () => {
    for (const id of ['intent', 'explore', 'spec', 'review', 'next']) expect(body(id), id).toContain('{{tool:ask}}');
    expect(body('build')).toContain('{{tool:todo}}');
    expect(body('build')).toMatch(/tasks\.md[\s\S]*source of truth/i);
  });

  it('the contract says an answer in chat is never an approval, and every workflow ends with the next step', () => {
    const contract = readAsset('workflows', '_contract.md');
    expect(contract).toMatch(/answer in (the )?chat is (not|never) an approval/i);
    expect(contract).toMatch(/sdlc next/);
  });

  it('every workflow renders for every surface without leftovers', () => {
    for (const id of WORKFLOW_IDS) {
      for (const surface of SURFACES) {
        expect(() => render(readAsset('workflows', `${id}.md`), surface), `${id} ${surface}`).not.toThrow();
      }
    }
  });
});

describe('generated files per tool (init)', () => {
  it('Claude files name Claude tools, OpenCode files name OpenCode tools; when_to_use reaches Claude skills only', () => {
    const root = tempDir('sdlc-ux-');
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, humanEnv(tempDir('sdlc-home-'))).code).toBe(0);
    const claudeIntent = read(path.join(root, '.claude/commands/sdlc/intent.md'));
    const opencodeIntent = read(path.join(root, '.opencode/commands/sdlc-intent.md'));
    expect(claudeIntent).toMatch(/AskUserQuestion/);
    expect(opencodeIntent).toMatch(/`question` tool/);
    expect(opencodeIntent).not.toMatch(/AskUserQuestion|TodoWrite/);
    expect(read(path.join(root, '.opencode/commands/sdlc-build.md'))).toMatch(/todowrite/);
    expect(read(path.join(root, '.claude/commands/sdlc/build.md'))).toMatch(/TodoWrite/);
    expect(read(path.join(root, '.opencode/commands/sdlc-status.md'))).toContain('!`sdlc status --json`');
    const skill = splitFrontmatter(read(path.join(root, '.claude/skills/sdlc-help/SKILL.md'))).data;
    expect(String(skill.when_to_use)).toMatch(/help|what can/i);
    expect(read(path.join(root, '.opencode/commands/sdlc-help.md'))).not.toMatch(/when_to_use/);
    expect(fs.existsSync(path.join(root, '.claude/skills/sdlc-help/SKILL.md'))).toBe(true);
  });

  it('the plugin includes help and names Claude tools', () => {
    const files = renderClaudePlugin();
    expect(files.some((f) => f.path === 'skills/help/SKILL.md')).toBe(true);
    expect(files.find((f) => f.path === 'skills/intent/SKILL.md')!.content).toMatch(/AskUserQuestion/);
  });
});
