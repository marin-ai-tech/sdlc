import * as path from 'node:path';
import { loadConfig, type SdlcConfig } from './config.js';
import { listActiveChanges } from './changes.js';
import { detectDependencies, onSearchPath } from './dependencies.js';
import { isFile, readText } from './fs-utils.js';
import { gitIdentity, isGitRepo } from './git.js';
import { t, type Locale } from './i18n.js';
import { evaluateChange } from './lifecycle.js';
import { harnessStamp, INSTALL_COMMAND } from './license.js';
import { LOG_PATH, readLog } from './log.js';
import { openspecVersion, resolveOpenSpec, runOpenSpec } from './openspec.js';
import { projectPaths, type ProjectPaths } from './project.js';
import { assessLicense, detectProjectLicense } from './project-license.js';
import { readRolesFile } from './roles.js';
import { hooksDisabledFiles } from './user-guard.js';
import { harnessVersion } from './version.js';
import { readYamlObject } from './yaml-io.js';
import { readManifest, sha256 } from '../integrations/manifest.js';
import { SETTINGS_PATH } from '../integrations/settings.js';
import { CURSOR_HOOKS_PATH, cursorHooksInstalled } from '../integrations/cursor-hooks.js';
import { CODEX_RULES_PATH } from '../integrations/codex.js';
import { CODEX_HOOKS_PATH, codexHooksInstalled } from '../integrations/codex-hooks.js';
import { qwenSettingsInstalled, qwenSettingsPath } from '../integrations/qwen-settings.js';
import { CHAIN_LINE, CHAIN_SUFFIX, inspectGitHook } from '../integrations/git-hook.js';

/**
 * The checks of `sdlc doctor`, as a function `sdlc health` reuses (config.doctor). Same checks in the same order,
 * same messages; the command only prints them.
 */
export interface DoctorCheck {
  check: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

class Checks {
  readonly list: DoctorCheck[] = [];
  constructor(readonly tt: Translate, readonly loc: Locale) {}

  add(check: string, status: DoctorCheck['status'], message: string, fix?: string): void {
    this.list.push({ check, status, message, ...(fix ? { fix } : {}) });
  }
}

function versionAtLeast(version: string, min: [number, number, number]): boolean {
  const parts = version.replace(/^v/, '').split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const a = parts[i] ?? 0;
    if (a > min[i]) return true;
    if (a < min[i]) return false;
  }
  return true;
}

/** Looked up in PATH in-process, without spawning a shell (B44: spawned probes raced on a loaded machine). */
function onPath(bin: string): boolean {
  return onSearchPath(bin);
}

function runtimeChecks(out: Checks, root: string | undefined): void {
  const { tt } = out;
  const node = versionAtLeast(process.versions.node, [20, 19, 0]) ? 'ok' : 'error';
  out.add('node', node, tt('doctor.node', { version: process.versions.node }), tt('doctor.fix.node'));
  out.add('harness', 'ok', tt('doctor.harness', { version: harnessVersion() }));
  const bin = resolveOpenSpec();
  const osVersion = openspecVersion(root ?? process.cwd());
  if (!osVersion) {
    const message = tt('doctor.openspecMissing', { source: bin.source, command: bin.command });
    out.add('openspec', 'error', message, tt('doctor.fix.openspec'));
    return;
  }
  const status = versionAtLeast(osVersion, [1, 13, 2]) ? 'ok' : 'warn';
  const message = tt('doctor.openspecVersion', { version: osVersion, source: bin.source });
  out.add('openspec', status, message, tt('doctor.openspecOld'));
}

function dependencyChecks(out: Checks, root: string | undefined): void {
  const { tt } = out;
  const optional = detectDependencies(root ?? process.cwd());
  const openspecCli = optional.find((d) => d.id === 'openspec')!;
  if (openspecCli.found) {
    out.add('openspec cli', 'ok', openspecCli.version ?? tt('doctor.installed'));
  } else {
    out.add('openspec cli', 'warn', tt('doctor.openspecCliOptional'), openspecCli.install.join(' '));
  }
  const codegraph = optional.find((d) => d.id === 'codegraph')!;
  if (!codegraph.found) {
    out.add('codegraph', 'warn', tt('doctor.notOnPath'), codegraph.install.join(' '));
    return;
  }
  const indexed = codegraph.indexed ? tt('doctor.codegraphIndexed') : tt('doctor.codegraphNotIndexed');
  const version = codegraph.version ?? tt('doctor.installed');
  out.add('codegraph', 'ok', tt('doctor.codegraphOk', { version, indexed }));
}

