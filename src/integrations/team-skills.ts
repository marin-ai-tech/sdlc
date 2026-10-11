import * as path from 'node:path';
import { readText } from '../core/fs-utils.js';
import { readTeam, skillDirs, type SkillEntry } from '../team/record.js';
import { unsafeSkillPath } from '../team/vetting.js';
import { sha256 } from './manifest.js';
import { TEAM_SKILL_ROOTS } from './skills.js';
import type { GeneratedFile, RenderContext, ToolId } from './types.js';

/**
 * The installed team skills (B74) as generated files, so the manifest owns them like the rest: each file team.json
 * records, as long as it still has the content that was checked and installed. An edited file is not rendered, so
 * it is kept as a person's edit and leaves the manifest; a file of a skill no longer in team.json is removed.
 *
 * Since B86 a skill has a copy in the skills folder of every configured tool; each recorded folder is rendered while
 * its tool is configured, so a copy whose tool was removed from `tools` goes with the next `sdlc update` (unless a
 * person edited it).
 */
export function renderTeamSkills(ctx: RenderContext): GeneratedFile[] {
  if (ctx.root === undefined) return [];
  const root = ctx.root;
  const roots = configuredRoots(ctx.tools);
  const team = readTeam(root);
  return Object.values(team.skills).flatMap((entry) => configuredDirs(entry, roots)
    .flatMap((dir) => copyFiles(root, dir, entry)));
}

/** The skills folder of each configured tool (an OpenCode copy from before Claude Code was added stays too). */
function configuredRoots(tools: readonly ToolId[]): string[] {
  return tools.map((tool) => TEAM_SKILL_ROOTS[tool]).filter((root) => root !== undefined);
}

/** The recorded folders of the skill that lie in a configured tool's skills folder. */
function configuredDirs(entry: SkillEntry, roots: string[]): string[] {
  return skillDirs(entry).filter((dir) => roots.includes(path.posix.dirname(dir)));
}

/** The files of one copy of the skill that still have the content that was installed. */
function copyFiles(root: string, dir: string, entry: SkillEntry): GeneratedFile[] {
  return Object.entries(entry.files).flatMap(([rel, digest]) => {
    const target = `${dir}/${rel}`;
    const content = unsafeSkillPath(rel) ? undefined : readText(path.join(root, target));
    if (content === undefined || sha256(content) !== digest) return [];
    return [{ path: target, content, tool: 'shared' as const, kind: 'team-skill' as const }];
  });
}
