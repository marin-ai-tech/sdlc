import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
export const CHECK_STARTUP_MS = 30000;
export function resolveCheckPowerShell(env = process.env) {
    const windows = env.SystemRoot ?? env.WINDIR ?? 'C:/Windows';
    const executable = path.resolve(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    try {
        if (fs.statSync(executable).isFile())
            return executable;
    }
    catch {
        // An explicit startup refusal follows; there is no uncontained fallback.
    }
    throw new Error('PowerShell executable is missing. Windows verification requires PowerShell and Add-Type.');
}
export function startOwnedCheck(root, check) {
    const windows = process.platform === 'win32';
    const executable = windows ? resolveCheckPowerShell() : check.run;
    const control = windows ? readyFile() : undefined;
    const wrapper = fileURLToPath(new URL('../../assets/windows/verify-job.ps1', import.meta.url));
    const args = windows ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper] : [];
    try {
        const child = spawn(executable, args, { cwd: root, shell: !windows, detached: !windows, windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'], env: checkEnvironment(check, control) });
        const startup = control ? awaitReadiness(child, control) : { ready: Promise.resolve(), stop: () => { } };
        return { child, ready: startup.ready, dispose: () => {
                startup.stop();
                if (control)
                    fs.rmSync(control.dir, { recursive: true, force: true });
            } };
    }
    catch (error) {
        if (control)
            fs.rmSync(control.dir, { recursive: true, force: true });
        throw error;
    }
}
function readyFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-check-startup-'));
    return { dir, file: path.join(dir, 'started.json'), nonce: randomBytes(24).toString('hex') };
}
function checkEnvironment(check, control) {
    return { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', ...check.env,
        ...(control ? { SDLC_VERIFY_COMMAND: check.run, SDLC_VERIFY_READY_FILE: control.file,
            SDLC_VERIFY_READY_NONCE: control.nonce } : {}) };
}
function isReady(child, control) {
    if (!fs.existsSync(control.file))
        return false;
    const stat = fs.lstatSync(control.file);
    if (!stat.isFile() || stat.size > 4096)
        throw new Error('Invalid Windows verification startup control file.');
    const record = JSON.parse(fs.readFileSync(control.file, 'utf8'));
    if (!record || typeof record !== 'object')
        throw new Error('Invalid Windows verification startup record.');
    const value = record;
    if (value.version !== 1 || value.nonce !== control.nonce || value.wrapper !== child.pid || value.started !== true) {
        throw new Error('Invalid Windows verification startup identity.');
    }
    return true;
}
function awaitReadiness(child, control) {
    let stop = () => { };
    const ready = new Promise((resolve, reject) => {
        const settle = (error) => {
            stop();
            if (error)
                reject(error);
            else
                resolve();
        };
        const poll = () => pollReadiness(child, control, settle);
        const onExit = () => {
            if (!poll()) {
                settle(new Error('Windows verification job startup failed; inspect PowerShell, execution policy or Add-Type.'));
            }
        };
        const onError = (error) => settle(new Error(`Windows verification startup failed: ${error.message}`));
        const interval = setInterval(poll, 20);
        const message = `Windows verification startup exceeded ${CHECK_STARTUP_MS} ms.`;
        const deadline = setTimeout(() => settle(new Error(message)), CHECK_STARTUP_MS);
        stop = () => {
            clearInterval(interval);
            clearTimeout(deadline);
            child.off('exit', onExit);
            child.off('error', onError);
        };
        child.once('exit', onExit);
        child.once('error', onError);
    });
    return { ready, stop: () => stop() };
}
function pollReadiness(child, control, settle) {
    try {
        if (!isReady(child, control))
            return false;
        settle();
    }
    catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
    }
    return true;
}
