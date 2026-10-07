import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B15: context packs. A team keeps the knowledge an agent needs (domain rules, an API's quirks) as files in
 * `docs/context/`, each with a header: owner, source, updated, fresh_days, stages. `sdlc instructions <artifact>`
 * adds the sources of the artifact's stage (the stage of the gate the artifact belongs to) and marks a source whose
 * `updated` is older than `fresh_days` as stale. A file without a valid header is skipped and named.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function source(fields: Record<string, string>, body: string): string {
  const header = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return ['---', ...header, '---', '', body, ''].join('\n');
}

function project(withContext = true) {
  const root = tempDir('sdlc-context-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  if (withContext) {
    const dir = path.join(root, 'docs/context');
    const common = { owner: 'alice', source: 'https://wiki.corp.example/payments' };
    write(path.join(dir, 'payments.md'), source(
      { ...common, updated: today(), fresh_days: '30', stages: '[design, build]' }, 'Refunds never exceed the charge.'));
    write(path.join(dir, 'old.md'), source(
      { ...common, updated: '2020-01-01', fresh_days: '30', stages: '[design]' }, 'The ledger API pages by 100.'));
    write(path.join(dir, 'deploy.md'), source(
      { ...common, updated: today(), fresh_days: '90', stages: '[deploy]' }, 'Deploy windows: Tue and Thu.'));
    write(path.join(dir, 'bad.md'), 'No header here.\n');
  }
  const instructions = (artifact: string) => {
    const r = cli(['instructions', artifact, '--change', 'add-export', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json();
  };
  return { instructions };
}

interface ContextSource {
  path: string;
  owner: string;
  source: string;
  updated: string;
  stale: boolean;
  content: string;
}

describe('context packs in sdlc instructions', () => {
  it('adds the sources of the artifact\'s stage, marks the stale ones and names the skipped files', () => {
    const p = project();
    const out = p.instructions('proposal');
    const sources = out.contextSources as ContextSource[];
    expect(sources.map((s) => s.path)).toEqual(['docs/context/old.md', 'docs/context/payments.md']);
    const byPath = Object.fromEntries(sources.map((s) => [s.path, s]));
    expect(byPath['docs/context/old.md'].stale).toBe(true);
    expect(byPath['docs/context/payments.md']).toMatchObject({
      owner: 'alice', source: 'https://wiki.corp.example/payments', updated: today(), stale: false,
    });
    expect(byPath['docs/context/payments.md'].content.trim()).toBe('Refunds never exceed the charge.');
    expect(byPath['docs/context/payments.md'].content).not.toContain('fresh_days');
    expect(out.contextSkipped.map((s: { path: string }) => s.path)).toEqual(['docs/context/bad.md']);
  }, 120000);

  it('gives record artifacts the sources of their own stage', () => {
    const p = project();
    const sources = p.instructions('review').contextSources as ContextSource[];
    expect(sources.map((s) => s.path)).toEqual(['docs/context/deploy.md']);
  }, 120000);

  it('negative: without docs/context nothing is added', () => {
    const p = project(false);
    expect(p.instructions('proposal').contextSources ?? []).toEqual([]);
    expect(p.instructions('review').contextSources ?? []).toEqual([]);
  }, 120000);
});
