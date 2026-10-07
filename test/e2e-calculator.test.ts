import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { buildProgram } from '../src/cli/index.js';
import { BIN, git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * The demo: a small team builds a calculator with sdlc, using every command.
 * Each step is recorded (who, command, exit code, output excerpt, note) into a
 * transcript that the demo deck is generated from. Set SDLC_DEMO_TRANSCRIPT to
 * a path to keep it (e.g. docs/demo/calculator-transcript.json).
 *
 * People: Alice — product owner, release manager, maintainer; Bob — engineer and
 * tech lead (writes the code); Carol — engineer and code owner (reviews).
 */
type Actor = 'alice' | 'bob' | 'carol' | 'agent';
interface Step { id: string; section: string; actor: Actor; command: string; exit: number | null; output: string; note: string }

/** The team, named for the deck's language: SDLC_DEMO_PEOPLE=en (default) or ru. */
const SURNAMES = {
  en: { alice: 'Walker', bob: 'Turner', carol: 'Hughes' },
  ru: { alice: 'Ivanova', bob: 'Petrov', carol: 'Smirnova' },
};
const surnames = process.env.SDLC_DEMO_PEOPLE === 'ru' ? SURNAMES.ru : SURNAMES.en;
const PEOPLE: Record<Exclude<Actor, 'agent'>, { name: string; email: string }> = {
  alice: { name: `Alice ${surnames.alice}`, email: 'alice@calc.example' },
  bob: { name: `Bob ${surnames.bob}`, email: 'bob@calc.example' },
  carol: { name: `Carol ${surnames.carol}`, email: 'carol@calc.example' },
};

const INTENT = '# Intent: basic arithmetic\n\nAuthor: Alice (product). Status: draft. Source: backlog B1\n\n## Problem\nPeople need quick sums at the counter; today they use a phone.\n\n## Proposed outcome\nA calculator library with add, subtract, multiply and divide.\n\n## Affected users and systems\nCashiers; the till app.\n\n## Constraints\nPlain JavaScript, no dependencies.\n\n## Success measures\nAll four operations pass their scenarios.\n\n## Out of scope\nPercent and memory (later backlog items).\n\n## Open questions\nNone\n';
const PROPOSAL = '# Proposal\n\n## Why\n\nCashiers need exact results for the four basic operations; the till app has no calculator module today.\n\n## What Changes\n\n- Add src/calc.js with add, sub, mul, div.\n\n## Capabilities\n\n### New Capabilities\n- `calculator`: basic arithmetic\n\n## Impact\n\nsrc/calc.js, test/calc.test.js\n';
const SPEC_WITHOUT_SCENARIO = '# Spec Delta\n\n## Purpose\n\nExact results for the four basic arithmetic operations.\n\n## ADDED Requirements\n\n### Requirement: Basic operations\nThe calculator SHALL add, subtract, multiply and divide two numbers.\n';
const SPEC = '# Spec Delta\n\n## Purpose\n\nExact results for the four basic arithmetic operations.\n\n## ADDED Requirements\n\n### Requirement: Basic operations\nThe calculator SHALL add, subtract, multiply and divide two numbers.\n\n#### Scenario: Add\n- **WHEN** the cashier adds 2 and 3\n- **THEN** the result is 5\n\n#### Scenario: Divide\n- **WHEN** the cashier divides 10 by 4\n- **THEN** the result is 2.5\n';
const DESIGN = '# Design\n\n## Context\nsrc/calc.js is new.\n\n## Decisions\nPure functions, one per operation.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nDivision by zero (see review).\n';
const PLAN = '# Plan\n\n## Files that change\n- `src/calc.js` (new)\n- `test/calc.test.js` (new)\n\n## Order of work\n1. Tests. 2. Implementation.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert the commit.\n';
const TASKS = '# Tasks\n\n## 1. Calculator\n\n- [ ] 1.1 Add test/calc.test.js and verify it fails first\n- [ ] 1.2 Implement add, sub, mul, div and verify npm test passes\n';
const CODE = 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\nexport const mul = (a, b) => a * b;\nexport const div = (a, b) => a / b;\n';
const TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add, div } from '../src/calc.js';\ntest('Add', () => assert.equal(add(2, 3), 5));\ntest('Divide', () => assert.equal(div(10, 4), 2.5));\n";
const COVERAGE = [
  '## Coverage',
  '- bugs: 1 finding',
  '- security: none found — checked: no input reaches a shell or a log',
  '- compliance: 1 finding',
  '- adversarial: none found — checked: huge numbers, NaN, strings',
  '- edge-cases: none found — checked: negative numbers, decimals',
  '- verification-gaps: none found — checked: each scenario has a test',
].join('\n');
const REVIEW = `# Review: basic-arithmetic\n\n## Findings\n\n### F1 [important][bugs] sub() argument order in the till adapter\n- **Where**: src/calc.js:2\n- **Status**: fixed (order documented and tested)\n\n### F2 [nit][compliance] Division by zero returns Infinity\n- **Where**: src/calc.js:4\n- **Status**: deferred (D1)\n\n${COVERAGE}\n`;
const TICKETS = '[[entry]]\nid = 1\ntype = "story"\ntitle = "Square root"\ndescription = "The cashier takes the square root of a number."\nverify = "sqrt(9) shows 3; sqrt(-1) shows an error."\nafter = []\nrisk = "low"\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Power"\ndescription = "The cashier raises a number to a power."\nverify = "2 ^ 10 shows 1024."\nafter = [1]\nrisk = "low"\n';
const EPIC = '---\ntype: epic\ntitle: "Scientific mode"\n---\n\n# Scientific mode\n\n## Outcome\n\nEngineers can use the till calculator for quick technical sums.\n';

