import { readAsset } from './assets.js';

/**
 * Where a rendered body will live. Skills are shared (OpenCode also reads
 * `.claude/skills/`), so a skill body only uses references that work in both
 * tools; command bodies can use the slash syntax of their own tool.
 */
export type Surface = 'skill' | 'plugin-skill' | 'claude-command' | 'opencode-command' | 'claude-agent'
  | 'opencode-agent' | CursorSurface | CodexSurface;

/** Cursor (B80, 0.13.0): its own skills, commands and subagents under `.cursor/`. */
export type CursorSurface = 'cursor-skill' | 'cursor-command' | 'cursor-agent';

/** Codex CLI (B82, 0.14.0): skills under `.agents/skills/` (its commands) and subagents under `.codex/agents/`. */
export type CodexSurface = 'codex-skill' | 'codex-agent';

/** A Codex surface: a workflow is the skill `$sdlc-<id>`, and no command output is injected into the prompt. */
function isCodex(surface: Surface): surface is CodexSurface {
  return surface.startsWith('codex-');
}

/** Cursor's commands and skills cannot inject a command's output into the prompt (`!\`cmd\``). */
function isCursor(surface: Surface): surface is CursorSurface {
  return surface.startsWith('cursor-');
}

export interface RenderOptions {
  surface: Surface;
  /** How agents invoke the harness CLI (`sdlc`, `npx --no-install sdlc`, ...). */
  cli: string;
  /** Built-in agent id -> the subagent named instead by `{{agent:<id>}}` (an accepted role, B70); else `sdlc-<id>`. */
  agents?: Record<string, string>;
}

/**
 * Slash-command spelling per surface. `/sdlc-<id>` works in both tools
 * (a Claude skill named `sdlc-<id>`; an OpenCode command of the same name),
 * so shared skill bodies always use it.
 */
export function commandRef(id: string, surface: Surface): string {
  if (surface === 'claude-command' || surface === 'plugin-skill') return `\`/sdlc:${id}\``;
  if (isCodex(surface)) return `\`$sdlc-${id}\``;
  return `\`/sdlc-${id}\``;
}

const CURSOR_PLAN_MODE = 'In Cursor, prefer Plan mode: explore read-only and present the plan for acceptance '
  + 'before writing plan.md. Otherwise edit only plan.md and tasks.md in this workflow.';

const CODEX_PLAN_MODE = 'In Codex, explore read-only first (or use /plan) and present the plan for acceptance '
  + 'before writing plan.md. Otherwise edit only plan.md and tasks.md in this workflow.';

const PLAN_MODE: Record<Surface, string> = {
  'skill':
    'In Claude Code, prefer plan mode: explore read-only and present the plan for acceptance before writing plan.md. In OpenCode, use the plan agent or stay read-only until plan.md is written.',
  'plugin-skill':
    'If the session is in plan mode, explore read-only and present the plan for acceptance first; write plan.md and tasks.md once it is accepted. Otherwise edit only those two files.',
  'claude-command':
    'If the session is in plan mode, explore read-only and present the plan for acceptance first; write plan.md and tasks.md once it is accepted. Otherwise edit only those two files.',
  'opencode-command':
    'Use the plan agent for exploration (or stay read-only); write only plan.md and tasks.md in this workflow.',
  'claude-agent': '',
  'opencode-agent': '',
  'cursor-skill': CURSOR_PLAN_MODE,
  'cursor-command': CURSOR_PLAN_MODE,
  'cursor-agent': '',
  'codex-skill': CODEX_PLAN_MODE,
  'codex-agent': '',
};

const ASK: Record<Surface, string> = {
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
};

const TODO: Record<Surface, string> = {
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
};

/** Rewrites `sdlc ` invocations to the configured CLI prefix (for `npx --no-install sdlc` pins). */
export function applyCliPrefix(text: string, cli: string): string {
  if (cli === 'sdlc') return text;
  return text.replace(/(`|^|\s\$ |```bash\n)sdlc(?= [a-z-])/gm, (_m, lead: string) => `${lead}${cli}`);
}

/** How a body names any workflow: `/sdlc:<workflow>`, `/sdlc-<workflow>` or, in Codex, `$sdlc-<workflow>`. */
function workflowRef(surface: Surface): string {
  if (surface === 'claude-command' || surface === 'plugin-skill') return '`/sdlc:<workflow>`';
  return isCodex(surface) ? '`$sdlc-<workflow>`' : '`/sdlc-<workflow>`';
}

export function renderBody(body: string, options: RenderOptions): string {
  const { surface } = options;
  const isCommand = surface === 'claude-command' || surface === 'opencode-command';
  const input = surface === 'cursor-command'
    ? 'the text after the command (a change id, or a description of the work)'
    : "the user's request (a change id, or a description of the work)";
  let out = body;
  if (out.includes('{{contract}}')) {
    out = out.replace('{{contract}}', readAsset('workflows', '_contract.md').trim());
  }
  out = out
    .replace(/\{\{input\}\}/g, isCommand ? '$ARGUMENTS' : input)
    .replace(/\{\{cmd:<workflow>\}\}/g, workflowRef(surface))
    .replace(/\{\{cmd:([a-z-]+)\}\}/g, (_m, id: string) => commandRef(id, surface))
    .replace(/\{\{skill:<workflow>\}\}/g, surface === 'plugin-skill' ? '`sdlc:<workflow>`' : '`sdlc-<workflow>`')
    .replace(/\{\{skill:([a-z-]+)\}\}/g, (_m, id: string) => (surface === 'plugin-skill' ? `\`sdlc:${id}\`` : `\`sdlc-${id}\``))
    .replace(/\{\{tool:ask\}\}/g, ASK[surface])
    .replace(/\{\{tool:todo\}\}/g, TODO[surface])
    .replace(/\{\{inject:([^}]+)\}\}/g, (_m, args: string) => {
      const command = `${options.cli} ${args}`;
      if (surface.endsWith('-agent') || isCursor(surface) || isCodex(surface)) return `Run \`${command}\`.`;
      return `!\`${command}\`\nIf the output above is missing, run \`${command}\`.`;
    })
    .replace(/\{\{plan-mode\}\}/g, PLAN_MODE[surface])
    .replace(/\{\{agent:([a-z-]+)\}\}/g, (_m, id: string) => options.agents?.[id] ?? `sdlc-${id}`);
  out = applyCliPrefix(out, options.cli);
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) throw new Error(`Unresolved template placeholder ${leftover[0]} for surface ${surface}`);
  return `${out.trimEnd()}\n`;
}

/**
 * Appends the generated-file notice (see `generatedNotice`) after the body of
 * a generated markdown file.
 */
export function appendNotice(content: string, notice: string): string {
  return `${content.trimEnd()}\n\n${notice}\n`;
}

/** YAML scalar that is always safe in frontmatter (quotes when needed). */
export function yamlString(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9 ,.()'/_-]*$/.test(value) && !/:\s/.test(value) && !value.endsWith(':')) return value;
  return JSON.stringify(value);
}
