import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { parseTeamConfig } from '../src/team/team-config.js';
import { renderAll, renderContext } from '../src/integrations/install.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import { humanEnv, read, runCli, tempDir, write } from './helpers.js';

describe('Explicit solo execution profile', () => {
  it('actual init persists the selected profile and installs five skills without touching human roles or trust', () => {
    const root = tempDir('sdlc-solo-init-');
    const env = humanEnv(tempDir('sdlc-solo-home-'));
    const roles = 'version: 1\nsigning: off\npeople: {}\nroles: {}\nseparation:\n  max_gates_per_person: 3\n';
    write(path.join(root, 'openspec/roles.yaml'), roles);
    const result = runCli(['init', '--tools', 'opencode,codex', '--team-mode', 'solo', '--layout', 'none', '--json'], root, env);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).team).toEqual({ mode: 'solo' });
    for (const role of ['analyst', 'architect', 'developer', 'tester', 'reviewer']) {
      for (const folder of ['.opencode/skills', '.agents/skills']) {
        expect(fs.existsSync(path.join(root, folder, `sdlc-role-${role}/SKILL.md`))).toBe(true);
      }
    }
    expect(read(path.join(root, 'openspec/roles.yaml'))).toBe(roles);
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/team.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  }, 120000);

  it('parses solo/team without changing human roles or implicitly trusting a registry', () => {
    expect(parseTeamConfig({ mode: 'solo' }, (key) => key, [])).toEqual({ mode: 'solo' });
    expect(parseTeamConfig({ mode: 'team' }, (key) => key, [])).toEqual({ mode: 'team' });
    expect(() => parseTeamConfig({ mode: 'automatic' }, (key) => key, [])).toThrow();
    expect(() => parseTeamConfig({ mode: 'solo', registry: 'untrusted' }, (key) => key, [])).toThrow();
  });

  it('renders all five discoverable execution skills and switches the active stage role', () => {
    const config = defaultConfig();
    config.team = { mode: 'solo' } as NonNullable<typeof config.team>;
    const files = renderAll(renderContext(config, ['opencode']));
    for (const role of ['analyst', 'architect', 'developer', 'tester', 'reviewer']) {
      const skill = files.find((file) => file.path === `.opencode/skills/sdlc-role-${role}/SKILL.md`);
      expect(skill, role).toBeDefined();
      expect(skill?.content).toMatch(/description:/);
      expect(skill?.content).toContain('human');
    }
    const spec = files.find((file) => file.path === '.opencode/skills/sdlc-spec/SKILL.md')!.content;
    const verify = files.find((file) => file.path === '.opencode/skills/sdlc-verify/SKILL.md')!.content;
    expect(spec).toContain('Active execution role: analyst');
    expect(verify).toContain('Active execution role: tester');
    expect(spec).not.toContain('Active execution role: tester');
    expect(files.some((file) => file.path.includes('roles.yaml'))).toBe(false);
    expect(files.some((file) => file.path.startsWith('.claude/'))).toBe(false);
  });

  it('positive control: absence preserves legacy rendering and registry validation', () => {
    expect(parseTeamConfig(undefined, (key) => key, [])).toBeUndefined();
    const config = defaultConfig();
    const files = renderAll(renderContext(config, ['opencode']));
    expect(files.some((file) => file.path.includes('/sdlc-role-'))).toBe(false);
    expect(files.some((file) => file.content.includes('Active execution role:'))).toBe(false);
    expect(() => parseTeamConfig({ registry: 'unknown' }, (key) => key, [])).toThrow();
  });
});
