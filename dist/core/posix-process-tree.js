import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
function signal(pid, name) {
    try {
        process.kill(pid, name);
        return true;
    }
    catch (error) {
        if (error.code !== 'ESRCH')
            throw error;
        return false;
    }
}
function processTable(timeout) {
    return new Promise((resolve, reject) => {
        execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            if (error)
                return reject(error);
            const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map((row) => row.trim().split(/\s+/).map(Number));
            if (rows.some((row) => row.length !== 3 || row.some((n) => !Number.isSafeInteger(n) || n < 0)
                || row[0] === 0))
                return reject(new Error('Invalid verification process table.'));
            resolve(rows.map(([pid, parent, group]) => ({ pid, parent, group })));
        });
    });
}
function descendants(rows, ownedGroup, parents, known, dropped) {
    const found = new Set(parents);
    for (const row of rows)
        if (row.group === ownedGroup && !dropped.has(row.pid))
            found.add(row.pid);
    let grew = true;
    while (grew) {
        grew = false;
        for (const row of rows)
            if (found.has(row.parent) && !found.has(row.pid) && !dropped.has(row.pid)) {
                found.add(row.pid);
                grew = true;
            }
    }
    return [...found].filter((pid) => !known.has(pid) && !dropped.has(pid));
}
async function waitForExit(pids, shell, root) {
    const pending = new Set(pids);
    const deadline = Date.now() + 2000;
    while (pending.size > 0) {
        for (const pid of pending) {
            if (pid === root && shell?.exited()) {
                pending.delete(pid);
                continue;
            }
            try {
                process.kill(pid, 0);
            }
            catch (error) {
                if (error.code !== 'ESRCH')
                    throw error;
                pending.delete(pid);
            }
        }
        if (pending.size === 0)
            return;
        if (Date.now() >= deadline)
            throw new Error('Verification descendants did not exit after SIGKILL.');
        await delay(20);
    }
}
function groupAllowed(state) {
    if (state.frozenLive || !state.shell?.exited())
        return true;
    const rows = state.rows;
    return !!rows && state.shell.groupLiveAtExit()
        && rows.some((row) => row.group === state.pid)
        && !rows.some((row) => row.pid === state.pid);
}
function send(state, target, name) {
    if (target === state.pid && state.shell?.exited())
        return false;
    if (target === -state.pid && !groupAllowed(state))
        return false;
    if (target > 0 && state.shell?.exited() && !groupAllowed(state)
        && state.rows?.some((row) => row.pid === target && row.group === state.pid))
        return false;
    const freezingLiveGroup = target === -state.pid && name === 'SIGSTOP' && state.shell?.exited() === false;
    const delivered = signal(target, name);
    if (freezingLiveGroup && delivered)
        state.frozenLive = true;
    // Counts delivered signals, not attempts that hit ESRCH.
    state.signalled ||= delivered;
    return delivered;
}
async function discover(state) {
    const deadline = Date.now() + 3000;
    let groupFrozen = send(state, -state.pid, 'SIGSTOP');
    for (let pass = 0; pass < 16; pass++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            throw new Error('Verification process discovery timed out.');
        state.rows = await processTable(remaining);
        if (state.shell?.exited()) {
            state.known.delete(state.pid);
            state.dropped.add(state.pid);
        }
        if (!groupFrozen && groupAllowed(state))
            groupFrozen = send(state, -state.pid, 'SIGSTOP');
        const parents = new Set(state.known);
        const includeGroup = groupAllowed(state);
        const added = includeGroup
            ? descendants(state.rows, state.pid, parents, state.known, state.dropped)
            : [];
        for (const child of added) {
            if (send(state, child, 'SIGSTOP'))
                state.known.add(child);
            else
                state.dropped.add(child);
        }
        if (added.length === 0)
            return;
    }
    throw new Error('Verification process tree did not stabilize.');
}
async function killKnown(state) {
    let failure;
    if (state.shell?.exited())
        state.known.delete(state.pid);
    try {
        send(state, -state.pid, 'SIGKILL');
    }
    catch (error) {
        failure ??= error;
    }
    for (const target of [...state.known].reverse()) {
        try {
            send(state, target, 'SIGKILL');
        }
        catch (error) {
            failure ??= error;
        }
    }
    try {
        await waitForExit(state.known, state.shell, state.pid);
    }
    catch (error) {
        failure ??= error;
    }
    return failure;
}
/** Freeze parents before collecting another table, so detached children cannot keep forking unnoticed. */
export async function stopPosixProcessTree(pid, shell) {
    const state = { pid, shell, known: new Set(shell?.exited() ? [] : [pid]),
        dropped: new Set(shell?.exited() ? [pid] : []), signalled: false, frozenLive: false };
    let failure;
    try {
        await discover(state);
    }
    catch (error) {
        failure = error;
    }
    const killFailure = await killKnown(state);
    failure ??= killFailure;
    if (failure) {
        const error = failure instanceof Error ? failure : new Error(String(failure));
        Object.assign(error, { signalled: state.signalled });
        throw error;
    }
    return { signalled: state.signalled };
}
