import { currentLocale, t } from '../core/i18n.js';
import * as path from 'node:path';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import {
  defaultConfig,
  loadConfig,
  saveConfig,
  type Delivery,
  type EnforcementMode,
  type SdlcConfig,
} from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { ensureDir, exists, isDirectory, isFile, readText, writeTextAtomic } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { harnessStamp, stampTextLocalized } from '../core/license.js';
import { appendLog } from '../core/log.js';
import { assessLicense, detectProjectLicense } from '../core/project-license.js';
import { runOpenSpec } from '../core/openspec.js';
import { findProjectRoot, projectPaths, type ProjectPaths } from '../core/project.js';
import { detectVerifyCommands } from '../core/verify.js';
import { readAsset } from '../integrations/assets.js';
import {
  ADAPTERS,
  detectTools,
  installIntegrations,
  parseTools,
  renderContext,
  uninstallIntegrations,
  type InstallResult,
} from '../integrations/install.js';
import type { ToolId } from '../integrations/types.js';
import { agentEnvironment } from '../core/agent-env.js';
import { checkLayoutRequest, describeFolder, initWithLayout, type FolderDescription } from '../core/init-layout.js';
import {
  codegraphIndexCommand,
  defaultInstaller,
  defaultProbe,
  installCommand,
  type DependencyId,
  type Installer,
  type Probe,
} from '../core/dependencies.js';
import {
  askInitChoices,
  initDefaults,
  shouldPrompt,
  starterRoles,
  terminalPrompter,
  type InitChoices,
  type Prompter,
  type TerminalState,
} from './init-wizard.js';
import { layoutOptions, printLayoutText } from './init-layout.js';

export interface InitOptions {
  tools?: string;
  delivery?: string;
  cli?: string;
  mode?: string;
  hooks?: boolean;
  opsx?: boolean;
  statusline?: boolean;
  language?: string;
  force?: boolean;
  json?: boolean;
  /** AI-ready layout: scaffold | adapt | worktree | none. */
  layout?: string;
  /** Folder of the AI-ready worktree (with `layout: worktree`). */
  worktree?: string;
  gitInit?: boolean;
}

function assertDelivery(value: string | undefined): Delivery | undefined {
  if (value === undefined) return undefined;
  if (value !== 'both' && value !== 'skills' && value !== 'commands') {
    throw new SdlcError(
      'invalid_option',
      { key: 'error.delivery_must_be_both_skills_or_commands_got_x', params: { value: value } }
    );
  }
  return value;
}

function assertMode(value: string | undefined): EnforcementMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'off' && value !== 'warn' && value !== 'block') {
    throw new SdlcError(
      'invalid_option',
      { key: 'error.mode_must_be_off_warn_or_block_got_x', params: { value: value } }
    );
  }
  return value;
}

/**
 * Makes sure OpenSpec's planning home exists. A project without one is
 * initialized by OpenSpec itself (`openspec init --tools none`), so the
 * resulting layout is exactly what plain OpenSpec produces.
 */
