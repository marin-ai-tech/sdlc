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
 *   @colbymchenry/codegraph. `codegraphIndexCommand(tools)` indexes and wires codegraph to the chosen tools only.
 * - `defaultProbe` / `defaultInstaller` spawn the command (with a shell on Windows, where npm is npm.cmd);
 *   the installer shows the command's output to the person and resolves to ok + output, never throws.
 * Nothing here runs unless a person chose it in the interactive init; agents and scripts never install.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exists } from './fs-utils.js';
import { openspecPackageDir } from './openspec-schema.js';
export const DEPENDENCY_IDS = ['openspec', 'codegraph'];
/** codegraph's agent ids for the tools sdlc supports. */
const CODEGRAPH_TARGETS = { claude: 'claude', opencode: 'opencode' };
/**
 * Indexes the project and connects codegraph to exactly the chosen tools, without codegraph's own prompts.
 * A bare `codegraph init` in a terminal asks which agents to wire and defaults to Claude Code, which wrote
 * `.claude/` into an OpenCode-only project. Without tools: index only.
 */
export function codegraphIndexCommand(tools) {
    const targets = tools.map((tool) => CODEGRAPH_TARGETS[tool]).filter(Boolean);
    if (targets.length === 0)
        return ['codegraph', 'init', '--yes'];
    return ['codegraph', 'install', '--target', targets.join(','), '--location', 'local', '--yes', '--init'];
}
const NAMES = {
    openspec: 'OpenSpec CLI',
    codegraph: 'codegraph',
};
/** Long enough for a node-based CLI to print its version on a busy machine. */
const PROBE_TIMEOUT_MS = 30000;
/** The version of the OpenSpec sdlc ships; undefined when the bundled package cannot be read. */
function bundledOpenSpecVersion() {
    const dir = openspecPackageDir();
    if (!dir)
        return undefined;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        return pkg.version;
    }
    catch {
        return undefined;
    }
}
function firstVersion(text) {
    const match = text.match(/\d+\.\d+\.\d+/);
    return match ? match[0] : undefined;
}
export function installCommand(id) {
    if (id === 'openspec') {
        // A broken install must not break doctor or init: without the bundled version, install the latest.
        const version = bundledOpenSpecVersion();
        return ['npm', 'install', '-g', version ? `@fission-ai/openspec@${version}` : '@fission-ai/openspec'];
    }
    return ['npm', 'install', '-g', '@colbymchenry/codegraph'];
}
export function detectDependencies(root, probe = defaultProbe) {
    return DEPENDENCY_IDS.map((id) => {
        const result = probe(id, ['--version'], root);
        const version = result.ok ? firstVersion(result.output) : undefined;
        const status = {
            id,
            name: NAMES[id],
            found: result.ok,
            install: installCommand(id),
        };
        if (version)
            status.version = version;
        if (id === 'codegraph')
            status.indexed = exists(path.join(root, '.codegraph'));
        return status;
    });
}
/** True when `command` is an executable file in a PATH folder (with a PATHEXT extension on Windows). */
export function onSearchPath(command, env = process.env) {
    const extensions = process.platform === 'win32'
        ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
        : [''];
    // A command given as a path (`./node_modules/.bin/sdlc`, an absolute path) is looked at directly.
    if (/[\\/]/.test(command))
        return extensions.some((ext) => isExecutable(path.resolve(`${command}${ext}`)));
    const folders = (env.PATH ?? env.Path ?? '').split(path.delimiter).map(searchFolder).filter(Boolean);
    return folders.some((folder) => extensions.some((ext) => isExecutable(path.join(folder, `${command}${ext}`))));
}
/** A PATH entry without the quotes Windows allows around it. */
function searchFolder(entry) {
    return entry.trim().replace(/^"(.*)"$/, '$1');
}
function isExecutable(file) {
    try {
        if (!fs.statSync(file).isFile())
            return false;
        if (process.platform !== 'win32')
            fs.accessSync(file, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function spawnProbe(command, args, cwd, timeout) {
    if (process.platform === 'win32') {
        return spawnSync([command, ...args].join(' '), { cwd, encoding: 'utf-8', timeout, shell: true });
    }
    return spawnSync(command, args, { cwd, encoding: 'utf-8', timeout });
}
/**
 * A probe that runs `<command> <args>` with a time limit. A command that does not answer in time is still found when
 * it is on PATH (B44: node-based tools answered too slowly on a loaded machine and were reported missing); its
 * output is then empty, so its version stays unknown.
 */
export function makeProbe(timeoutMs) {
    return (command, args, cwd) => {
        try {
            const result = spawnProbe(command, args, cwd, timeoutMs);
            const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
            const timedOut = result.error?.code === 'ETIMEDOUT';
            if (timedOut)
                return onSearchPath(command) ? { ok: true, output: '' } : { ok: false, output };
            if (result.error)
                return { ok: false, output: result.error.message };
            if (result.status !== 0)
                return { ok: false, output };
            return { ok: true, output };
        }
        catch (error) {
            return { ok: false, output: error instanceof Error ? error.message : String(error) };
        }
    };
}
export const defaultProbe = makeProbe(PROBE_TIMEOUT_MS);
export async function defaultInstaller(command, cwd) {
    const shown = command.join(' ');
    process.stdout.write(`${shown}\n`);
    try {
        const useShell = process.platform === 'win32';
        const result = useShell
            ? spawnSync(command.join(' '), {
                cwd,
                encoding: 'utf-8',
                shell: true,
                stdio: 'inherit',
            })
            : spawnSync(command[0], command.slice(1), {
                cwd,
                encoding: 'utf-8',
                stdio: 'inherit',
            });
        if (result.error)
            return { ok: false, output: result.error.message };
        if (result.status !== 0)
            return { ok: false, output: `exit ${result.status ?? 'unknown'}` };
        return { ok: true, output: '' };
    }
    catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
}
