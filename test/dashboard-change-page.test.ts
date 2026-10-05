import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B8: the offline dashboard has a section per change (anchor `change-<id>`, linked from the changes table): the
 * timeline, the waits on people, the reworks with reasons, the trace gaps, and who acts now by name.
 */

const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  carol: { name: Carol Smirnova, emails: [carol@corp.example] }',
  'roles:', '  product-owner: [alice, carol]', '  engineer: [carol]', '  code-owner: [carol]', '  maintainer: [alice]', '',
].join('\n');
const INTENT = '# Intent: say goodbye\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';
const SPEC = '# Spec Delta\n\n## ADDED Requirements\n\n### Requirement: Farewell\nThe system SHALL say goodbye.\n';

function project() {
  const root = tempDir('sdlc-dash-change-');
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'roles']);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/add-farewell');
  write(path.join(dir, 'intent.md'), INTENT);
  write(path.join(dir, 'specs/greeting/spec.md'), SPEC);
  expect(cli(['status', '--change', 'add-farewell', '--json']).code).toBe(0);
  expect(cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
  const rework = cli(['rework', 'intent', '--change', 'add-farewell', '--reason', 'wrong-assumption', '--note', 'n', '--json']);
  expect(rework.code, rework.stdout + rework.stderr).toBe(0);
  return { root, cli };
}

describe('the dashboard page of a change', () => {
  it('has a linked section with the timeline, waits, reworks, trace gaps and who acts now', () => {
    const p = project();
    const out = path.join(p.root, 'dashboard.html');
    expect(p.cli(['dashboard', '--out', out]).code).toBe(0);
    const html = read(out);
    expect(html).toContain('href="#change-add-farewell"');
    const start = html.indexOf('id="change-add-farewell"');
    expect(start).toBeGreaterThan(0);
    const end = html.indexOf('</section>', start);
    const section = html.slice(start, end);
    expect(section).toContain('gate.intent.approved');
    expect(section).toMatch(/wait/i);
    expect(section).toContain('wrong-assumption');
    expect(section).toMatch(/requirement without a scenario: Farewell/);
    expect(section).toContain('Alice Ivanova');
    expect(section).toContain('Carol Smirnova');
  }, 240000);

  it('negative: the dashboard stays one file without network references', () => {
    const p = project();
    const out = path.join(p.root, 'dashboard.html');
    expect(p.cli(['dashboard', '--out', out]).code).toBe(0);
    expect(read(out)).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/i);
  }, 240000);
});
