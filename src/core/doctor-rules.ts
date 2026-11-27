import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import { readText } from './fs-utils.js';
import { readTeam } from '../team/record.js';
import { agentsGuidePath, rulesInBlock } from '../team/rules-block.js';

/**
 * The team rules findings of `sdlc doctor` (B317). The rules block of AGENTS.md holds no registry rule, since
 * SkillForge installs them: each rule still in it (a 0.32.0 project, or a hand edit) is named. Rules accepted with
 * sdlc stay in team.json for a rollback; while none of SkillForge's rule files is in the project they reach no agent.
 * With a team registry, the agents SkillForge installs no rules for are named. Offline: nothing asks the registry.
 */
export interface RulesFinding {
  key: string;
  params: Record<string, string | number>;
  fix?: string;
}

/** The folders where SkillForge puts rule files, and the guides where it writes its rules block. */
const SKILLFORGE_RULE_DIRS = [
  '.claude/rules', '.cursor/rules', '.opencode/rules', '.codex/skillforge/rules', '.qwen/skillforge/rules',
];
const SKILLFORGE_BLOCK_GUIDES = ['QWEN.md', 'GEMINI.md'];
const SKILLFORGE_BLOCK = '<!-- skillforge:rules:start -->';

/** The agents SkillForge has no rules runtime for (Codex and Qwen Code have one since SkillForge 0.5.12). */
const RULES_NOT_CONNECTED: Record<string, string> = { gigacode: 'GigaCode' };

function hasRuleFile(root: string, dir: string): boolean {
  try {
    return fs.readdirSync(path.join(root, dir)).some((name) => name.endsWith('.md'));
  } catch {
    return false;
  }
}

function hasBlock(root: string, guide: string): boolean {
  return (readText(path.join(root, guide)) ?? '').includes(SKILLFORGE_BLOCK);
}

function skillforgeRulesPresent(root: string, config: SdlcConfig): boolean {
  if (SKILLFORGE_RULE_DIRS.some((dir) => hasRuleFile(root, dir))) return true;
  return [agentsGuidePath(config), ...SKILLFORGE_BLOCK_GUIDES].some((guide) => hasBlock(root, guide));
}

export function teamRulesFindings(root: string, config: SdlcConfig): RulesFinding[] {
  const file = agentsGuidePath(config);
  const findings: RulesFinding[] = rulesInBlock(root, config)
    .map((rule) => ({ key: 'doctor.rulesDuplicate', params: { rule, path: file }, fix: 'doctor.fix.rulesDuplicate' }));
  const recorded = Object.keys(readTeam(root).rules ?? {}).length;
  if (recorded > 0 && !skillforgeRulesPresent(root, config)) {
    const fix = 'doctor.fix.rulesNotInstalled';
    findings.push({ key: 'doctor.rulesNotInstalled', params: { count: recorded }, fix });
  }
  if (!config.team?.registry) return findings;
  for (const tool of config.tools.filter((id) => Object.hasOwn(RULES_NOT_CONNECTED, id))) {
    findings.push({ key: 'doctor.rulesNotConnected', params: { tool: RULES_NOT_CONNECTED[tool] } });
  }
  return findings;
}
