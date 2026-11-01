import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureLocalIgnore } from './local-ignore.js';
import { SdlcError } from './errors.js';
import { acquireWriterLock, recoverWriterLock } from './writer-lock.js';
function refused(detail) {
    throw new SdlcError('log_write', detail);
}
export function logFile(root, name) {
    let dir = fs.realpathSync(root);
    for (const part of ['openspec', '.sdlc']) {
        dir = path.join(dir, part);
        try {
            fs.mkdirSync(dir);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            refused('Linked log storage is refused');
    }
    if (!/^[a-zA-Z0-9.-]+$/.test(name))
        refused('Invalid log filename');
    const file = path.join(dir, name);
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            refused('Linked log file is refused');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    return file;
}
/** All log and local-queue writers cooperate; lock age never grants ownership. */
export function withLogWriter(root, action) {
    const lock = logFile(root, 'log.lock');
    ensureLocalIgnore(root, ['log.lock']);
    ensureLocalIgnore(root, ['log.lock.writers/']);
    const lease = acquireWriterLock(lock, 10_000);
    try {
        return action();
    }
    finally {
        lease.release();
    }
}
function writeComplete(fd, bytes) {
    let offset = 0;
    while (offset < bytes.length) {
        const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
        if (!count)
            refused('Incomplete project log append');
        offset += count;
    }
}
/** Caller holds the writer lock. Acknowledgement requires complete, parseable, flushed newline records. */
export function appendLogRecords(file, records) {
    if (!records.length)
        return;
    const bytes = Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    const fd = fs.openSync(file, 'a+', 0o600);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1)
            refused('Unsafe log append target');
        if (stat.size) {
            const tail = Buffer.alloc(1);
            if (fs.readSync(fd, tail, 0, 1, stat.size - 1) !== 1)
                refused('Cannot inspect project log tail');
            if (tail[0] !== 10)
                writeComplete(fd, Buffer.from('\n'));
        }
        const start = fs.fstatSync(fd).size;
        writeComplete(fd, bytes);
        fs.fsyncSync(fd);
        const confirmed = Buffer.alloc(bytes.length);
        let offset = 0;
        while (offset < confirmed.length) {
            const count = fs.readSync(fd, confirmed, offset, confirmed.length - offset, start + offset);
            if (!count)
                refused('Project log acknowledgement is incomplete');
            offset += count;
        }
        if (!confirmed.equals(bytes) || confirmed.at(-1) !== 10)
            refused('Project log acknowledgement differs');
        for (const line of confirmed.toString('utf8').trimEnd().split('\n'))
            JSON.parse(line);
    }
    finally {
        fs.closeSync(fd);
    }
}
export function recoverLogWriter(root) {
    recoverWriterLock(logFile(root, 'log.lock'));
}
