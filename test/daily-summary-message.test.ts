import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * A defect found by the cookbook videos (0.20.2, recipe 09): with nothing waiting for a person, `sdlc events summary`
 * printed "waiting changes: none" while the chat text said "waiting changes: add-farewell" — the text fell back to the
 * active changes under the word "waiting". The text now names the active changes and the changes waiting for people
 * separately, and agrees with the CLI.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

function project(locale: 'en' | 'xx') {
  const root = tempDir('sdlc-summary-text-');
  const events = path.join(tempDir('sdlc-summary-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events, SDLC_LOCALE: locale });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.project = { name: 'claims' };
  config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = [{ server: 'chat', tool: 'report_event', on: ['summary.daily'], message: 'text' }];
  write(file, stringify(config));
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  const texts = () => (fs.existsSync(events)
    ? read(events).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).text as string)
    : []);
  return { cli, texts };
}

describe('the daily summary text', () => {
  it('with nothing waiting for a person, the text does not call the active change waiting', () => {
    const p = project('en');
    const r = p.cli(['events', 'summary', '--json']);
    expect(r.json().summary.waiting).toEqual([]);
    const [text] = p.texts();
    expect(text).toContain('add-export');
    expect(text).toMatch(/waiting for people: none/);
    expect(text).not.toMatch(/waiting[^;]*add-export/);
  }, 180000);

  it('the summary message includes the active change', () => {
    const p = project('en');
    expect(p.cli(['events', 'summary', '--json']).code).toBe(0);
    const [text] = p.texts();
    expect(text).toContain('add-export');
  }, 180000);

  });
