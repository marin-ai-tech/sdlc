import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B93: GitHub Issues and the backlog stay linked, through the team's GitHub MCP server (sdlc holds no token).
 * - sdlc.yaml `issues: { server: <a name in mcp.servers>, repo: <owner/name> }`.
 * - `sdlc backlog import --issues [--json]` calls `list_issues` (state open) and adds one backlog item per open issue
 *   that is not linked yet: the title, and the field `Issue: GH-<n>` (JSON `issue: "GH-<n>"`). Pull requests are not
 *   issues and are skipped; a second import adds nothing.
 * - Archiving a change whose backlog item has `Issue: GH-<n>` comments on the issue (`add_issue_comment`, the body
 *   names the change) and closes it (`update_issue`, state closed). The calls go through the event outbox: when the
 *   server fails, the archive still succeeds and `sdlc events flush` delivers them later. An item without an issue
 *   never causes a GitHub call.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-github.mjs').replace(/\\/g, '/');
const ISSUES = [
  { number: 42, title: 'Show the claim stage', body: 'Policyholders want to see the stage.', state: 'open' },
  { number: 43, title: 'Bump a dependency', state: 'open', pull_request: { url: 'https://example.invalid/pr/43' } },
  { number: 44, title: 'Export claims to CSV', body: 'Finance asks for CSV.', state: 'open' },
];

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

function project() {
  const root = tempDir('sdlc-gh-issues-');
  const calls = path.join(tempDir('sdlc-gh-calls-'), 'calls.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_GITHUB_CALLS: calls, FAKE_ISSUES: JSON.stringify(ISSUES) });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { github: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.issues = { server: 'github', repo: 'acme/claims' };
  write(file, stringify(config));
  const received = (): Call[] => (fs.existsSync(calls)
    ? read(calls).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Call)
    : []);
  const writes = () => received().filter((call) => call.tool !== 'list_issues');
  return { root, cli, received, writes };
}

/** Gives B1 an outcome and a criterion so it is ready, starts it and archives the change (a person, forced). */
function startAndArchive(cli: ReturnType<typeof project>['cli'], item: string, change: string, extra = {}) {
  expect(cli(['backlog', 'edit', item, '--outcome', 'it works', '--accept', 'a check passes', '--json']).code).toBe(0);
  expect(cli(['backlog', 'start', item, '--change', change, '--json']).code).toBe(0);
  return cli(['archive', change, '--yes', '--force', '--note', 'test shortcut', '--json'], extra);
}

describe('B93: backlog import --issues', () => {
  it('adds one item per open issue with the link; pull requests are skipped; a second import adds nothing', () => {
    const p = project();
    const r = p.cli(['backlog', 'import', '--issues', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const listCall = p.received().find((call) => call.tool === 'list_issues');
    expect(listCall?.args).toMatchObject({ owner: 'acme', repo: 'claims' });
    const items = p.cli(['backlog', 'list', '--json']).json().items;
    expect(items.map((item: { title: string; issue?: string }) => [item.title, item.issue])).toEqual([
      ['Show the claim stage', 'GH-42'], ['Export claims to CSV', 'GH-44'],
    ]);
    expect(JSON.stringify(items)).not.toContain('Bump a dependency');
    expect(read(path.join(p.root, 'openspec/backlog.md'))).toContain('**Issue**: GH-42');
    const again = p.cli(['backlog', 'import', '--issues', '--json']);
    expect(again.code).toBe(0);
    expect(p.cli(['backlog', 'list', '--json']).json().items).toHaveLength(2);
  }, 240000);

  it('negative: without the issues setting the import is refused and nothing is called', () => {
    const p = project();
    const file = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    delete config.issues;
    write(file, stringify(config));
    const r = p.cli(['backlog', 'import', '--issues', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('issues_not_configured');
    expect(p.received()).toEqual([]);
  }, 240000);
});

describe('B93: archive closes the linked issue', () => {
  it('comments on the issue and closes it; an item without an issue calls nothing', () => {
    const p = project();
    p.cli(['backlog', 'import', '--issues', '--json']);
    p.cli(['backlog', 'add', 'No issue here', '--json']);
    const archived = startAndArchive(p.cli, 'B1', 'show-claim-stage');
    expect(archived.code, archived.stdout + archived.stderr).toBe(0);
    const comment = p.writes().find((call) => call.tool === 'add_issue_comment');
    expect(comment?.args).toMatchObject({ owner: 'acme', repo: 'claims', issue_number: 42 });
    expect(String(comment?.args.body)).toContain('show-claim-stage');
    const close = p.writes().find((call) => call.tool === 'update_issue');
    expect(close?.args).toMatchObject({ owner: 'acme', repo: 'claims', issue_number: 42, state: 'closed' });
    const before = p.writes().length;
    expect(startAndArchive(p.cli, 'B3', 'no-issue-here').code).toBe(0);
    expect(p.writes()).toHaveLength(before);
    expect(JSON.stringify(p.writes())).not.toContain('"issue_number":44');
  }, 300000);

  it('a failing server does not fail the archive; events flush delivers the close later', () => {
    const p = project();
    p.cli(['backlog', 'import', '--issues', '--json']);
    const archived = startAndArchive(p.cli, 'B1', 'show-claim-stage', { FAKE_GITHUB_FAIL: '1' });
    expect(archived.code, archived.stdout + archived.stderr).toBe(0);
    expect(p.cli(['events', 'flush', '--json']).code).toBe(0);
    const closes = p.writes().filter((call) => call.tool === 'update_issue' && call.args.state === 'closed');
    expect(closes.length).toBeGreaterThanOrEqual(2);
    expect(p.cli(['events', 'list', '--json']).json().pending ?? []).toEqual([]);
  }, 300000);
});
