/**
 * Detects a shell spawned by a coding agent. Claude Code exports
 * `CLAUDECODE=1`; OpenCode exports `OPENCODE=1` and `AGENT=1` to its process
 * tree, and the harness's OpenCode plugin adds `SDLC_AGENT` to agent shells.
 * Used to keep human-only decisions (gate approvals) out of agent sessions.
 */
export function agentEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.SDLC_AGENT) return env.SDLC_AGENT;
  if (env.CLAUDECODE === '1') return 'claude-code';
  if (env.OPENCODE === '1') return 'opencode';
  if (env.AGENT === '1') return 'agent';
  return undefined;
}
