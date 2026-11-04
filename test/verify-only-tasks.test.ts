import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { verifyOnlyTasks } from '../src/core/verify-only-tasks.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B243: an open task blocks the verify gate, so a task only the verify stage can do deadlocks it (E2E run of 2026-11-02,
 * finding S20). `sdlc validate` warns about such a task and points at the plan's Proof section; it is a warning, since
 * the check is a heuristic.
 */

interface Issue { level: string; path?: string; line?: number; message: string; textKey?: string }

let root: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  root = tempDir('sdlc-verify-only-');
  env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
  expect(runCli(['new', 'demo', '--skip-specs', '--json'], root, env).code).toBe(0);
}, 180000);

function warnings(tasks: string[]): { code: number; issues: Issue[] } {
  write(path.join(root, 'openspec/changes/demo/tasks.md'), ['# Tasks', '', '## 1. Work', '', ...tasks, ''].join('\n'));
  const result = runCli(['validate', '--change', 'demo', '--json'], root, env);
  const issues = (result.json().items as Array<{ id?: string; issues: Issue[] }>).flatMap((item) => item.issues);
  return { code: result.code, issues: issues.filter((issue) => issue.textKey === 'validate.verifyOnlyTask') };
}

describe('sdlc validate on tasks.md', () => {
  it('B243.C1: warns on a browser and screenshot task, names the line and Proof, and exits 0', () => {
    const { code, issues } = warnings([
      '- [ ] 1.1 Add the view; test/view.test.js passes',
      '- [ ] 1.2 Check the page in a browser on a tablet and take screenshots',
    ]);
    expect(code).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: 'warning', path: 'tasks.md', line: 6 });
    expect(issues[0].message).toContain('1.2');
    expect(issues[0].message).toMatch(/Proof/);
    expect(issues[0].message).toMatch(/plan\.md/);
  }, 120000);

  it.each([
    'Manually verify the form on a phone',
    'Take screenshots of the calculator',
    'Open the page in a browser and confirm the buttons work',
    'Run it on a real device and note the result',
    'Run sdlc verify and record the evidence',
    'Do a manual check of the release notes',
  ])('B243.C1: warns on: %s', (text) => {
    expect(warnings([`- [ ] 1.1 ${text}`]).issues).toHaveLength(1);
  }, 120000);

  it.each([
    'Add the star view; test/view.test.js passes',
    'Support the browser back button in the router; `npm test` passes',
    'Add a device id field to the record; `npx vitest run device` passes',
    'Render the screenshots folder in the report; test/report.test.ts passes',
    'Write the manual section of the docs; `npx vitest run docs` passes',
    'Support the browser back button in the router',
    'Parse the device list from the config',
    'Add sdlc verify to the list of commands in the guide',
  ])('B243.C2: no warning on: %s', (text) => {
    expect(warnings([`- [ ] 1.1 ${text}`]).issues).toEqual([]);
  }, 120000);

  it('B243.C3: a ticked task gives no warning', () => {
    expect(warnings(['- [x] 1.1 Check the page in a browser and take screenshots']).issues).toEqual([]);
  }, 120000);
});

describe('the plan instructions', () => {
  it('B243.C4: the schema tasks instruction keeps verify-only checks under Proof', () => {
    const schema = parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas/sdlc/schema.yaml'), 'utf-8'));
    const tasks = schema.artifacts.find((artifact: { id: string }) => artifact.id === 'tasks').instruction as string;
    expect(tasks).toMatch(/(manual|browser)[^.]*Proof/is);
  });

  it('B243.C4: the generated plan workflow says the same', () => {
    const text = read(path.join(root, '.claude/skills/sdlc-plan/SKILL.md'));
    expect(text).toMatch(/(manual|browser)[^.]*Proof[^.]*tasks\.md|(manual|browser)[^.]*tasks\.md[^.]*Proof/is);
  });
});

describe('review round 1: the spellings agents use', () => {
  const warned = (text: string) => {
    const dir = tempDir('sdlc-verify-only-unit-');
    write(path.join(dir, 'tasks.md'), `# Tasks\n\n- [ ] 1.1 ${text}\n`);
    return verifyOnlyTasks(dir).length > 0;
  };

  it.each([
    'Run `sdlc verify` after implementation',
    'Run `sdlc verify --change demo` after implementation',
    'Open `index.html` in a browser and take screenshots',
    'Check the page in a browser with `open index.html`',
    'Take screenshots of `index.html`',
    'Manually check `index.html` on a phone',
    'Manually verify the `Save` button',
    'Check `/login` on a real device',
    'Manual browser check of the page',
    'Browser check of the login page',
    'Device check on an iPhone',
    'Screenshots of every page',
    'Screenshot the page',
    'Check the page manually on a phone',
    'Check the page in all browsers',
    'Verify on a phone',
    'Test on a tablet',
    'Manual testing of the login page',
    'Do a manual QA pass',
    'Run `npm test` and `sdlc verify`',
    'Confirm `sdlc verify` is green',
    '`sdlc verify` passes',
    'Run `npx sdlc verify --change x`',
  ])('warns on: %s', (text) => {
    expect(warned(text)).toBe(true);
  });

  it.each([
    'Run the browser bundle build',
    'Test the device driver parser in src/driver.ts',
    'Implement device detection and test the device module in src/device.ts',
    'Fix screenshot upload, record the screenshot id in the database',
    'Add the view; `npm test` passes',
    'Add the `Save` button; test/save.test.ts passes',
    'Add a `--json` flag to the command',
    'Check the page in a browser with `npx playwright test e2e/login.spec.ts`',
    'Open the page in a browser; `pnpm test` passes',
    'Open the page in a browser; `pytest tests/test_ui.py` passes',
    'Add sdlc verify to the list of commands in the guide',
  ])('no warning on: %s', (text) => {
    expect(warned(text)).toBe(false);
  });

  it('a very long task line is judged quickly', () => {
    const started = Date.now();
    warned('check '.repeat(40000));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
