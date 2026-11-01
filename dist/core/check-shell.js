import { stopProcessTree } from './process-tree.js';
export function checkShell(child) {
    const pid = child.pid ?? 0;
    let exitObserved = false;
    let groupLive = false;
    child.on('exit', () => {
        exitObserved = true;
        if (process.platform === 'win32' || !pid)
            return;
        try {
            process.kill(-pid, 0);
            groupLive = true;
        }
        catch (error) {
            groupLive = error.code === 'EPERM';
        }
    });
    const exited = () => exitObserved || child.exitCode != null || child.signalCode != null;
    return {
        pid,
        exited,
        groupLiveAtExit: () => exitObserved && groupLive,
        kill: () => new Promise((resolve) => {
            if (exited())
                return resolve(false);
            const onExit = () => resolve(true);
            child.once('exit', onExit);
            if (!child.kill('SIGKILL')) {
                child.off('exit', onExit);
                resolve(false);
            }
        }),
    };
}
const noSignalNote = "Process tree cleanup sent no signal: the check's shell had already exited.";
async function noteIfNoSignal(shell, signalled, keep, noteApplies) {
    if (signalled === false && shell.exited() && await noteApplies())
        keep(Buffer.from(`\n${noSignalNote}\n`));
}
/**
 * Stops the check's process tree. `noteApplies` says, once cleanup ended, whether a cleanup that sent no signal is
 * worth reporting: after a timeout, a cancellation or with the output still held open, not after a normal exit.
 */
export async function cleanupCheckShell(shell, keep, onFailure, noteApplies = () => true) {
    try {
        const result = await stopProcessTree(shell.pid, shell);
        await noteIfNoSignal(shell, result?.signalled, keep, noteApplies);
    }
    catch (error) {
        const failure = error;
        keep(Buffer.from(`\nProcess tree cleanup failed: ${failure.message}\n`));
        await noteIfNoSignal(shell, failure.signalled, keep, noteApplies);
        onFailure();
    }
}
