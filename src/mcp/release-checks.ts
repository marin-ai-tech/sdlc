import type { SdlcConfig } from '../core/config.js';
import type { ReleaseCheckRecord } from '../core/change-state.js';
import { SdlcError } from '../core/errors.js';
import { headCommit } from '../core/git.js';
import type { McpCheckOutcome } from '../core/verify.js';
import { runMcpChecks } from './checks.js';
import type { McpCheck } from './registry.js';

/**
 * `release.mcp` (B47): checks in the format of `verify.mcp`, called by the CLI itself when a person approves the
 * release (`sdlc approve release`) and on demand (`sdlc release check`). They cannot approve anything: a required
 * failing check only refuses the approval (`release_checks_failed`), before anything is written. The calls, the
 * `${HEAD}`/`${CHANGE}` expansion and the masking of secrets are those of `verify.mcp` (`runMcpChecks`).
 * The approval keeps what ran and how it ended, never the servers' answers.
 */
export function releaseChecks(config: SdlcConfig): McpCheck[] {
  return config.release.mcp ?? [];
}

/** Runs the release checks for a change, with `${HEAD}` the current commit and `${CHANGE}` the change id. */
export async function runReleaseChecks(config: SdlcConfig, root: string, change: string): Promise<McpCheckOutcome[]> {
  return runMcpChecks(config, releaseChecks(config), { head: headCommit(root), change });
}

/** The checks that hold the release back: required and not ok. */
export function failingReleaseChecks(outcomes: McpCheckOutcome[]): McpCheckOutcome[] {
  return outcomes.filter((check) => check.required && !check.ok);
}

/** Each failing check by name, with its call and its reason. */
function failureDetail(failing: McpCheckOutcome[]): string {
  const one = (check: McpCheckOutcome) => `${check.name} (${check.server}/${check.tool}): ${check.reason ?? '-'}`;
  return failing.map(one).join('; ');
}

function releaseChecksFailed(change: string, failing: McpCheckOutcome[]): SdlcError {
  const message = { key: 'error.release_checks_failed', params: { checks: failureDetail(failing) } };
  return new SdlcError('release_checks_failed', message, { key: 'fix.release_checks_failed', params: { change } });
}

/** What the approval records of each check: the call and its outcome, with when it ended. */
function checkRecords(outcomes: McpCheckOutcome[], started: number): ReleaseCheckRecord[] {
  let elapsed = 0;
  return outcomes.map(({ name, server, tool, ok, duration_ms: duration }) => {
    elapsed += duration;
    return { name, server, tool, ok, at: new Date(started + elapsed).toISOString() };
  });
}

/**
 * The release checks before a release approval: none configured = `undefined` (the approval is as before); a
 * required failing check throws `release_checks_failed`; otherwise the records to keep on the approval.
 */
export async function approvalChecks(
  config: SdlcConfig,
  root: string,
  change: string,
): Promise<ReleaseCheckRecord[] | undefined> {
  if (releaseChecks(config).length === 0) return undefined;
  const started = Date.now();
  const outcomes = await runReleaseChecks(config, root, change);
  const failing = failingReleaseChecks(outcomes);
  if (failing.length > 0) throw releaseChecksFailed(change, failing);
  return checkRecords(outcomes, started);
}
