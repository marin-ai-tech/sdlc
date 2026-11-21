import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText } from './fs-utils.js';
import { readTeam } from '../team/record.js';
import { agentsGuidePath, rulesInBlock } from '../team/rules-block.js';
/** The folders and the AGENTS.md block where SkillForge's `sync --type rule` puts rules. */
const SKILLFORGE_RULE_DIRS = ['.claude/rules', '.cursor/rules', '.opencode/rules'];
const SKILLFORGE_BLOCK = '<!-- skillforge:rules:start -->';
/** The agents SkillForge does not install registry rules for yet. */
const RULES_NOT_CONNECTED = { codex: 'Codex CLI', qwen: 'Qwen Code', gigacode: 'GigaCode' };
function hasRuleFile(root, dir) {
    try {
        return fs.readdirSync(path.join(root, dir)).some((name) => name.endsWith('.md'));
    }
    catch {
        return false;
    }
}
function skillforgeRulesPresent(root, config) {
    const guide = readText(path.join(root, agentsGuidePath(config))) ?? '';
    return SKILLFORGE_RULE_DIRS.some((dir) => hasRuleFile(root, dir)) || guide.includes(SKILLFORGE_BLOCK);
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
