import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES, writeWork } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.24.0, change digest-check (backlog B125, requested by sdlc-ui for its B16): the version a person approves.
 * - gate-reads: `report --json` gives each gate its `digest`, `approvals` and `staleApprovals`; `next --me --json`
 *   gives an approval its `digest`; both stay non-writing and only gain fields.
 * - gate-approval: `approve --expect-digest` refuses a version that changed since it was read, before anything is
 *   written; the preview lists the same refusal.
 * - project-log: `gate.<g>.approved` and `gate.<g>.rejected` entries carry the digest as a field.
 * Oracles: `status --json` (the full gate evaluation), byte comparison of the record, the log and the local queue,
 * the checkpoint refs, sdlc's own catalog `t()` from the build, and the 0.23.7 shapes written out below.
 * Review round 1: only the full digest is accepted (the 12-character form can be collided), a gate without a digest
 * gives approve's own error, the preview names the version and suggests the guarded command, archived gates have no
 * digest.
 */

type Json = Record<string, any>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OLD_GATE_KEYS = ['id', 'required', 'status'];
const OLD_QUEUE_KEYS = ['action', 'change', 'cli', 'gate', 'message'];
const OLD_EVENT_KEYS = ['id', 'project', 'event', 'change', 'gate', 'at', 'sdlc', 'by', 'agent', 'waitingFor',
  'summary'];
const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

const INTENT_LINES = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions'];
const INTENT = [...INTENT_LINES, 'None', ''].join('\n');
const INTENT_WITH_QUESTION = [...INTENT_LINES, '- Which users count?', ''].join('\n');
const ROLES = ['version: 1', 'signing: off', 'people:', '  alice: { name: Alice Ivanova, emails: [pat@example.com] }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]',
  ''].join('\n');
/** Bob may not approve the intent: he holds no product-owner role. */
const ROLES_WITH_BOB = ['version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [pat@example.com] }',
  '  bob: { name: Bob Petrov, emails: [bob@example.com] }',
  'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', '  maintainer: [alice]',
  ''].join('\n');

function short(digest: string): string {
  return digest.slice(7, 19);
}

function readOrNull(file: string): string | null {
  return fs.existsSync(file) ? read(file) : null;
}

