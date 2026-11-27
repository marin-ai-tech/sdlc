import * as path from 'node:path';
import type { ToolId } from '../integrations/types.js';

/**
 * Where each tool reads the skills of the agent team from (B86). src/integrations/skills.ts exports it for the
 * installers, and both project walks use it to know an installed skill folder (B249). The guard in policy-guard.ts
 * keeps its own copy with its patterns (`GUARD_SKILL_ROOTS`, `SKILL_ROOT_NAME`); test/b249-r1.test.ts proves the two
 * lists hold the same folders (B249 review F8).
 */
export const TEAM_SKILL_ROOTS: Readonly<Record<ToolId, string>> = {
  claude: '.claude/skills',
  opencode: '.opencode/skills',
  cursor: '.cursor/skills',
  codex: '.agents/skills',
  qwen: '.qwen/skills',
  gigacode: '.gigacode/skills',
};

const ROOT_PARTS = Object.values(TEAM_SKILL_ROOTS).map((root) => root.split('/'));

/**
 * True when `dir` is `<owner>/<skill root>` or lies under it. Compared without case: on Windows and macOS
 * `.Claude/Skills` is the same folder, and elsewhere the stricter answer only hands a folder to its enclosing project.
 */
function inSkillRoot(owner: string, dir: string): boolean {
  const rel = path.relative(owner, dir).split(path.sep).map((part) => part.toLowerCase());
  return ROOT_PARTS.some((root) => root.every((part, index) => rel[index] === part));
}

/** The nearest ancestor of `dir` that is a project and holds `dir` in one of its skill roots. */
function skillRootOwner(dir: string, isProject: (candidate: string) => boolean): string | undefined {
  let candidate = path.dirname(dir);
  for (;;) {
    if (inSkillRoot(candidate, dir) && isProject(candidate)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

/**
 * The project that governs `found`, the folder a project walk stopped at (B249). A configuration inside an
 * installed skill folder is not a project of its own: while `found` lies in a skill root of `<P>` and `<P>` is a
 * project by the caller's own test, `<P>` governs. A nested project outside the skill roots governs itself, and a
 * skill-root-named folder outside any project is returned as found.
 */
export function governingRoot(found: string, isProject: (candidate: string) => boolean): string {
  let current = found;
  for (;;) {
    const owner = skillRootOwner(current, isProject);
    if (owner === undefined) return current;
    current = owner;
  }
}
