import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { SdlcError } from './errors.js';
import { isDirectory, isFile, listFilesRecursive } from './fs-utils.js';
import { readYamlObject } from './yaml-io.js';
const require = createRequire(import.meta.url);
/** Root of the installed `@fission-ai/openspec` package, when resolvable. */
export function openspecPackageDir() {
    try {
        const entry = require.resolve('@fission-ai/openspec');
        // <pkg>/dist/index.js -> <pkg>
        let dir = path.dirname(entry);
        for (let i = 0; i < 4; i += 1) {
            if (isFile(path.join(dir, 'package.json')) && isDirectory(path.join(dir, 'schemas')))
                return dir;
            dir = path.dirname(dir);
        }
    }
    catch {
        // Not installed next to the harness.
    }
    return undefined;
}
/** Root of this harness package (holds `schemas/` and `assets/`). */
export function harnessPackageDir() {
    // dist/core/openspec-schema.js -> package root
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
export function openspecUserDataDir(env = process.env) {
    if (env.XDG_DATA_HOME)
        return path.join(env.XDG_DATA_HOME, 'openspec');
    if (process.platform === 'win32') {
        const base = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
        return path.join(base, 'openspec');
    }
    return path.join(os.homedir(), '.local', 'share', 'openspec');
}
function isValidSchemaName(name) {
    return /^[a-z0-9][a-z0-9-]*$/i.test(name);
}
export function resolveSchemaDir(name, projectRoot) {
    if (!isValidSchemaName(name))
        return undefined;
    const candidates = [
        { dir: path.join(projectRoot, 'openspec', 'schemas', name), source: 'project' },
        { dir: path.join(openspecUserDataDir(), 'schemas', name), source: 'user' },
    ];
    const pkg = openspecPackageDir();
    if (pkg)
        candidates.push({ dir: path.join(pkg, 'schemas', name), source: 'package' });
    // The harness ships its own schema too, so `sdlc` resolves even before
    // `sdlc init` copies it into the project (OpenSpec itself cannot see this one).
    candidates.push({ dir: path.join(harnessPackageDir(), 'schemas', name), source: 'harness' });
    return candidates.find((c) => isFile(path.join(c.dir, 'schema.yaml')));
}
export function loadSchemaInfo(name, projectRoot) {
    const resolved = resolveSchemaDir(name, projectRoot);
    if (!resolved) {
        throw new SdlcError('schema_not_found', { key: 'error.openspec_schema_x_was_not_found_in_the_project_u', params: { name: name } }, name === 'sdlc' ? { key: 'fix.run_sdlc_init_or_update_to_install_sdlc_schema' } : undefined);
    }
    return parseSchemaFile(path.join(resolved.dir, 'schema.yaml'), resolved.source, resolved.dir);
}
export function parseSchemaFile(file, source, dir) {
    const raw = readYamlObject(file) ?? {};
    const artifactsRaw = Array.isArray(raw.artifacts) ? raw.artifacts : [];
    const artifacts = artifactsRaw.map((entry, index) => {
        const a = (entry ?? {});
        if (typeof a.id !== 'string' || typeof a.generates !== 'string') {
            throw new SdlcError('invalid_schema', { key: 'error.x_artifacts_x_needs_string_id_and_generates', params: { file: file, index: index } });
        }
        return {
            id: a.id,
            generates: a.generates,
            requires: Array.isArray(a.requires) ? a.requires.filter((r) => typeof r === 'string') : [],
            description: typeof a.description === 'string' ? a.description : '',
        };
    });
    const applyRaw = raw.apply;
    return {
        name: typeof raw.name === 'string' ? raw.name : path.basename(dir),
        version: typeof raw.version === 'number' ? raw.version : 1,
        description: typeof raw.description === 'string' ? raw.description : '',
        artifacts,
        apply: applyRaw
            ? {
                requires: Array.isArray(applyRaw.requires)
                    ? applyRaw.requires.filter((r) => typeof r === 'string')
                    : [],
                tracks: typeof applyRaw.tracks === 'string' ? applyRaw.tracks : null,
            }
            : undefined,
        source,
        dir,
    };
}
/** Schema name for a change: `.openspec.yaml` -> project config.yaml -> spec-driven. */
export function resolveChangeSchemaName(changeDir, projectRoot) {
    const meta = safeReadYaml(path.join(changeDir, '.openspec.yaml'));
    if (typeof meta?.schema === 'string' && meta.schema.trim())
        return meta.schema.trim();
    const config = safeReadYaml(path.join(projectRoot, 'openspec', 'config.yaml'))
        ?? safeReadYaml(path.join(projectRoot, 'openspec', 'config.yml'));
    if (typeof config?.schema === 'string' && config.schema.trim())
        return config.schema.trim();
    return 'spec-driven';
}
export function readOpenSpecMetadata(changeDir) {
    return safeReadYaml(path.join(changeDir, '.openspec.yaml')) ?? {};
}
function safeReadYaml(file) {
    try {
        return readYamlObject(file);
    }
    catch {
        return undefined;
    }
}
function hasGlobChars(pattern) {
    return /[*?[\]{}()!]/.test(pattern);
}
/**
 * Concrete files that currently satisfy an artifact's `generates` pattern,
 * relative to the change directory (posix). Same rule as OpenSpec: an
 * artifact is done when at least one file matches.
 */
export function resolveArtifactFiles(changeDir, generates, files) {
    const normalized = generates.replace(/\\/g, '/');
    const all = files ?? listFilesRecursive(changeDir);
    if (!hasGlobChars(normalized))
        return all.includes(normalized) ? [normalized] : [];
    const matcher = picomatch(normalized, { dot: false });
    return all.filter((f) => matcher(f));
}
/**
 * File-existence artifact states in dependency order, honoring
 * `skip_specs: true` the way OpenSpec does (artifacts generating under
 * `specs/` count as satisfied and are reported as skipped).
 */
export function computeArtifactStates(schema, changeDir) {
    const files = listFilesRecursive(changeDir);
    const meta = readOpenSpecMetadata(changeDir);
    const skipSpecs = meta.skip_specs === true;
    const complete = new Set();
    const skipped = new Set();
    const filesById = new Map();
    for (const artifact of schema.artifacts) {
        const matched = resolveArtifactFiles(changeDir, artifact.generates, files);
        filesById.set(artifact.id, matched);
        if (matched.length > 0)
            complete.add(artifact.id);
        else if (skipSpecs && artifact.generates.replace(/\\/g, '/').startsWith('specs/')) {
            complete.add(artifact.id);
            skipped.add(artifact.id);
        }
    }
    return orderArtifacts(schema).map((artifact) => {
        const missingDeps = artifact.requires.filter((dep) => !complete.has(dep));
        let status;
        if (skipped.has(artifact.id))
            status = 'skipped';
        else if (complete.has(artifact.id))
            status = 'done';
        else
            status = missingDeps.length === 0 ? 'ready' : 'blocked';
        return {
            id: artifact.id,
            generates: artifact.generates,
            requires: artifact.requires,
            files: filesById.get(artifact.id) ?? [],
            status,
            missingDeps: status === 'blocked' ? missingDeps : [],
        };
    });
}
/** Kahn's algorithm with ties broken by declaration order (OpenSpec's rule). */
export function orderArtifacts(schema) {
    const order = new Map(schema.artifacts.map((a, i) => [a.id, i]));
    const byId = new Map(schema.artifacts.map((a) => [a.id, a]));
    const inDegree = new Map(schema.artifacts.map((a) => [a.id, a.requires.filter((r) => byId.has(r)).length]));
    const dependents = new Map(schema.artifacts.map((a) => [a.id, []]));
    for (const a of schema.artifacts)
        for (const r of a.requires)
            dependents.get(r)?.push(a.id);
    const queue = schema.artifacts.filter((a) => inDegree.get(a.id) === 0).map((a) => a.id);
    const result = [];
    while (queue.length > 0) {
        queue.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        const id = queue.shift();
        result.push(byId.get(id));
        for (const dep of dependents.get(id) ?? []) {
            const next = (inDegree.get(dep) ?? 0) - 1;
            inDegree.set(dep, next);
            if (next === 0)
                queue.push(dep);
        }
    }
    // Cycles are OpenSpec's to report; keep any leftovers in declaration order.
    for (const a of schema.artifacts)
        if (!result.includes(a))
            result.push(a);
    return result;
}
