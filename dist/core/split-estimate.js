import * as fs from 'node:fs';
import * as path from 'node:path';
import { readBacklog } from './backlog.js';
import { readChangeState } from './change-state.js';
import { listArchivedChanges } from './changes.js';
import { t } from './i18n.js';
import { readLog } from './log.js';
import { readLoops } from './loop-budget.js';
import { projectPaths } from './project.js';
const PLANNING_FILES = ['intent.md', 'proposal.md', 'design.md', 'plan.md', 'tasks.md'];
/** True only for a real file or folder: a link may lead outside the change folder and is never followed. */
function isPlain(file, kind) {
    try {
        const stat = fs.lstatSync(file);
        return kind === 'file' ? stat.isFile() : stat.isDirectory();
    }
    catch {
        return false;
    }
}
function specFiles(dir) {
    if (!isPlain(dir, 'dir'))
        return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory())
            return specFiles(file);
        return entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
    });
}
function coveredItems(ref, backlog) {
    const state = readChangeState(ref.dir);
    const ids = new Set();
    if (state.source?.type === 'backlog' && state.source.ref)
        ids.add(state.source.ref);
    const files = [...PLANNING_FILES.map((name) => path.join(ref.dir, name)),
        ...specFiles(path.join(ref.dir, 'specs'))];
    for (const file of files) {
        if (!isPlain(file, 'file'))
            continue;
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bB\d+\b/g))
            ids.add(match[0]);
    }
    return backlog.items.filter((item) => ids.has(item.id));
}
/** Finished verify runs per change, each run once. */
function finishedByChange(log) {
    const seen = new Set();
    const result = new Map();
    for (const entry of log) {
        if (entry.event !== 'verify.passed' && entry.event !== 'verify.failed')
            continue;
        if (entry.run?.trigger === 'reuse')
            continue;
        const id = entry.run?.id;
        if (id && seen.has(id))
            continue;
        if (id)
            seen.add(id);
        const change = entry.change ?? '';
        result.set(change, [...(result.get(change) ?? []), entry]);
    }
    return result;
}
/** Minutes of a finished full run, or undefined when its recorded duration is not a usable number. */
function fullRunMinutes(entry) {
    const duration = entry.run?.duration_ms;
    if (entry.run?.partial || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
        return undefined;
    }
    return duration / 60000;
}
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
/** Minutes of each comparable run and the number of runs of each comparable change. */
function comparables(root, backlog, finished) {
    const minutes = [];
    const counts = [];
    for (const archived of listArchivedChanges(projectPaths(root))) {
        const runs = (finished.get(archived.id) ?? []).map(fullRunMinutes)
            .filter((value) => value !== undefined);
        if (!runs.length || coveredItems(archived, backlog).length < 2)
            continue;
        counts.push(runs.length);
        minutes.push(...runs);
    }
    return { minutes, counts };
}
/** A read-only warning for a package before its first finished verify run. */
export function splitProposalWarnings(root, ref) {
    const { verifyMinutes, comparableMin } = readLoops(root).split;
    if (verifyMinutes === undefined || ref.archived)
        return [];
    const backlog = readBacklog(root);
    const items = coveredItems(ref, backlog);
    if (items.length < 2)
        return [];
    const finished = finishedByChange(readLog(root));
    if (finished.get(ref.id)?.length)
        return [];
    const { minutes, counts } = comparables(root, backlog, finished);
    if (counts.length < comparableMin) {
        const params = { setting: 'loops.verify_minutes', count: counts.length, minimum: comparableMin };
        return [t('split.insufficient', params)];
    }
    const medianMinutes = median(minutes);
    const medianRuns = median(counts);
    const estimate = Math.round(medianMinutes * medianRuns);
    if (estimate <= verifyMinutes)
        return [];
    const epic = items[0].epic;
    const command = epic && items.every((item) => item.epic === epic)
        ? `sdlc backlog epic edit ${epic} --granularity feature` : '';
    const line = t('split.proposal', { setting: 'loops.verify_minutes', budget: verifyMinutes,
        items: items.length, minutes: medianMinutes.toFixed(1), runs: medianRuns,
        low: Math.min(...counts), high: Math.max(...counts), estimate,
        points: counts.length === 1 ? t('split.onePoint') : t('split.points', { count: counts.length }) });
    return command ? [line, t('split.command', { command })] : [line];
}
