import type { ToolId } from '../integrations/types.js';

/**
 * The agents SkillForge installs registry rules for, by its `--runtime` id (probed on SkillForge 0.6.1). Claude Code
 * is `claude-code`: SkillForge refuses the sdlc tool id `claude` as an unknown runtime. Codex gets a managed block in
 * AGENTS.md and Qwen Code one in QWEN.md (SkillForge 0.5.12 and newer). GigaCode has no SkillForge runtime.
 */
const RUNTIME_OF: Partial<Record<ToolId, string>> = {
  claude: 'claude-code',
  cursor: 'cursor',
  opencode: 'opencode',
  codex: 'codex',
  qwen: 'qwen',
};

/**
 * OpenCode reads AGENTS.md too. With Codex configured, the Codex block in AGENTS.md already reaches OpenCode, and an
 * OpenCode install on top would make it read every rule twice (SkillForge warns about it), so only Codex is named.
 */
export function codexServesOpenCode(tools: readonly string[]): boolean {
  return tools.includes('codex') && tools.includes('opencode');
}

/** The SkillForge runtimes to install rules for, in the order of the configured tools. */
export function ruleRuntimes(tools: readonly string[]): string[] {
  const skipOpenCode = codexServesOpenCode(tools);
  const runtimes: string[] = [];
  for (const tool of tools) {
    if (skipOpenCode && tool === 'opencode') continue;
    if (!Object.hasOwn(RUNTIME_OF, tool)) continue;
    const runtime = RUNTIME_OF[tool as ToolId];
    if (runtime && !runtimes.includes(runtime)) runtimes.push(runtime);
  }
  return runtimes;
}

/** The line that installs every active rule of the registry for one runtime, fitting or not. */
export function syncAllLine(runtime: string): string {
  return `skillforge sync --type rule --runtime ${runtime}`;
}

/** The line that installs one rule for one runtime. */
export function installRuleLine(id: string, runtime: string): string {
  return `skillforge install rule/${id} --runtime ${runtime}`;
}

/** The line that removes one installed rule from one runtime. */
export function uninstallRuleLine(id: string, runtime: string): string {
  return `skillforge uninstall rule/${id} --runtime ${runtime}`;
}

/** For each runtime, one install line per rule id. */
export function installRuleLines(ids: readonly string[], runtimes: readonly string[]): string[] {
  return runtimes.flatMap((runtime) => ids.map((id) => installRuleLine(id, runtime)));
}
