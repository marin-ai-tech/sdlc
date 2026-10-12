import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.2: messages that said the wrong thing (found while writing the user course).
 * - The denial of an agent's edit of openspec/roles.yaml names roles.yaml, not `.sdlc.yaml` and the log.
 * - `sdlc trace` shows a finding deferred to the registry as deferred, with its item, not as accepted.
 * - The text output of `sdlc approvals verify` shows each approval's trailer status, as its JSON does.
 */

const AGENT = { CLAUDECODE: '1' };

function project() {
  const root = tempDir('sdlc-messages-0152-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

describe('0.15.2 messages', () => {
  it('the denial of an edit of roles.yaml names roles.yaml', () => {
    const p = project();
    const ctx = { paths: projectPaths(p.root), config: defaultConfig() };
    const call = normalizeToolCall('Write', { file_path: path.join(p.root, 'openspec/roles.yaml') }, p.root);
    const decision = evaluateToolCall(call, ctx);
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('roles.yaml');
    expect(decision.reason).not.toContain('.sdlc.yaml');
  }, 120000);

  it('trace shows a deferred finding as deferred, with its registry item', () => {
    const p = project();
    expect(p.cli(['new', 'add-export', '--json']).code).toBe(0);
    expect(p.cli(['defer', 'add', 'Retry failed exports', '--why', 'Out of scope', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/add-export/review.md'), ['# Review', '', '## Findings', '',
      '### F1 [minor][bugs] no retry', '- **Where**: src/export.js:3', '- **Status**: deferred (D1)', ''].join('\n'));
    const trace = p.cli(['trace', 'add-export', '--json']);
    expect(trace.code, trace.stdout + trace.stderr).toBe(0);
    const text = JSON.stringify(trace.json());
    expect(text).toContain('D1');
    expect(text).toMatch(/deferred/);
    expect(text).not.toMatch(/"accepted"/);
  }, 120000);

  it('approvals verify prints the trailer status of each approval in text', () => {
    const p = project();
    write(path.join(p.root, 'openspec/roles.yaml'), ['version: 1', 'signing: warn', 'people:',
      '  pat: { name: Pat Owner, emails: [pat@example.com] }', 'roles:', '  product-owner: [pat]', '  engineer: [pat]',
      '  code-owner: [pat]', '  maintainer: [pat]', ''].join('\n'));
    expect(p.cli(['new', 'add-export', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/add-export/intent.md'), ['# Intent: x', '',
      'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.', '',
      '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
      '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n'));
    expect(p.cli(['approve', 'intent', '--change', 'add-export', '--json']).code).toBe(0);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'approve intent']);
    const json = p.cli(['approvals', 'verify', '--mode', 'warn', '--json']).json();
    expect(JSON.stringify(json)).toMatch(/trailer/);
    const text = p.cli(['approvals', 'verify', '--mode', 'warn']).stdout;
    expect(text).toMatch(/trailer/i);
  }, 120000);

  it('negative: an agent edit of the change record still names the record', () => {
    const p = project();
    expect(p.cli(['new', 'add-export', '--json']).code).toBe(0);
    const ctx = { paths: projectPaths(p.root), config: defaultConfig() };
    const file = path.join(p.root, 'openspec/changes/add-export/.sdlc.yaml');
    const decision = evaluateToolCall(normalizeToolCall('Write', { file_path: file }, p.root), ctx);
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('.sdlc.yaml');
    void AGENT;
  }, 120000);
});
