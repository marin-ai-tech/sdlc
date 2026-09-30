import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAsset, splitFrontmatter, WORKFLOW_IDS } from '../src/integrations/assets.js';
import { renderClaudePlugin } from '../src/integrations/plugin.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

const SECTIONS = ['Problem', 'What exists', 'Research', 'Alternatives', 'Pressure test', 'Recommendation'];

function project() {
  const root = tempDir('sdlc-explore-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude,opencode', '--json']).code).toBe(0);
  return { root, cli };
}

describe('/sdlc:explore workflow', () => {
  it('is an optional workflow before intent, rendered for both tools and the plugin', () => {
    expect(WORKFLOW_IDS).toContain('explore');
    expect(WORKFLOW_IDS.indexOf('explore')).toBeLessThan(WORKFLOW_IDS.indexOf('intent'));
    expect(renderClaudePlugin().some((f) => f.path === 'skills/explore/SKILL.md')).toBe(true);
    const { root } = project();
    for (const f of ['.claude/skills/sdlc-explore/SKILL.md', '.claude/commands/sdlc/explore.md', '.opencode/commands/sdlc-explore.md']) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
  });

  it('researches, pressure-tests with named lenses, recommends, and never writes code', () => {
    const { data, body } = splitFrontmatter(readAsset('workflows', 'explore.md'));
    expect(data.id).toBe('explore');
    expect(String(data.description)).toMatch(/idea/i);
    expect(body).toMatch(/sdlc explore/);
    expect(body).toMatch(/sdlc-researcher/);
    for (const lens of ['user', 'technical', 'cost', 'risk']) expect(body.toLowerCase(), lens).toContain(lens);
    expect(body).toMatch(/--source-type exploration/);
    expect(body).toMatch(/\{\{cmd:intent\}\}/);
    expect(body).toMatch(/do not (edit|write|change) (project )?code/i);
  });

  it('intent reads a linked exploration instead of asking again', () => {
    const intent = readAsset('workflows', 'intent.md');
    expect(intent).toMatch(/exploration/i);
    expect(intent).toMatch(/openspec\/explorations\//);
  });
});

describe('sdlc explore (CLI)', () => {
  it('creates an exploration note from the template, lists it, logs it; agents may run it', () => {
    const { root, cli } = project();
    const r = cli(['explore', 'claims-status', '--json'], { CLAUDECODE: '1' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().path).toBe('openspec/explorations/claims-status.md');
    const text = read(path.join(root, 'openspec/explorations/claims-status.md'));
    for (const s of SECTIONS) expect(text, s).toMatch(new RegExp(`^## ${s}`, 'm'));
    expect(text).not.toMatch(/\{\{/);
    expect(cli(['explore', 'list', '--json']).json().explorations).toEqual([
      expect.objectContaining({ slug: 'claims-status', path: 'openspec/explorations/claims-status.md' }),
    ]);
    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toContain('exploration.created');
  });

  it('negative: refuses an existing note and an invalid slug, and never overwrites', () => {
    const { root, cli } = project();
    cli(['explore', 'claims-status', '--json']);
    fs.appendFileSync(path.join(root, 'openspec/explorations/claims-status.md'), '\nmy notes\n');
    const again = cli(['explore', 'claims-status', '--json']);
    expect(again.code).toBe(1);
    expect(again.json().status[0].code).toBe('exploration_exists');
    expect(read(path.join(root, 'openspec/explorations/claims-status.md'))).toContain('my notes');
    expect(cli(['explore', '../escape', '--json']).code).toBe(1);
    expect(cli(['explore', 'Bad Name', '--json']).code).toBe(1);
  });

  it('a change can name an exploration as its source; a missing one is refused', () => {
    const { cli } = project();
    cli(['explore', 'claims-status', '--json']);
    const ok = cli(['new', 'claims-status-self-service', '--source-type', 'exploration', '--source-ref', 'openspec/explorations/claims-status.md', '--json']);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.json().change.source).toEqual({ type: 'exploration', ref: 'openspec/explorations/claims-status.md' });
    const missing = cli(['new', 'other', '--source-type', 'exploration', '--source-ref', 'openspec/explorations/nope.md', '--json']);
    expect(missing.code).toBe(1);
    expect(missing.json().status[0].code).toBe('unknown_exploration');
  });
});
