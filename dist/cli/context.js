import { appendHistory, writeChangeState } from '../core/change-state.js';
import { loadConfig } from '../core/config.js';
import { harnessStamp } from '../core/license.js';
import { appendLog } from '../core/log.js';
import { projectPaths, requireProjectRoot } from '../core/project.js';
export function loadProject(cwd = process.cwd()) {
    const root = requireProjectRoot(cwd);
    const paths = projectPaths(root);
    const config = loadConfig(paths.sdlcConfig);
    return { root, paths, config, stamp: harnessStamp(config) };
}
/**
 * Records a lifecycle event: appends it to the change's history, writes the
 * change record, then appends it to the project log. History, record and log
 * entry all carry the sdlc version and license.
 */
export function recordChangeEvent(ctx, ref, state, event, by, detail) {
    appendHistory(state, event, by, detail, ctx.stamp);
    writeChangeState(ref.dir, state, ctx.stamp);
    appendLog(ctx.root, ctx.config, { event, change: ref.id, ...(by ? { by } : {}), ...(detail ? { detail } : {}) }, ctx.stamp);
}
