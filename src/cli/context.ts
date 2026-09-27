import { appendHistory, writeChangeState, type ChangeState } from '../core/change-state.js';
import type { ChangeRef } from '../core/changes.js';
import { loadConfig, type SdlcConfig } from '../core/config.js';
import { harnessStamp, type HarnessStamp } from '../core/license.js';
import { appendLog } from '../core/log.js';
import { projectPaths, requireProjectRoot, type ProjectPaths } from '../core/project.js';

export interface ProjectContext {
  root: string;
  paths: ProjectPaths;
  config: SdlcConfig;
  /** scdl version and the project's license, recorded with everything the CLI writes. */
  stamp: HarnessStamp;
}

export function loadProject(cwd: string = process.cwd()): ProjectContext {
  const root = requireProjectRoot(cwd);
  const paths = projectPaths(root);
  const config = loadConfig(paths.sdlcConfig);
  return { root, paths, config, stamp: harnessStamp(config) };
}

/**
 * Records a lifecycle event: appends it to the change's history, writes the
 * change record, then appends it to the project log. History, record and log
 * entry all carry the scdl version and license.
 */
export function recordChangeEvent(
  ctx: ProjectContext,
  ref: Pick<ChangeRef, 'id' | 'dir'>,
  state: ChangeState,
  event: string,
  by?: string,
  detail?: string
): void {
  appendHistory(state, event, by, detail, ctx.stamp);
  writeChangeState(ref.dir, state, ctx.stamp);
  appendLog(ctx.root, ctx.config, { event, change: ref.id, ...(by ? { by } : {}), ...(detail ? { detail } : {}) }, ctx.stamp);
}
