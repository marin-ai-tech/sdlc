/**
 * Detects a shell spawned by a coding agent. Claude Code exports
 * `CLAUDECODE=1`; the OpenCode CLI exports `OPENCODE=1` and `AGENT=1` to its
 * process tree (OpenCode desktop was seen without them, 2026-10), and the
 * harness's OpenCode plugin adds `SDLC_AGENT` to agent shells (`shell.env`) —
 * the marker that does not depend on the OpenCode client. Cursor's agent terminals export `CURSOR_AGENT=1`
 * (documented for the Cursor CLI, not confirmed for the IDE; B80): separation of duties in Cursor rests on it.
 * Used to keep human-only decisions (gate approvals) out of agent sessions.
 *
 * Keep in sync: the prepare-commit-msg git hook (src/integrations/git-hook.ts, B24) checks the same markers in the
 * same order in sh, without running sdlc; test/git-hook-sync.test.ts compares the two.
 */
export function agentEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.SDLC_AGENT) return safeAgentName(env.SDLC_AGENT);
  if (env.CLAUDECODE === '1') return 'claude-code';
  if (env.OPENCODE === '1') return 'opencode';
  if (env.AGENT === '1') return 'agent';
  if (env.CURSOR_AGENT === '1') return 'cursor';
  return undefined;
}

/** The agent's name as it is shown and recorded: a plain name of up to 64 characters, else `agent`. */
function safeAgentName(value: string): string {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : 'agent';
}
