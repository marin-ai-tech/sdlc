import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { FILES } from './farewell-fixture.js';
import { humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';
import { assertCliValue } from '../src/core/cli-value.js';
import { withCliPrefix } from '../src/core/suggested-command.js';

describe('Configured command prefix', () => {
  it('keeps an accepted standalone .js program unchanged when a presenter reapplies the prefix', () => {
    const prefix = 'sdlc.js';
    expect(() => assertCliValue(prefix, 'cli')).not.toThrow();
    const command = withCliPrefix('sdlc approve intent --change demo', prefix);
    expect(command).toBe('sdlc.js approve intent --change demo');
    expect(withCliPrefix(command, prefix)).toBe(command);
  });

  it('uses identical validated program words in all actual approval surfaces', () => {
    const root = tempDir('sdlc-prefix-');
    initGitRepo(root);
    const env = humanEnv(tempDir('sdlc-prefix-home-'));
    const cli = (args: string[]) => {
      const result = runCli(args, root, env);
      expect(result.code, result.stdout + result.stderr).toBe(0);
      return result;
    };
    cli(['init', '--tools', 'none', '--json']);
    cli(['new', 'prefix-work', '--json']);
    write(path.join(root, 'openspec/changes/prefix-work/intent.md'), FILES['intent.md']);
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.cli = 'npx --no-install sdlc';
    config.team = { mode: 'solo' };
    write(file, stringify(config));
    const next = cli(['next', '--change', 'prefix-work', '--json']).json();
    const report = cli(['report', '--change', 'prefix-work', '--json']).json();
    const queue = cli(['next', '--me', '--no-branches', '--json']).json();
    const explain = cli(['explain', '--change', 'prefix-work', '--json']).json();
    const preview = cli(['approve', 'intent', '--change', 'prefix-work', '--preview', '--json']).json();
    const commands = [next.next.cli, report.changes[0].next.cli, queue.items[0].cli,
      explain.unblock[0].cli, preview.cli];
    for (const command of commands) expect(command).toMatch(/^npx --no-install sdlc approve intent\b/);
    expect(next.next.executionRole).toBe('analyst');
    expect(cli(['next', '--change', 'prefix-work']).stdout).toContain('$ npx --no-install sdlc approve intent');
  }, 120000);
});
