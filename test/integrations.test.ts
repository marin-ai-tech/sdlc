import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { renderAll, renderContext, installIntegrations, uninstallIntegrations } from '../src/integrations/install.js';
import { splitFrontmatter, WORKFLOW_IDS } from '../src/integrations/assets.js';
import { applyCliPrefix } from '../src/integrations/render.js';
import { REQUIRED_NOTICE } from '../src/core/license.js';
import { harnessVersion } from '../src/core/version.js';
import { mergeClaudeHooks } from '../src/integrations/settings.js';
import { read, tempDir, write } from './helpers.js';
import type { ToolId } from '../src/integrations/types.js';

function render(tools: ToolId[], mutate?: (c: ReturnType<typeof defaultConfig>) => void) {
  const config = defaultConfig();
  mutate?.(config);
  return renderAll(renderContext(config, tools));
}

describe('generated agent files', () => {
  const files = render(['claude', 'opencode']);
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it('writes skills once, to .claude/skills, when both tools are installed', () => {
    expect(files.filter((f) => f.path.startsWith('.opencode/skills/'))).toHaveLength(0);
    expect(files.filter((f) => f.path.startsWith('.claude/skills/'))).toHaveLength(WORKFLOW_IDS.length);
  });

  it('uses .opencode/skills for an OpenCode-only project', () => {
    const only = render(['opencode']);
    expect(only.filter((f) => f.path.startsWith('.opencode/skills/'))).toHaveLength(WORKFLOW_IDS.length);
    expect(only.some((f) => f.path.startsWith('.claude/'))).toBe(false);
  });

  it('skill frontmatter follows the Agent Skills rules', () => {
    for (const f of files.filter((x) => x.kind === 'skill')) {
      const { data } = splitFrontmatter(f.content);
      const dir = path.posix.basename(path.posix.dirname(f.path));
      expect(data.name).toBe(dir);
      expect(String(data.name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(String(data.name).length).toBeLessThanOrEqual(64);
      expect(String(data.description).length).toBeGreaterThan(20);
      expect(String(data.description).length).toBeLessThanOrEqual(1024);
      expect(Object.values(data.metadata as Record<string, unknown>).every((v) => typeof v === 'string')).toBe(true);
    }
  });

  it('every file has parseable frontmatter and no unresolved placeholders', () => {
    for (const f of files.filter((x) => x.path.endsWith('.md') && !x.path.startsWith('openspec/'))) {
      expect(() => splitFrontmatter(f.content), f.path).not.toThrow();
      expect(f.content, f.path).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });

  it('OpenCode commands pass arguments and never pin an agent', () => {
    for (const id of WORKFLOW_IDS) {
      const content = byPath.get(`.opencode/commands/sdlc-${id}.md`)!;
      const { data, body } = splitFrontmatter(content);
      expect(Object.keys(data)).toEqual(['description']);
      expect(body).toContain('$ARGUMENTS');
      expect(body).not.toMatch(/\/sdlc:[a-z]/);
    }
  });

  it('Claude commands use the namespaced /sdlc:<id> form', () => {
    const verify = byPath.get('.claude/commands/sdlc/verify.md')!;
    expect(verify).toContain('`/sdlc:review`');
    expect(splitFrontmatter(verify).data['allowed-tools']).toBe('Bash(sdlc *)');
  });

  it('OpenCode agents use a permission map, never a Claude-style tools string', () => {
    for (const f of files.filter((x) => x.path.startsWith('.opencode/agents/'))) {
      const { data } = splitFrontmatter(f.content);
      expect(data.mode).toBe('subagent');
      expect(data.tools).toBeUndefined();
      expect(typeof data.permission).toBe('object');
    }
    const reviewer = splitFrontmatter(byPath.get('.opencode/agents/sdlc-reviewer.md')!).data as { permission: { edit: string } };
    expect(reviewer.permission.edit).toBe('deny');
  });

  it('Claude agents list Claude tool names', () => {
    const { data } = splitFrontmatter(byPath.get('.claude/agents/sdlc-verifier.md')!);
    expect(data.tools).toBe('Read, Grep, Glob, Bash');
  });

  it('renders a project-local CLI prefix everywhere', () => {
    const local = render(['claude', 'opencode'], (c) => { c.cli = 'npx sdlc'; });
    const skill = local.find((f) => f.path === '.claude/skills/sdlc-verify/SKILL.md')!.content;
    expect(skill).toContain('`npx sdlc verify --change <id>`');
    expect(splitFrontmatter(skill).data['allowed-tools']).toBe('Bash(npx sdlc *)');
    expect(local.find((f) => f.path === '.opencode/plugins/sdlc.js')!.content).toContain('const CLI = ["npx","sdlc"];');
    expect(applyCliPrefix('see openspec/sdlc.yaml and sdlc-verifier', 'npx sdlc')).toBe('see openspec/sdlc.yaml and sdlc-verifier');
  });

  it('the OpenCode plugin is valid JavaScript', () => {
    const plugin = files.find((f) => f.path === '.opencode/plugins/sdlc.js')!.content;
    const root = tempDir();
    const file = path.join(root, 'plugin.mjs');
    write(file, plugin);
    return import(file).then((mod) => expect(typeof mod.SdlcPlugin).toBe('function'));
  });

  it('ships the sdlc schema for OpenSpec', () => {
    const schema = parse(byPath.get('openspec/schemas/sdlc/schema.yaml')!);
    expect(schema.artifacts.map((a: { id: string }) => a.id)).toEqual(['intent', 'proposal', 'specs', 'design', 'plan', 'tasks']);
    expect(schema.apply.tracks).toBe('tasks.md');
  });

  it('every generated agent file carries the version, the Required Notice and the license in use', () => {
    const version = harnessVersion();
    const noticed = files.filter((f) => !f.path.startsWith('openspec/schemas/sdlc/templates/'));
    expect(noticed.length).toBeGreaterThan(30);
    for (const f of noticed) {
      expect(f.content, f.path).toContain(`Generated by scdl ${version}`);
      expect(f.content, f.path).toContain(REQUIRED_NOTICE);
      expect(f.content, f.path).toContain('used under the community (PolyForm-Noncommercial-1.0.0');
    }
    for (const f of files.filter((x) => x.kind === 'skill')) {
      expect(String(splitFrontmatter(f.content).data.license)).toMatch(/^PolyForm-Noncommercial-1\.0\.0 with scdl Additional Permissions/);
    }
  });

  it('keeps notices out of artifact templates, whose text becomes the project\'s own', () => {
    const templates = files.filter((f) => f.path.startsWith('openspec/schemas/sdlc/templates/'));
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) expect(t.content, t.path).not.toMatch(/Generated by scdl|Required Notice|sdlc-provenance/);
  });

  it('names a commercial license in the notices once the project records one', () => {
    const commercial = render(['claude'], (c) => { c.license = { type: 'commercial', agreement: 'ACME-7' }; });
    const skill = commercial.find((f) => f.kind === 'skill')!;
    expect(skill.content).toContain('used under the commercial (scdl-Commercial, agreement ACME-7) license');
  });
});

describe('Claude settings.json hook merge', () => {
  it('adds harness hooks next to foreign ones and removes only its own', () => {
    const root = tempDir();
    const foreign = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }] }] } };
    write(path.join(root, '.claude/settings.json'), JSON.stringify(foreign));
    expect(mergeClaudeHooks(root, 'sdlc', true)).toBe('installed');
    expect(mergeClaudeHooks(root, 'sdlc', true)).toBe('unchanged');
    const merged = JSON.parse(read(path.join(root, '.claude/settings.json')));
    expect(merged.permissions).toEqual(foreign.permissions);
    expect(merged.hooks.PreToolUse).toHaveLength(2);
    expect(merged.hooks.SessionStart[0].hooks[0].command).toBe('sdlc hook session-start');
    expect(mergeClaudeHooks(root, 'sdlc', false)).toBe('removed');
    expect(JSON.parse(read(path.join(root, '.claude/settings.json')))).toEqual(foreign);
  });
  it('refuses to touch invalid JSON', () => {
    const root = tempDir();
    write(path.join(root, '.claude/settings.json'), '{ nope');
    expect(() => mergeClaudeHooks(root, 'sdlc', true)).toThrow(/not valid JSON/);
  });
});

