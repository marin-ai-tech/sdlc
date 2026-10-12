import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * B106 (0.16.0): reading the log and the health for one event type or one period.
 * - `sdlc log --event <name>` keeps the entries of that event; `*` matches any text (`gate.*`). `--since <date>`
 *   keeps the entries from that date. Both combine with `--change` and `--limit`; `total` counts the filtered entries.
 * - `sdlc health --since <date>` or `--days <n>` looks at another window than `health.window_days` for one run; the
 *   JSON says which window it used (`window: { since, days }`). A one-off window records no health signals.
 */

function project() {
  const root = tempDir('sdlc-log-window-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  expect(cli(['new', 'add-import', '--json']).code).toBe(0);
  return cli;
}

type Entry = { event: string; change?: string };

describe('B106: sdlc log --event and --since', () => {
  it('--event keeps one event type; * matches any text', () => {
    const cli = project();
    const exact = cli(['log', '--event', 'change.created', '--json']).json();
    expect(exact.total).toBe(2);
    expect(exact.entries.every((entry: Entry) => entry.event === 'change.created')).toBe(true);
    const glob = cli(['log', '--event', 'change.*', '--json']).json();
    expect(glob.entries.length).toBeGreaterThanOrEqual(2);
    expect(glob.entries.every((entry: Entry) => entry.event.startsWith('change.'))).toBe(true);
    const both = cli(['log', '--event', 'change.created', '--change', 'add-import', '--json']).json();
    expect(both.entries.map((entry: Entry) => entry.change)).toEqual(['add-import']);
  }, 120000);

  it('negative: an event that never happened gives no entries; text says so', () => {
    const cli = project();
    expect(cli(['log', '--event', 'gate.release.approved', '--json']).json().total).toBe(0);
    const text = cli(['log', '--event', 'gate.release.approved']);
    expect(text.code).toBe(0);
    expect(text.stdout).not.toContain('change.created');
  }, 120000);

  it('--since keeps the entries from a date; a bad date is refused', () => {
    const cli = project();
    expect(cli(['log', '--since', '2000-01-01', '--json']).json().total).toBeGreaterThanOrEqual(3);
    expect(cli(['log', '--since', '2999-01-01', '--json']).json().total).toBe(0);
    const bad = cli(['log', '--since', 'yesterday', '--json']);
    expect(bad.code).not.toBe(0);
    expect(bad.json().status[0].code).toBe('invalid_option');
  }, 120000);
});

describe('B106: sdlc health --since and --days', () => {
  it('the JSON names the window: the configured days by default, or the one given', () => {
    const cli = project();
    expect(cli(['health', '--json']).json().window).toMatchObject({ days: 90 });
    const days = cli(['health', '--days', '7', '--json']).json().window;
    expect(days.days).toBe(7);
    const since = Date.parse(days.since);
    expect(Math.abs(Date.now() - 7 * 86_400_000 - since)).toBeLessThan(600_000);
    expect(cli(['health', '--since', '2026-01-01', '--json']).json().window.since).toBe('2026-01-01T00:00:00.000Z');
  }, 120000);

  it('negative: --since with --days, a bad date or a bad number is refused', () => {
    const cli = project();
    const refused = [['--since', '2026-01-01', '--days', '7'], ['--since', 'soon'], ['--days', '0'], ['--days', 'x']];
    for (const args of refused) {
      const r = cli(['health', ...args, '--json']);
      expect(r.code, args.join(' ')).not.toBe(0);
      expect(r.json().status[0].code, args.join(' ')).toBe('invalid_option');
    }
  }, 120000);

  it('negative: a one-off window records no health signals in the log', () => {
    const cli = project();
    const count = () => cli(['log', '--json', '--limit', '1000']).json().entries
      .filter((entry: Entry) => entry.event.startsWith('health.')).length;
    const before = count();
    expect(cli(['health', '--days', '1', '--json']).code).toBe(0);
    expect(cli(['health', '--since', '2000-01-01', '--json']).code).toBe(0);
    expect(count()).toBe(before);
  }, 120000);
});