/** The checkpoint refs an approval records (`refs/sdlc/<change>/<gate>`), one per line. */
function checkpointRefs(root: string): string {
  const r = spawnSync('git', ['for-each-ref', '--format=%(refname)', 'refs/sdlc'], { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git for-each-ref failed: ${r.stderr}`);
  return r.stdout;
}

function project(change = 'a') {
  const root = tempDir('sdlc-0240-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const must = (args: string[]) => {
    const r = cli(args);
    expect(r.code, `sdlc ${args.join(' ')}\n${r.stdout}${r.stderr}`).toBe(0);
    return r;
  };
  must(['init', '--tools', 'none', '--json']);
  must(['new', change, '--json']);
  const file = (rel: string) => path.join(root, rel);
  const intent = file(`openspec/changes/${change}/intent.md`);
  return { root, env, cli, must, file, intent, change };
}

type P = ReturnType<typeof project>;

function reportChange(p: P): Json {
  return p.must(['report', '--json', '--change', p.change]).json<Json>().changes[0];
}

function reportGate(p: P, id: string): Json {
  return reportChange(p).gates.find((gate: Json) => gate.id === id);
}

function statusGate(p: P, id: string): Json {
  return p.must(['status', '--change', p.change, '--json']).json<Json>().change.gates.find((g: Json) => g.id === id);
}

function queue(p: P): Json[] {
  return p.must(['next', '--me', '--json']).json<Json>().items;
}

/** Everything a refused approval must leave as it was: the record, the log, the local queue, the intent, the refs. */
function snapshot(p: P): Record<string, string | null> {
  const files = [`openspec/changes/${p.change}/.sdlc.yaml`, 'openspec/.sdlc/log.jsonl',
    'openspec/.sdlc/hook-log.jsonl', `openspec/changes/${p.change}/intent.md`];
  return { ...Object.fromEntries(files.map((rel) => [rel, readOrNull(p.file(rel))])), refs: checkpointRefs(p.root) };
}

function approve(p: P, extra: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return p.cli(['approve', 'intent', '--change', p.change, ...extra], env);
}

function preview(p: P, expected: string): Json {
  const r = p.cli(['approve', 'intent', '--change', p.change, '--preview', '--expect-digest', expected, '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r.json<Json>();
}

/** The preview without `--expect-digest`, in JSON or as text. */
function plainPreview(p: P, json = true) {
  const r = p.cli(['approve', 'intent', '--change', p.change, '--preview', ...(json ? ['--json'] : [])]);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r;
}

/** The roles file with Bob, and Bob's git identity: a person who may not approve the intent. */
function asBob(p: P): void {
  write(p.file('openspec/roles.yaml'), ROLES_WITH_BOB);
  git(p.root, ['config', 'user.name', 'Bob Petrov']);
  git(p.root, ['config', 'user.email', 'bob@example.com']);
}

function logEntries(p: P, event: string): Json[] {
  const entries = p.must(['log', '--json', '--change', p.change]).json<Json>().entries as Json[];
  return entries.filter((entry) => entry.event === event);
}

/** A project whose intent was read (digest `before`) and then edited (digest `after`). */
function changedAfterReading() {
  const p = project();
  write(p.intent, INTENT);
  const before = reportGate(p, 'intent').digest as string;
  write(p.intent, `${INTENT}\nOne more line.\n`);
  const after = reportGate(p, 'intent').digest as string;
  return { p, before, after };
}

/** The farewell change at review: intent, spec and plan approved, the code written, verification passed. */
function atReview(): P {
  const p = project('add-farewell');
  write(p.file('package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }));
  write(p.file('src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  const config = parse(read(p.file('openspec/sdlc.yaml')));
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  write(p.file('openspec/sdlc.yaml'), stringify(config));
  const change = (rel: string) => p.file(`openspec/changes/add-farewell/${rel}`);
  write(change('intent.md'), FILES['intent.md']);
  p.must(['approve', 'intent', '--change', p.change, '--json']);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  p.must(['approve', 'spec', '--change', p.change, '--json']);
  for (const rel of ['plan.md', 'tasks.md']) write(change(rel), FILES[rel]);
  p.must(['approve', 'plan', '--change', p.change, '--json']);
  writeWork(p.root, p.change);
  write(change('review.md'), FILES['review.md']);
  git(p.root, ['add', '-A']);
  git(p.root, ['commit', '-q', '-m', 'work']);
  p.must(['verify', '--change', p.change, '--json']);
  return p;
}

/**
 * An interface language other than English installed in this checkout, found at run time (the repository itself
 * carries only English); undefined when none is installed, and the case that needs one is skipped visibly.
 */
function otherLocale(): string | undefined {
  const dir = path.join(REPO_ROOT, 'assets/locales');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  return files.map((f) => f.slice(0, -5)).filter((code) => code !== 'en').sort()[0];
}

const OTHER_LOCALE = otherLocale();

async function catalogText(locale: string, key: string, params: Record<string, string>) {
  const i18n = await import(pathToFileURL(path.join(REPO_ROOT, 'dist/core/i18n.js')).href);
  return { other: i18n.t(key, params, locale), en: i18n.t(key, params, 'en') };
}

describe('gate-reads: the report gives each gate its version and its approvals', () => {
  it('A gate waiting for its first approval: the digest status uses, and empty lists', () => {
    const p = project();
    write(p.intent, INTENT);
    const gate = reportGate(p, 'intent');
    const truth = statusGate(p, 'intent').digest;
    expect(truth).toMatch(DIGEST);
    expect(gate.digest).toBe(truth);
    expect(gate.approvals).toEqual([]);
    expect(gate.staleApprovals).toEqual([]);
  }, 240000);

  it('A gate without a version: no digest field (not null) on intent or verify', () => {
    const p = project();
    const change = reportChange(p);
    for (const id of ['intent', 'verify']) {
      const gate = change.gates.find((item: Json) => item.id === id);
      expect(Object.keys(gate)).not.toContain('digest');
      expect(gate.approvals).toEqual([]);
    }
  }, 240000);

  it('An approved gate: one approval with role, identity, time and digest, and nothing else', () => {
    const p = project();
    write(p.intent, INTENT);
    p.must(['approve', 'intent', '--change', p.change, '--note', 'looks right', '--json']);
    const gate = reportGate(p, 'intent');
    expect(gate.approvals).toHaveLength(1);
    const [approval] = gate.approvals;
    expect(Object.keys(approval).sort()).toEqual(['at', 'by', 'digest', 'role']);
    expect(approval).toMatchObject({ role: 'product-owner', by: 'Pat Owner <pat@example.com>', digest: gate.digest });
    expect(Number.isFinite(Date.parse(approval.at))).toBe(true);
    expect(gate.staleApprovals).toEqual([]);
  }, 240000);

  it('An approved gate with roles.yaml: the approval names the person', () => {
    const p = project();
    write(p.file('openspec/roles.yaml'), ROLES);
    write(p.intent, INTENT);
    p.must(['approve', 'intent', '--change', p.change, '--json']);
    const [approval] = reportGate(p, 'intent').approvals;
    expect(Object.keys(approval).sort()).toEqual(['at', 'by', 'digest', 'person', 'role']);
    expect(approval.person).toBe('alice');
  }, 240000);

  it('An approval that went stale: a new digest, the old approval under staleApprovals', () => {
    const p = project();
    write(p.intent, INTENT);
    p.must(['approve', 'intent', '--change', p.change, '--json']);
    const approved = reportGate(p, 'intent').digest;
    write(p.intent, `${INTENT}\nOne more line.\n`);
    const gate = reportGate(p, 'intent');
    expect(gate.digest).toMatch(DIGEST);
    expect(gate.digest).not.toBe(approved);
    expect(gate.approvals).toEqual([]);
    expect(gate.staleApprovals).toHaveLength(1);
    expect(gate.staleApprovals[0].digest).toBe(approved);
    expect(gate.status).toBe('stale');
  }, 240000);

  it('A gate that takes no approvals: the verify gate has empty lists', () => {
    const p = project();
    write(p.intent, INTENT);
    const gate = reportGate(p, 'verify');
    expect(gate.approvals).toEqual([]);
    expect(gate.staleApprovals).toEqual([]);
  }, 240000);

  it('An archived change: its recorded approvals are listed and none is stale', () => {
    const p = project();
    write(p.intent, INTENT);
    p.must(['approve', 'intent', '--change', p.change, '--json']);
    const archive = p.file('openspec/changes/archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(p.file(`openspec/changes/${p.change}`), path.join(archive, `2026-10-20-${p.change}`));
    const changes = p.must(['report', '--json']).json<Json>().changes as Json[];
    const archived = changes.find((change) => change.archived === true);
    expect(archived).toBeDefined();
    const gate = archived!.gates.find((item: Json) => item.id === 'intent');
    expect(gate.approvals).toHaveLength(1);
    expect(gate.approvals[0].digest).toMatch(DIGEST);
    expect(gate.staleApprovals).toEqual([]);
    const withDigest = (archived!.gates as Json[]).filter((item) => 'digest' in item).map((item) => item.id);
    expect(withDigest).toEqual([]);
  }, 240000);

  it('A gate bound to the code: the review digest is the one status uses', () => {
    const p = atReview();
    const truth = statusGate(p, 'review').digest;
    expect(truth).toMatch(DIGEST);
    expect(reportGate(p, 'review').digest).toBe(truth);
  }, 480000);
});

describe('gate-reads: the queue gives an approval its digest', () => {
  it('An approval waiting for me: the item has the digest of the report', () => {
    const p = project();
    write(p.intent, INTENT);
    const [item] = queue(p);
    expect(item).toMatchObject({ change: p.change, gate: 'intent', action: 'approve-gate' });
    expect(item.digest).toMatch(DIGEST);
    expect(item.digest).toBe(reportGate(p, 'intent').digest);
  }, 240000);

  it('Questions waiting for an answer: the item has no digest', () => {
    const p = project();
    write(p.intent, INTENT_WITH_QUESTION);
    const item = queue(p).find((entry) => entry.change === p.change);
    expect(item).toBeDefined();
    expect(item!.action).toBe('answer-questions');
    expect(Object.keys(item!)).not.toContain('digest');
  }, 240000);

  it('The suggested command is unchanged: no --expect-digest, the same cli as next --json', () => {
    const p = project();
    write(p.intent, INTENT);
    const [item] = queue(p);
    expect(item.cli).not.toContain('--expect-digest');
    expect(item.cli).toBe(p.must(['next', '--change', p.change, '--json']).json<Json>().next.cli);
  }, 240000);
});

describe('gate-reads: the reads stay non-writing and compatible', () => {
  it('Reading changes nothing on disk: the record, the log and the local queue stay byte for byte', () => {
    const p = project();
    write(p.intent, INTENT);
    const before = snapshot(p);
    p.must(['report', '--json']);
    p.must(['next', '--me', '--json']);
    expect(snapshot(p)).toEqual(before);
  }, 240000);

  it('Existing fields keep their values: old keys plus the new ones, and the values status gives', () => {
    const p = project();
    write(p.intent, INTENT);
    const gates = reportChange(p).gates as Json[];
    const [item] = queue(p);
    const status = p.must(['status', '--change', p.change, '--json']).json<Json>().change.gates as Json[];
    for (const gate of gates) {
      const added = ['approvals', 'staleApprovals', ...(gate.digest === undefined ? [] : ['digest'])];
      expect(Object.keys(gate).sort()).toEqual([...OLD_GATE_KEYS, ...added].sort());
      const truth = status.find((entry) => entry.id === gate.id)!;
      expect([gate.status, gate.required]).toEqual([truth.status, truth.required]);
    }
    expect(Object.keys(item).sort()).toEqual([...OLD_QUEUE_KEYS, 'digest'].sort());
  }, 240000);
});

describe('gate-approval: approve only the expected version', () => {
  it('The version is the one I read: approved, and the record carries that digest', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest;
    const r = approve(p, ['--expect-digest', digest, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const gate = reportGate(p, 'intent');
    expect(gate.status).toBe('approved');
    expect(gate.approvals[0].digest).toBe(digest);
    // The oracle of the refusal cases sees a checkpoint when one is made.
    expect(checkpointRefs(p.root)).toContain(`refs/sdlc/${p.change}/intent`);
  }, 240000);

  it('A gate bound to the code: approve review with the report\'s digest', () => {
    const p = atReview();
    const digest = reportGate(p, 'review').digest as string;
    const stale = `sha256:${'0'.repeat(64)}`;
    const refused = p.cli(['approve', 'review', '--change', p.change, '--expect-digest', stale, '--json']);
    expect(refused.json<Json>().status[0].code).toBe('digest_changed');
    const r = p.cli(['approve', 'review', '--change', p.change, '--expect-digest', digest, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(statusGate(p, 'review').approvals[0].digest).toBe(digest);
  }, 480000);

  it('Already approved in that version: reported as already approved, as without the option', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest;
    p.must(['approve', 'intent', '--change', p.change, '--json']);
    expect(checkpointRefs(p.root)).toContain(`refs/sdlc/${p.change}/intent`);
    const r = approve(p, ['--expect-digest', digest, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json<Json>()).toMatchObject({ alreadyApproved: true, digest });
  }, 240000);

  it('The version changed after I read it: refused naming both, nothing written, no checkpoint', () => {
    const { p, before, after } = changedAfterReading();
    const untouched = snapshot(p);
    const r = approve(p, ['--expect-digest', before]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(short(before));
    expect(r.stderr).toContain(short(after));
    expect(r.stderr).toContain('--preview');
    const left = snapshot(p);
    expect(left).toEqual(untouched);
    expect(left.refs).not.toContain(`refs/sdlc/${p.change}/intent`);
  }, 240000);

  it('The refusal in JSON: the usual error shape with the code digest_changed', () => {
    const { p, before } = changedAfterReading();
    const r = approve(p, ['--expect-digest', before, '--json']);
    expect(r.code).toBe(1);
    expect(r.json<Json>().status[0]).toMatchObject({ severity: 'error', code: 'digest_changed' });
  }, 240000);

  it.skipIf(!OTHER_LOCALE)('The refusal in another installed language: its catalog text and both digests', async () => {
    const locale = OTHER_LOCALE!;
    const { p, before, after } = changedAfterReading();
    const r = approve(p, ['--expect-digest', before, '--locale', locale]);
    expect(r.code).toBe(1);
    const params = { gate: 'intent', expected: short(before), current: short(after) };
    const text = await catalogText(locale, 'error.expectDigestChanged', params);
    expect(text.other).not.toBe(text.en);
    expect(text.other).not.toBe('error.expectDigestChanged');
    expect(r.stderr).toContain(text.other);
  }, 240000);

  it('A blocked gate: gate_blocked, the same code and message as without the option, nothing written', () => {
    const p = project();
    const untouched = snapshot(p);
    const r = approve(p, ['--expect-digest', `sha256:${'a'.repeat(64)}`, '--json']);
    expect(r.code).toBe(1);
    const guarded = r.json<Json>().status[0];
    expect(snapshot(p)).toEqual(untouched);
    const plain = approve(p, ['--json']).json<Json>().status[0];
    expect(plain.code).toBe('gate_blocked');
    expect({ code: guarded.code, message: guarded.message }).toEqual({ code: plain.code, message: plain.message });
  }, 240000);

  it('A person without the role: refused for the missing role with the same code as without the option', () => {
    const p = project();
    write(p.intent, INTENT);
    asBob(p);
    const digest = reportGate(p, 'intent').digest;
    const guarded = approve(p, ['--expect-digest', digest, '--json']);
    expect(guarded.code).toBe(1);
    const plain = approve(p, ['--json']);
    expect(guarded.json<Json>().status[0].code).toBe(plain.json<Json>().status[0].code);
    expect(statusGate(p, 'intent').approvals).toEqual([]);
  }, 240000);

  it('An agent session: refused as a person\'s command even with the matching digest, nothing written', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest;
    const untouched = snapshot(p);
    const r = approve(p, ['--expect-digest', digest, '--json'], { CLAUDECODE: '1' });
    expect(r.code).toBe(1);
    expect(r.json<Json>().status[0].code).toBe('agent_cannot_approve');
    expect(snapshot(p)).toEqual(untouched);
  }, 240000);
});

describe('gate-approval: the expected digest\'s form', () => {
  it('A malformed digest: invalid_option, nothing written', () => {
    const p = project();
    write(p.intent, INTENT);
    const untouched = snapshot(p);
    const r = approve(p, ['--expect-digest', 'abc', '--json']);
    expect(r.code).toBe(1);
    expect(r.json<Json>().status[0].code).toBe('invalid_option');
    expect(snapshot(p)).toEqual(untouched);
  }, 240000);

  it('The 12 characters approve prints: invalid_option, nothing written', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest as string;
    const untouched = snapshot(p);
    const r = approve(p, ['--expect-digest', short(digest), '--json']);
    expect(r.code).toBe(1);
    expect(r.json<Json>().status[0].code).toBe('invalid_option');
    expect(snapshot(p)).toEqual(untouched);
  }, 240000);

  it('A value with control characters: invalid_option, the value shown escaped', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest as string;
    const r = approve(p, ['--expect-digest', `${digest}\r`, '--json']);
    expect(r.code).toBe(1);
    const [diagnostic] = r.json<Json>().status;
    expect(diagnostic.code).toBe('invalid_option');
    expect(diagnostic.message).toContain('\\r');
    expect(diagnostic.message).not.toContain('\r');
  }, 240000);

  it('A long value is cut in the message', () => {
    const p = project();
    write(p.intent, INTENT);
    const r = approve(p, ['--expect-digest', 'x'.repeat(5000), '--json']);
    const [diagnostic] = r.json<Json>().status;
    expect(diagnostic.code).toBe('invalid_option');
    expect(diagnostic.message).not.toContain('x'.repeat(81));
  }, 240000);

  it('Two values: invalid_option, nothing written', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest as string;
    const untouched = snapshot(p);
    const r = approve(p, ['--expect-digest', `sha256:${'0'.repeat(64)}`, '--expect-digest', digest, '--json']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/invalid_option|expect-digest/);
    expect(snapshot(p)).toEqual(untouched);
  }, 240000);

  it('A full digest without its prefix: invalid_option', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest as string;
    const r = approve(p, ['--expect-digest', digest.slice(7), '--json']);
    expect(r.code).toBe(1);
    expect(r.json<Json>().status[0].code).toBe('invalid_option');
  }, 240000);

  it('Upper case: compared as the same digest in lower case', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest as string;
    const r = approve(p, ['--expect-digest', digest.toUpperCase(), '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(reportGate(p, 'intent').approvals[0].digest).toBe(digest);
  }, 240000);
});

describe('gate-approval: the preview with an expected digest', () => {
  it('Previewing a changed version: not allowed, the digest_changed refusal, the current digest', () => {
    const { p, before, after } = changedAfterReading();
    const out = preview(p, before);
    expect(out.allowed).toBe(false);
    expect(out.refusals.map((refusal: Json) => refusal.rule)).toContain('digest_changed');
    expect(out.digest).toBe(after);
  }, 240000);

  it('Previewing the version I read: no digest_changed refusal', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest;
    const out = preview(p, digest);
    expect(out.refusals.map((refusal: Json) => refusal.rule)).not.toContain('digest_changed');
    expect(out.allowed).toBe(true);
    expect(out.digest).toBe(digest);
  }, 240000);

  it('Parity: the preview\'s first refusal is the error approve gives', () => {
    const { p, before } = changedAfterReading();
    const first = preview(p, before).refusals[0].rule;
    const r = approve(p, ['--expect-digest', before, '--json']);
    expect(first).toBe('digest_changed');
    expect(r.json<Json>().status[0].code).toBe(first);
  }, 240000);

  it('The comparison before the roles: a person without the role sees digest_changed first, like approve', () => {
    const { p, before } = changedAfterReading();
    asBob(p);
    const rules = preview(p, before).refusals.map((refusal: Json) => refusal.rule);
    expect(rules[0]).toBe('digest_changed');
    expect(rules.length).toBeGreaterThan(1);
    expect(approve(p, ['--expect-digest', before, '--json']).json<Json>().status[0].code).toBe('digest_changed');
  }, 240000);

  it('A malformed value in the preview: the preview succeeds and lists invalid_option', () => {
    const p = project();
    write(p.intent, INTENT);
    const out = preview(p, 'abc');
    expect(out.allowed).toBe(false);
    expect(out.refusals.map((refusal: Json) => refusal.rule)).toContain('invalid_option');
  }, 240000);

  it('The preview writes nothing, with the option set', () => {
    const { p, before } = changedAfterReading();
    const untouched = snapshot(p);
    preview(p, before);
    expect(snapshot(p)).toEqual(untouched);
  }, 240000);
});

describe('gate-approval: the preview names the version', () => {
  it('The preview without the option: the digest status uses, and a guarded command', () => {
    const p = project();
    write(p.intent, INTENT);
    const out = plainPreview(p).json<Json>();
    const truth = statusGate(p, 'intent').digest as string;
    expect(truth).toMatch(DIGEST);
    expect(out.digest).toBe(truth);
    expect(out.allowed).toBe(true);
    expect(out.cli.endsWith(`--expect-digest ${truth}`)).toBe(true);
  }, 240000);

  it('The text preview: the full digest and the guarded command', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = reportGate(p, 'intent').digest as string;
    const text = plainPreview(p, false).stdout;
    expect(text).toContain(digest);
    expect(text).toContain(`--expect-digest ${digest}`);
  }, 240000);

  it('Nothing to approve in the preview: no digest and no command', () => {
    const p = project();
    const out = plainPreview(p).json<Json>();
    expect(Object.keys(out)).not.toContain('digest');
    expect(Object.keys(out)).not.toContain('cli');
  }, 240000);
});

describe('project-log: decisions name their version', () => {
  it('An approval in the log: the approved digest, and the detail as before', () => {
    const p = project();
    write(p.intent, INTENT);
    p.must(['approve', 'intent', '--change', p.change, '--note', 'ok', '--json']);
    const approved = statusGate(p, 'intent').approvals[0].digest;
    expect(approved).toMatch(DIGEST);
    const entry = logEntries(p, 'gate.intent.approved').at(-1)!;
    expect(entry.digest).toBe(approved);
    expect(entry.detail).toBe('role product-owner: ok');
  }, 240000);

  it('The report\'s events: the approval entry has the same digest as the log', () => {
    const p = project();
    write(p.intent, INTENT);
    p.must(['approve', 'intent', '--change', p.change, '--json']);
    const fromLog = logEntries(p, 'gate.intent.approved').at(-1)!;
    const events = p.must(['report', '--json', '--change', p.change]).json<Json>().events as Json[];
    const fromReport = events.filter((event) => event.event === 'gate.intent.approved').at(-1)!;
    expect(fromLog.digest).toMatch(DIGEST);
    expect(fromReport.digest).toBe(fromLog.digest);
  }, 240000);

  it('A rejection in the log: the gate\'s digest at that moment, the note as detail', () => {
    const p = project();
    write(p.intent, INTENT);
    const digest = statusGate(p, 'intent').digest;
    expect(digest).toMatch(DIGEST);
    p.must(['reject', 'intent', '--change', p.change, '--note', 'needs work', '--json']);
    const entry = logEntries(p, 'gate.intent.rejected').at(-1)!;
    expect(entry.digest).toBe(digest);
    expect(entry.detail).toBe('needs work');
  }, 240000);

  it('A rejection of a gate without a version: no digest field', () => {
    const p = project();
    p.must(['reject', 'intent', '--change', p.change, '--note', 'write it first', '--json']);
    const entry = logEntries(p, 'gate.intent.rejected').at(-1)!;
    expect(entry).toBeDefined();
    expect(Object.keys(entry)).not.toContain('digest');
  }, 240000);

  it('Older entries without a digest are listed unchanged by log and report', () => {
    const p = project();
    const old = { ts: '2026-10-01T00:00:00.000Z', event: 'gate.intent.approved', change: p.change,
      by: 'Old Owner <old@example.com>', detail: 'role product-owner', sdlc: '0.23.7', license: 'community' };
    fs.appendFileSync(p.file('openspec/.sdlc/log.jsonl'), `${JSON.stringify(old)}\n`);
    expect(logEntries(p, 'gate.intent.approved')).toContainEqual(old);
    const events = p.must(['report', '--json', '--change', p.change]).json<Json>().events as Json[];
    expect(events).toContainEqual(old);
  }, 240000);

  it('Integration events: the approval\'s event body keeps its fields and has no digest', () => {
    const p = project();
    const sink = path.join(tempDir('sdlc-0240-sink-'), 'events.jsonl');
    const config = parse(read(p.file('openspec/sdlc.yaml')));
    config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [], agents: false } } };
    config.events = [{ server: 'chat', tool: 'report_event', on: ['gate.*'] }];
    write(p.file('openspec/sdlc.yaml'), stringify(config));
    write(p.intent, INTENT);
    const r = approve(p, ['--json'], { FAKE_EVENTS_FILE: sink });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const calls = read(sink).trim().split('\n').map((line) => JSON.parse(line) as Json);
    const approved = calls.find((call) => call.event?.event === 'gate.intent.approved');
    expect(approved).toBeDefined();
    expect(Object.keys(approved!.event)).not.toContain('digest');
    for (const key of Object.keys(approved!.event)) expect(OLD_EVENT_KEYS).toContain(key);
    for (const key of ['id', 'project', 'event', 'change', 'gate', 'at', 'sdlc']) {
      expect(Object.keys(approved!.event)).toContain(key);
    }
  }, 240000);
});
