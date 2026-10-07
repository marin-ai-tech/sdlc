/**
 * Interactive `sdlc init`, like `openspec init`: in a terminal with no setup flags, a person is guided
 * through the choices and sees a summary before anything is written. Flags, `--json`, a non-terminal
 * stdin/stdout or an agent session never prompt, so scripts and agents keep today's behaviour.
 *
 * Contract (the lead's; implementation by the executor):
 * - `shouldPrompt(opts, io)`: true only when stdin and stdout are terminals, no agent session, and none of
 *   the setup options was given (`tools`, `delivery`, `cli`, `mode`, `hooks: false`, `opsx`, `statusline`,
 *   `language`, `force`, `json`).
 * - `askInitChoices(prompter, defaults)`: shows the welcome text, asks in this order — tools (checkbox,
 *   `defaults.tools` preselected), enforcement mode (select, `defaults.mode` first), status line (confirm,
 *   only when Claude Code is chosen), /opsx workflows (confirm), artifact language (input, may be empty),
 *   roles.yaml (confirm, default no), the MCP server (confirm, `defaults.mcp`, B13; only when the defaults carry
 *   `mcp`) — then shows the summary and asks to confirm (default yes).
 *   Resolves to the choices, or `undefined` when the summary is declined.
 * - `initDefaults(root, detected)`: defaults for the questions; on an initialized project they are the current
 *   settings from openspec/sdlc.yaml, otherwise the detected tools (or both) and `warn`.
 * - `starterRoles(identity)`: openspec/roles.yaml text for one person (the git identity) holding every role,
 *   `signing: off` and separation switched off with a comment saying to add people and turn it back on
 *   (one person cannot pass author_cannot_approve on their own code).
 * - Optional tools: `initDefaults(root, detected, probe)` also returns `dependencies` =
 *   detectDependencies(root, probe). Right after the tools question, `askInitChoices` asks for each dependency
 *   that is not found: "Install <name>? (<install command>)" (confirm, default yes); then, when codegraph is
 *   found or chosen and the project is not indexed: "Index this project with codegraph (codegraph init)?"
 *   (confirm, default no). The summary lists the install commands and the index choice. With no dependencies in
 *   the defaults (or all found and indexed) nothing extra is asked.
 *   In setup.ts the installs run after the settings are written, through `deps.installer` (default
 *   defaultInstaller): each chosen install, then codegraphIndexCommand(tools) in the root when `index` is chosen. A failed
 *   command prints a warning with the command to run by hand; init still succeeds. Non-interactive runs never
 *   probe or install. `InitDeps` gains `probe?: Probe` and `installer?: Installer`.
 * - AI-ready layout (src/commands/init-layout.ts): with `defaults.folder`, right after the welcome an empty folder
 *   is offered `git init` (only without git) and gets the layout scaffolded; an existing one sees the diagnosis
 *   and chooses worktree | adapt | none (worktree asks for the folder). Without it nothing changes.
 * - `initCommand(target, opts, deps)` in setup.ts asks before any file is written; a declined summary prints
 *   "Nothing written." and creates nothing; accepted choices behave exactly like the matching flags, plus
 *   roles.yaml when chosen (never overwriting an existing one).
 */
import type { EnforcementMode } from '../core/config.js';
import type { FolderDescription } from '../core/init-layout.js';
import {
  detectDependencies,
  installCommand,
  type DependencyId,
  type DependencyStatus,
  type Probe,
} from '../core/dependencies.js';
import { loadConfig } from '../core/config.js';
import { isFile } from '../core/fs-utils.js';
import type { GitIdentity } from '../core/git.js';
import { projectPaths } from '../core/project.js';
import { ADAPTERS } from '../integrations/install.js';
import { TOOL_IDS, type ToolId } from '../integrations/types.js';
import type { InitOptions } from './setup.js';
import { t } from '../core/i18n.js';
import { askLayoutChoices, layoutSummaryLines, type LayoutChoices } from './init-layout.js';

export interface InitChoices extends Partial<LayoutChoices> {
  tools: ToolId[];
  mode: EnforcementMode;
  statusline: boolean;
  opsx: boolean;
  /** Empty means OpenSpec's default. */
  language: string;
  roles: boolean;
  /** Optional tools to install. */
  install: DependencyId[];
  /** Run `codegraph init` in the project. */
  index: boolean;
  /** Register `sdlc mcp serve` (B13); absent when the question was not asked. */
  mcp?: boolean;
}

/** Where the questions come from; the default implementation uses @inquirer/prompts. */
export interface Prompter {
  checkbox<T extends string>(
    message: string,
    choices: Array<{ value: T; name: string; checked: boolean }>,
  ): Promise<T[]>;
  select<T extends string>(message: string, choices: Array<{ value: T; name: string }>, initial: T): Promise<T>;
  confirm(message: string, initial: boolean): Promise<boolean>;
  input(message: string, initial: string): Promise<string>;
  /** Plain text: the welcome screen and the summary. */
  say(text: string): void;
}

export interface TerminalState {
  stdinTTY: boolean;
  stdoutTTY: boolean;
  /** The agent session name (agentEnvironment()), if any. */
  agent?: string;
}

export interface InitDefaults {
  tools: ToolId[];
  mode: EnforcementMode;
  statusline: boolean;
  opsx: boolean;
  language: string;
  /** Status of the optional tools; absent = do not ask about them. */
  dependencies?: DependencyStatus[];
  /** The folder init runs in; absent = no git or layout questions. */
  folder?: FolderDescription;
  /** Current `mcp.serve` (default no); absent = no MCP question. */
  mcp?: boolean;
}

