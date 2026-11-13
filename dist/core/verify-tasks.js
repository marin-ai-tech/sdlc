import * as path from 'node:path';
import { readText, writeTextAtomic } from './fs-utils.js';
import { parseTasks } from './tasks.js';
/** Resolve legacy verify tasks after evidence is recorded and the other work is complete. */
export function completeVerifyTasks(changeDir) {
    const file = path.join(changeDir, 'tasks.md');
    const content = readText(file);
    if (content === undefined)
        return;
    const tasks = parseTasks(content).tasks;
    const verifyTasks = tasks.filter((task) => !task.done && /\bsdlc\s+verify\b/i.test(task.description));
    if (verifyTasks.length === 0)
        return;
    const otherOpen = tasks.some((task) => !task.done && !verifyTasks.includes(task));
    if (otherOpen)
        return;
    const lines = content.split('\n');
    for (const task of verifyTasks) {
        lines[task.line - 1] = lines[task.line - 1].replace(/\[\s*\]/, '[x]');
    }
    writeTextAtomic(file, lines.join('\n'));
}
