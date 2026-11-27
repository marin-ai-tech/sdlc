import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText } from './fs-utils.js';
import { readTeam } from '../team/record.js';
import { agentsGuidePath, rulesInBlock } from '../team/rules-block.js';
/** The folders where SkillForge puts rule files, and the guides where it writes its rules block. */
const SKILLFORGE_RULE_DIRS = [
    '.claude/rules', '.cursor/rules', '.opencode/rules', '.codex/skillforge/rules', '.qwen/skillforge/rules',
];
const SKILLFORGE_BLOCK_GUIDES = ['QWEN.md', 'GEMINI.md'];
const SKILLFORGE_BLOCK = '<!-- skillforge:rules:start -->';
/** The agents SkillForge has no rules runtime for (Codex and Qwen Code have one since SkillForge 0.5.12). */
const RULES_NOT_CONNECTED = { gigacode: 'GigaCode' };
function hasRuleFile(root, dir) {
    try {
        return fs.readdirSync(path.join(root, dir)).some((name) => name.endsWith('.md'));
    }
    catch {
        return false;
    }
}
function hasBlock(root, guide) {
    return (readText(path.join(root, guide)) ?? '').includes(SKILLFORGE_BLOCK);
}
function skillforgeRulesPresent(root, config) {
    if (SKILLFORGE_RULE_DIRS.some((dir) => hasRuleFile(root, dir)))
        return true;
    return [agentsGuidePath(config), ...SKILLFORGE_BLOCK_GUIDES].some((guide) => hasBlock(root, guide));
}
export function teamRulesFindings(root, config) {
    const file = agentsGuidePath(config);
    const findings = rulesInBlock(root, config)
        .map((rule) => ({ key: 'doctor.rulesDuplicate', params: { rule, path: file }, fix: 'doctor.fix.rulesDuplicate' }));
    const recorded = Object.keys(readTeam(root).rules ?? {}).length;
    if (recorded > 0 && !skillforgeRulesPresent(root, config)) {
        const fix = 'doctor.fix.rulesNotInstalled';
        findings.push({ key: 'doctor.rulesNotInstalled', params: { count: recorded }, fix });
    }
    if (!config.team?.registry)
        return findings;
    for (const tool of config.tools.filter((id) => Object.hasOwn(RULES_NOT_CONNECTED, id))) {
        findings.push({ key: 'doctor.rulesNotConnected', params: { tool: RULES_NOT_CONNECTED[tool] } });
    }
    return findings;
}