function ensureOpenSpec(paths: ProjectPaths, language?: string): { created: boolean } {
  const hasRoot = isDirectory(paths.openspecDir) && (isFile(paths.openspecConfig) || isDirectory(paths.changesDir) || isDirectory(paths.specsDir));
  if (hasRoot) {
    ensureDir(paths.changesDir);
    ensureDir(paths.specsDir);
    ensureDir(paths.archiveDir);
    return { created: false };
  }
  const args = ['init', paths.root, '--tools', 'none', '--no-animation'];
  if (language) args.push('--language', language);
  const result = runOpenSpec(args, { cwd: paths.root });
  if (!result.ok || !isDirectory(paths.openspecDir)) {
    throw new SdlcError(
      'openspec_init_failed',
      { key: 'error.openspec_init_failed_x', params: { p1: (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ') } },
      { key: 'fix.run_sdlc_openspec_init_tools_none_to_see_the_ful' }
    );
  }
  ensureDir(paths.changesDir);
  ensureDir(paths.specsDir);
  ensureDir(paths.archiveDir);
  return { created: true };
}

/** Points OpenSpec's default schema at `sdlc`, preserving the file's comments. */
function setDefaultSchema(paths: ProjectPaths, schema: string): boolean {
  const text = readText(paths.openspecConfig);
  if (text === undefined) {
    writeTextAtomic(paths.openspecConfig, `schema: ${schema}\n`);
    return true;
  }
  if (/^schema:\s*\S+/m.test(text)) {
    const next = text.replace(/^schema:\s*\S+.*$/m, `schema: ${schema}`);
    if (next !== text) writeTextAtomic(paths.openspecConfig, next);
    return next !== text;
  }
  writeTextAtomic(paths.openspecConfig, `schema: ${schema}\n${text}`);
  return true;
}

function ensureReviewPolicy(root: string, config: SdlcConfig): boolean {
  const file = path.join(root, config.review.policy);
  if (exists(file)) return false;
  writeTextAtomic(file, readAsset('project', 'REVIEW.md'));
  return true;
}


/** Localized label for hook/status-line result words in text output (JSON keeps English). */
function stateLabel(state: string): string {
  const key = `state.${state}`;
  const text = t(key);
  return text === key ? state : text;
}

function summarize(result: InstallResult): Record<string, number> {
  return {
    created: result.files.created.length,
    updated: result.files.updated.length,
    unchanged: result.files.unchanged.length,
    kept: result.files.kept.length,
    removed: result.files.removed.length,
  };
}

function printInstall(result: InstallResult, config: SdlcConfig): void {
  const s = summarize(result);
  line(t('init.filesSummary', { created: s.created, updated: s.updated, unchanged: s.unchanged, removed: s.removed }));
  for (const kept of result.files.kept) {
    warn(t('init.keptEditedForce', { path: kept }));
  }
    if (result.claudeHooks !== 'absent' && result.claudeHooks !== 'unchanged') {
    line(t('init.claudeHooks', { state: stateLabel(result.claudeHooks) }));
  }
  if (result.tools.length > 0) {
    line();
    line(c.bold(t('init.startChange')));
    for (const tool of result.tools) {
      const adapter = ADAPTERS[tool];
      const ctx = renderContext(config, result.tools);
      line(t('init.startChangeLine', { name: adapter.name.padEnd(12), intent: adapter.invocation('intent', ctx), next: adapter.invocation('next', ctx) }));
    }
    printAdoptHint(result.tools, config);
  }
}

/** An existing project: the adopt workflow fills the agent documents and drafts the settings. */
function printAdoptHint(tools: InstallResult['tools'], config: SdlcConfig): void {
  line();
  line(c.bold(t('init.adoptProject')));
  const ctx = renderContext(config, tools);
  for (const tool of tools) {
    const adapter = ADAPTERS[tool];
    line(t('init.adoptLine', { name: adapter.name.padEnd(12), adopt: adapter.invocation('adopt', ctx) }));
  }
}

interface WizardResult {
  opts: InitOptions;
  roles: boolean;
  install: DependencyId[];
  index: boolean;
}

/** Asks interactively when appropriate; returns undefined if the person declines. */
async function resolveWizard(
  root: string,
  opts: InitOptions,
  deps: InitDeps = {},
  folder?: FolderDescription,
): Promise<WizardResult | undefined> {
  const terminal = {
    stdinTTY: !!process.stdin.isTTY,
    stdoutTTY: !!process.stdout.isTTY,
    agent: agentEnvironment(),
  };
  const io = deps.io ?? terminal;
  if (!shouldPrompt(opts, io)) {
    return { opts, roles: false, install: [], index: false };
  }
  const probe = deps.probe ?? defaultProbe;
  const defaults = { ...initDefaults(root, detectTools(root), probe), folder };
  const choices = await askInitChoices(deps.prompter ?? terminalPrompter(), defaults);
  if (!choices) {
    line(t('init.nothingWritten'));
    return undefined;
  }
  return {
    opts: optsFromChoices(opts, choices),
    roles: choices.roles,
    install: choices.install,
    index: choices.index,
  };
}

/** Runs chosen optional installs after settings are written; failures warn, never fail init. */
async function runChosenInstalls(
  root: string,
  install: DependencyId[],
  index: { wanted: boolean; tools: string[] },
  installer: Installer,
): Promise<void> {
  for (const id of install) {
    const command = installCommand(id);
    const result = await installer(command, root);
    if (!result.ok) {
      warn(t('init.optionalInstallFailed', { command: command.join(' ') }));
    }
  }
  if (!index.wanted) return;
  const command = codegraphIndexCommand(index.tools);
  const result = await installer(command, root);
  if (!result.ok) {
    warn(t('init.optionalIndexFailed', { command: command.join(' ') }));
  }
}

function optsFromChoices(opts: InitOptions, choices: InitChoices): InitOptions {
  return {
    ...opts,
    tools: choices.tools.length > 0 ? choices.tools.join(',') : 'none',
    mode: choices.mode,
    statusline: choices.statusline,
    opsx: choices.opsx,
    ...(choices.language ? { language: choices.language } : {}),
    ...layoutOptions(choices),
  };
}

function writeStarterRoles(root: string): 'created' | 'kept' {
  const file = path.join(root, 'openspec', 'roles.yaml');
  if (exists(file)) return 'kept';
  writeTextAtomic(file, starterRoles(gitIdentity(root)));
  return 'created';
}

/** Test seams for the interactive mode; production uses the real terminal. */
export interface InitDeps {
  prompter?: Prompter;
  io?: TerminalState;
  probe?: Probe;
  installer?: Installer;
}

/** What init did in one folder; printed as JSON or text. */
interface InitOutcome {
  root: string;
  config: SdlcConfig;
  hadConfig: boolean;
  openspecCreated: boolean;
  schemaDefaulted: boolean;
  tools: ToolId[];
  detectedCommands: string[];
  result: InstallResult;
  reviewCreated: boolean;
  opsx?: 'installed' | 'failed';
  rolesNote?: string;
  license: ReturnType<typeof assessLicense>;
}

export async function initCommand(target: string | undefined, opts: InitOptions, deps?: InitDeps): Promise<void> {
  try {
    const root = path.resolve(target ?? process.cwd());
    if (!isDirectory(root)) throw new SdlcError(
      'invalid_path',
      { key: 'error.x_is_not_a_directory', params: { root: root } }
    );
    const nested = findProjectRoot(root);
    if (nested && nested !== root && !isDirectory(path.join(root, 'openspec'))) {
      warn(t('init.nestedOpenSpec', { nested, root }));
    }
    // Classified before anything is written; the wizard and the layout step use it.
    const folder = describeFolder(root);
    const resolved = await resolveWizard(root, opts, deps, folder);
    if (!resolved) return;
    const chosen = resolved.opts;
    // The terminal seam (deps.io) names the agent session in tests; the CLI reads the environment.
    const request = checkLayoutRequest(root, chosen, deps?.io ? deps.io.agent : agentEnvironment());
    const runInit = (dir: string) => setupProject(dir, chosen, resolved, deps);
    const done = await initWithLayout(root, folder, request, chosen, runInit);
    if (chosen.json) return printJson({ ...initJson(done.outcome), layout: done.layout });
    printInitText(done.outcome);
    printLayoutText(done);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

interface Settings {
  paths: ProjectPaths;
  openspecCreated: boolean;
  hadConfig: boolean;
  config: SdlcConfig;
  tools: ToolId[];
  detectedCommands: string[];
}

/** OpenSpec's planning home and openspec/sdlc.yaml with the chosen options. */
function writeSettings(root: string, opts: InitOptions): Settings {
  const paths = projectPaths(root);
  const openspec = ensureOpenSpec(paths, opts.language);
  const hadConfig = isFile(paths.sdlcConfig);
  const config = hadConfig ? loadConfig(paths.sdlcConfig) : defaultConfig();
  const detected = detectTools(root);
  const fallback: ToolId[] = config.tools.length > 0
    ? (config.tools.filter((t) => t in ADAPTERS) as ToolId[])
    : detected.length > 0 ? detected : ['claude', 'opencode'];
  const tools = parseTools(opts.tools, fallback);
  config.tools = tools;
  config.delivery = assertDelivery(opts.delivery) ?? config.delivery;
  config.cli = opts.cli ?? config.cli;
  config.statusline = opts.statusline || config.statusline;
  config.enforcement.mode = assertMode(opts.mode) ?? config.enforcement.mode;
  let detectedCommands: string[] = [];
  if (!hadConfig && config.verify.commands.length === 0) {
    const found = detectVerifyCommands(root);
    config.verify.commands = found.map((f) => ({ name: f.name, run: f.run, required: true }));
    detectedCommands = found.map((f) => `${f.run} (${f.why})`);
  }
  saveConfig(paths.sdlcConfig, config);
  return { paths, openspecCreated: openspec.created, hadConfig, config, tools, detectedCommands };
}

/** The whole init in one folder: settings, integrations, review policy, log, chosen installs. */
async function setupProject(
  root: string,
  opts: InitOptions,
  resolved: WizardResult,
  deps?: InitDeps,
): Promise<InitOutcome> {
  const { paths, openspecCreated, hadConfig, config, tools, detectedCommands } = writeSettings(root, opts);
  const rolesNote = resolved.roles ? `roles: ${writeStarterRoles(root)} openspec/roles.yaml` : undefined;
  // New OpenSpec roots default to the sdlc schema so OpenSpec's own /opsx
  // workflows produce SDLC changes too; existing roots keep their default.
  const schemaDefaulted = openspecCreated ? setDefaultSchema(paths, config.schema) : false;
  const result = installIntegrations(root, config, tools, { force: opts.force, hooks: opts.hooks });
  const reviewCreated = ensureReviewPolicy(root, config);
  let opsx: 'installed' | 'failed' | undefined;
  if (opts.opsx && tools.length > 0) {
    const r = runOpenSpec(['init', root, '--tools', tools.join(','), '--no-animation'], { cwd: root });
    opsx = r.ok ? 'installed' : 'failed';
  }
  logSetup(root, config, hadConfig ? 'harness.reinitialized' : 'harness.initialized', tools);
  const license = assessLicense(config.license, detectProjectLicense(root), opts.json ? 'en' : currentLocale());
  if (resolved.install.length > 0 || resolved.index) {
    const installer = deps?.installer ?? defaultInstaller;
    await runChosenInstalls(root, resolved.install, { wanted: resolved.index, tools }, installer);
  }
  return {
    root, config, hadConfig, openspecCreated, schemaDefaulted, tools, detectedCommands, result, reviewCreated,
    opsx, rolesNote, license,
  };
}

function initJson(o: InitOutcome): Record<string, unknown> {
  const { config, result } = o;
  return {
    harness: harnessStamp(config),
    license: { ...config.license, assessment: o.license },
    root: o.root,
    openspec: { created: o.openspecCreated, defaultSchema: o.schemaDefaulted ? config.schema : undefined },
    config: {
      path: projectPaths(o.root).sdlcConfig,
      created: !o.hadConfig,
      verifyCommands: config.verify.commands.map((v) => v.run),
    },
    tools: o.tools,
    files: result.files,
    claudeHooks: result.claudeHooks,
    statusLine: result.statusLine,
    reviewPolicy: o.reviewCreated ? config.review.policy : undefined,
    ...(o.opsx ? { opsx: o.opsx } : {}),
    ...(o.rolesNote ? { roles: o.rolesNote } : {}),
  };
}

function printInitText(o: InitOutcome): void {
  const { config, tools, result, license } = o;
  const schema = o.schemaDefaulted ? t('init.defaultSchema', { schema: config.schema }) : '';
  const names = tools.length > 0 ? tools.map((id) => ADAPTERS[id].name).join(', ') : t('init.none');
  line(c.bold(t('init.done', { root: o.root })));
  line((o.openspecCreated ? t('init.openspecCreated') : t('init.openspecExisting')) + schema);
  line(t(o.hadConfig ? 'init.configKept' : 'init.configCreated', { mode: config.enforcement.mode }));
  if (!o.hadConfig) {
    line(o.detectedCommands.length > 0
      ? t('init.verifyDetected', { commands: o.detectedCommands.join('; ') })
      : c.yellow(t('init.verifyEmpty')));
  }
  if (o.reviewCreated) line(t('init.reviewPolicy', { policy: config.review.policy }));
  line(t('init.toolsLine', { tools: names }));
  if (o.rolesNote) line(`  ${o.rolesNote}`);
  if (o.opsx) line(t('init.opsxLine', { opsx: stateLabel(o.opsx) }));
  line(`  ${stampTextLocalized(harnessStamp(config))}`);
  if (license.status !== 'ok') warn(`${license.message}. ${license.fix ?? ''}`.trim());
  printInstall(result, config);
  if (result.statusLine === 'kept (user-defined)') warn(t('init.keptStatusline'));
}

/** Setup events go to the project log with the tools involved. */
function logSetup(root: string, config: SdlcConfig, event: string, tools: ToolId[]): void {
  const by = formatIdentity(gitIdentity(root));
  appendLog(root, config, { event, ...(by ? { by } : {}), detail: `tools: ${tools.join(', ') || 'none'}` });
}

export interface UpdateOptions {
  tools?: string;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export async function updateCommand(target: string | undefined, opts: UpdateOptions): Promise<void> {
  try {
    const root = findProjectRoot(path.resolve(target ?? process.cwd()));
    if (!root) throw new SdlcError(
      'no_project_root',
      { key: 'error.no_openspec_directory_found' },
      { key: 'fix.run_sdlc_init_first' }
    );
    const paths = projectPaths(root);
    if (!isFile(paths.sdlcConfig)) {
      throw new SdlcError(
      'not_initialized',
      { key: 'error.this_openspec_project_has_no_openspec_sdlc_yaml' },
      { key: 'fix.run_sdlc_init_to_add_the_sdlc_harness' }
    );
    }
    const config = loadConfig(paths.sdlcConfig);
    const tools = parseTools(opts.tools, config.tools.filter((t) => t in ADAPTERS) as ToolId[]);
    if (opts.tools !== undefined && !opts.dryRun) {
      config.tools = tools;
      saveConfig(paths.sdlcConfig, config);
    }
    const result = installIntegrations(root, config, tools, { force: opts.force, dryRun: opts.dryRun });
    if (!opts.dryRun) logSetup(root, config, 'harness.updated', tools);
    const stamp = harnessStamp(config);
    if (opts.json) {
      printJson({ root, tools, dryRun: !!opts.dryRun, files: result.files, claudeHooks: result.claudeHooks, harness: stamp });
      return;
    }
    line(c.bold(t(opts.dryRun ? 'update.would' : 'update.done', { root })) + c.dim(` (${stampTextLocalized(stamp)})`));
    printInstall(result, config);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function uninstallCommand(target: string | undefined, opts: { force?: boolean; dryRun?: boolean; json?: boolean }): Promise<void> {
  try {
    const root = findProjectRoot(path.resolve(target ?? process.cwd()));
    if (!root) throw new SdlcError('no_project_root', { key: 'error.no_openspec_directory_found' });
    const result = uninstallIntegrations(root, { force: opts.force, dryRun: opts.dryRun });
    const paths = projectPaths(root);
    if (!opts.dryRun && isFile(paths.sdlcConfig)) {
      try {
        logSetup(root, loadConfig(paths.sdlcConfig), 'harness.uninstalled', []);
      } catch {
        // An unreadable sdlc.yaml must not stop an uninstall.
      }
    }
    if (opts.json) {
      printJson({ root, dryRun: !!opts.dryRun, files: result.files, claudeHooks: result.claudeHooks });
      return;
    }
    line(c.bold(t(opts.dryRun ? 'uninstall.would' : 'uninstall.done', { root })));
    line(t('uninstall.filesRemoved', { removed: result.files.removed.length, hooks: stateLabel(result.claudeHooks) }));
    for (const kept of result.files.kept) warn(t('uninstall.keptEdited', { path: kept }));
    line(c.dim(t('uninstall.leftUntouched')));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
