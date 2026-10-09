import { buildProgram } from '../cli/index.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { helpCatalog, type CatalogCommand } from '../core/help-catalog.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';
import { loadConfig, type SdlcConfig } from '../core/config.js';
import { findProjectRoot, projectPaths } from '../core/project.js';
import { DEFAULT_TOOLS, TOOL_IDS, type ToolId } from '../integrations/types.js';

function cmdKey(name: string): string {
  return `cmd.${name.replace(/ /g, '.')}`;
}

function localizedDescription(item: CatalogCommand): string {
  return t(cmdKey(item.name));
}

function printCommands(title: string, commands: CatalogCommand[]): void {
  line(`\n${title}`);
  const width = Math.max(...commands.map((item) => item.usage.length), 0);
  for (const item of commands) {
    line(`  ${item.usage.padEnd(width)}  ${localizedDescription(item)}`);
  }
}

function displayedTools(config: SdlcConfig | undefined): ToolId[] {
  const configured = config?.tools.filter(
    (tool): tool is ToolId => (TOOL_IDS as readonly string[]).includes(tool),
  ) ?? [];
  return configured.length > 0 ? configured : [...DEFAULT_TOOLS];
}

function workflowInvocations(
  workflow: ReturnType<typeof helpCatalog>['workflows'][number],
  tools: ToolId[],
): string {
  return tools.map((tool) => workflow.invocation[tool]).join(' · ');
}

function printWorkflows(workflows: ReturnType<typeof helpCatalog>['workflows'], tools: ToolId[]): void {
  line(t('help.workflows'));
  const titles = workflows.map((item) => t(`workflow.${item.id}.title`));
  const width = Math.max(...titles.map((title) => title.length), 0);
  const invocations = workflows.map((item) => workflowInvocations(item, tools));
  const invocationWidth = Math.max(...invocations.map((item) => item.length), 0);
  for (const [index, item] of workflows.entries()) {
    const title = titles[index];
    const description = t(`workflow.${item.id}.description`);
    line(`  ${title.padEnd(width)}  ${invocations[index].padEnd(invocationWidth)}  ${description}`);
  }
}

function printTopic(
  workflow: ReturnType<typeof helpCatalog>['workflows'][number] | undefined,
  command: CatalogCommand | undefined,
  tools: ToolId[],
): boolean {
  if (workflow) {
    line(`${t(`workflow.${workflow.id}.title`)}\n${t(`workflow.${workflow.id}.description`)}`);
    line(workflowInvocations(workflow, tools));
    line(t('help.whoRunsAgent'));
    line(t('help.example', { example: workflow.invocation[tools[0]] }));
    return true;
  }
  if (!command) return false;
  line(`${command.usage}\n${localizedDescription(command)}`);
  const who = command.actor === 'human' ? t('help.whoRunsPerson') : t('help.whoRunsAny');
  line(who);
  line(t('help.example', { example: command.example }));
  return true;
}

/** The project's configuration, if help runs inside a project whose sdlc.yaml loads; help never fails on it. */
function projectConfig(): SdlcConfig | undefined {
  const root = findProjectRoot();
  if (!root) return undefined;
  try {
    return loadConfig(projectPaths(root).sdlcConfig);
  } catch {
    return undefined;
  }
}

export function helpCommand(topic: string | undefined, opts: { json?: boolean }): void {
  try {
    const config = projectConfig();
    const catalog = helpCatalog(buildProgram(), config);
    const tools = displayedTools(config);
    const workflow = catalog.workflows.find((item) => item.id === topic);
    const command = catalog.commands.find((item) => item.name === topic);
    if (topic && !workflow && !command) {
      const topics = [...catalog.workflows.map((item) => item.id), ...catalog.commands.map((item) => item.name)];
      throw new SdlcError(
        'unknown_topic',
        { key: 'error.unknown_topic_x_topics_x', params: { topic: topic, p2: topics.join(', ') } }
      );
    }
    if (opts.json) {
      printJson(topic ? workflow ?? command : catalog);
      return;
    }
    if (printTopic(workflow, command, tools)) return;
    printWorkflows(catalog.workflows, tools);
    printCommands(t('help.commandsEveryone'), catalog.commands.filter((entry) => entry.actor === 'any'));
    printCommands(t('help.commandsPeople'), catalog.commands.filter((entry) => entry.actor === 'human'));
    line(`\n${t('help.details')}`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
