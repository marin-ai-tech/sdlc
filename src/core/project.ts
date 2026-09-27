import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isDirectory, isFile } from './fs-utils.js';

/**
 * Filesystem layout of a project that uses the harness.
 *
 * The harness deliberately shares OpenSpec's planning home: every change lives
 * in `openspec/changes/<id>/`, the living specs in `openspec/specs/`, and the
 * archive in `openspec/changes/archive/`. The only file the harness adds at
 * the root level is `openspec/sdlc.yaml`, next to OpenSpec's own `config.yaml`.
 */
export interface ProjectPaths {
  root: string;
  openspecDir: string;
  changesDir: string;
  archiveDir: string;
  specsDir: string;
  schemasDir: string;
  openspecConfig: string;
  sdlcConfig: string;
}

export function projectPaths(root: string): ProjectPaths {
  const openspecDir = path.join(root, 'openspec');
  return {
    root,
    openspecDir,
    changesDir: path.join(openspecDir, 'changes'),
    archiveDir: path.join(openspecDir, 'changes', 'archive'),
    specsDir: path.join(openspecDir, 'specs'),
    schemasDir: path.join(openspecDir, 'schemas'),
    openspecConfig: path.join(openspecDir, 'config.yaml'),
    sdlcConfig: path.join(openspecDir, 'sdlc.yaml'),
  };
}

/**
 * Finds the nearest ancestor of `start` that holds an `openspec/` planning
 * directory, the same "nearest root" rule OpenSpec applies.
 */
export function findProjectRoot(start: string = process.cwd()): string | undefined {
  let current = path.resolve(start);
  for (;;) {
    const candidate = path.join(current, 'openspec');
    if (isDirectory(candidate) && (isDirectory(path.join(candidate, 'changes')) ||
      isDirectory(path.join(candidate, 'specs')) || isFile(path.join(candidate, 'config.yaml')))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function requireProjectRoot(start: string = process.cwd()): string {
  const root = findProjectRoot(start);
  if (!root) {
    throw new SdlcError(
      'no_project_root',
      `No openspec/ directory found in ${path.resolve(start)} or any parent.`,
      'Run `sdlc init` in the project root first.'
    );
  }
  return root;
}