describe('ownership manifest', () => {
  it('updates untouched files, keeps edited ones, and removes files no longer generated', () => {
    const root = tempDir();
    const config = defaultConfig();
    const first = installIntegrations(root, config, ['claude', 'opencode']);
    expect(first.files.created.length).toBeGreaterThan(40);
    const again = installIntegrations(root, config, ['claude', 'opencode']);
    expect(again.files.created).toHaveLength(0);
    expect(again.files.updated).toHaveLength(0);

    const edited = path.join(root, '.claude/skills/sdlc-plan/SKILL.md');
    fs.appendFileSync(edited, '\nteam note\n');
    const kept = installIntegrations(root, config, ['claude', 'opencode']);
    expect(kept.files.kept).toContain('.claude/skills/sdlc-plan/SKILL.md');
    expect(read(edited)).toContain('team note');

    const opencodeOnly = installIntegrations(root, config, ['opencode']);
    expect(opencodeOnly.files.removed).toContain('.claude/commands/sdlc/plan.md');
    expect(opencodeOnly.files.created).toContain('.opencode/skills/sdlc-plan/SKILL.md');
    // the edited Claude skill is kept, and forgotten by the manifest
    expect(fs.existsSync(edited)).toBe(true);

    const removed = uninstallIntegrations(root);
    expect(removed.files.removed).toContain('.opencode/plugins/sdlc.js');
    expect(fs.existsSync(path.join(root, 'openspec/schemas/sdlc/schema.yaml'))).toBe(true);
  });
});
