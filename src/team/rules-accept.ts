import type { SdlcConfig } from '../core/config.js';
import { refreshGeneratedFiles } from '../integrations/install.js';
import type { ApplyReport } from '../integrations/manifest.js';
import { readTeam, TEAM_PATH, writeTeam, type RuleEntry, type TeamRecord } from './record.js';
import { agentsGuidePath, applyRulesBlock } from './rules-block.js';
import { fetchRule } from './rules.js';

/** `sdlc team accept --rule <id>` (0.32.0): a person accepts one rule of the registry; placement follows. */
export interface RuleAcceptResult {
  rule: string;
  version: string;
  checksum: string;
  /** `agents-md` for a rule of the whole project, `roles` for a rule with paths. */
  placed: 'agents-md' | 'roles';
  paths?: string[];
  agentsGuide?: string;
  team: string;
  files: ApplyReport;
}

export async function acceptRule(root: string, config: SdlcConfig, id: string, by: string): Promise<RuleAcceptResult> {
  const { rule, server } = await fetchRule(config, id);
  const team = readTeam(root);
  const entry: RuleEntry = {
    version: rule.version, checksum: rule.checksum, server, description: rule.description, tags: rule.tags,
    ...(rule.paths ? { paths: rule.paths } : {}), text: rule.body, by, at: new Date().toISOString(),
  };
  team.rules = { ...(team.rules ?? {}), [id]: entry };
  writeTeam(root, team);
  const files = refreshGeneratedFiles(root, config);
  applyRulesBlock(root, config, team.rules);
  const placed = rule.paths ? 'roles' : 'agents-md';
  return { rule: id, version: rule.version, checksum: rule.checksum, placed, ...(rule.paths ? { paths: rule.paths } : {}),
    ...(placed === 'agents-md' ? { agentsGuide: agentsGuidePath(config) } : {}), team: TEAM_PATH, files };
}

/** For `sdlc update`: the AGENTS.md block follows team.json (true when the file changed). */
export function refreshRulesBlock(root: string, config: SdlcConfig, team: TeamRecord = readTeam(root)): boolean {
  return applyRulesBlock(root, config, team.rules ?? {});
}
