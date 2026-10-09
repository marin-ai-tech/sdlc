import { buildProgram } from '../cli/index.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { helpCatalog } from '../core/help-catalog.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';
function cmdKey(name) {
    return `cmd.${name.replace(/ /g, '.')}`;
}
function localizedDescription(item) {
    return t(cmdKey(item.name));
}
function printCommands(title, commands) {
    line(`\n${title}`);
    const width = Math.max(...commands.map((item) => item.usage.length), 0);
    for (const item of commands) {
        line(`  ${item.usage.padEnd(width)}  ${localizedDescription(item)}`);
    }
}
function printWorkflows(workflows) {
    line(t('help.workflows'));
    const titles = workflows.map((item) => t(`workflow.${item.id}.title`));
    const width = Math.max(...titles.map((title) => title.length), 0);
    const invocations = workflows.map((item) => `${item.invocation.claude} · ${item.invocation.opencode}`);
    const invocationWidth = Math.max(...invocations.map((item) => item.length), 0);
    for (const [index, item] of workflows.entries()) {
        const title = titles[index];
        const description = t(`workflow.${item.id}.description`);
        line(`  ${title.padEnd(width)}  ${invocations[index].padEnd(invocationWidth)}  ${description}`);
    }
}
function printTopic(workflow, command) {
    if (workflow) {
        line(`${t(`workflow.${workflow.id}.title`)}\n${t(`workflow.${workflow.id}.description`)}`);
        line(t('help.claudeCode', {
            claude: workflow.invocation.claude,
            opencode: workflow.invocation.opencode,
        }));
        line(t('help.whoRunsAgent'));
        line(t('help.example', { example: workflow.invocation.claude }));
        return true;
    }
    if (!command)
        return false;
    line(`${command.usage}\n${localizedDescription(command)}`);
    const who = command.actor === 'human' ? t('help.whoRunsPerson') : t('help.whoRunsAny');
    line(who);
    line(t('help.example', { example: command.example }));
    return true;
}
export function helpCommand(topic, opts) {
    try {
        const catalog = helpCatalog(buildProgram());
        const workflow = catalog.workflows.find((item) => item.id === topic);
        const command = catalog.commands.find((item) => item.name === topic);
        if (topic && !workflow && !command) {
            const topics = [...catalog.workflows.map((item) => item.id), ...catalog.commands.map((item) => item.name)];
            throw new SdlcError('unknown_topic', { key: 'error.unknown_topic_x_topics_x', params: { topic: topic, p2: topics.join(', ') } });
        }
        if (opts.json) {
            printJson(topic ? workflow ?? command : catalog);
            return;
        }
        if (printTopic(workflow, command))
            return;
        printWorkflows(catalog.workflows);
        printCommands(t('help.commandsEveryone'), catalog.commands.filter((entry) => entry.actor === 'any'));
        printCommands(t('help.commandsPeople'), catalog.commands.filter((entry) => entry.actor === 'human'));
        line(`\n${t('help.details')}`);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
