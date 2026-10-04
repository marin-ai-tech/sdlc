/**
 * Optional tools around sdlc: the OpenSpec CLI on PATH (sdlc itself runs its bundled OpenSpec; the global CLI
 * lets people call `openspec` and `/opsx` directly) and codegraph (a code index agents query first).
 *
 * Contract (the lead's; implementation by the executor):
 * - `detectDependencies(root, probe)`: one status per DEPENDENCY_IDS entry, in that order. Found = the probe
 *   of `<bin> --version` succeeds (never the bundled OpenSpec: the probe runs the command name from PATH);
 *   `version` = the first x.y.z in its output. codegraph also reports `indexed` = `<root>/.codegraph` exists.
 * - `installCommand('openspec')` = npm install -g @fission-ai/openspec@<bundled version> (the version of the
 *   OpenSpec sdlc ships, from its package.json); `installCommand('codegraph')` = npm install -g
 *   @colbymchenry/codegraph. `CODEGRAPH_INDEX` = codegraph init (run in the project root).
 * - `defaultProbe` / `defaultInstaller` spawn the command (with a shell on Windows, where npm is npm.cmd);
 *   the installer shows the command's output to the person and resolves to ok + output, never throws.
 * Nothing here runs unless a person chose it in the interactive init; agents and scripts never install.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exists } from './fs-utils.js';
import { openspecPackageDir } from './openspec-schema.js';

export const DEPENDENCY_IDS = ['openspec', 'codegraph'] as const;
export type DependencyId = (typeof DEPENDENCY_IDS)[number];

export interface DependencyStatus {
  id: DependencyId;
  /** Human name: "OpenSpec CLI", "codegraph". */
  name: string;
  found: boolean;
  version?: string;
  /** The command that installs it. */
  install: string[];
  /** codegraph only: the project has a `.codegraph/` index. */
  indexed?: boolean;
}

export interface CommandResult {
  ok: boolean;
  output: string;
}

/** Runs `<command> <args>` from PATH and reports whether it worked. */
export type Probe = (command: string, args: string[], cwd: string) => CommandResult;
/** Runs an install or index command for a person who asked for it. */
export type Installer = (command: string[], cwd: string) => Promise<CommandResult>;

export const CODEGRAPH_INDEX = ['codegraph', 'init'];

const NAMES: Record<DependencyId, string> = {
  openspec: 'OpenSpec CLI',
  codegraph: 'codegraph',
};

const PROBE_TIMEOUT_MS = 5000;

/** The version of the OpenSpec sdlc ships; undefined when the bundled package cannot be read. */
function bundledOpenSpecVersion(): string | undefined {
  const dir = openspecPackageDir();
  if (!dir) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function firstVersion(text: string): string | undefined {
  const match = text.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : undefined;
}

export function installCommand(id: DependencyId): string[] {
  if (id === 'openspec') {
    // A broken install must not break doctor or init: without the bundled version, install the latest.
    const version = bundledOpenSpecVersion();
    return ['npm', 'install', '-g', version ? `@fission-ai/openspec@${version}` : '@fission-ai/openspec'];
  }
  return ['npm', 'install', '-g', '@colbymchenry/codegraph'];
}

export function detectDependencies(root: string, probe: Probe = defaultProbe): DependencyStatus[] {
  return DEPENDENCY_IDS.map((id) => {
    const result = probe(id, ['--version'], root);
    const version = result.ok ? firstVersion(result.output) : undefined;
    const status: DependencyStatus = {
      id,
      name: NAMES[id],
      found: result.ok,
      install: installCommand(id),
    };
    if (version) status.version = version;
    if (id === 'codegraph') status.indexed = exists(path.join(root, '.codegraph'));
    return status;
  });
}

export function defaultProbe(command: string, args: string[], cwd: string): CommandResult {
  try {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf-8',
      timeout: PROBE_TIMEOUT_MS,
      shell: process.platform === 'win32',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.error) return { ok: false, output: result.error.message };
    if (result.status !== 0) return { ok: false, output };
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function defaultInstaller(command: string[], cwd: string): Promise<CommandResult> {
  const shown = command.join(' ');
  process.stdout.write(`${shown}\n`);
  try {
    const result = spawnSync(command[0], command.slice(1), {
      cwd,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    if (result.error) return { ok: false, output: result.error.message };
    if (result.status !== 0) return { ok: false, output: `exit ${result.status ?? 'unknown'}` };
    return { ok: true, output: '' };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
