import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { setLocale } from '../src/core/i18n.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * Human decisions cannot be taken from the agent chat: in OpenCode and Claude Code a command typed with `!` runs in
 * the agent's shell. When the CLI or the hook refuses one, the person gets the exact command to run in their own
 * terminal and the reason a `!` command in the chat does not count.
 */

const OPENCODE_AGENT = { SDLC_AGENT: 'opencode' };

function project() {
  const root = tempDir('sdlc-human-hint-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'opencode', '--json']).code).toBe(0);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  cli(['backlog', 'add', 'Export', '--json']);
  cli(['backlog', 'add', 'Import', '--json']);
  write(path.join(root, 'openspec/changes/demo/intent.md'), '# Intent: demo\n');
  return { root, cli };
}

describe('a refused human decision names the command to run and where', () => {
  it('the CLI refusal in an agent session gives the exact command and says a ! command in the chat does not count', () => {
    const { cli } = project();
    const cases: Array<[string[], string]> = [
      [['approve', 'intent', '--change', 'demo'], 'sdlc approve intent --change demo'],
      [['backlog', 'move', 'B2', '--top'], 'sdlc backlog move B2 --top'],
      [['adopt', '--apply'], 'sdlc adopt --apply'],
      [['track', 'set', 'lite', '--change', 'demo'], 'sdlc track set lite --change demo'],
    ];
    for (const [args, command] of cases) {
      const text = cli(args, OPENCODE_AGENT);
      expect(text.code, command).toBe(1);
      expect(text.stderr, command).toContain(command);
      expect(text.stderr, command).toMatch(/your own terminal/i);
      expect(text.stderr, command).toMatch(/`!`/);
      const json = cli([...args, '--json'], OPENCODE_AGENT).json();
      expect(json.status[0].fix, command).toContain(command);
    }
  }, 120000);

  it('the hook reason quotes the refused command', () => {
    setLocale('en');
    const root = tempDir('sdlc-human-hint-hook-');
    const ctx = { paths: projectPaths(root), config: defaultConfig() };
    const command = 'sdlc approve plan --change add-export';
    const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
    expect(decision).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    expect(decision.reason).toContain(`\`${command}\``);
    // The agent reads this reason: it asks the person, it does not tell the agent to run the command.
    expect(decision.reason).toMatch(/ask the responsible person[^.]*their own terminal/i);
  });

  it('negative: a very long refused command is shortened in the hook reason', () => {
    setLocale('en');
    const root = tempDir('sdlc-human-hint-hook-');
    const ctx = { paths: projectPaths(root), config: defaultConfig() };
    const command = `sdlc approve plan --change add-export --note "${'x'.repeat(800)}"`;
    const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
    expect(decision.reason!.length).toBeLessThan(600);
  });

  it('negative: outside an agent session the commands still run (no refusal text)', () => {
    const { cli } = project();
    const r = cli(['backlog', 'move', 'B2', '--top', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
  }, 120000);
});
