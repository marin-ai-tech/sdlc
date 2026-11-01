import * as fs from 'node:fs';
import * as path from 'node:path';

export const WRITER_COORDINATION_DIRS = [
  'openspec/.sdlc/log.lock.writers', 'openspec/.sdlc/board.lock.writers',
];

/**
 * The state files only the harness may write, root-relative (B115): the one list the policy modules and the task
 * contract share. A change's `.sdlc.yaml` sits inside its change folder; callers add the folders on disk.
 */
export const STATE_FILES = [
  'openspec/.sdlc/plugins/**',
  ...WRITER_COORDINATION_DIRS.map(dir => `${dir}/**`),
  'openspec/backlog.md', 'openspec/roles.yaml', 'openspec/executors.yaml', 'openspec/.sdlc/log.jsonl',
  'openspec/.sdlc/hook-log.jsonl', 'openspec/.sdlc/log.lock',
  'openspec/.sdlc/team.json', 'openspec/.sdlc/board.json', 'openspec/.sdlc/board.lock',
];

/** Actual flat writer tickets, including partial publications; only the two reserved directories are read. */
export function writerCoordinationFiles(root: string): string[] {
  return WRITER_COORDINATION_DIRS.flatMap(dir => {
    try {
      return fs.readdirSync(path.join(root, dir)).map(name => `${dir}/${name}`);
    } catch {
      return [];
    }
  });
}
