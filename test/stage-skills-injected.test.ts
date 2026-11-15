import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// OpenSpec change stage-skills-are-in-the-opencode-command (B319, B257). On OpenCode a role's skills reached the work
// only when the agent loaded them itself. A stage command now injects the SKILL.md texts of its stage through
// `sdlc team skills --stage <stage>`, a read-only command; surfaces without injection keep the load step.

const CLI = 'npx --no-install sdlc';
const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`;

function project(stages: Record<string, string[]>, tools = 'claude,opencode') {
  const root = tempDir('sdlc-b319-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--cli', CLI, '--json']).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.stages = Object.fromEntries(Object.entries(stages).map(([stage, skills]) => [stage, { skills }]));
  write(sdlc, stringify(config));
  const install = (name: string, body: string) =>
    write(path.join(root, `.claude/skills/${name}/SKILL.md`), skill(name, body));
  const text = (rel: string) => read(path.join(root, rel));
  const update = () => {
    const r = cli(['update', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  };
  return { root, cli, install, text, update };
}

const BUILD = ['plan-mode', 'code-that-fits-in-your-head'];

describe('B319.C1 the build command carries its skills', () => {
  it('the OpenCode and Claude Code build commands inject the stage skills command', () => {
    const p = project({ build: BUILD });
    p.update();
    for (const rel of ['.opencode/commands/sdlc-build.md', '.claude/commands/sdlc/build.md']) {
      const text = p.text(rel);
      expect(text, rel).toContain(`!\`${CLI} team skills --stage build\``);
      // The load step stays as the fallback for a missing text, after the injection (0.32.0 B257 keeps its test).
      expect(text.indexOf('team skills --stage build'), rel).toBeLessThan(text.indexOf('by name only when'));
      // Review F8: the texts are printed at the start of the command, before the workflow body.
      expect(text.indexOf('team skills --stage build'), rel).toBeLessThan(text.indexOf('Harness contract'));
    }
  }, 180000);

  it('the command prints each SKILL.md text under its heading, without the front matter, and writes nothing', () => {
    const p = project({ build: BUILD });
    p.install('plan-mode', 'Plan before you edit.');
    p.install('code-that-fits-in-your-head', 'Keep functions short.');
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'setup']);
    const r = p.cli(['team', 'skills', '--stage', 'build']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('## Skill plan-mode');
    expect(r.stdout).toContain('Plan before you edit.');
    expect(r.stdout).toContain('## Skill code-that-fits-in-your-head');
    expect(r.stdout).toContain('Keep functions short.');
    expect(r.stdout).not.toContain('description: plan-mode skill');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: p.root, encoding: 'utf-8' });
    expect(status).toBe('');
    const json = p.cli(['team', 'skills', '--stage', 'build', '--json']).json();
    expect(json.skills).toEqual([
      { name: 'plan-mode', status: 'injected' },
      { name: 'code-that-fits-in-your-head', status: 'injected' },
    ]);
  }, 180000);
});

describe('B319.C2 negative: no other stage skills', () => {
  it('build output has no review skill, and the review command injects the deploy stage', () => {
    const p = project({ build: BUILD, deploy: ['review-checklist'] });
    for (const name of [...BUILD, 'review-checklist']) p.install(name, `Text of ${name}.`);
    p.update();
    const build = p.cli(['team', 'skills', '--stage', 'build']).stdout;
    expect(build).not.toContain('review-checklist');
    const review = p.text('.opencode/commands/sdlc-review.md');
    expect(review).toContain(`!\`${CLI} team skills --stage deploy\``);
    expect(review).not.toContain('--stage build');
  }, 180000);
});

describe('B319.C3 limits', () => {
  it('a skill that is not installed is named as missing', () => {
    const p = project({ build: BUILD });
    p.install('plan-mode', 'Plan before you edit.');
    const r = p.cli(['team', 'skills', '--stage', 'build']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/## Skill code-that-fits-in-your-head[\s\S]*missing/i);
    const json = p.cli(['team', 'skills', '--stage', 'build', '--json']).json();
    expect(json.skills[1]).toEqual({ name: 'code-that-fits-in-your-head', status: 'missing' });
  }, 180000);

  it('the output stops at 48 KiB and names each skill past the cap with "load it by name"', () => {
    const p = project({ build: ['big-one', 'big-two', 'small'] });
    p.install('big-one', 'a'.repeat(40 * 1024));
    p.install('big-two', 'b'.repeat(20 * 1024));
    p.install('small', 'Small text.');
    const r = p.cli(['team', 'skills', '--stage', 'build']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(Buffer.byteLength(r.stdout)).toBeLessThan(49 * 1024);
    expect(r.stdout).not.toContain('b'.repeat(1000));
    expect(r.stdout).toMatch(/## Skill big-two[\s\S]*load it by name/);
    // Review F3: the output stops at the cap; the small skill after it is only named, as the spec says.
    expect(r.stdout).not.toContain('Small text.');
    expect(r.stdout).toMatch(/## Skill small[\s\S]*load it by name/);
    const json = p.cli(['team', 'skills', '--stage', 'build', '--json']).json();
    expect(json.skills.map((s: { status: string }) => s.status)).toEqual(['injected', 'over-cap', 'over-cap']);
  }, 180000);

  it('review F4 and F11: a SKILL.md that links outside is not read; a BOM or empty front matter is dropped', () => {
    const p = project({ build: ['outside', 'bom', 'empty'] });
    const elsewhere = tempDir('sdlc-b319-elsewhere-');
    write(path.join(elsewhere, 'SKILL.md'), skill('outside', 'Text from outside the project.'));
    fs.mkdirSync(path.join(p.root, '.claude/skills'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(p.root, '.claude/skills/outside'), 'junction');
    write(path.join(p.root, '.claude/skills/bom/SKILL.md'), `﻿${skill('bom', 'Bom body.')}`);
    write(path.join(p.root, '.claude/skills/empty/SKILL.md'), '---\n---\nEmpty front matter body.\n');
    const r = p.cli(['team', 'skills', '--stage', 'build']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain('Text from outside the project.');
    expect(r.stdout).toContain('Bom body.');
    expect(r.stdout).not.toContain('description: bom skill');
    expect(r.stdout).toContain('Empty front matter body.');
    expect(r.stdout).not.toMatch(/## Skill empty\n\n---/);
  }, 180000);
});

describe('B319.C4 surfaces without injection and stages without skills', () => {
  it('the Codex build skill keeps the load step; a stage without skills gets neither', () => {
    const p = project({ build: BUILD }, 'claude,opencode,codex');
    p.update();
    const codex = p.text('.agents/skills/sdlc-build/SKILL.md');
    expect(codex).toContain('load the skills `plan-mode`, `code-that-fits-in-your-head` by name');
    expect(codex).not.toContain('team skills --stage');
    const verify = p.text('.opencode/commands/sdlc-verify.md');
    expect(verify).not.toContain('team skills --stage');
    expect(verify).not.toContain('load the skills');
  }, 180000);
});
