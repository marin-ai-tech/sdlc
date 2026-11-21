import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B252 (E25): a busy or silent remote is not reported as a code defect: the CLI line, `sdlc next` and `sdlc explain`
 * point at the server and the script log. A code failure keeps the usual texts. The guide documents the contract.
 */

const AGENT = { CLAUDECODE: '1' };
const ID = 'add-export';
const CODE_HINT = /fix the code|fix the failing checks/i;
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/app.js`\n\n## Order of work\n1. Do.\n\n## Proof\n'
  + 'The suite.\n\n## Rollback\nRevert.\n';

function script(dir: string, name: string, body: string): string {
  const file = path.join(dir, `${name}.cjs`);
  write(file, body);
  return `node "${file.replace(/\\/g, '/')}"`;
}

function project(kind: 'busy' | 'silent' | 'code' | 'dirty') {
  const root = tempDir('sdlc-rh-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const dir = tempDir('sdlc-rh-scripts-');
  const busy = script(dir, 'busy', [
    "require('fs').writeFileSync(process.env.SDLC_VERIFY_ANSWER,",
    "  JSON.stringify({ commit: process.env.SDLC_VERIFY_COMMIT, status: 'busy' }));",
    '',
  ].join('\n'));
  const silent = script(dir, 'silent', 'process.exit(0);\n');
  const broken = script(dir, 'broken', 'process.exit(1);\n');
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  expect(runCli(['new', ID, '--json'], root, env).code).toBe(0);
  // Past its plan, every task done: `sdlc next` then speaks about verification.
  const change = path.join(root, `openspec/changes/${ID}`);
  write(path.join(change, 'intent.md'), INTENT);
  for (const gate of ['intent', 'spec', 'plan']) {
    const waived = runCli(['waive', gate, '--change', ID, '--note', 'test', '--json'], root, env);
    expect(waived.code, waived.stdout + waived.stderr).toBe(0);
  }
  write(path.join(change, 'plan.md'), PLAN);
  write(path.join(change, 'tasks.md'), '# Tasks\n\n## 1. Work\n\n- [x] 1.1 Do it and verify the suite passes\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = kind === 'code'
    ? [{ name: 'suite', run: broken, required: true }]
    : [{ name: 'suite', run: kind === 'busy' ? busy : silent, required: true, remote: true }];
  // A dirty tree is refused before the command starts, so the script never matters there.
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  if (kind === 'dirty') write(path.join(root, 'src/app.js'), 'export const a = 2;\n');
  const cli = (argv: string[]) => runCli(argv, root, { ...env, ...AGENT });
  const verify = cli(['verify', '--change', ID]);
  return { verify, next: cli(['next', '--change', ID]), explain: cli(['explain', '--change', ID]) };
}

const text = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

describe('B252: infrastructure failures are not code defects', () => {
  it('H1: a busy remote: the verify line, next and explain point at the server, not the code', () => {
    const p = project('busy');
    expect(p.verify.code).not.toBe(0);
    for (const [name, r] of Object.entries({ verify: p.verify, next: p.next, explain: p.explain })) {
      expect(text(r), name).not.toMatch(CODE_HINT);
      expect(text(r), name).toMatch(/server/i);
    }
  }, 240000);

  it('H2: a silent remote: the verify line and next point at the server and the script log', () => {
    const p = project('silent');
    expect(p.verify.code).not.toBe(0);
    for (const [name, r] of Object.entries({ verify: p.verify, next: p.next })) {
      expect(text(r), name).not.toMatch(CODE_HINT);
      expect(text(r), name).toMatch(/script log/i);
    }
  }, 240000);

  it('negative H3: a code failure keeps the usual texts', () => {
    const p = project('code');
    expect(p.verify.code).not.toBe(0);
    expect(text(p.verify)).toMatch(CODE_HINT);
    expect(text(p.next)).toMatch(CODE_HINT);
  }, 240000);
});

describe('B252 review: a refused dirty tree asks for a commit, not a code fix', () => {
  it('H5: the verify line and next say to commit or revert, not to fix the code', () => {
    const p = project('dirty');
    expect(p.verify.code).not.toBe(0);
    for (const [name, r] of Object.entries({ verify: p.verify, next: p.next, explain: p.explain })) {
      expect(text(r), name).not.toMatch(CODE_HINT);
      expect(text(r), name).toMatch(/commit/i);
    }
  }, 240000);

  it('H6: the guide warns that the kept log may hold secrets', () => {
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs/en/05-guide.md'), 'utf8');
    const section = guide.split('### Remote checks')[1]?.split('\n### ')[0] ?? '';
    expect(section).toMatch(/secret/i);
  });
});

describe('B252: the guide documents the contract', () => {
  it('H4: docs/en/05-guide.md names the mark, the variables, the answer and both reasons', () => {
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs/en/05-guide.md'), 'utf8');
    for (const term of ['remote: true', 'SDLC_VERIFY_COMMIT', 'SDLC_VERIFY_ANSWER', 'SDLC_VERIFY_LOG',
      '"commit"', '"status"', 'remote_unavailable', 'remote_no_answer', 'authorized_keys', 'restrict']) {
      expect(guide, term).toContain(term);
    }
  });
});
