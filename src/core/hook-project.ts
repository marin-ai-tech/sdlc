import * as fs from 'node:fs';
import * as path from 'node:path';
import { governingRoot } from './skill-root.js';

/** True when `dir` holds openspec/sdlc.yaml; a stat that fails for another reason than "missing" counts as held. */
function holdsSdlcConfig(dir: string): boolean {
  try {
    fs.statSync(path.join(dir, 'openspec/sdlc.yaml'));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/**
 * Hook discovery follows actual SDLC configuration, independently of OpenSpec planning-directory discovery. A
 * configuration inside an installed skill folder of an enclosing project does not move the root (B249).
 */
export function findHookProjectRoot(start: string): string | undefined {
  let current = path.resolve(start);
  for (;;) {
    if (holdsSdlcConfig(current)) return governingRoot(current, holdsSdlcConfig);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
