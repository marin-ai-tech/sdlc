import type { Command } from 'commander';
import { WORKFLOW_IDS, loadWorkflow } from '../integrations/assets.js';

export const HUMAN_COMMANDS = [
  'approve', 'reject', 'waive', 'tests unlock', 'track set',
  'backlog move', 'backlog drop', 'license set', 'roles migrate',
] as const;

const EXAMPLES: Record<string, string> = {
  approve: 'sdlc approve plan --change add-export',
  reject: 'sdlc reject plan --change add-export --note "Revise scope"',
  waive: 'sdlc waive spec --change docs-only --note "No behavior change"',
  'tests unlock': 'sdlc tests unlock --change fix-login',
  'track set': 'sdlc track set lite --change docs-only',
  'backlog move': 'sdlc backlog move B2 --top',
  'backlog drop': 'sdlc backlog drop B2 --note "No longer needed"',
  'license set': 'sdlc license set community',
  'roles migrate': 'sdlc roles migrate',
};

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
  return {
    name,
    usage,
    description: command.description(),
    actor: (HUMAN_COMMANDS as readonly string[]).includes(name) ? 'human' : 'any',
    example: EXAMPLES[name] ?? `${usage.replace(/<[^>]+>/g, 'example').replace(/\[[^\]]+\]/g, '')} --json`.trim(),
  };
}

function entries(command: Command, prefix = ''): CatalogCommand[] {
  return command.commands.flatMap((child) => {
    const name = `${prefix} ${child.name()}`.trim();
    const actionable = child as Command & { _actionHandler?: (...args: unknown[]) => unknown };
    return [...(actionable._actionHandler ? [describe(child, name)] : []), ...entries(child, name)];
  });
}

function actionVariants(commands: CatalogCommand[]): CatalogCommand[] {
  const variants = ['tests unlock', 'license set'];
  return variants.map((name) => {
    const parent = commands.find((item) => item.name === name.split(' ')[0])!;
    const usage = name === 'license set'
      ? 'sdlc license set <community|commercial> [--agreement <id>] [--licensee <name>]'
      : 'sdlc tests unlock --change <id>';
    return { ...parent, name, usage,
      actor: 'human', example: EXAMPLES[name] };
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
