import { buildProgram } from '../cli/index.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { helpCatalog, type CatalogCommand } from '../core/help-catalog.js';
import { SdlcError } from '../core/errors.js';

function printCommands(title: string, commands: CatalogCommand[]): void {
  line(`\n${title}`);
  const width = Math.max(...commands.map((item) => item.usage.length), 0);
  for (const item of commands) line(`  ${item.usage.padEnd(width)}  ${item.description}`);
}

function printWorkflows(workflows: ReturnType<typeof helpCatalog>['workflows']): void {
  line('Workflows');
  const width = Math.max(...workflows.map((item) => item.title.length), 0);
  const invocations = workflows.map((item) => `${item.invocation.claude} · ${item.invocation.opencode}`);
  const invocationWidth = Math.max(...invocations.map((item) => item.length), 0);
  for (const [index, item] of workflows.entries()) {
    line(`  ${item.title.padEnd(width)}  ${invocations[index].padEnd(invocationWidth)}  ${item.description}`);
  }
}

function printTopic(workflow: ReturnType<typeof helpCatalog>['workflows'][number] | undefined,
  command: CatalogCommand | undefined): boolean {
  if (workflow) {
    line(`${workflow.title}\n${workflow.description}`);
    line(`Claude Code: ${workflow.invocation.claude} | OpenCode: ${workflow.invocation.opencode}`);
    line('Who runs it: agent');
    line(`Example: ${workflow.invocation.claude}`);
    return true;
  }
  if (!command) return false;
  line(`${command.usage}\n${command.description}`);
  line(`Who runs it: ${command.actor === 'human' ? 'person' : 'agent or person'}`);
  line(`Example: ${command.example}`);
  return true;
}

export function helpCommand(topic: string | undefined, opts: { json?: boolean }): void {
  try {
    const catalog = helpCatalog(buildProgram());
    const workflow = catalog.workflows.find((item) => item.id === topic);
    const command = catalog.commands.find((item) => item.name === topic);
    if (topic && !workflow && !command) {
      const topics = [...catalog.workflows.map((item) => item.id), ...catalog.commands.map((item) => item.name)];
      throw new SdlcError('unknown_topic', `Unknown topic: ${topic}. Topics: ${topics.join(', ')}`);
    }
    if (opts.json) {
      printJson(topic ? workflow ?? command : catalog);
      return;
    }
    if (printTopic(workflow, command)) return;
    printWorkflows(catalog.workflows);
    printCommands('Commands for everyone', catalog.commands.filter((entry) => entry.actor === 'any'));
    printCommands('Decisions made by people (in their own terminal)',
      catalog.commands.filter((entry) => entry.actor === 'human'));
    line('\nDetails: sdlc help <command or workflow>');
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
