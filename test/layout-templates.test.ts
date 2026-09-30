import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUT_ROLE_IDS, LAYOUT_ROLES } from '../src/core/layout.js';
import { REPO_ROOT } from './helpers.js';

const TEMPLATES = path.join(REPO_ROOT, 'assets', 'project');
const read = (rel: string) => fs.readFileSync(path.join(TEMPLATES, rel), 'utf-8');
const TOKEN = /\{\{([^}]*)\}\}/g;
const KNOWN = new Set(['project.name', 'cli', 'verify.commands', ...LAYOUT_ROLE_IDS.map((id) => `path:${id}`)]);

describe('AI-ready project templates (assets/project/)', () => {
  it('every role has its template file', () => {
    for (const r of LAYOUT_ROLES) {
      expect(fs.existsSync(path.join(TEMPLATES, r.template)), r.template).toBe(true);
    }
  });

  it('templates use only known tokens, are English Markdown and end with a newline', () => {
    for (const r of LAYOUT_ROLES) {
      const text = read(r.template);
      for (const m of text.matchAll(TOKEN)) expect(KNOWN.has(m[1]), `${r.template}: {{${m[1]}}}`).toBe(true);
      expect(text, r.template).not.toMatch(/[Ѐ-ӿ]/);
      expect(text, r.template).not.toMatch(/\r/);
      expect(text.endsWith('\n'), r.template).toBe(true);
      expect(text, r.template).toMatch(/^# /m);
    }
  });

  it('AGENTS.md is the main guide: links every other role and names the lifecycle commands', () => {
    const agents = read('ai-ready/AGENTS.md');
    for (const id of LAYOUT_ROLE_IDS.filter((x) => x !== 'agents-guide')) {
      expect(agents, id).toContain(`({{path:${id}}})`);
    }
    expect(agents).toContain('{{verify.commands}}');
    expect(agents).toMatch(/\{\{cli\}\} (status|next)/);
    for (const wf of ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'archive']) expect(agents, wf).toContain(wf);
    expect(agents).toMatch(/openspec\//);
  });

  it('CLAUDE.md is a thin wrapper that imports AGENTS.md', () => {
    const claude = read('ai-ready/CLAUDE.md');
    expect(claude).toMatch(/^@AGENTS\.md$/m);
    expect(claude.split('\n').length).toBeLessThan(40);
  });

  it('negative: document templates carry guidance, not lorem ipsum or TODO placeholders only', () => {
    for (const r of LAYOUT_ROLES) {
      const text = read(r.template);
      expect(text, r.template).not.toMatch(/lorem ipsum/i);
      expect(text.replace(TOKEN, '').trim().length, r.template).toBeGreaterThan(200);
    }
  });
});
