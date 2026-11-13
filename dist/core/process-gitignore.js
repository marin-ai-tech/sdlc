import * as fs from 'node:fs';
import * as path from 'node:path';
import { git, isGitRepo } from './git.js';
import { readManifest } from '../integrations/manifest.js';
/** The top-level entry a path belongs to: `openspec/`, `.qwen/`, or a file at the root such as `AGENTS.md`. */
function topLevel(rel) {
    const slash = rel.indexOf('/');
    return slash === -1 ? rel : rel.slice(0, slash + 1);
}
/** Top-level entries git ignores although sdlc generated files in them (Git's own rules, parents included). */
export function ignoredProcessPaths(root) {
    if (!isGitRepo(root))
        return [];
    const own = ['REVIEW.md', 'AGENTS.md', 'CLAUDE.md'].filter((file) => fs.existsSync(path.join(root, file)));
    const candidates = ['openspec/', ...own, ...Object.keys(readManifest(root).files)];
    const safe = [...new Set(candidates)]
        .filter((rel) => !rel.includes('..') && !/^[A-Za-z]:|^\//.test(rel))
        .filter((rel) => !/[\\:\x00-\x1f\x7f]/.test(rel));
    const result = git(root, ['check-ignore', '--no-index', '--', ...safe]);
    if (!result.ok)
        return [];
    const ignored = new Set(result.stdout.split('\n'));
    return [...new Set(safe.filter((rel) => ignored.has(rel)).map(topLevel))];
}
/** The `.gitignore` lines that allow the entries again: one per top-level entry. */
export function ignoreFix(entries) {
    return entries.map((entry) => `!/${entry}`).join('\n');
}
