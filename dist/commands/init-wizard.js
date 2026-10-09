import { detectDependencies, installCommand, } from '../core/dependencies.js';
import { loadConfig } from '../core/config.js';
import { isFile } from '../core/fs-utils.js';
import { projectPaths } from '../core/project.js';
import { ADAPTERS } from '../integrations/install.js';
import { DEFAULT_TOOLS, TOOL_IDS } from '../integrations/types.js';
import { t } from '../core/i18n.js';
import { askLayoutChoices, layoutSummaryLines } from './init-layout.js';
function modeChoiceList() {
    return [
        { value: 'off', name: t('init.mode.off') },
        { value: 'warn', name: t('init.mode.warn') },
        { value: 'block', name: t('init.mode.block') },
    ];
}
const STARTER_ROLE_IDS = [
    'product-owner',
    'engineer',
    'tech-lead',
    'code-owner',
    'release-manager',
    'maintainer',
];
function welcomeText() {
    return t('init.welcome');
}
function isExitPrompt(error) {
    if (!(error instanceof Error))
        return false;
    return error.name === 'ExitPromptError' || /force closed the prompt/i.test(error.message);
}
export function shouldPrompt(opts, io) {
    if (!io.stdinTTY || !io.stdoutTTY)
        return false;
    if (io.agent)
        return false;
    if (opts.tools !== undefined)
        return false;
    if (opts.delivery !== undefined)
        return false;
    if (opts.cli !== undefined)
        return false;
    if (opts.mode !== undefined)
        return false;
    if (opts.hooks === false)
        return false;
    if (opts.opsx)
        return false;
    if (opts.statusline)
        return false;
    if (opts.language !== undefined)
        return false;
    if (opts.force)
        return false;
    if (opts.json)
        return false;
    if (opts.layout !== undefined || opts.worktree !== undefined || opts.gitInit)
        return false;
    if (opts.mcp)
        return false;
    return true;
}
function toolChoices(defaults) {
    return TOOL_IDS.map((id) => ({
        value: id,
        name: ADAPTERS[id].name,
        checked: defaults.tools.includes(id),
    }));
}
function modeChoices(defaults) {
    const all = modeChoiceList();
    const rest = all.filter((c) => c.value !== defaults.mode);
    const first = all.find((c) => c.value === defaults.mode) ?? all[1];
    return [first, ...rest];
}
function formatSummary(choices) {
    const tools = choices.tools.length > 0
        ? choices.tools.map((tool) => ADAPTERS[tool].name).join(', ')
        : t('init.none');
    const language = choices.language || t('init.languageDefault');
    const install = choices.install.length > 0
        ? choices.install.map((id) => installCommand(id).join(' ')).join('; ')
        : t('init.none');
    const yn = (value) => (value ? t('init.yes') : t('init.no'));
    return [
        t('init.summary'),
        t('init.summary.tools', { value: tools }),
        t('init.summary.mode', { value: choices.mode }),
        t('init.summary.statusline', { value: yn(choices.statusline) }),
        t('init.summary.opsx', { value: yn(choices.opsx) }),
        t('init.summary.language', { value: language }),
        t('init.summary.roles', { value: yn(choices.roles) }),
        t('init.summary.install', { value: install }),
        t('init.summary.index', { value: yn(choices.index) }),
        ...(choices.mcp === undefined ? [] : [t('init.summary.mcp', { value: yn(choices.mcp) })]),
        ...layoutSummaryLines(choices),
    ].join('\n');
}
/** The MCP question (default: the current setting), asked only when the defaults carry one. */
async function askMcp(prompter, defaults) {
    if (defaults.mcp === undefined)
        return {};
    return { mcp: await prompter.confirm(t('init.mcp'), defaults.mcp) };
}
async function askDependencyChoices(prompter, defaults) {
    const install = [];
    let index = false;
    const deps = defaults.dependencies;
    if (!deps)
        return { install, index };
    for (const dep of deps) {
        if (dep.found)
            continue;
        const message = t('init.installDep', { name: dep.name, command: dep.install.join(' ') });
        if (await prompter.confirm(message, true))
            install.push(dep.id);
    }
    const codegraph = deps.find((d) => d.id === 'codegraph');
    const hasCodegraph = Boolean(codegraph?.found) || install.includes('codegraph');
    const notIndexed = codegraph ? !codegraph.indexed : true;
    if (hasCodegraph && notIndexed) {
        index = await prompter.confirm(t('init.indexCodegraph'), false);
    }
    return { install, index };
}
export async function askInitChoices(prompter, defaults) {
    try {
        prompter.say(welcomeText());
        const layout = defaults.folder ? await askLayoutChoices(prompter, defaults.folder) : {};
        const tools = await prompter.checkbox(t('init.tools'), toolChoices(defaults));
        const depChoices = await askDependencyChoices(prompter, defaults);
        const mode = await prompter.select(t('init.mode'), modeChoices(defaults), defaults.mode);
        let statusline = false;
        if (tools.includes('claude')) {
            statusline = await prompter.confirm(t('init.statusline'), defaults.statusline);
        }
        const opsx = await prompter.confirm(t('init.opsx'), defaults.opsx);
        const language = await prompter.input(t('init.language'), defaults.language);
        const roles = await prompter.confirm(t('init.roles'), false);
        const choices = {
            tools,
            mode,
            statusline,
            opsx,
            language: language.trim(),
            roles,
            install: depChoices.install,
            index: depChoices.index,
            ...layout,
            ...(await askMcp(prompter, defaults)),
        };
        prompter.say(formatSummary(choices));
        const ok = await prompter.confirm(t('init.write'), true);
        return ok ? choices : undefined;
    }
    catch (error) {
        if (isExitPrompt(error))
            return undefined;
        throw error;
    }
}
export function initDefaults(root, detected, probe) {
    const paths = projectPaths(root);
    let base;
    if (isFile(paths.sdlcConfig)) {
        const config = loadConfig(paths.sdlcConfig);
        const tools = config.tools.filter((t) => t in ADAPTERS);
        base = {
            tools,
            mode: config.enforcement.mode,
            statusline: config.statusline,
            opsx: false,
            language: '',
            mcp: config.mcp?.serve ?? false,
        };
    }
    else {
        base = {
            tools: detected.length > 0 ? detected : [...DEFAULT_TOOLS],
            mode: 'warn',
            statusline: false,
            opsx: false,
            language: '',
            mcp: false,
        };
    }
    if (probe)
        base.dependencies = detectDependencies(root, probe);
    return base;
}
function personId(identity) {
    if (identity.email) {
        const local = identity.email.split('@')[0].trim().toLowerCase();
        const cleaned = local.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        if (cleaned)
            return cleaned;
    }
    if (identity.name) {
        const cleaned = identity.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        if (cleaned)
            return cleaned;
    }
    return 'owner';
}
export function starterRoles(identity) {
    const id = personId(identity);
    const name = identity.name?.trim() || identity.email || 'Owner';
    const email = identity.email?.trim().toLowerCase() || 'owner@example.com';
    const roleLines = STARTER_ROLE_IDS.map((role) => `  ${role}: [${id}]`).join('\n');
    return [
        'version: 1',
        'signing: off',
        'people:',
        `  ${id}:`,
        // JSON strings are valid YAML scalars: a name with ':' or '#' stays a name.
        `    name: ${JSON.stringify(name)}`,
        `    emails: [${JSON.stringify(email)}]`,
        'roles:',
        roleLines,
        'separation:',
        '  # Add people and turn separation back on; one person cannot pass',
        '  # author_cannot_approve on their own code.',
        '  author_cannot_approve: []',
        '  distinct_approvers: []',
        '  max_gates_per_person: 0',
        '',
    ].join('\n');
}
/**
 * The real prompter (@inquirer/prompts). Loaded lazily: every CLI call, including the hook that runs on each
 * agent tool call, imports this module, and only an interactive init needs the prompt library.
 */
function promptNavHints(kind) {
    const text = t(kind === 'checkbox' ? 'init.prompt.checkboxHint' : 'init.prompt.selectHint');
    return {
        instructions: text,
        theme: { style: { keysHelpTip: () => text } },
    };
}
export function terminalPrompter() {
    const prompts = () => import('@inquirer/prompts');
    return {
        async checkbox(message, choices) {
            const hints = promptNavHints('checkbox');
            return (await prompts()).checkbox({ message, choices, ...hints });
        },
        async select(message, choices, initial) {
            const hints = promptNavHints('select');
            return (await prompts()).select({
                message, choices, default: initial, ...hints,
            });
        },
        async confirm(message, initial) {
            return (await prompts()).confirm({ message, default: initial });
        },
        async input(message, initial) {
            return (await prompts()).input({ message, default: initial });
        },
        say(text) {
            console.log(text);
        },
    };
}
