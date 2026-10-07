import * as path from 'node:path';
import { readText } from '../core/fs-utils.js';
import { readTeam } from '../team/record.js';
import { unsafeSkillPath } from '../team/vetting.js';
import { sha256 } from './manifest.js';
import type { GeneratedFile, RenderContext } from './types.js';

/**
 * The installed team skills (B74) as generated files, so the manifest owns them like the rest: each file team.json
 * records, as long as it still has the content that was checked and installed. An edited file is not rendered, so
 * it is kept as a person's edit and leaves the manifest; a file of a skill no longer in team.json is removed.
 */
export function renderTeamSkills(ctx: RenderContext): GeneratedFile[] {
  if (ctx.root === undefined) return [];
  const root = ctx.root;
  const team = readTeam(root);
  return Object.values(team.skills).flatMap((entry) => Object.entries(entry.files).flatMap(([rel, digest]) => {
    const target = `${entry.dir}/${rel}`;
    const content = unsafeSkillPath(rel) ? undefined : readText(path.join(root, target));
    if (content === undefined || sha256(content) !== digest) return [];
    return [{ path: target, content, tool: 'shared' as const, kind: 'team-skill' as const }];
  }));
}
