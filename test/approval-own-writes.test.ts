import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { BIN, REPO_ROOT, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F4 (close-the-digest-integrity-review-findings): a review or release approval captured the raw worktree tree,
 * evaluated, and only then called `recordAwaiting`, which records an auto-waive policy's waiver on the change
 * (`.sdlc.yaml`) and appends `gate.<g>.auto_waived` to the tracked project log. The checkpoint then compared that
 * early tree with a snapshot that held the approval's own writes, so the first such approval was always refused with
 * `digest_changed`. The raw tree is now recorded after the approval's own writes and before the evaluation it
 * approves; anyone else's edit in the window, to any file Git does not ignore, still refuses.
 *
 * Real CLI, real git, no mocks. The waiver is due because the policy (`gates.intent.auto_waive` for the change's
 * kind) is added just before the approval, after a person approved the intent. Edits by someone else are made while
 * the release checks run: the release check's MCP server is started with a preloaded script that writes the file.
 */

const CHANGE = 'add-farewell';
const CLI_TIMEOUT = 120000;
const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const INTENT = [
  '# Intent: say goodbye', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem',
  'Sessions end without a goodbye.', '', '## Proposed outcome', 'Users see a named farewell.', '',
  '## Affected users and systems', 'All users.', '', '## Constraints', 'None', '', '## Success measures',
  'Shown on sign-out.', '', '## Out of scope', 'Localization.', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n\n## Order of work\n1. Do.\n\n'
  + '## Proof\n`node -e 0`\n\n## Rollback\nRevert.\n';
const TASKS = '# Tasks\n\n## 1. Farewell\n\n- [x] 1.1 Implement farewell and verify node -e 0 passes\n';
const REVIEW = [
  `# Review: ${CHANGE}`, '', '## Findings', '', '### F1 [important][bugs] Empty name', '- **Where**: src/greet.js:1',
  '- **Status**: fixed (default name)', '', '## Coverage', '- bugs: 1 finding',
  '- security: none found — checked: no input reaches a shell', '- compliance: none found — checked: no data',
  '- adversarial: none found — checked: very long names', '- edge-cases: none found — checked: empty names',
  '- verification-gaps: none found — checked: exact message asserted', '',
].join('\n');
const RELEASE = `# Release: ${CHANGE}\n\nNotes.\n`;

interface Edit {
  /** Project-relative file that someone else writes while the release checks run. */
  file: string;
  text: string;
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8', timeout: CLI_TIMEOUT });
  return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A change past verify with its review written; intent approved by a person, spec and plan set aside. */
function project(release = false) {
  const root = tempDir('sdlc-own-writes-');
  const home = tempDir('sdlc-home-');
  const env = humanEnv(home);
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), 'export const greet = (n) => `Hello, ${n}`;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[]) => run(args, root, env);
  const ok = (args: string[]) => {
    const r = cli([...args, '--json']);
    expect(r.code, `${args.join(' ')}: ${r.out}`).toBe(0);
  };
  ok(['init', '--tools', 'none']);
  const configFile = path.join(root, 'openspec', 'sdlc.yaml');
  const editConfig = (edit: (config: any) => void) => {
    const config = parse(read(configFile));
    edit(config);
    write(configFile, stringify(config));
  };
  editConfig((config) => {
    config.verify.commands = [{ name: 'unit', run: 'node -e 0', required: true }];
    if (release) config.gates.release.required = true;
  });
  const change = (file: string) => path.join(root, 'openspec', 'changes', CHANGE, file);
  ok(['new', CHANGE, '--kind', 'feature']);
  write(change('intent.md'), INTENT);
  ok(['approve', 'intent', '--change', CHANGE]);
  for (const gate of ['spec', 'plan']) ok(['waive', gate, '--change', CHANGE, '--note', 'test']);
  write(change('plan.md'), PLAN);
  write(change('tasks.md'), TASKS);
  write(path.join(root, 'src/greet.js'), 'export const greet = (n) => `Hello, ${n}`;\nexport const bye = 1;\n');
  ok(['verify', '--change', CHANGE]);
  write(change('review.md'), REVIEW);
  if (release) {
    ok(['waive', 'review', '--change', CHANGE, '--note', 'test']);
    write(change('release.md'), RELEASE);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'work']);
  /** The policy that waives the intent gate for this change's kind; no command has recorded its waiver yet. */
  const addPolicy = () => editConfig((config) => {
    config.gates.intent = { ...config.gates.intent, auto_waive: { kinds: ['feature'] } };
  });
  /** A required release check whose MCP server, when it starts, makes the given edit. */
  const editDuringChecks = (edit: Edit) => {
    const script = path.join(home, 'someone-else.mjs');
    const target = path.join(root, edit.file);
    write(script, `import * as fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(target)}, `
      + `${JSON.stringify(edit.text)});\n`);
    editConfig((config) => {
      const command = ['node', '--import', pathToFileURL(script).href, FAKE];
      config.mcp = { servers: { ci: { type: 'stdio', command, stages: ['deploy'] } } };
      config.release.mcp = [{ name: 'ci-green', server: 'ci', tool: 'pipeline_status', args: { ref: '${CHANGE}' },
        expect: { status: 'success' } }];
    });
  };
  const state = () => parse(read(change('.sdlc.yaml')));
  const log = () => read(path.join(root, 'openspec', '.sdlc', 'log.jsonl'));
  const ref = (gate: string) => spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/sdlc/${CHANGE}/${gate}`],
    { cwd: root, encoding: 'utf-8', timeout: 30000 }).status === 0;
  return { root, cli, addPolicy, editDuringChecks, state, log, ref };
}

type Project = ReturnType<typeof project>;

function expectRecorded(p: Project, gate: string, r: ReturnType<typeof run>): void {
  expect(r.code, r.out).toBe(0);
  expect(p.state().gates[gate].approvals).toHaveLength(1);
  expect(p.ref(gate), `refs/sdlc/${CHANGE}/${gate} is missing`).toBe(true);
}

function expectWaiverRecorded(p: Project): void {
  expect(p.state().gates.intent.waived).toMatchObject({ by: 'policy', note: 'auto_waive: kind feature' });
  expect(p.log()).toMatch(/"event":"gate\.intent\.auto_waived"/);
}

function expectRefused(p: Project, gate: string, r: ReturnType<typeof run>): void {
  expect(r.code, r.out).toBe(1);
  expect(JSON.parse(r.stdout).status[0].code).toBe('digest_changed');
  expect(p.state().gates[gate]?.approvals ?? []).toEqual([]);
  expect(p.ref(gate), `refs/sdlc/${CHANGE}/${gate} was recorded`).toBe(false);
}

const LOG_LINE = `${JSON.stringify({ ts: '2026-10-27T00:00:00.000Z', event: 'note', sdlc: '0.27.0',
  license: 'community', detail: 'someone else' })}\n`;

describe('F4: a review or release approval with its own policy-waiver writes', () => {
  it('records the first review approval together with its policy waiver', () => {
    const p = project();
    p.addPolicy();
    const r = p.cli(['approve', 'review', '--change', CHANGE, '--json']);
    expectRecorded(p, 'review', r);
    expectWaiverRecorded(p);
  }, 360000);

  it('records a review approval when no policy waiver is due', () => {
    const p = project();
    const r = p.cli(['approve', 'review', '--change', CHANGE, '--json']);
    expectRecorded(p, 'review', r);
    expect(p.state().gates.intent.waived).toBeUndefined();
  }, 360000);

  it('records the first release approval together with its policy waiver', () => {
    const p = project(true);
    p.addPolicy();
    const r = p.cli(['approve', 'release', '--change', CHANGE, '--json']);
    expectRecorded(p, 'release', r);
    expectWaiverRecorded(p);
  }, 360000);

  it('refuses a release approval when a tracked file changes during the release checks', () => {
    const p = project(true);
    // Under openspec/, outside the code fingerprint: only the raw-tree check sees it.
    p.editDuringChecks({ file: 'openspec/notes.md', text: 'Written during the release checks.\n' });
    const r = p.cli(['approve', 'release', '--change', CHANGE, '--json']);
    expectRefused(p, 'release', r);
    // The digest itself is unchanged, so the refusal is the snapshot comparison's (error.approvalSnapshotChanged).
    expect(JSON.parse(r.stdout).status[0].message).toMatch(/approval source changed/);
    expect(fs.existsSync(path.join(p.root, 'openspec/notes.md')), 'the release checks made no edit').toBe(true);
  }, 360000);

  it('refuses when someone else edits the change\'s state file after the approval\'s own writes', () => {
    const p = project(true);
    p.addPolicy();
    p.editDuringChecks({ file: `openspec/changes/${CHANGE}/.sdlc.yaml`, text: '# edited by someone else\n' });
    const r = p.cli(['approve', 'release', '--change', CHANGE, '--json']);
    expectRefused(p, 'release', r);
    expect(read(path.join(p.root, 'openspec', 'changes', CHANGE, '.sdlc.yaml'))).toContain('# edited by someone else');
    expectWaiverRecorded(p);
  }, 360000);

  it('refuses when someone else edits the project log after the approval\'s own writes', () => {
    const p = project(true);
    p.addPolicy();
    p.editDuringChecks({ file: 'openspec/.sdlc/log.jsonl', text: LOG_LINE });
    const r = p.cli(['approve', 'release', '--change', CHANGE, '--json']);
    expectRefused(p, 'release', r);
    expect(p.log()).toContain('someone else');
    expectWaiverRecorded(p);
  }, 360000);
});

/** Every file under `dir`, keyed by its relative path, with its bytes as base64. */
function filesUnder(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = fs.readFileSync(full).toString('base64');
  }
  return out;
}

/** Everything a refused approval must leave as it was: the change's state, sdlc's own folder and the refs. */
function recorded(p: Project) {
  const refs = spawnSync('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/sdlc'],
    { cwd: p.root, encoding: 'utf-8', timeout: 30000 }).stdout;
  return {
    state: read(path.join(p.root, 'openspec', 'changes', CHANGE, '.sdlc.yaml')),
    sdlcDir: filesUnder(path.join(p.root, 'openspec', '.sdlc')),
    refs,
  };
}

const STALE = `sha256:${'0'.repeat(64)}`;

/**
 * Review round 1, F1: the fix for F4 moved `recordAwaiting` before the expected-digest comparison for review and
 * release, so a refused `--expect-digest <stale>` still wrote the policy waiver and queued the wait entry. The living
 * gate-approval spec says such a refusal records nothing (evaluation, expected digest, awaiting record).
 */
function expectStaleRefusal(gate: 'review' | 'release'): void {
  const p = project(gate === 'release');
  p.addPolicy();
  const before = recorded(p);
  const r = p.cli(['approve', gate, '--change', CHANGE, '--expect-digest', STALE, '--json']);
  expect(r.code, r.out).toBe(1);
  expect(JSON.parse(r.stdout).status[0].code).toBe('digest_changed');
  const after = recorded(p);
  expect(after.state, `.sdlc.yaml changed: ${after.state}`).toBe(before.state);
  expect(after.sdlcDir).toEqual(before.sdlcDir);
  expect(after.refs).toBe(before.refs);
}

describe('F1 (review round 1): a stale --expect-digest on review or release records nothing', () => {
  it('a review approval with a stale digest leaves the state, the logs and the refs as they were', () => {
    expectStaleRefusal('review');
  }, 360000);

  it('a release approval with a stale digest leaves the state, the logs and the refs as they were', () => {
    expectStaleRefusal('release');
  }, 360000);

  it('negative: the current digest still approves review and records the policy waiver', () => {
    const p = project();
    p.addPolicy();
    const status = JSON.parse(p.cli(['status', '--change', CHANGE, '--json']).stdout);
    const current = status.change.gates.find((item: { id: string }) => item.id === 'review').digest;
    const r = p.cli(['approve', 'review', '--change', CHANGE, '--expect-digest', current, '--json']);
    expectRecorded(p, 'review', r);
    expectWaiverRecorded(p);
  }, 360000);
});
