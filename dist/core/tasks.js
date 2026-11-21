/**
 * Task checkbox parsing with the exact semantics OpenSpec's apply/archive use,
 * so `sdlc status` and `openspec status` never disagree about progress.
 *
 * Pattern adapted from OpenSpec (MIT, src/utils/task-progress.ts): any list
 * marker, any single-character checkbox marker; only `x`/`X` means done, every
 * other marker (`[ ]`, `[~]`, `[-]`, `[]`) reads as unfinished; link bullets
 * such as `- [A](url)` are not tasks.
 */
const TASK_LINE_PATTERN = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/;
export function parseTasks(content) {
    const tasks = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(TASK_LINE_PATTERN);
        if (match) {
            tasks.push({
                done: (match[1] ?? '').toLowerCase() === 'x',
                description: (match[2] ?? '').trim(),
                line: i + 1,
            });
        }
    }
    const complete = tasks.filter((t) => t.done).length;
    return { total: tasks.length, complete, remaining: tasks.length - complete, tasks };
}
