import type { Command } from 'commander';
import { catalog } from './i18n.js';
import { WORKFLOW_IDS, loadWorkflow } from '../integrations/assets.js';

export const HUMAN_COMMANDS = [
  'approve', 'reject', 'rework', 'waive', 'tests unlock', 'track set',
  'backlog move', 'backlog drop', 'license set', 'roles migrate', 'takeover', 'release-control',
  // Removing the harness switches the guard off: a person's decision (B41).
  'uninstall',
  // What a role of the agent team says is a person's decision (B72).
  'team accept',
  // An answer to an open question is a person's decision (B62).
  'answer',
] as const;

const EXAMPLES: Record<string, string> = {
  approve: 'sdlc approve plan --change add-export',
  reject: 'sdlc reject plan --change add-export --note "Revise scope"',
  rework: 'sdlc rework spec --change add-export --reason missing-requirement --note "No empty-name case"',
  waive: 'sdlc waive spec --change docs-only --note "No behavior change"',
  'tests unlock': 'sdlc tests unlock --change fix-login',
  'track set': 'sdlc track set lite --change docs-only',
  'backlog move': 'sdlc backlog move B2 --top',
  'backlog drop': 'sdlc backlog drop B2 --note "No longer needed"',
  'license set': 'sdlc license set community',
  'roles migrate': 'sdlc roles migrate',
  takeover: 'sdlc takeover --change add-export --note "I will fix the migration myself" --json',
  'release-control': 'sdlc release-control --change add-export --note "Migration fixed, carry on" --json',
  uninstall: 'sdlc uninstall --dry-run',
  adopt: 'sdlc adopt --json',
  'adopt --apply': 'sdlc adopt --apply',
  'review suggest': 'sdlc review suggest --change add-export',
  'backlog epic add': 'sdlc backlog epic add "Checkout" --goal "Customers pay without calling support" --json',
  'backlog epic edit': 'sdlc backlog epic edit E1 --title "0.8.0 Checkout" --json',
  'defer add': 'sdlc defer add "Retry failed payments" --why "Out of scope for this change" --json',
  'defer close': 'sdlc defer close D1 --status done --note "Fixed in add-retries" --json',
  'import bmad': 'sdlc import bmad _bmad-output/epic-1 --to-backlog --dry-run --json',
  explore: 'sdlc explore checkout-flow --json',
  trace: 'sdlc trace add-export --json',
  health: 'sdlc health --json',
  changelog: 'sdlc changelog --change add-export',
  explain: 'sdlc explain --change add-export --json',
  archive: 'sdlc archive add-export --yes --json',
  openspec: 'sdlc openspec list --specs',
  'mcp serve': 'sdlc mcp serve --project ../claims --project ../billing',
  'mcp check': 'sdlc mcp check --json',
  'release check': 'sdlc release check --change add-export --json',
  'inbox list': 'sdlc inbox list --json',
  'inbox done': 'sdlc inbox done 20261006T184222020Z-ci-green-3f9a1c --json',
  guide: 'sdlc guide denials#plan-gate --json',
  'team sync': 'sdlc team sync --json',
  'team accept': 'sdlc team accept tester',
  answer: 'sdlc answer 1 --change add-export --text "Cashiers at the till"',
  'team list': 'sdlc team list --json',
  'team check': 'sdlc team check --json',
};

/** A real value per argument name, so a generated example can be run as it is. */
const ARGUMENT_EXAMPLES: Record<string, string> = {
  gate: 'review', id: 'add-export', change: 'add-export', name: 'add-export', title: '"Show order status"',
  'B-id': 'B1', 'D-id': 'D1', path: '_bmad-output/epic-1', slug: 'checkout-flow', topic: 'backlog',
  track: 'lite', artifact: 'plan', type: 'bmad', dir: 'plugin', event: 'session-start', args: 'list',
};
/** Commands whose `<action>` argument takes one of several words. */
const ACTION_EXAMPLES: Record<string, string> = { tests: 'lock', review: 'context' };

function generatedExample(command: Command, name: string): string {
  const value = (arg: string) => (arg === 'action' && ACTION_EXAMPLES[name]) || ARGUMENT_EXAMPLES[arg];
  const args = command.registeredArguments.filter((arg) => arg.required).map((arg) => value(arg.name()));
  const options = command.options.filter((option) => option.mandatory)
    .map((option) => `${option.long} ${ARGUMENT_EXAMPLES[option.attributeName()] ?? ARGUMENT_EXAMPLES.id}`);
  const json = command.options.some((option) => option.long === '--json') ? ['--json'] : [];
  return ['sdlc', name, ...args, ...options, ...json].join(' ');
}

export interface CatalogCommand {
  name: string;
  usage: string;
  description: string;
  actor: 'human' | 'any';
  example: string;
}

function describe(command: Command, name: string): CatalogCommand {
  const args = command.registeredArguments.map((arg) => arg.required ? `<${arg.name()}>` : `[${arg.name()}]`);
  const required = command.options.filter((option) => option.mandatory).map((option) => option.flags.split(', ').at(-1));
  const usage = `sdlc ${name}${args.length ? ` ${args.join(' ')}` : ''}${required.length ? ` ${required.join(' ')}` : ''}`;
  const key = `cmd.${name.replace(/ /g, '.')}`;
  return {
    name,
    usage,
    description: catalog('en')[key] ?? command.description(),
    actor: (HUMAN_COMMANDS as readonly string[]).includes(name) ? 'human' : 'any',
    example: EXAMPLES[name] ?? generatedExample(command, name),
  };
}

function entries(command: Command, prefix = ''): CatalogCommand[] {
  return command.commands.flatMap((child) => {
    const name = `${prefix} ${child.name()}`.trim();
    const actionable = child as Command & { _actionHandler?: (...args: unknown[]) => unknown };
    return [...(actionable._actionHandler ? [describe(child, name)] : []), ...entries(child, name)];
  });
}

/** Human-only forms of commands any actor may run otherwise: name -> usage. */
const ACTION_VARIANTS: Record<string, string> = {
  'tests unlock': 'sdlc tests unlock --change <id>',
  'license set': 'sdlc license set <community|commercial> [--agreement <id>] [--licensee <name>]',
  'adopt --apply': 'sdlc adopt --apply',
};

/** Read-only actions any actor may run, listed on their own so an agent finds them: name -> usage. */
const ANY_ACTIONS: Record<string, string> = {
  'review suggest': 'sdlc review suggest --change <id> [--base <ref>] [--json]',
};

function actionVariants(commands: CatalogCommand[]): CatalogCommand[] {
  const variants = [
    ...Object.entries(ACTION_VARIANTS).map(([name, usage]) => ({ name, usage, actor: 'human' as const })),
    ...Object.entries(ANY_ACTIONS).map(([name, usage]) => ({ name, usage, actor: 'any' as const })),
  ];
  return variants.map(({ name, usage, actor }) => {
    const parent = commands.find((item) => item.name === name.split(' ')[0])!;
    const description = catalog('en')[`cmd.${name.replace(/ /g, '.')}`] ?? parent.description;
    return { ...parent, name, usage, description, actor, example: EXAMPLES[name] };
  });
}

export function helpCatalog(program: Command) {
  const workflows = WORKFLOW_IDS.map((id) => {
    const template = loadWorkflow(id);
    return { id, title: template.title, description: template.description,
      invocation: { claude: `/sdlc:${id}`, opencode: `/sdlc-${id}` } };
  });
  const commands = entries(program);
  return { workflows, commands: [...commands, ...actionVariants(commands)] };
}