function modeChoiceList(): Array<{ value: EnforcementMode; name: string }> {
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
] as const;

function welcomeText(): string {
  return t('init.welcome');
}

function isExitPrompt(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ExitPromptError' || /force closed the prompt/i.test(error.message);
}

export function shouldPrompt(opts: InitOptions, io: TerminalState): boolean {
  if (!io.stdinTTY || !io.stdoutTTY) return false;
  if (io.agent) return false;
  if (opts.tools !== undefined) return false;
  if (opts.delivery !== undefined) return false;
  if (opts.cli !== undefined) return false;
  if (opts.mode !== undefined) return false;
  if (opts.hooks === false) return false;
  if (opts.opsx) return false;
  if (opts.statusline) return false;
  if (opts.language !== undefined) return false;
  if (opts.force) return false;
  if (opts.json) return false;
  if (opts.layout !== undefined || opts.worktree !== undefined || opts.gitInit) return false;
  if (opts.mcp) return false;
  return true;
}

function toolChoices(defaults: InitDefaults): Array<{ value: ToolId; name: string; checked: boolean }> {
  return TOOL_IDS.map((id) => ({
    value: id,
    name: ADAPTERS[id].name,
    checked: defaults.tools.includes(id),
  }));
}

function modeChoices(defaults: InitDefaults): Array<{ value: EnforcementMode; name: string }> {
  const all = modeChoiceList();
  const rest = all.filter((c) => c.value !== defaults.mode);
  const first = all.find((c) => c.value === defaults.mode) ?? all[1];
  return [first, ...rest];
}

function formatSummary(choices: InitChoices): string {
  const tools = choices.tools.length > 0
    ? choices.tools.map((tool) => ADAPTERS[tool].name).join(', ')
    : t('init.none');
  const language = choices.language || t('init.languageDefault');
  const install = choices.install.length > 0
    ? choices.install.map((id) => installCommand(id).join(' ')).join('; ')
    : t('init.none');
  const yn = (value: boolean) => (value ? t('init.yes') : t('init.no'));
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
async function askMcp(prompter: Prompter, defaults: InitDefaults): Promise<{ mcp?: boolean }> {
  if (defaults.mcp === undefined) return {};
  return { mcp: await prompter.confirm(t('init.mcp'), defaults.mcp) };
}

async function askDependencyChoices(
  prompter: Prompter,
  defaults: InitDefaults,
): Promise<{ install: DependencyId[]; index: boolean }> {
  const install: DependencyId[] = [];
  let index = false;
  const deps = defaults.dependencies;
  if (!deps) return { install, index };
  for (const dep of deps) {
    if (dep.found) continue;
    const message = t('init.installDep', { name: dep.name, command: dep.install.join(' ') });
    if (await prompter.confirm(message, true)) install.push(dep.id);
  }
  const codegraph = deps.find((d) => d.id === 'codegraph');
  const hasCodegraph = Boolean(codegraph?.found) || install.includes('codegraph');
  const notIndexed = codegraph ? !codegraph.indexed : true;
  if (hasCodegraph && notIndexed) {
    index = await prompter.confirm(t('init.indexCodegraph'), false);
  }
  return { install, index };
}

export async function askInitChoices(
  prompter: Prompter,
  defaults: InitDefaults
): Promise<InitChoices | undefined> {
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
    const language = await prompter.input(
      t('init.language'),
      defaults.language
    );
    const roles = await prompter.confirm(t('init.roles'), false);
    const choices: InitChoices = {
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
  } catch (error) {
    if (isExitPrompt(error)) return undefined;
    throw error;
  }
}

export function initDefaults(root: string, detected: ToolId[], probe?: Probe): InitDefaults {
  const paths = projectPaths(root);
  let base: InitDefaults;
  if (isFile(paths.sdlcConfig)) {
    const config = loadConfig(paths.sdlcConfig);
    const tools = config.tools.filter((t): t is ToolId => t in ADAPTERS);
    base = {
      tools,
      mode: config.enforcement.mode,
      statusline: config.statusline,
      opsx: false,
      language: '',
      mcp: config.mcp?.serve ?? false,
    };
  } else {
    base = {
      tools: detected.length > 0 ? detected : [...TOOL_IDS],
      mode: 'warn',
      statusline: false,
      opsx: false,
      language: '',
      mcp: false,
    };
  }
  if (probe) base.dependencies = detectDependencies(root, probe);
  return base;
}

function personId(identity: GitIdentity): string {
  if (identity.email) {
    const local = identity.email.split('@')[0].trim().toLowerCase();
    const cleaned = local.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (cleaned) return cleaned;
  }
  if (identity.name) {
    const cleaned = identity.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (cleaned) return cleaned;
  }
  return 'owner';
}

export function starterRoles(identity: GitIdentity): string {
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
function promptNavHints(kind: 'checkbox' | 'select'): {
  instructions: string;
  theme: { style: { keysHelpTip: () => string } };
} {
  const text = t(kind === 'checkbox' ? 'init.prompt.checkboxHint' : 'init.prompt.selectHint');
  return {
    instructions: text,
    theme: { style: { keysHelpTip: () => text } },
  };
}

export function terminalPrompter(): Prompter {
  const prompts = () => import('@inquirer/prompts');
  return {
    async checkbox(message, choices) {
      const hints = promptNavHints('checkbox');
      return (await prompts()).checkbox({ message, choices, ...hints } as { message: string; choices: typeof choices });
    },
    async select(message, choices, initial) {
      const hints = promptNavHints('select');
      return (await prompts()).select({
        message, choices, default: initial, ...hints,
      } as { message: string; choices: typeof choices; default: typeof initial });
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
