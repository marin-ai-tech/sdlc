import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTicketsToml, planBmadBacklog } from '../src/core/bmad-tickets.js';
import { git, humanEnv, initGitRepo, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

function copyTree(from: string, to: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else write(dst, fs.readFileSync(src, 'utf-8'));
  }
}

function project() {
  const root = tempDir('sdlc-bmad-backlog-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  copyTree(path.join(REPO_ROOT, 'test/fixtures/bmad/checkout'), path.join(root, '_bmad-output/initiative-checkout'));
  copyTree(path.join(REPO_ROOT, 'test/fixtures/bmad/claims'), path.join(root, '_bmad-output/claims'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

describe('tickets.toml subset parser', () => {
  it('reads table arrays, strings with escapes, numbers, booleans, arrays and inline tables; ignores comments', () => {
    const t = parseTicketsToml([
      '# comment', '',
      '[[entry]]', 'id = 1   # trailing comment', 'type = "story"', 'title = "Say \\"hi\\" # not a comment"',
      'covers = ["R1", "R2"]', 'after = [1, "1.3"]', 'hitl = true', '',
      '[[epic]]', 'id = 2', 'after = [{ epic = 1, needs = "the contract" }]',
    ].join('\n'));
    expect(t.entry).toEqual([{ id: 1, type: 'story', title: 'Say "hi" # not a comment', covers: ['R1', 'R2'], after: [1, '1.3'], hitl: true }]);
    expect(t.epic).toEqual([{ id: 2, after: [{ epic: 1, needs: 'the contract' }] }]);
  });

  it('negative: unsupported syntax is an error with the line number', () => {
    expect(() => parseTicketsToml('[[entry]]\nid = 1\n[table]\n', 'x/tickets.toml')).toThrow(/x\/tickets\.toml.*3/);
    expect(() => parseTicketsToml('[[entry]]\ntitle = "unterminated\n')).toThrow(/2/);
  });

  it('parses the real BMAD template shape (fixture)', () => {
    const t = parseTicketsToml(fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/bmad/checkout/epic-cart-rules/tickets.toml'), 'utf-8'));
    expect(t.entry.map((e) => e.id)).toEqual([1, 2]);
    expect(t.entry[1].after).toEqual([1, 'epic-pricing-rules']);
  });
});

describe('planBmadBacklog', () => {
  it('an initiative becomes epics in build order and items per entry, with kinds, acceptance and dependencies', () => {
    const { root } = project();
    const plan = planBmadBacklog(root, '_bmad-output/initiative-checkout');
    expect(plan.epics.map((e) => e.title)).toEqual(['Pricing rules', 'Shoppers manage their cart']);
    expect(plan.epics[0].goal).toMatch(/payment-mismatch rate/);
    expect(plan.items.map((i) => [i.key, i.kind])).toEqual([['1.1', 'feature'], ['1.2', 'chore'], ['1.3', 'bugfix'], ['2.1', 'feature'], ['2.2', 'feature']]);
    const byKey = Object.fromEntries(plan.items.map((i) => [i.key, i]));
    expect(byKey['1.1']).toMatchObject({ title: 'Pricing function contract', risk: 'medium', outcome: expect.stringMatching(/price\(cart\)/), acceptance: [expect.stringMatching(/same total/)] });
    expect(byKey['1.3'].dependsOnKeys).toEqual(['1.1']);
    expect(byKey['2.1'].dependsOnKeys).toEqual(['1.1']);
    expect(byKey['2.2'].dependsOnKeys.sort()).toEqual(['1.1', '1.2', '1.3', '2.1']);
    expect(byKey['2.2'].acceptance.join('\n')).toMatch(/Valid code reduces the total/);
    expect(byKey['2.2'].acceptance.join('\n')).toMatch(/Expired code is refused/);
    expect(byKey['1.1'].source).toBe('bmad _bmad-output/initiative-checkout/epic-pricing-rules/tickets.toml#1.1');
  });

  it('without tickets, a SPEC becomes one epic with an item per capability', () => {
    const { root } = project();
    const plan = planBmadBacklog(root, '_bmad-output/claims');
    expect(plan.epics).toHaveLength(1);
    expect(plan.items.map((i) => i.acceptance[0])).toEqual([expect.stringMatching(/in review/), expect.stringMatching(/within 5 minutes/)]);
    expect(plan.items.every((i) => i.epicKey === plan.epics[0].key && i.outcome)).toBe(true);
  });
});

describe('sdlc import bmad --to-backlog (CLI)', () => {
  it('appends the epics and items to openspec/backlog.md with resolved dependencies; next is the first ready item', () => {
    const { cli } = project();
    cli(['backlog', 'add', 'Existing item', '--outcome', 'o', '--accept', 'a', '--json']);
    const r = cli(['import', 'bmad', '_bmad-output/initiative-checkout', '--to-backlog', '--json'], { CLAUDECODE: '1' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const list = cli(['backlog', 'list', '--json']).json();
    expect(list.epics.map((e: { title: string }) => e.title)).toEqual(['Pricing rules', 'Shoppers manage their cart']);
    const items = list.items as Array<{ id: string; title: string; dependsOn: string[] }>;
    const id = (title: string) => items.find((i) => i.title === title)!.id;
    expect(items.find((i) => i.title === 'Rounding differs between cart and payment')!.dependsOn).toEqual([id('Pricing function contract')]);
    expect(cli(['backlog', 'next', '--json']).json().item.title).toBe('Pricing function contract');
    expect(items.map((i) => i.title)).toContain('Existing item');
  });

  it('--dry-run writes nothing; the claims SPEC also imports to the backlog', () => {
    const { root, cli } = project();
    const dry = cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--dry-run', '--json']);
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.json().items).toHaveLength(2);
    expect(fs.existsSync(path.join(root, 'openspec/backlog.md'))).toBe(false);
    expect(cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--json']).code).toBe(0);
    expect(cli(['backlog', 'list', '--json']).json().items).toHaveLength(2);
  });

  it('negative: --to-backlog and --change are exclusive; without either the command says what is missing', () => {
    const { cli } = project();
    expect(cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--change', 'x', '--json']).code).toBe(1);
    expect(cli(['import', 'bmad', '_bmad-output/claims', '--json']).code).toBe(1);
  });
});