function configCheck(out: Checks, paths: ProjectPaths): SdlcConfig | undefined {
  const { tt } = out;
  try {
    const config = loadConfig(paths.sdlcConfig);
    const exists = isFile(paths.sdlcConfig);
    const tools = config.tools.join(', ') || tt('init.none');
    const message = exists
      ? tt('doctor.enforcementTools', { mode: config.enforcement.mode, tools })
      : tt('doctor.sdlcMissing');
    out.add('sdlc.yaml', exists ? 'ok' : 'error', message, tt('doctor.fix.init'));
    return config;
  } catch (error) {
    out.add('sdlc.yaml', 'error', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function readOpenspecConfig(paths: ProjectPaths): Record<string, unknown> | undefined {
  try {
    return readYamlObject(paths.openspecConfig);
  } catch {
    return undefined;
  }
}

function openspecChecks(out: Checks, root: string, paths: ProjectPaths): void {
  const { tt } = out;
  const osConfig = readOpenspecConfig(paths);
  const message = osConfig
    ? tt('doctor.schemaDefault', { schema: String(osConfig.schema ?? 'spec-driven') })
    : tt('doctor.openspecConfigMissing');
  out.add('openspec config', osConfig ? 'ok' : 'warn', message);
  if (!isFile(path.join(paths.schemasDir, 'sdlc', 'schema.yaml'))) {
    out.add('sdlc schema', 'error', tt('doctor.schemaMissing'), tt('doctor.fix.update'));
    return;
  }
  const r = runOpenSpec(['schema', 'validate', 'sdlc'], { cwd: root });
  const failure = (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ');
  out.add('sdlc schema', r.ok ? 'ok' : 'error', r.ok ? tt('doctor.schemaValid') : failure);
}

function generatedStatus(missing: number, edited: number, outdated: boolean, tracked: number): DoctorCheck['status'] {
  if (missing > 0) return 'error';
  if (edited > 0 || (outdated && tracked > 0)) return 'warn';
  return tracked > 0 ? 'ok' : 'warn';
}

function generatedFilesCheck(out: Checks, root: string, config: SdlcConfig | undefined): void {
  const { tt } = out;
  const manifest = readManifest(root);
  const entries = Object.entries(manifest.files);
  const missing = entries.filter(([rel]) => !isFile(path.join(root, rel))).map(([rel]) => rel);
  const edited = entries.filter(([rel, e]) => {
    const text = readText(path.join(root, rel));
    return text !== undefined && sha256(text) !== e.sha256;
  }).map(([rel]) => rel);
  const outdated = manifest.harness !== harnessVersion() ||
    (config !== undefined && manifest.license !== undefined && manifest.license !== harnessStamp(config).license);
  const licensePart = manifest.license ? tt('doctor.licensePart', { license: manifest.license }) : '';
  const by = outdated ? tt('doctor.generatedBy', { harness: manifest.harness, license: licensePart }) : '';
  const counts = { tracked: entries.length, missing: missing.length, edited: edited.length };
  const fix = missing.length > 0 || outdated
    ? tt('doctor.fix.update')
    : edited.length > 0 ? tt('doctor.fix.edited') : undefined;
  const status = generatedStatus(missing.length, edited.length, outdated, entries.length);
  out.add('generated files', status, tt('doctor.generatedSummary', counts) + by, fix);
}

function integrationChecks(out: Checks, root: string, config: SdlcConfig): void {
  const { tt } = out;
  if (config.tools.includes('claude')) {
    const settings = readText(path.join(root, SETTINGS_PATH)) ?? '';
    const hasHooks = /hook pre-tool/.test(settings);
    const message = hasHooks
      ? tt('doctor.hooksInstalled', { path: SETTINGS_PATH })
      : tt('doctor.hooksMissing', { path: SETTINGS_PATH });
    out.add('claude hooks', hasHooks ? 'ok' : 'warn', message, tt('doctor.fix.update'));
  }
  if (config.tools.includes('opencode')) {
    const plugin = isFile(path.join(root, '.opencode', 'plugins', 'sdlc.js')) ? 'ok' : 'warn';
    out.add('opencode plugin', plugin, '.opencode/plugins/sdlc.js', tt('doctor.fix.update'));
  }
  if (config.tools.includes('cursor')) cursorCheck(out, root);
  if (config.tools.includes('codex')) codexCheck(out, root);
  if (config.tools.includes('qwen')) qwenCheck(out, root, 'qwen');
  if (config.tools.includes('gigacode')) qwenCheck(out, root, 'gigacode');
  const cliBin = config.cli.split(/\s+/)[0];
  const on = onPath(cliBin);
  const message = tt(on ? 'doctor.cliOnPath' : 'doctor.cliNotOnPath', { bin: cliBin, cli: config.cli });
  out.add('cli on PATH', on ? 'ok' : 'warn', message, tt('doctor.fix.cli', { install: INSTALL_COMMAND }));
}

function qwenCheck(out: Checks, root: string, id: 'qwen' | 'gigacode'): void {
  const { tt } = out;
  const installed = qwenSettingsInstalled(root, id);
  const status = tt(installed ? 'doctor.qwenInstalled' : 'doctor.qwenMissing',
    { path: qwenSettingsPath(id) });
  const parts = [status, tt('doctor.qwenTrust')];
  if (id === 'gigacode') parts.push(tt('doctor.gigacodeExperimental'));
  const fix = tt(installed ? 'doctor.fix.qwenTrust' : 'doctor.fix.update');
  out.add(id, 'warn', parts.join('; '), fix);
}

/**
 * Codex CLI (B82): sdlc's hooks in `.codex/hooks.json` and its command rules, and always a warning: Codex runs a
 * project's hooks only in a trusted project after the user trusts them in `/hooks`, and `--ignore-rules` or
 * `features.hooks=false` turn them off.
 */
function codexCheck(out: Checks, root: string): void {
  const { tt } = out;
  const installed = codexHooksInstalled(root) && isFile(path.join(root, CODEX_RULES_PATH));
  const key = installed ? 'doctor.codexHooksInstalled' : 'doctor.codexHooksMissing';
  const hooks = tt(key, { hooks: CODEX_HOOKS_PATH, rules: CODEX_RULES_PATH });
  const parts = [hooks, tt('doctor.codexTrust'), tt('doctor.codexOff')];
  const fix = installed ? tt('doctor.fix.codexTrust') : tt('doctor.fix.update');
  out.add('codex', 'warn', parts.join('; '), fix);
}

/**
 * Cursor (B80): sdlc's hooks in `.cursor/hooks.json`, and always a warning: separation of duties in Cursor rests on
 * `CURSOR_AGENT` (an agent's terminal without it runs person-only commands as a person); on Windows Cursor runs the
 * hooks through PowerShell.
 */
function cursorCheck(out: Checks, root: string): void {
  const { tt } = out;
  const installed = cursorHooksInstalled(root);
  const key = installed ? 'doctor.cursorHooksInstalled' : 'doctor.cursorHooksMissing';
  const parts = [tt(key, { path: CURSOR_HOOKS_PATH }), tt('doctor.cursorAgent')];
  if (process.platform === 'win32') parts.push(tt('doctor.cursorWindows'));
  const fix = installed ? tt('doctor.fix.cursorAgent') : tt('doctor.fix.update');
  out.add('cursor', 'warn', parts.join('; '), fix);
}

function projectConfigChecks(out: Checks, root: string, paths: ProjectPaths, config: SdlcConfig): void {
  const { tt } = out;
  const license = assessLicense(config.license, detectProjectLicense(root), out.loc);
  out.add('license', license.status, license.message, license.fix);
  const logMessage = config.log.enabled
    ? tt('doctor.logEntries', { count: readLog(root).length, path: LOG_PATH })
    : tt('doctor.logOff');
  out.add('project log', 'ok', logMessage);
  integrationChecks(out, root, config);
  const names = config.verify.commands.map((v) => v.name).join(', ');
  const verify = config.verify.commands.length > 0 ? 'ok' : 'warn';
  const verifyMessage = verify === 'ok' ? tt('doctor.verifyNames', { names }) : tt('doctor.verifyNone');
  out.add('verify commands', verify, verifyMessage, tt('doctor.fix.verify'));
  const policy = isFile(path.join(root, config.review.policy)) ? 'ok' : 'warn';
  const policyMessage = tt('doctor.reviewPolicyFile', { path: config.review.policy });
  out.add('review policy', policy, policyMessage, tt('doctor.fix.review'));
  changeChecks(out, root, paths, config);
}

function changeChecks(out: Checks, root: string, paths: ProjectPaths, config: SdlcConfig): void {
  for (const ref of listActiveChanges(paths)) {
    try {
      const view = evaluateChange(root, ref, config, { skipFingerprint: true });
      out.add(`change ${ref.id}`, 'ok', out.tt('doctor.changeStage', { stage: view.stage }));
    } catch (error) {
      out.add(`change ${ref.id}`, 'error', error instanceof Error ? error.message : String(error));
    }
  }
}

function gitCheck(out: Checks, root: string): void {
  const { tt } = out;
  if (!isGitRepo(root)) {
    out.add('git', 'warn', tt('doctor.gitNotRepo'), tt('doctor.fix.gitInit'));
    return;
  }
  const id = gitIdentity(root);
  const message = id.email
    ? tt('doctor.gitIdentity', { name: id.name ?? '', email: id.email })
    : tt('doctor.gitNoEmail');
  out.add('git', id.email ? 'ok' : 'warn', message, tt('doctor.fix.gitEmail'));
  gitHookCheck(out, root);
}

/** sdlc's prepare-commit-msg hook (B24); a hook of the project's own is a warning with how to chain sdlc's. */
function gitHookCheck(out: Checks, root: string): void {
  const { tt } = out;
  const hook = inspectGitHook(root);
  if (hook.status === 'no-git' || hook.path === undefined) return;
  const shown = path.relative(root, hook.path).split(path.sep).join('/');
  if (hook.status === 'current' || hook.status === 'chained') {
    out.add('git hook', 'ok', tt(`doctor.gitHook.${hook.status}`, { path: shown }));
    return;
  }
  if (hook.status === 'foreign') {
    const fix = tt('doctor.fix.gitHookChain', { line: CHAIN_LINE, copy: `${shown}${CHAIN_SUFFIX}` });
    out.add('git hook', 'warn', tt('doctor.gitHook.foreign', { path: shown }), fix);
    return;
  }
  const fix = hook.status === 'shared' ? tt('doctor.fix.gitHookShared') : tt('doctor.fix.update');
  out.add('git hook', 'warn', tt(`doctor.gitHook.${hook.status}`, { path: shown }), fix);
}

function projectChecks(out: Checks, root: string): void {
  const paths = projectPaths(root);
  out.add('project', 'ok', out.tt('doctor.root', { root }));
  const roles = readRolesFile(root);
  if (roles) out.add('approval signing', 'ok', out.tt('doctor.signingMode', { mode: roles.signing }));
  const config = configCheck(out, paths);
  openspecChecks(out, root, paths);
  generatedFilesCheck(out, root, config);
  if (config) projectConfigChecks(out, root, paths, config);
  gitCheck(out, root);
}

export interface DoctorOptions {
  /** The project root; undefined outside a project. */
  root: string | undefined;
  /** Locale of the messages: English for JSON. */
  locale: Locale;
  env?: NodeJS.ProcessEnv;
}

/** Every check of `sdlc doctor`, in order. Throws only what the checks themselves throw (e.g. a bad roles.yaml). */
export function doctorChecks(options: DoctorOptions): DoctorCheck[] {
  const loc = options.locale;
  const out = new Checks((key, params) => t(key, params, loc), loc);
  runtimeChecks(out, options.root);
  dependencyChecks(out, options.root);
  if (!options.root) out.add('project', 'error', out.tt('doctor.noProject'), out.tt('doctor.fix.init'));
  else projectChecks(out, options.root);
  // A disabled hook cannot say so itself (B42): the user's and the project's settings files.
  for (const file of hooksDisabledFiles(options.root, options.env ?? process.env)) {
    const fix = out.tt('doctor.fix.hooksDisabled', { path: file });
    out.add('hooks disabled', 'warn', out.tt('doctor.hooksDisabled', { path: file }), fix);
  }
  return out.list;
}
