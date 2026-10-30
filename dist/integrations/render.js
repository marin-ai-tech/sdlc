import { readAsset } from './assets.js';
/** A Codex surface: a workflow is the skill `$sdlc-<id>`, and no command output is injected into the prompt. */
function isCodex(surface) {
    return surface.startsWith('codex-');
}
/** Cursor's commands and skills cannot inject a command's output into the prompt (`!\`cmd\``). */
function isCursor(surface) {
    return surface.startsWith('cursor-');
}
/**
 * Slash-command spelling per surface. `/sdlc-<id>` works in both tools
 * (a Claude skill named `sdlc-<id>`; an OpenCode command of the same name),
 * so shared skill bodies always use it.
 */
export function commandRef(id, surface) {
    if (surface === 'claude-command' || surface === 'plugin-skill')
        return `\`/sdlc:${id}\``;
    if (isCodex(surface))
        return `\`$sdlc-${id}\``;
    return `\`/sdlc-${id}\``;
}
const CURSOR_PLAN_MODE = 'In Cursor, prefer Plan mode: explore read-only and present the plan for acceptance '
    + 'before writing plan.md. Otherwise edit only plan.md and tasks.md in this workflow.';
const CODEX_PLAN_MODE = 'In Codex, explore read-only first (or use /plan) and present the plan for acceptance '
    + 'before writing plan.md. Otherwise edit only plan.md and tasks.md in this workflow.';
