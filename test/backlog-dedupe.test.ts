import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * 0.15.1: `sdlc backlog add` refuses a second open item with the same source (`--source-type` and `--source-ref`,
 * e.g. the same GitHub issue) and names the existing item — an agent that brings issues into the backlog twice no
 * longer makes duplicates. `--allow-duplicate` adds it anyway (one issue may become several items).
 */

function project() {
  const root = tempDir('sdlc-backlog-dedupe-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return cli;
}

const ADD = ['backlog', 'add', 'Show order status', '--source-type', 'ticket', '--source-ref', 'GH-42', '--json'];

describe('backlog add and the same source twice', () => {
  it('refuses a second item with the same source and names the first', () => {
    const cli = project();
    const first = cli(ADD);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    const id = first.json().item?.id ?? first.json().id;
    const second = cli(['backlog', 'add', 'Order status page', '--source-type', 'ticket', '--source-ref', 'GH-42',
      '--json']);
    expect(second.code).toBe(1);
    expect(second.json().status[0].code).toBe('duplicate_item');
    expect(JSON.stringify(second.json())).toContain(String(id));
  }, 120000);

  it('--allow-duplicate adds it anyway', () => {
    const cli = project();
    expect(cli(ADD).code).toBe(0);
    expect(cli([...ADD, '--allow-duplicate']).code).toBe(0);
  }, 120000);

  it('negative: another source, or no source, is never a duplicate', () => {
    const cli = project();
    expect(cli(ADD).code).toBe(0);
    expect(cli(['backlog', 'add', 'Show order status', '--source-type', 'ticket', '--source-ref', 'GH-43', '--json'])
      .code).toBe(0);
    expect(cli(['backlog', 'add', 'Show order status', '--json']).code).toBe(0);
    expect(cli(['backlog', 'add', 'Show order status', '--json']).code).toBe(0);
  }, 120000);
});
