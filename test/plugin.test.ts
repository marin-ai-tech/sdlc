import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitFrontmatter, WORKFLOW_IDS } from '../src/integrations/assets.js';
import { renderClaudePlugin, renderMarketplace } from '../src/integrations/plugin.js';
import { REPO_ROOT } from './helpers.js';

describe('Claude Code plugin', () => {
  const files = renderClaudePlugin();

  it('the committed plugin/ and marketplace match the generator (run `sdlc plugin build plugin --marketplace`)', () => {
    for (const f of files) {
      const committed = fs.readFileSync(path.join(REPO_ROOT, 'plugin', f.path), 'utf-8');
      expect(committed, f.path).toBe(f.content);
    }
    expect(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf-8')).toBe(renderMarketplace());
  });

  it('renders every file with LF line endings, whatever the checkout (core.autocrlf)', () => {
    for (const f of files) {
      expect(f.content.includes('\r'), f.path).toBe(false);
    }
    expect(renderMarketplace().includes('\r')).toBe(false);
  });

  it('names skills by workflow so they are invoked as /sdlc:<id>', () => {
    for (const id of WORKFLOW_IDS) {
      const skill = files.find((f) => f.path === `skills/${id}/SKILL.md`)!;
      const { data, body } = splitFrontmatter(skill.content);
      expect(data.name).toBe(id);
      expect(body).not.toMatch(/`\/sdlc-[a-z]/);
    }
  });

  it('bundles the same hooks as a project install', () => {
    const hooks = JSON.parse(files.find((f) => f.path === 'hooks/hooks.json')!.content).hooks;
    expect(Object.keys(hooks)).toEqual(['SessionStart', 'PreToolUse', 'Stop']);
  });
});
