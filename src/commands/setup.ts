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
import { harnessStamp, stampText } from '../core/license.js';
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

export interface InitOptions {
  tools?: string;
  delivery?: string;
  cli?: string;
  mode?: string;
  hooks?: boolean;
  opsx?: boolean;
  language?: string;
  force?: boolean;
  json?: boolean;
}

function assertDelivery(value: string | undefined): Delivery | undefined {
  if (value === undefined) return undefined;
  if (value !== 'both' && value !== 'skills' && value !== 'commands') {
    throw new SdlcError('invalid_option', `--delivery must be both, skills, or commands (got ${value}).`);
  }
  return value;
}

function assertMode(value: string | undefined): EnforcementMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'off' && value !== 'warn' && value !== 'block') {
    throw new SdlcError('invalid_option', `--mode must be off, warn, or block (got ${value}).`);
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
      `openspec init failed: ${(result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ')}`,
      'Run `sdlc openspec init --tools none` to see the full error.'
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
  line(`  files: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged, ${s.removed} removed`);
  for (const kept of result.files.kept) {
    warn(`kept ${kept} (edited locally; run with --force to overwrite)`);
  }
  if (result.claudeHooks !== 'absent' && result.claudeHooks !== 'unchanged') {
    line(`  Claude Code hooks: ${result.claudeHooks} in .claude/settings.json`);
  }
  if (result.tools.length > 0) {
    line();
    line(c.bold('Start a change:'));
    for (const tool of result.tools) {
      const adapter = ADAPTERS[tool];
      const ctx = renderContext(config, result.tools);
      line(`  ${adapter.name.padEnd(12)} ${adapter.invocation('intent', ctx)} "<your idea>"   then ${adapter.invocation('next', ctx)}`);
    }
  }
}

export async function initCommand(target: string | undefined, opts: InitOptions): Promise<void> {
  try {
    const root = path.resolve(target ?? process.cwd());
    if (!isDirectory(root)) throw new SdlcError('invalid_path', `${root} is not a directory.`);
    const nested = findProjectRoot(root);
    if (nested && nested !== root && !isDirectory(path.join(root, 'openspec'))) {
      warn(`an OpenSpec root already exists at ${nested}; initializing a separate one in ${root}.`);
    }
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
    config.enforcement.mode = assertMode(opts.mode) ?? config.enforcement.mode;
    let detectedCommands: string[] = [];
    if (!hadConfig && config.verify.commands.length === 0) {
      const found = detectVerifyCommands(root);
      config.verify.commands = found.map((f) => ({ name: f.name, run: f.run, required: true }));
      detectedCommands = found.map((f) => `${f.run} (${f.why})`);
    }
    saveConfig(paths.sdlcConfig, config);

    // New OpenSpec roots default to the sdlc schema so OpenSpec's own /opsx
    // workflows produce SDLC changes too; existing roots keep their default.
    const schemaDefaulted = openspec.created ? setDefaultSchema(paths, config.schema) : false;
    const result = installIntegrations(root, config, tools, { force: opts.force, hooks: opts.hooks });
    const reviewCreated = ensureReviewPolicy(root, config);

    let opsx: 'installed' | 'failed' | undefined;
    if (opts.opsx && tools.length > 0) {
      const r = runOpenSpec(['init', root, '--tools', tools.join(','), '--no-animation'], { cwd: root });
      opsx = r.ok ? 'installed' : 'failed';
    }
    const stamp = harnessStamp(config);
    logSetup(root, config, hadConfig ? 'harness.reinitialized' : 'harness.initialized', tools);
    const license = assessLicense(config.license, detectProjectLicense(root));

    if (opts.json) {
      printJson({
        harness: stamp,
        license: { ...config.license, assessment: license },
        root,
        openspec: { created: openspec.created, defaultSchema: schemaDefaulted ? config.schema : undefined },
        config: { path: paths.sdlcConfig, created: !hadConfig, verifyCommands: config.verify.commands.map((v) => v.run) },
        tools,
        files: result.files,
        claudeHooks: result.claudeHooks,
        reviewPolicy: reviewCreated ? config.review.policy : undefined,
        ...(opsx ? { opsx } : {}),
      });
      return;
    }
    line(c.bold(`SDLC harness initialized in ${root}`));
    line(`  OpenSpec: ${openspec.created ? 'created openspec/ (via openspec init)' : 'using existing openspec/'}${schemaDefaulted ? `, default schema: ${config.schema}` : ''}`);
    line(`  config: ${hadConfig ? 'kept' : 'created'} openspec/sdlc.yaml (enforcement: ${config.enforcement.mode})`);
    if (!hadConfig) {
      line(detectedCommands.length > 0
        ? `  verify.commands detected: ${detectedCommands.join('; ')}`
        : `  ${c.yellow('verify.commands is empty')} - add your build/test/lint commands to openspec/sdlc.yaml`);
    }
    if (reviewCreated) line(`  review policy: created ${config.review.policy}`);
    line(`  tools: ${tools.length > 0 ? tools.map((t) => ADAPTERS[t].name).join(', ') : 'none'}`);
    if (opsx) line(`  OpenSpec /opsx workflows: ${opsx}`);
    line(`  ${stampText(stamp)}`);
    if (license.status !== 'ok') warn(`${license.message}. ${license.fix ?? ''}`.trim());
    printInstall(result, config);
  } catch (error) {
    reportFailure(error, opts.json);
  }
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
    if (!root) throw new SdlcError('no_project_root', 'No openspec/ directory found.', 'Run `sdlc init` first.');
    const paths = projectPaths(root);
    if (!isFile(paths.sdlcConfig)) {
      throw new SdlcError('not_initialized', 'This OpenSpec project has no openspec/sdlc.yaml.', 'Run `sdlc init` to add the SDLC harness.');
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
    line(c.bold(`${opts.dryRun ? 'Would update' : 'Updated'} SDLC harness files in ${root}`) + c.dim(` (${stampText(stamp)})`));
    printInstall(result, config);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function uninstallCommand(target: string | undefined, opts: { force?: boolean; dryRun?: boolean; json?: boolean }): Promise<void> {
  try {
    const root = findProjectRoot(path.resolve(target ?? process.cwd()));
    if (!root) throw new SdlcError('no_project_root', 'No openspec/ directory found.');
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
    line(c.bold(`${opts.dryRun ? 'Would remove' : 'Removed'} SDLC harness integration files from ${root}`));
    line(`  files removed: ${result.files.removed.length}; Claude hooks: ${result.claudeHooks}`);
    for (const kept of result.files.kept) warn(`kept ${kept} (edited locally)`);
    line(c.dim('  openspec/ (specs, changes, sdlc.yaml, the sdlc schema) was left untouched.'));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
