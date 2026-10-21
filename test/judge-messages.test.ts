import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Defects found by the 0.20.0 course audit: the judge's own rework text ends with a period, and `sdlc next` added
 * another one ("…proposal.. Revise them"); the message after max_loops had no colon before the rework text ("the spec
 * gate Add …"). The judge's text is now put into a sentence without its own end punctuation, in every locale.
 */

const JUDGE = path.join(REPO_ROOT, 'test/fixtures/judge/judge.mjs').replace(/\\/g, '/');

function project(locale: 'en' | 'xx') {
  const root = tempDir('sdlc-judge-msg-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(['--locale', locale, ...args], root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'docs/rubrics/spec.md'), '# Rubric\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.gates.spec.judge = { run: `node ${JUDGE}`, rubric: 'docs/rubrics/spec.md', max_loops: 2 };
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  expect(cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  const judge = () => cli(['judge', '--gate', 'spec', '--change', 'add-farewell', '--json']);
  const nextText = () => cli(['next', '--change', 'add-farewell']).stdout;
  return { judge, nextText };
}

describe('judge messages', () => {
  for (const locale of ['en', 'xx'] as const) {
    it(`${locale}: the rework text is not followed by a second period, and the escalation has a colon`, () => {
      const p = project(locale);
      expect(p.judge().code).toBe(1);
      const rework = p.nextText();
      expect(rework).toContain('Add JUDGE-OK to the proposal');
      expect(rework).not.toMatch(/proposal\.\./);
      expect(p.judge().code).toBe(1);
      const escalated = p.nextText();
      expect(escalated).toMatch(/spec( gate)?: Add JUDGE-OK to the proposal/);
      expect(escalated).not.toMatch(/proposal\.\./);
    }, 240000);
  }
});
