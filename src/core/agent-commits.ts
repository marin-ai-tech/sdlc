import { git } from './git.js';

/**
 * How much of the history agents committed (B24): the commits reachable from HEAD and how many of them carry an
 * `SDLC-Agent:` trailer (added by sdlc's prepare-commit-msg hook in agent sessions).
 */
export interface AgentCommits {
  total: number;
  agent: number;
}

const RECORD = '\x1e';
const FIELD = '\x1f';
const FORMAT = '--format=%x1e%ct%x1f%(trailers:key=SDLC-Agent,valueonly,separator=%x2c)';

/** The period start in epoch milliseconds; undefined for no (or an unreadable) start. */
function sinceMs(since: string | undefined): number | undefined {
  if (since === undefined) return undefined;
  const at = Date.parse(since);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * Counts the commits reachable from HEAD in one `git log` call; with `since`, only those committed at or after it.
 * The period is applied here, not by git's `--since`, whose date parsing drops some dates (a far future year) and
 * which stops at the first older commit of a merged history. Outside a git repository or without commits both
 * counts are 0.
 */
export function agentCommits(root: string, since?: string): AgentCommits {
  const result = git(root, ['log', FORMAT, 'HEAD', '--']);
  if (!result.ok) return { total: 0, agent: 0 };
  const start = sinceMs(since);
  const records = result.stdout.split(RECORD).slice(1).map((record) => record.split(FIELD));
  const inPeriod = records.filter(([seconds]) => start === undefined || Number(seconds) * 1000 >= start);
  const agent = inPeriod.filter(([, trailers]) => (trailers ?? '').trim() !== '').length;
  return { total: inPeriod.length, agent };
}
