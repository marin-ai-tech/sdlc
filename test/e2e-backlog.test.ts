import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * Backlog end to end, with the bundled OpenSpec CLI: a BMAD initiative becomes
 * the backlog, `sdlc next` proposes the first ready item, the item becomes a
 * change that goes through every gate for real, archiving closes the item and
 * unblocks its dependants, and the report shows the epic's progress.
 */
const ARTIFACTS: Record<string, string> = {
  'proposal.md': '# Proposal\n\n## Why\n\nCart and payment compute totals separately, so shoppers sometimes pay a different amount than they saw.\n\n## What Changes\n\n- One price(cart) function used by the cart page.\n\n## Capabilities\n\n### New Capabilities\n- `pricing`: one pricing function for every total\n\n## Impact\n\nsrc/price.js\n',
  'specs/pricing/spec.md': '# Spec Delta\n\n## Purpose\n\nOne pricing function computes every total the shopper sees.\n\n## ADDED Requirements\n\n### Requirement: Single pricing function\nThe system SHALL compute the cart total with price(cart).\n\n#### Scenario: Same total\n- **WHEN** a cart holds two items at 2 and 3\n- **THEN** price(cart) returns 5\n',
  'design.md': '# Design\n\n## Context\nsrc/price.js\n\n## Decisions\nA pure function over cart lines.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/price.js` (new)\n- `test/price.test.js` (new)\n\n## Order of work\n1. Test. 2. Implement.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n',
  'tasks.md': '# Tasks\n\n## 1. Pricing\n\n- [ ] 1.1 Add test/price.test.js and verify it fails first\n- [ ] 1.2 Implement price(cart) and verify npm test passes\n',
};

const COVERAGE = [
  '## Coverage',
  '- bugs: none found — checked: empty cart and one-line cart',
  '- security: none found — checked: no input reaches a shell or a log',
  '- compliance: none found — checked: the Same total scenario has a test',
  '- adversarial: none found — checked: negative prices, non-numeric prices',
  '- edge-cases: none found — checked: empty cart returns 0',
  '- verification-gaps: none found — checked: the test asserts the exact total',
].join('\n');

function copyTree(from: string, to: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else write(dst, fs.readFileSync(src, 'utf-8'));
  }
}

describe('backlog e2e (0.4.0)', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let changeId: string;
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) => runCli(args, root, { ...env, ...extra }, input);
  const AGENT = { CLAUDECODE: '1' };
  const changeDir = () => path.join(root, 'openspec/changes', changeId);
  const item = (title: string) => cli(['backlog', 'list', '--json']).json().items.find((i: { title: string }) => i.title === title);

  beforeAll(() => {
    root = tempDir('sdlc-e2e-backlog-');
    env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } }));
    copyTree(path.join(REPO_ROOT, 'test/fixtures/bmad/checkout'), path.join(root, '_bmad-output/initiative-checkout'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
    expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'sdlc init']);
  });

  it('1. the BMAD initiative becomes the backlog; nothing is active, next proposes the first ready item', () => {
    const r = cli(['import', 'bmad', '_bmad-output/initiative-checkout', '--to-backlog', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const next = cli(['next', '--json']);
    expect(next.code, next.stdout).toBe(0);
    expect(next.json().next).toMatchObject({ action: 'start-backlog-item', item: item('Pricing function contract').id });
  });

  it('2. an agent starts the item as a change with a draft intent', () => {
    const id = item('Pricing function contract').id;
    const r = cli(['backlog', 'start', id, '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    changeId = r.json().change.id;
    expect(read(path.join(changeDir(), 'intent.md'))).toMatch(/same total/);
    expect(item('Pricing function contract')).toMatchObject({ status: 'in-progress', change: changeId });
    expect(cli(['next', '--json']).json().change).toBe(changeId);
  });

  it('3. the change goes through every gate for real', () => {
    expect(cli(['approve', 'intent', '--change', changeId]).code).toBe(0);
    for (const f of ['proposal.md', 'specs/pricing/spec.md', 'design.md']) write(path.join(changeDir(), f), ARTIFACTS[f]);
    expect(cli(['validate', '--change', changeId, '--json']).code).toBe(0);
    expect(cli(['approve', 'spec', '--change', changeId]).code).toBe(0);
    for (const f of ['plan.md', 'tasks.md']) write(path.join(changeDir(), f), ARTIFACTS[f]);
    expect(cli(['approve', 'plan', '--change', changeId]).code).toBe(0);

    write(path.join(root, 'test/price.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { price } from '../src/price.js';\ntest('Same total', () => assert.equal(price([{ amount: 2 }, { amount: 3 }]), 5));\n");
    write(path.join(root, 'src/price.js'), 'export function price(lines) {\n  return lines.reduce((sum, line) => sum + line.amount, 0);\n}\n');
    write(path.join(changeDir(), 'tasks.md'), ARTIFACTS['tasks.md'].replace(/- \[ \]/g, '- [x]'));
    const v = cli(['verify', '--change', changeId, '--json']);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    const evidence = read(path.join(changeDir(), 'verification.md'));
    fs.writeFileSync(path.join(changeDir(), 'verification.md'), evidence.replace(/(## Behavioral verification[\s\S]*?\|---\|---\|---\|---\|\n)/, '$1| Same total | node --test | 5 | PASS |\n'));
    write(path.join(changeDir(), 'review.md'), `# Review: ${changeId}\n\n## Findings\n\nNone.\n\n${COVERAGE}\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'pricing function']);
    expect(cli(['review', 'check', '--change', changeId]).code).toBe(0);
    const approve = cli(['approve', 'review', '--change', changeId]);
    expect(approve.code, approve.stdout + approve.stderr).toBe(0);
  });

  it('4. archiving closes the item and unblocks its dependants', () => {
    const r = cli(['archive', changeId, '--yes', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(item('Pricing function contract').status).toBe('done');
    expect(item('Rounding differs between cart and payment')).toMatchObject({ status: 'open', ready: true });
    expect(item('Change item quantity')).toMatchObject({ status: 'open', ready: true });
    expect(item('A shopper applies a discount code and sees the new total').ready).toBe(false);
  });

  it('5. next proposes the following item; the report shows the epic progress; people own the priority', () => {
    expect(cli(['next', '--json']).json().next.item).toBe(item('Can the tax engine answer within 300 ms').id);
    const model = cli(['report', '--json']).json();
    const pricing = model.backlog.epics.find((e: { title: string }) => e.title === 'Pricing rules');
    expect(pricing).toMatchObject({ total: 3, done: 1, open: 2 });
    const rounding = item('Rounding differs between cart and payment').id;
    expect(cli(['backlog', 'move', rounding, '--top', '--json'], AGENT).json().status[0].code).toBe('agent_cannot_prioritize');
    expect(cli(['backlog', 'move', rounding, '--top', '--json']).code).toBe(0);
    expect(cli(['next', '--json']).json().next.item).toBe(rounding);
    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    for (const e of ['backlog.imported', 'backlog.started', 'change.archived', 'backlog.done', 'backlog.moved']) expect(events, e).toContain(e);
  });
});
