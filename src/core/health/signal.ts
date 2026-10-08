import type { SdlcConfig } from '../config.js';
import { t } from '../i18n.js';
import type { HarnessStamp } from '../license.js';
import { appendLog, readLog, type LogEntry } from '../log.js';
import type { ProjectPaths } from '../project.js';
import { runHealth, type HealthRun } from './index.js';

/**
 * Health signals (0.11.3, B67): `health.degraded` (detail: the finding id) is logged when a bad finding appears and
 * was not degraded already; `health.recovered` when a finding logged as degraded is no longer bad. The log entry
 * reaches event receivers like any other. The session start shows one line only while a bad finding exists.
 */
const DEGRADED = 'health.degraded';
const RECOVERED = 'health.recovered';

/** Finding ids whose latest health entry (by time: the log merges by union) is `health.degraded`. */
function degradedIds(entries: LogEntry[]): Set<string> {
  const latest = new Map<string, string>();
  const signals = entries.filter((entry) => (entry.event === DEGRADED || entry.event === RECOVERED) && entry.detail);
  const ordered = [...signals].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  for (const entry of ordered) latest.set(String(entry.detail), entry.event);
  return new Set([...latest].filter(([, event]) => event === DEGRADED).map(([id]) => id));
}

/**
 * Logs the changes of state for the findings of one evaluation. Only a finding that was evaluated (looked at, and
 * its collector did not fail) can be declared recovered. Never throws: the log is a record, not a gate.
 */
export function recordHealthSignals(
  root: string, config: SdlcConfig, run: HealthRun, stamp?: HarnessStamp, log?: LogEntry[],
): void {
  if (!config.log.enabled) return;
  try {
    const bad = new Set(run.drafts.filter((draft) => draft.level === 'bad').map((draft) => draft.id));
    const before = degradedIds(log ?? readLog(root));
    for (const id of [...bad].filter((item) => !before.has(item)).sort()) {
      appendLog(root, config, { event: DEGRADED, detail: id }, stamp);
    }
    const evaluated = new Set(run.evaluated);
    for (const id of [...before].filter((item) => !bad.has(item) && evaluated.has(item)).sort()) {
      appendLog(root, config, { event: RECOVERED, detail: id }, stamp);
    }
  } catch {
    // A missing signal only makes the record less complete.
  }
}

/**
 * The session-start line: present only while a bad finding exists (light evaluation, so the hook stays fast). The
 * signals are logged on the way. Undefined when everything is info or warn, or when health cannot be read.
 */
export function sessionHealthLine(root: string, paths: ProjectPaths, config: SdlcConfig): string | undefined {
  try {
    const log = readLog(root);
    const run = runHealth(root, paths, config, { badOnly: true, log });
    recordHealthSignals(root, config, run, undefined, log);
    const bad = run.drafts.filter((draft) => draft.level === 'bad').map((draft) => draft.id);
    if (bad.length === 0) return undefined;
    return t('session.health', { count: bad.length, ids: bad.join(', '), cmd: `${config.cli} health` });
  } catch {
    return undefined;
  }
}
