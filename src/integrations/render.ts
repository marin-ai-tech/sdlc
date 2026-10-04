import { readAsset } from './assets.js';

/**
 * Where a rendered body will live. Skills are shared (OpenCode also reads
 * `.claude/skills/`), so a skill body only uses references that work in both
 * tools; command bodies can use the slash syntax of their own tool.
 */
export type Surface = 'skill' | 'plugin-skill' | 'claude-command' | 'opencode-command' | 'claude-agent' | 'opencode-agent';

export interface RenderOptions {
  surface: Surface;
  /** How agents invoke the harness CLI (`sdlc`, `npx --no-install sdlc`, ...). */
  cli: string;
}

/**
 * Slash-command spelling per surface. `/sdlc-<id>` works in both tools
 * (a Claude skill named `sdlc-<id>`; an OpenCode command of the same name),
 * so shared skill bodies always use it.
 */
export function commandRef(id: string, surface: Surface): string {
  if (surface === 'claude-command' || surface === 'plugin-skill') return `\`/sdlc:${id}\``;
  return `\`/sdlc-${id}\``;
}

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
};

const ASK: Record<Surface, string> = {
  skill: 'the AskUserQuestion tool in Claude Code or the `question` tool in OpenCode',
  'plugin-skill': 'the AskUserQuestion tool',
  'claude-command': 'the AskUserQuestion tool',
  'opencode-command': 'the `question` tool',
  'claude-agent': 'ask the user, offering choices',
  'opencode-agent': 'ask the user, offering choices',
};

const TODO: Record<Surface, string> = {
  skill: 'TodoWrite in Claude Code or `todowrite` in OpenCode',
  'plugin-skill': 'TodoWrite',
  'claude-command': 'TodoWrite',
  'opencode-command': '`todowrite`',
  'claude-agent': 'a task list',
  'opencode-agent': 'a task list',
};

/** Rewrites `sdlc ` invocations to the configured CLI prefix (for `npx --no-install sdlc` pins). */
export function applyCliPrefix(text: string, cli: string): string {
  if (cli === 'sdlc') return text;
  return text.replace(/(`|^|\s\$ |```bash\n)sdlc(?= [a-z-])/gm, (_m, lead: string) => `${lead}${cli}`);
}

export function renderBody(body: string, options: RenderOptions): string {
  const { surface } = options;
  const isCommand = surface === 'claude-command' || surface === 'opencode-command';
  let out = body;
  if (out.includes('{{contract}}')) {
    out = out.replace('{{contract}}', readAsset('workflows', '_contract.md').trim());
  }
  out = out
    .replace(/\{\{input\}\}/g, isCommand ? '$ARGUMENTS' : "the user's request (a change id, or a description of the work)")
    .replace(/\{\{cmd:<workflow>\}\}/g, surface === 'claude-command' || surface === 'plugin-skill' ? '`/sdlc:<workflow>`' : '`/sdlc-<workflow>`')
    .replace(/\{\{cmd:([a-z-]+)\}\}/g, (_m, id: string) => commandRef(id, surface))
    .replace(/\{\{skill:<workflow>\}\}/g, surface === 'plugin-skill' ? '`sdlc:<workflow>`' : '`sdlc-<workflow>`')
    .replace(/\{\{skill:([a-z-]+)\}\}/g, (_m, id: string) => (surface === 'plugin-skill' ? `\`sdlc:${id}\`` : `\`sdlc-${id}\``))
    .replace(/\{\{tool:ask\}\}/g, ASK[surface])
    .replace(/\{\{tool:todo\}\}/g, TODO[surface])
    .replace(/\{\{inject:([^}]+)\}\}/g, (_m, args: string) => {
      const command = `${options.cli} ${args}`;
      if (surface.endsWith('-agent')) return `Run \`${command}\`.`;
      return `!\`${command}\`\nIf the output above is missing, run \`${command}\`.`;
    })
    .replace(/\{\{plan-mode\}\}/g, PLAN_MODE[surface]);
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