/** An MCP client's first messages: initialize, then list the tools; the server answers and ends with stdin. */
const MCP_LIST = [
  { jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo', version: '0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 1, method: 'tools/list' },
].map((message) => JSON.stringify(message)).join('\n');

/** Every leaf command of the CLI, e.g. `backlog add`, `approvals verify`. */
function cliCommands(): string[] {
  const leaves = (c: ReturnType<typeof buildProgram>, prefix: string): string[] =>
    c.commands.flatMap((s) => {
      const name = prefix ? `${prefix} ${s.name()}` : s.name();
      return s.commands.length ? leaves(s, name) : [name];
    });
  return leaves(buildProgram(), '');
}

/** The CLI command a step ran: the longest leaf its command line starts with. */
function commandName(command: string, commands: string[]): string {
  const matches = commands.filter((name) => command === `sdlc ${name}` || command.startsWith(`sdlc ${name} `));
  return matches.sort((a, b) => b.length - a.length)[0] ?? command.split(' ')[1];
}

function keypair(dir: string, name: string, email: string): { pubPath: string; pub: string } {
  const priv = path.join(dir, name);
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', priv], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`ssh-keygen: ${r.stderr}`);
  return { pubPath: `${priv}.pub`, pub: fs.readFileSync(`${priv}.pub`, 'utf-8').trim() };
}

