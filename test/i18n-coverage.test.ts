import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

const FUNCTION_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'is', 'are', 'was', 'for', 'with', 'no', 'not', 'and',
  'or', 'in', 'on', 'at', 'by', 'be', 'has', 'have', 'must', 'will', 'can', 'this', 'that', 'it', 'run', 'use',
  'yet', 'from', 'into', 'than', 'only', 'none', 'already', 'cannot', 'does', 'do', 'should', 'would', 'there']);
const CLI_WORDS = new Set(['created', 'creating', 'change', 'changes', 'approved', 'rejected', 'waived', 'locked',
  'unlocked', 'written', 'installed', 'removed', 'kept', 'update', 'updated', 'remove', 'create', 'found', 'missing',
  'started', 'imported', 'archived', 'recorded', 'evidence', 'findings', 'finding', 'passed', 'failed', 'unknown',
  'invalid', 'valid', 'entries', 'tracked', 'edited', 'ready', 'item', 'items', 'epic', 'added', 'closed', 'done',
  'dropped', 'moved', 'next', 'start', 'checked', 'declared', 'license', 'project', 'person', 'agent', 'gate',
  'gates', 'approve', 'approval', 'approvals', 'review', 'verification', 'verify', 'checks', 'files', 'file',
  'initialized', 'harness', 'hooks', 'plugin', 'unchanged', 'left', 'untouched', 'blocked', 'pending', 'stale',
  'scenario', 'scenarios', 'row', 'aliases', 'documents', 'readiness', 'record', 'signing', 'signed', 'unsigned',
  'roles', 'role', 'people', 'refused', 'denied', 'not', 'here', 'name', 'path', 'warning', 'fix', 'run', 'set']);

/** True when a line still reads as English prose after names, paths, flags, code and URLs are removed. */
function englishProse(line: string): boolean {
  if (/^\s*\$ /.test(line)) return false;
  if (/^\d{4}-\d\d-\d\dT[\d:.]+Z\s/.test(line)) return false;
  if (/[●○] ─ /.test(line)) return false;
  const stripped = line
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/(^|\s)--?[\w-]+/g, ' ')
    .replace(/\b[\w-]*\d[\w.-]*\b/g, ' ')
    .replace(/\b[a-z]+(?:-[a-z]+)+\b/g, ' ');
  const words = stripped.split(/[^A-Za-z']+/).filter(Boolean).map((w) => w.toLowerCase());
  for (let i = 0; i + 2 < words.length; i++) {
    const run = words.slice(i, i + 3);
    if (run.some((w) => FUNCTION_WORDS.has(w))) return true;
  }
  for (let i = 0; i + 1 < words.length; i++) {
    if (CLI_WORDS.has(words[i]) || CLI_WORDS.has(words[i + 1])) {
      if (/^[a-z']+$/.test(words[i]) && /^[a-z']+$/.test(words[i + 1])) return true;
    }
  }
  return false;
}

describe('English CLI meaning', () => {
  it('flags English prose and ignores names, paths, flags and code', () => {
    expect(englishProse('Created change add-x (sdlc schema, feature, risk medium, full track)')).toBe(true);
    expect(englishProse('No active change has an approved plan yet')).toBe(true);
    expect(englishProse('error: Unknown gate. Gates: intent, spec')).toBe(true);
    expect(englishProse('✓ tests locked for fix-x')).toBe(true);
    expect(englishProse('add-x  [feature · risk medium · full track · schema sdlc]')).toBe(false);
    expect(englishProse('The intent gate was rejected by Pat')).toBe(true);
    expect(englishProse('  openspec/changes/add-x/intent.md')).toBe(false);
    expect(englishProse('$ sdlc approve intent --change add-x --as product-owner')).toBe(false);
  });
  it('explains community license problems in English', () => {
    const root = tempDir('sdlc-i18n-cov-');
    initGitRepo(root);
    const env = humanEnv(tempDir('sdlc-home-'));
    runCli(['init', '--tools', 'none', '--json'], root, env);
    const english = runCli(['license'], root, env).stdout;
    expect(english).toMatch(/community license, but the project declares no OSI-approved license/);
    write(path.join(root, 'LICENSE'), 'Proprietary. All rights reserved.\n');
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'x', license: 'UNLICENSED' }));
    expect(runCli(['license'], root, env).stdout)
      .toMatch(/community license, but the project's license .* is not OSI-approved/);
  }, 120000);
});