const PLAN_MODE = {
    'skill': 'In Claude Code, prefer plan mode: explore read-only and present the plan for acceptance before writing plan.md. In OpenCode, use the plan agent or stay read-only until plan.md is written.',
    'plugin-skill': 'If the session is in plan mode, explore read-only and present the plan for acceptance first; write plan.md and tasks.md once it is accepted. Otherwise edit only those two files.',
    'claude-command': 'If the session is in plan mode, explore read-only and present the plan for acceptance first; write plan.md and tasks.md once it is accepted. Otherwise edit only those two files.',
    'opencode-command': 'Use the plan agent for exploration (or stay read-only); write only plan.md and tasks.md in this workflow.',
    'claude-agent': '',
    'opencode-agent': '',
    'cursor-skill': CURSOR_PLAN_MODE,
    'cursor-command': CURSOR_PLAN_MODE,
    'cursor-agent': '',
    'codex-skill': CODEX_PLAN_MODE,
    'codex-agent': '',
    'qwen-skill': 'In Qwen Code, explore read-only and present the plan for acceptance before writing plan.md. '
        + 'Otherwise edit only plan.md and tasks.md in this workflow.',
    'qwen-command': 'In Qwen Code, explore read-only and present the plan for acceptance before writing plan.md. '
        + 'Otherwise edit only plan.md and tasks.md in this workflow.',
    'qwen-agent': '',
};
const ASK = {
    skill: 'the AskUserQuestion tool in Claude Code or the `question` tool in OpenCode',
    'plugin-skill': 'the AskUserQuestion tool',
    'claude-command': 'the AskUserQuestion tool',
    'opencode-command': 'the `question` tool',
    'claude-agent': 'ask the user, offering choices',
    'opencode-agent': 'ask the user, offering choices',
    'cursor-skill': 'a question to the user in the chat, offering numbered choices',
    'cursor-command': 'a question to the user in the chat, offering numbered choices',
    'cursor-agent': 'ask the user, offering choices',
    'codex-skill': 'a question to the user in the chat, offering numbered choices',
    'codex-agent': 'ask the user, offering choices',
    'qwen-skill': 'ask the user, offering choices',
    'qwen-command': 'ask the user, offering choices',
    'qwen-agent': 'ask the user, offering choices',
};
const TODO = {
    skill: 'TodoWrite in Claude Code or `todowrite` in OpenCode',
    'plugin-skill': 'TodoWrite',
    'claude-command': 'TodoWrite',
    'opencode-command': '`todowrite`',
    'claude-agent': 'a task list',
    'opencode-agent': 'a task list',
    'cursor-skill': "the agent's to-do list",
    'cursor-command': "the agent's to-do list",
    'cursor-agent': 'a task list',
    'codex-skill': 'the plan tool (update_plan)',
    'codex-agent': 'a task list',
    'qwen-skill': 'the todo_write tool',
    'qwen-command': 'the todo_write tool',
    'qwen-agent': 'a task list',
};
/** Rewrites `sdlc ` invocations to the configured CLI prefix (for `npx --no-install sdlc` pins). */
export function applyCliPrefix(text, cli) {
    if (cli === 'sdlc')
        return text;
    return text.replace(/(`|^|\s\$ |```bash\n)sdlc(?= [a-z-])/gm, (_m, lead) => `${lead}${cli}`);
}
/** How a body names any workflow: `/sdlc:<workflow>`, `/sdlc-<workflow>` or, in Codex, `$sdlc-<workflow>`. */
function workflowRef(surface) {
    if (surface === 'claude-command' || surface === 'plugin-skill')
        return '`/sdlc:<workflow>`';
    return isCodex(surface) ? '`$sdlc-<workflow>`' : '`/sdlc-<workflow>`';
}
export function renderBody(body, options) {
    const { surface } = options;
    const isCommand = surface === 'claude-command' || surface === 'opencode-command';
    const input = surface === 'cursor-command' || surface === 'qwen-command'
        ? 'the text after the command (a change id, or a description of the work)'
        : "the user's request (a change id, or a description of the work)";
    let out = body;
    if (out.includes('{{contract}}')) {
        out = out.replace('{{contract}}', readAsset('workflows', '_contract.md').trim());
    }
    out = out
        .replace(/\{\{input\}\}/g, isCommand ? '$ARGUMENTS' : input)
        .replace(/\{\{cmd:<workflow>\}\}/g, workflowRef(surface))
        .replace(/\{\{cmd:([a-z-]+)\}\}/g, (_m, id) => commandRef(id, surface))
        .replace(/\{\{skill:<workflow>\}\}/g, surface === 'plugin-skill' ? '`sdlc:<workflow>`' : '`sdlc-<workflow>`')
        .replace(/\{\{skill:([a-z-]+)\}\}/g, (_m, id) => (surface === 'plugin-skill' ? `\`sdlc:${id}\`` : `\`sdlc-${id}\``))
        .replace(/\{\{tool:ask\}\}/g, ASK[surface])
        .replace(/\{\{tool:todo\}\}/g, TODO[surface])
        .replace(/\{\{inject:([^}]+)\}\}/g, (_m, args) => {
        const command = `${options.cli} ${args}`;
        if (surface.endsWith('-agent') || isCursor(surface) || isCodex(surface)
            || surface.startsWith('qwen-'))
            return `Run \`${command}\`.`;
        return `!\`${command}\`\nIf the output above is missing, run \`${command}\`.`;
    })
        .replace(/\{\{plan-mode\}\}/g, PLAN_MODE[surface])
        .replace(/\{\{agent:([a-z-]+)\}\}/g, (_m, id) => options.agents?.[id] ?? `sdlc-${id}`);
    out = applyCliPrefix(out, options.cli);
    const leftover = out.match(/\{\{[^}]+\}\}/);
    if (leftover)
        throw new Error(`Unresolved template placeholder ${leftover[0]} for surface ${surface}`);
    return `${out.trimEnd()}\n`;
}
/**
 * Appends the generated-file notice (see `generatedNotice`) after the body of
 * a generated markdown file.
 */
export function appendNotice(content, notice) {
    return `${content.trimEnd()}\n\n${notice}\n`;
}
/** YAML scalar that is always safe in frontmatter (quotes when needed). */
export function yamlString(value) {
    if (/^[A-Za-z0-9][A-Za-z0-9 ,.()'/_-]*$/.test(value) && !/:\s/.test(value) && !value.endsWith(':'))
        return value;
    return JSON.stringify(value);
}
