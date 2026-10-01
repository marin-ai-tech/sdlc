import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/index.js';
import { ALL_GATES } from '../src/core/config.js';
import { helpCatalog } from '../src/core/help-catalog.js';

/** Splits an example into argv the way a shell would (double-quoted parts stay whole). */
const argv = (example: string) => [...example.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]).slice(1);

/** The real CLI with every action replaced by a no-op: parsing only, nothing runs. */
function parser(): Command {
  const program = buildProgram();
  const silence = (command: Command) => {
    command.exitOverride();
    command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    const actionable = command as Command & { _actionHandler?: unknown };
    if (actionable._actionHandler) command.action(() => {});
    command.commands.forEach(silence);
  };
  silence(program);
  return program;
}

const ARTIFACTS = ['intent', 'proposal', 'specs', 'design', 'plan', 'tasks', 'verification', 'review', 'release'];
const HOOK_EVENTS = ['pre-tool', 'session-start', 'stop'];

describe('help catalog examples', () => {
  const { commands } = helpCatalog(buildProgram());

  it('no example uses a placeholder instead of a real value', () => {
    expect(commands.filter((c) => /\bexample\b/.test(c.example)).map((c) => c.example)).toEqual([]);
  });

  it('every example parses with the real CLI: known command, arguments and options', async () => {
    const failures: string[] = [];
    for (const command of commands) {
      try {
        await parser().parseAsync(argv(command.example), { from: 'user' });
      } catch (error) {
        failures.push(`${command.example}: ${error instanceof CommanderError ? error.code : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('gates, artifacts and hook events in examples are real ones', () => {
    const value = (name: string) => argv(commands.find((c) => c.name === name)!.example)[name.split(' ').length];
    for (const name of ['approve', 'reject', 'waive', 'roles who']) expect(ALL_GATES).toContain(value(name));
    expect(ARTIFACTS).toContain(value('instructions'));
    expect(HOOK_EVENTS).toContain(value('hook'));
    expect(value('backlog start')).toMatch(/^B\d+$/);
    expect(value('defer close')).toMatch(/^D\d+$/);
  });

  it('examples carry the options the CLI checks at run time', () => {
    const example = (name: string) => commands.find((c) => c.name === name)!.example;
    expect(example('import bmad')).toMatch(/--change|--to-backlog/);
    expect(example('defer close')).toMatch(/--status (done|dropped)/);
    expect(example('defer add')).toMatch(/--why/);
    expect(example('archive')).toMatch(/archive \S+ --yes/);
  });

  it('negative: --json appears only on commands that accept it', () => {
    const program = buildProgram();
    const find = (name: string) => name.split(' ').reduce<Command | undefined>((c, part) => c?.commands.find((x) => x.name() === part), program);
    const wrong = commands.filter((c) => c.example.includes('--json') && !find(c.name)?.options.some((o) => o.long === '--json'));
    expect(wrong.map((c) => c.name)).toEqual([]);
  });
});
