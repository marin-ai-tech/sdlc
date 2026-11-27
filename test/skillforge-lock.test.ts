import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SdlcConfig } from '../src/core/config.js';
import { checkRules } from '../src/team/rules.js';
import { installedSkillforgeRules, lockRuleIds } from '../src/team/skillforge-lock.js';
import { codexServesOpenCode, ruleRuntimes } from '../src/team/skillforge-runtimes.js';
import { tempDir, write } from './helpers.js';

// Unit cases next to test/skillforge-rule-hints.test.ts: the lock files are another tool's input, parsed at the
// boundary; the runtime ids are SkillForge's; without a registry, team check names no installed rule.

const lockOf = (artifacts: unknown) => JSON.stringify({ registry: 'http://x', artifacts });

describe('SkillForge lock files', () => {
  it('keeps rule ids of the registry form and nothing else', () => {
    const text = lockOf({ 'rule/go-errors': {}, 'skill/plan-mode': {}, 'rule/../x': {}, 'rule/': {}, rule: {} });
    expect(lockRuleIds(text)).toEqual(['go-errors']);
  });

  it('negative: a lock that is not JSON, or has no artifacts object, gives no rules', () => {
    expect(lockRuleIds('{ not json')).toEqual([]);
    expect(lockRuleIds(JSON.stringify({ artifacts: ['rule/go-errors'] }))).toEqual([]);
    expect(lockRuleIds(JSON.stringify(null))).toEqual([]);
  });

  it('takes the runtime from the folder, not from the file', () => {
    const root = tempDir('sdlc-sf-lock-');
    write(path.join(root, '.claude/.skillforge-lock.json'), lockOf({ 'rule/a-rule': { runtime: 'opencode' } }));
    write(path.join(root, '.qwen/.skillforge-lock.json'), lockOf({ 'rule/b-rule': {} }));
    fs.mkdirSync(path.join(root, '.codex/.skillforge-lock.json'), { recursive: true });
    expect(installedSkillforgeRules(root)).toEqual([
      { id: 'a-rule', runtime: 'claude-code' },
      { id: 'b-rule', runtime: 'qwen' },
    ]);
  });

  it('negative: without a team registry, team check names no installed rule', async () => {
    const root = tempDir('sdlc-sf-lock-');
    write(path.join(root, '.opencode/.skillforge-lock.json'), lockOf({ 'rule/go-errors': {} }));
    const config = { tools: ['opencode'] } as unknown as SdlcConfig;
    expect(await checkRules(root, config)).toEqual({ rules: [], installedNotFitting: [] });
  });
});

describe('SkillForge runtime ids', () => {
  it('Claude Code is claude-code; GigaCode has none; OpenCode is left out next to Codex', () => {
    expect(ruleRuntimes(['claude', 'cursor', 'gigacode'])).toEqual(['claude-code', 'cursor']);
    expect(ruleRuntimes(['opencode', 'codex', 'qwen'])).toEqual(['codex', 'qwen']);
    expect(codexServesOpenCode(['opencode', 'codex'])).toBe(true);
    expect(codexServesOpenCode(['opencode', 'qwen'])).toBe(false);
  });
});
