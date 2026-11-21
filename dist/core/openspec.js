import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isFile } from './fs-utils.js';
import { INSTALL_COMMAND } from './license.js';
import { openspecPackageDir } from './openspec-schema.js';
export function resolveOpenSpec() {
    const fromEnv = process.env.SDLC_OPENSPEC_BIN;
    if (fromEnv) {
        return fromEnv.endsWith('.js')
            ? { command: process.execPath, args: [fromEnv], source: 'env' }
            : { command: fromEnv, args: [], source: 'env' };
    }
    const pkg = openspecPackageDir();
    if (pkg) {
        const bin = path.join(pkg, 'bin', 'openspec.js');
        if (isFile(bin))
            return { command: process.execPath, args: [bin], source: 'bundled' };
    }
    return { command: 'openspec', args: [], source: 'path' };
}
export function runOpenSpec(args, options = { cwd: process.cwd() }) {
    const bin = resolveOpenSpec();
    const result = spawnSync(bin.command, [...bin.args, ...args], {
        cwd: options.cwd,
        encoding: 'utf-8',
        stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
        input: options.input,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, OPENSPEC_NO_ANIMATION: '1' },
    });
    if (result.error) {
        throw new SdlcError('openspec_unavailable', { key: 'error.could_not_run_openspec_x_x', params: { bin_command: bin.command, result_error_message: result.error.message } }, { key: 'fix.reinstall_the_harness_x_or_install_openspec_npm_', params: { INSTALL_COMMAND: INSTALL_COMMAND } });
    }
    return {
        ok: result.status === 0,
        exitCode: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}
/**
 * Runs an OpenSpec `--json` command and parses its single JSON document.
 * OpenSpec prints exactly one JSON document on stdout in JSON mode, even on
 * failure (with a `status` diagnostics array), so failures are returned, not
 * thrown, for the caller to interpret.
 */
export function runOpenSpecJson(args, cwd) {
    const raw = runOpenSpec([...args, '--json'], { cwd });
    const text = raw.stdout.trim();
    if (!text)
        return { ok: false, raw };
    try {
        return { ok: raw.ok, data: JSON.parse(text), raw };
    }
    catch {
        return { ok: false, raw };
    }
}
export function openspecVersion(cwd) {
    const r = runOpenSpec(['--version'], { cwd });
    return r.ok ? r.stdout.trim() : undefined;
}
/** First diagnostic message from an OpenSpec JSON failure payload. */
export function openspecFailure(data, raw) {
    const status = data?.status;
    if (Array.isArray(status) && status.length > 0) {
        const d = status[0];
        return `${d.message ?? 'OpenSpec reported an error'}${d.fix ? ` (fix: ${d.fix})` : ''}`;
    }
    return (raw.stderr || raw.stdout).trim().split('\n').slice(-5).join('\n') || `openspec exited ${raw.exitCode}`;
}