// Each step is a run of sequential CLI calls (step 6 takes ~22 s alone); under a loaded machine the default 60 s
// limit was hit (bridge gate, 2026-10-06), so the demo gets three times the margin.
describe('demo: a team builds a calculator with sdlc (every command)', { timeout: 180000 }, () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let keys: Record<'alice' | 'carol', { pubPath: string; pub: string }>;
  const steps: Step[] = [];
  const change = (id: string) => path.join(root, 'openspec/changes', id);

  const as = (actor: Actor) => {
    if (actor === 'agent') return;
    git(root, ['config', 'user.name', PEOPLE[actor].name]);
    git(root, ['config', 'user.email', PEOPLE[actor].email]);
  };
  /** Runs one command as an actor and records it. `expect` = expected exit code (default 0). */
  const step = (id: string, section: string, actor: Actor, args: string[], note: string, opts: { expect?: number; input?: string } = {}) => {
    as(actor);
    const r = runCli(args, root, { ...env, ...(actor === 'agent' ? { CLAUDECODE: '1' } : {}) }, opts.input);
    const output = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim().split('\n').slice(0, 40).join('\n');
    steps.push({ id, section, actor, command: `sdlc ${args.join(' ')}`, exit: r.code, output, note });
    expect(r.code, `${id}: ${output}`).toBe(opts.expect ?? 0);
    return r;
  };
  const commit = (actor: Exclude<Actor, 'agent'>, message: string) => {
    as(actor);
    const key = actor === 'alice' || actor === 'carol' ? keys[actor] : undefined;
    git(root, ['add', '-A']);
    git(root, [...(key ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${key.pubPath}`] : []), 'commit', '-q', ...(key ? ['-S'] : []), '-m', message]);
  };

  beforeAll(() => {
    root = tempDir('sdlc-demo-calculator-');
    // The CLI speaks the deck's language (SDLC_DEMO_LOCALE); the default run, the acceptance test, is English.
    env = humanEnv(tempDir('sdlc-home-'), { SDLC_LOCALE: process.env.SDLC_DEMO_LOCALE ?? 'en' });
    const k = tempDir('sdlc-demo-keys-');
    keys = { alice: keypair(k, 'alice', PEOPLE.alice.email), carol: keypair(k, 'carol', PEOPLE.carol.email) };
    initGitRepo(root);
    git(root, ['checkout', '-q', '-b', 'main']);
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'till-calculator', type: 'module', scripts: { test: 'node --test' } }, null, 2));
    write(path.join(root, 'README.md'), '# Till calculator\n\nThe calculator used by the till app.\n');
    commit('alice', 'Start the calculator project');
  });

  afterAll(() => {
    const target = process.env.SDLC_DEMO_TRANSCRIPT ?? path.join(tempDir('sdlc-demo-out-'), 'calculator-transcript.json');
    // The deck shows the project as `till-calculator` and never this machine's paths,
    // also where an output is JSON with escaped backslashes.
    const variants = (p: string) => [p, p.replace(/\\/g, '\\\\')].map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = (paths: string[], tail = '') => new RegExp(paths.flatMap(variants).map((p) => `${p}${tail}`).join('|'), 'gi');
    const tmp = fs.realpathSync(path.dirname(root));
    const clean = (s: string) => s
      .replace(pattern([root, fs.realpathSync(root)]), 'till-calculator')
      .replace(pattern([REPO_ROOT]), '<sdlc>')
      .replace(pattern([tmp], '(?:\\\\{1,2}|/)[\\w.-]+'), '<tmp>')
      .replace(pattern([os.tmpdir()]), '<tmp>');
    const commands = cliCommands();
    const cleaned = steps.map((s) => ({ ...s, name: commandName(s.command, commands), command: clean(s.command), output: clean(s.output) }));
    const transcript = { version: 1, generatedAt: new Date().toISOString(), people: PEOPLE, commands, steps: cleaned };
    write(target, `${JSON.stringify(transcript, null, 2)}\n`);
  });

  it('1. setup: install for both tools, check health, get help, make the project AI-ready', () => {
    step('init', 'setup', 'alice', ['init', '--tools', 'claude,opencode', '--statusline'], 'Alice installs sdlc for Claude Code and OpenCode, with the status line.');
    step('doctor', 'setup', 'alice', ['doctor'], 'Installation health.');
    step('license', 'setup', 'alice', ['license'], 'Which license the project uses sdlc under.');
    step('help', 'setup', 'bob', ['help'], 'The catalog: workflows, commands, and the decisions only people take.');
    step('guide', 'setup', 'bob', ['guide', 'gates'], 'How sdlc works, from the guide the agent answers from.');
    step('layout-check', 'setup', 'agent', ['layout', 'check'], 'Is the project AI-ready? Not yet.');
    step('layout-scaffold', 'setup', 'agent', ['layout', 'scaffold'], 'The agent creates AGENTS.md, CLAUDE.md and the docs skeleton.');
    step('layout-adapt', 'setup', 'agent', ['layout', 'adapt', '--dry-run'], 'Nothing to adapt: everything is at its canonical place.');
    step('layout-convert', 'setup', 'agent', ['layout', 'convert'], 'Nothing to convert (dry run).');
    step('adopt', 'setup', 'agent', ['adopt'], 'The agent drafts settings and roles from the repository: stack, CI, CODEOWNERS, git authors.');
    step('adopt-apply-agent', 'setup', 'agent', ['adopt', '--apply'], 'Applying the draft is a person\'s decision: refused for the agent.', { expect: 1 });
    step('update', 'setup', 'alice', ['update', '--dry-run'], 'Generated files are up to date.');
    commit('alice', 'Install sdlc and the AI-ready layout');
  });

  it('2. roles: who may approve what, in a file versioned in git', () => {
    write(path.join(root, 'openspec/roles.yaml'), [
      'version: 1', 'signing: warn', 'people:',
      `  alice: { name: ${PEOPLE.alice.name}, emails: [${PEOPLE.alice.email}], signing_key: "${keys.alice.pub}" }`,
      `  bob: { name: ${PEOPLE.bob.name}, emails: [${PEOPLE.bob.email}] }`,
      `  carol: { name: ${PEOPLE.carol.name}, emails: [${PEOPLE.carol.email}], signing_key: "${keys.carol.pub}" }`,
      'roles:', '  product-owner: [alice]', '  release-manager: [alice]', '  maintainer: [alice]',
      '  engineer: [bob, carol]', '  tech-lead: [bob]', '  code-owner: [bob, carol]',
      'separation:', '  author_cannot_approve: [review, release]', '  distinct_approvers: [[spec, review], [plan, review]]', '  max_gates_per_person: 3', '',
    ].join('\n'));
    commit('alice', 'Roles for the calculator team');
    step('roles-check', 'roles', 'bob', ['roles', 'check'], 'Who holds which role.');
    step('roles-migrate', 'roles', 'agent', ['roles', 'migrate'], 'An agent cannot write the roles file.', { expect: 1 });
  });

  it('3. explore the idea before committing to it', () => {
    step('explore', 'explore', 'agent', ['explore', 'calculator'], 'The agent opens an exploration: does the till need its own calculator?');
    fs.appendFileSync(path.join(root, 'openspec/explorations/calculator.md'), '\nRecommendation: proceed with basic operations; percent and memory next.\n');
    step('explore-list', 'explore', 'bob', ['explore', 'list'], 'Explorations in the project.');
  });

  it('4. backlog: an epic, items with acceptance criteria and dependencies; people own the priority', () => {
    step('epic-add', 'backlog', 'agent', ['backlog', 'epic', 'add', 'Calculator MVP', '--goal', 'Cashiers stop using their phones for sums'], 'The epic.');
    step('epic-edit', 'backlog', 'agent', ['backlog', 'epic', 'edit', 'E1', '--goal', 'Cashiers stop using their phones for sums at the till'], 'The agent sharpens the epic goal; titles and goals change, the order does not.');
    step('add-b1', 'backlog', 'agent', ['backlog', 'add', 'Basic arithmetic', '--epic', 'E1', '--kind', 'feature', '--risk', 'low', '--outcome', 'add, subtract, multiply and divide', '--accept', '2 + 3 = 5', '--accept', '10 / 4 = 2.5', '--source-type', 'exploration', '--source-ref', 'openspec/explorations/calculator.md'], 'First item, from the exploration.');
    step('add-b2', 'backlog', 'agent', ['backlog', 'add', 'Percent', '--epic', 'E1', '--outcome', '15% of 200', '--accept', '15% of 200 = 30', '--depends', 'B1'], 'Depends on B1.');
    step('add-b3', 'backlog', 'agent', ['backlog', 'add', 'Memory M+ / MR', '--epic', 'E1', '--outcome', 'keep a running total', '--accept', 'M+ 5, M+ 3, MR = 8', '--depends', 'B1'], 'Depends on B1.');
    step('move-agent', 'backlog', 'agent', ['backlog', 'move', 'B3', '--before', 'B2'], 'Priority is a person\'s decision: refused for the agent.', { expect: 1 });
    step('move', 'backlog', 'alice', ['backlog', 'move', 'B3', '--before', 'B2'], 'Alice puts memory before percent.');
    step('add-b4', 'backlog', 'agent', ['backlog', 'add', 'Scientific notation'], 'An unrefined idea: no outcome yet.');
    step('edit-b4', 'backlog', 'agent', ['backlog', 'edit', 'B4', '--outcome', 'large results in scientific notation', '--accept', '120000 * 1000 shows 1.2e+8'], 'The agent refines the idea; an edit never changes its place.');
    step('drop', 'backlog', 'alice', ['backlog', 'drop', 'B4', '--note', 'Not for the till'], 'Alice drops it.');
    step('list', 'backlog', 'bob', ['backlog', 'list'], 'The backlog with readiness and the epic bar.');
    step('backlog-next', 'backlog', 'bob', ['backlog', 'next'], 'The first ready item.');
    step('next-empty', 'backlog', 'agent', ['next'], 'No active change: next proposes the backlog item.');
  });

  it('5. the item becomes a change; the track is suggested, never self-chosen', () => {
    step('start', 'change', 'agent', ['backlog', 'start', 'B1', '--change', 'basic-arithmetic'], 'A change with a draft intent from the item.');
    step('track-agent', 'change', 'agent', ['track', 'set', 'lite', '--change', 'basic-arithmetic'], 'An agent cannot pick the lite track.', { expect: 1 });
    step('status', 'change', 'bob', ['status', '--change', 'basic-arithmetic'], 'The stepper: intent is current.');
    step('instructions', 'change', 'agent', ['instructions', 'intent', '--change', 'basic-arithmetic', '--json'], 'What the intent must contain.');
    step('takeover', 'change', 'alice', ['takeover', '--change', 'basic-arithmetic', '--note', 'I will word the intent with the cashiers myself'], 'Alice takes the change over: the agent may not edit it until she hands it back.');
    step('release-control', 'change', 'alice', ['release-control', '--change', 'basic-arithmetic', '--note', 'Cashiers agreed on the four operations; carry on'], 'Alice hands it back with a note the agent sees.');
  });

  it('6. intent → spec → plan, each approved by the right person', () => {
    write(path.join(change('basic-arithmetic'), 'intent.md'), INTENT);
    step('approve-intent-agent', 'gates', 'agent', ['approve', 'intent', '--change', 'basic-arithmetic'], 'The agent cannot approve.', { expect: 1 });
    step('approve-intent-bob', 'gates', 'bob', ['approve', 'intent', '--change', 'basic-arithmetic'], 'Bob is not the product owner.', { expect: 1 });
    step('approve-intent', 'gates', 'alice', ['approve', 'intent', '--change', 'basic-arithmetic'], 'Alice approves the intent.');
    for (const [f, text] of [['proposal.md', PROPOSAL], ['specs/calculator/spec.md', SPEC_WITHOUT_SCENARIO], ['design.md', DESIGN]]) write(path.join(change('basic-arithmetic'), f), text);
    const bad = step('validate-bad', 'openspec', 'agent', ['validate', '--change', 'basic-arithmetic'], 'The first draft has a requirement without a scenario: strict validation refuses it.', { expect: 1 });
    expect(bad.stdout + bad.stderr).toMatch(/scenario/i);
    write(path.join(change('basic-arithmetic'), 'specs/calculator/spec.md'), SPEC);
    step('validate', 'openspec', 'agent', ['validate', '--change', 'basic-arithmetic'], 'With the scenarios added, OpenSpec strict validation and the delta target checks pass.');
    step('os-schema', 'openspec', 'bob', ['openspec', 'schema', 'validate', 'sdlc'], 'The sdlc schema is a standard OpenSpec schema.');
    step('approve-spec', 'gates', 'alice', ['approve', 'spec', '--change', 'basic-arithmetic'], 'Alice approves the spec.');
    commit('alice', 'Intent and spec for basic arithmetic');
    write(path.join(change('basic-arithmetic'), 'plan.md'), PLAN);
    write(path.join(change('basic-arithmetic'), 'tasks.md'), TASKS);
    step('approve-plan', 'gates', 'bob', ['approve', 'plan', '--change', 'basic-arithmetic'], 'Bob, the engineer, approves the plan.');
    commit('bob', 'Plan for basic arithmetic'); // each approver commits their own approval
    step('rework', 'gates', 'alice', ['rework', 'spec', '--change', 'basic-arithmetic', '--reason', 'missing-requirement', '--note', 'Say what 10 / 0 shows on the till'], 'Alice sends the change back to the spec with a reason; the plan approval stops counting.');
    step('approve-spec-again', 'gates', 'alice', ['approve', 'spec', '--change', 'basic-arithmetic'], 'The spec is approved again.');
    step('approve-plan-again', 'gates', 'bob', ['approve', 'plan', '--change', 'basic-arithmetic'], 'The plan needs its own new approval.');
    commit('alice', 'Rework of the spec, approvals renewed');
  });

  it('6b. OpenSpec underneath: the sdlc change is a plain OpenSpec change', () => {
    const list = step('os-list', 'openspec', 'bob', ['openspec', 'list'], 'OpenSpec lists the change like any of its own.');
    expect(list.stdout).toContain('basic-arithmetic');
    step('os-status', 'openspec', 'agent', ['openspec', 'status', '--change', 'basic-arithmetic'], 'Artifact completion by the sdlc schema, computed by OpenSpec.');
    const show = step('os-show', 'openspec', 'bob', ['openspec', 'show', 'basic-arithmetic', '--json', '--deltas-only'], 'The change as OpenSpec sees it: the ADDED requirement and its scenarios.');
    expect(show.stdout).toMatch(/"operation": "ADDED"/);
    expect(show.stdout).toMatch(/SHALL add, subtract, multiply and divide/);
  });

  it('7. build and verify with evidence (Bob writes the code on a branch)', () => {
    git(root, ['checkout', '-q', '-b', 'basic-arithmetic']);
    write(path.join(root, 'test/calc.test.js'), TEST);
    write(path.join(root, 'src/calc.js'), CODE);
    write(path.join(change('basic-arithmetic'), 'tasks.md'), TASKS.replace(/- \[ \]/g, '- [x]'));
    step('verify', 'build', 'agent', ['verify', '--change', 'basic-arithmetic'], 'Real checks, recorded evidence.');
    const evidence = read(path.join(change('basic-arithmetic'), 'verification.md'));
    fs.writeFileSync(path.join(change('basic-arithmetic'), 'verification.md'), evidence.replace(/(## Behavioral verification[\s\S]*?\|---\|---\|---\|---\|\n)/, '$1| Add | node --test | 5 | PASS |\n| Divide | node --test | 2.5 | PASS |\n'));
    step('verify-check', 'build', 'agent', ['verify', '--check', '--change', 'basic-arithmetic'], 'Every scenario has evidence.');
    commit('bob', 'Basic arithmetic');
  });

  it('8. review with lenses; a finding is deferred; the author cannot approve his own review', () => {
    step('review-context', 'review', 'agent', ['review', 'context', '--change', 'basic-arithmetic'], 'Passes, lenses and plan drift.');
    step('defer', 'review', 'agent', ['defer', 'add', 'Division by zero shows an error', '--why', 'Till app handles it for now', '--change', 'basic-arithmetic', '--finding', 'F2', '--revisit', 'before the kiosk release'], 'The deferred finding goes to the registry.');
    write(path.join(change('basic-arithmetic'), 'review.md'), REVIEW);
    step('review-check', 'review', 'agent', ['review', 'check', '--change', 'basic-arithmetic'], 'Coverage of every pass and lens, deferred link valid.');
    step('defer-list', 'review', 'bob', ['defer', 'list'], 'The registry.');
    commit('carol', 'Review of basic arithmetic');
    step('roles-who', 'review', 'bob', ['roles', 'who', 'review', '--change', 'basic-arithmetic', '--base', 'main'], 'Who may approve the review: not Bob, he wrote the code.');
    step('approve-review-bob', 'review', 'bob', ['approve', 'review', '--change', 'basic-arithmetic'], 'Bob is the author: refused.', { expect: 1 });
    step('approve-review', 'review', 'carol', ['approve', 'review', '--change', 'basic-arithmetic'], 'Carol approves the review.');
    commit('carol', 'Approve the review of basic arithmetic');
  });

  it('9. release, signatures, archive; the backlog moves on', () => {
    step('release-check', 'release', 'bob', ['release', 'check', '--change', 'basic-arithmetic'], 'Before Alice decides, Bob runs the release checks; none are configured here.');
    step('approve-release', 'release', 'alice', ['approve', 'release', '--change', 'basic-arithmetic'], 'Alice authorizes the release.');
    commit('alice', 'Release approvals for basic arithmetic');
    step('approvals-verify', 'release', 'bob', ['approvals', 'verify'], "Signed approvals check (warn mode): Alice and Carol sign; Bob's plan approval is unsigned, reported but not blocking.");
    step('archive', 'release', 'alice', ['archive', 'basic-arithmetic', '--yes'], 'The delta merges into the living spec; B1 closes.');
    step('trace', 'release', 'bob', ['trace', 'basic-arithmetic'], 'From intent to evidence: requirements, scenarios, tasks, commits, findings, and the gaps.');
    commit('alice', 'Archive basic arithmetic');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', '--no-edit', 'basic-arithmetic']);
    step('openspec', 'openspec', 'bob', ['openspec', 'list', '--specs'], 'The calculator capability is now a living spec.');
    const spec = step('os-spec-show', 'openspec', 'bob', ['openspec', 'show', 'calculator', '--type', 'spec'], 'The living spec holds the requirement the change added.');
    expect(spec.stdout).toMatch(/Basic operations/);
    step('list-after', 'release', 'bob', ['backlog', 'list'], 'B3 and B2 are ready now.');
  });

  it('10. the safety nets: bug-fix protocol, reject, waive', () => {
    step('new-fix', 'safety', 'agent', ['new', 'fix-rounding', '--kind', 'bugfix', '--risk', 'low'], 'A bug fix: the CLI suggests lite; a person decides.');
    step('track', 'safety', 'bob', ['track', 'set', 'lite', '--change', 'fix-rounding', '--note', 'one-line fix'], 'Bob confirms the lite track.');
    step('tests-lock', 'safety', 'agent', ['tests', 'lock', '--change', 'fix-rounding'], 'Tests are locked: the failing test is the proof.');
    step('tests-unlock-agent', 'safety', 'agent', ['tests', 'unlock', '--change', 'fix-rounding'], 'Unlocking is a person\'s decision.', { expect: 1 });
    step('tests-unlock', 'safety', 'bob', ['tests', 'unlock', '--change', 'fix-rounding'], 'Bob unlocks.');
    step('new-idea', 'safety', 'agent', ['new', 'voice-input', '--kind', 'feature'], 'An agent proposes voice input.');
    write(path.join(change('voice-input'), 'intent.md'), INTENT.replace('basic arithmetic', 'voice input'));
    step('reject', 'safety', 'alice', ['reject', 'intent', '--change', 'voice-input', '--note', 'Tills are in noisy shops'], 'Alice rejects it with a reason.');
    step('waive', 'safety', 'alice', ['waive', 'release', '--change', 'fix-rounding', '--note', 'Internal library, no release step'], 'A recorded waiver.');
    step('defer-close', 'safety', 'bob', ['defer', 'close', 'D1', '--status', 'done', '--note', 'Division by zero shows "Error" since fix-rounding'], 'The deferred finding is closed when it is handled.');
    step('backlog-done', 'safety', 'alice', ['backlog', 'done', 'B3', '--note', 'The till app already has memory keys; nothing to build'], 'An item can be closed without a change.');
  });

  it('11. BMAD planning comes in as backlog items', () => {
    write(path.join(root, '_bmad-output/epic-scientific/epic-scientific.md'), EPIC);
    write(path.join(root, '_bmad-output/epic-scientific/tickets.toml'), TICKETS);
    step('import', 'bmad', 'agent', ['import', 'bmad', '_bmad-output/epic-scientific', '--to-backlog'], 'Epic and tickets from BMAD become backlog items.');
  });

  it('12. see the whole picture', () => {
    step('status-all', 'visibility', 'bob', ['status'], 'Every active change.');
    step('status-md', 'visibility', 'bob', ['status', '--markdown'], 'A report for the pull request.');
    step('report', 'visibility', 'alice', ['report', '--format', 'md'], 'The progress report with Mermaid diagrams.');
    step('dashboard', 'visibility', 'alice', ['dashboard', '--out', 'reports/dashboard.html'], 'The dashboard, one offline HTML page.');
    step('audit', 'visibility', 'alice', ['audit'], 'Lead times and first-pass rate.');
    step('log', 'visibility', 'alice', ['log', '--limit', '15'], 'Who did what, with the sdlc version and license.');
    // The team's MCP registry: a CI server (the test fixture) for the build and test stages, and a check on it.
    const ci = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
    const config = parseDocument(read(path.join(root, 'openspec/sdlc.yaml')));
    config.setIn(['mcp', 'servers', 'ci'], { type: 'stdio', command: ['node', ci], stages: ['build', 'test'] });
    const green = { status: 'success' };
    config.setIn(['verify', 'mcp'], [{ name: 'ci-green', server: 'ci', tool: 'pipeline_status', args: { ref: '${HEAD}' }, expect: green }]);
    write(path.join(root, 'openspec/sdlc.yaml'), config.toString());
    step('mcp-check', 'visibility', 'bob', ['mcp', 'check'], 'The team\'s MCP servers: reachable, tools listed, file writers flagged.');
    step('verify-mcp', 'visibility', 'bob', ['verify', '--change', 'fix-rounding'], 'Bob verifies himself: the CLI calls the CI server over MCP and keeps the result for the agent.');
    const inbox = step('inbox-list', 'visibility', 'agent', ['inbox', 'list', '--json'], 'The agent finds the result in its inbox.');
    step('statusline', 'visibility', 'bob', ['statusline'], 'Claude Code status line.', { input: JSON.stringify({ cwd: root }) });
    step('hook', 'visibility', 'agent', ['hook', 'session-start'], 'What the agent learns when a session starts.', { input: JSON.stringify({ cwd: root, source: 'startup' }) });
    step('inbox-done', 'visibility', 'agent', ['inbox', 'done', JSON.parse(inbox.stdout).items[0].id], 'Read: the agent marks the item done.');
    step('events-list', 'visibility', 'agent', ['events', 'list'], 'Process events waiting for the team\'s servers; no receivers are configured here.');
    step('events-flush', 'visibility', 'bob', ['events', 'flush'], 'Bob sends the waiting events now; nothing waits.');
    step('mcp', 'visibility', 'agent', ['mcp', 'serve'], 'Other AI systems read the process over MCP.', { input: MCP_LIST });
    step('plugin', 'visibility', 'bob', ['plugin', 'build', path.join(tempDir('sdlc-demo-plugin-'), 'plugin')], 'The same workflows as a Claude Code plugin.');
    step('uninstall', 'visibility', 'alice', ['uninstall', '--dry-run'], 'Uninstall keeps every planning file.');
  });

  it('13. every CLI command appears in the demo', () => {
    const commands = cliCommands();
    const used = new Set(steps.map((s) => commandName(s.command, commands)));
    const missing = commands.filter((name) => !used.has(name));
    expect(missing).toEqual([]);
    expect(fs.existsSync(BIN)).toBe(true);
  });
});
