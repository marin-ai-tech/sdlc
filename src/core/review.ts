/**
 * Parser for `review.md`, the review record a change carries into the archive.
 *
 * Each finding is a level-3 heading tagged with a severity and the review pass
 * that raised it, followed by bullet fields:
 *
 *   ### F1 [important][security] PII written to logs in the error path
 *   - **Where**: src/api/claims.py:42
 *   - **Status**: open
 *
 * Severities follow the playbook's REVIEW.md vocabulary: `important` findings
 * would break behavior, leak data or breach a policy; `nit` is style;
 * `pre-existing` marks issues the change did not introduce. Status is one of
 * open | fixed | accepted | wontfix (missing = open).
 */
export type FindingStatus = 'open' | 'fixed' | 'accepted' | 'wontfix';

export interface Finding {
  id?: string;
  severity: string;
  pass: string;
  title: string;
  status: FindingStatus;
  where?: string;
  line: number;
}

export interface FindingSummary {
  total: number;
  open: number;
  bySeverity: Record<string, { total: number; open: number }>;
  byPass: Record<string, number>;
  blocking: Finding[];
}

const HEADING = /^###\s+(?:([A-Za-z]+-?\d+)\s+)?\[([A-Za-z][\w-]*)\]\s*(?:\[([A-Za-z][\w-]*)\]\s*)?(.+?)\s*$/;
const STATUS = /^\s*[-*]\s*\*\*Status\*\*\s*:\s*([A-Za-z-]+)/i;
const WHERE = /^\s*[-*]\s*\*\*Where\*\*\s*:\s*(.+)$/i;

function normalizeStatus(raw: string | undefined): FindingStatus {
  const s = (raw ?? '').toLowerCase();
  if (s === 'fixed' || s === 'resolved' || s === 'done') return 'fixed';
  if (s === 'accepted' || s === 'acknowledged' || s === 'deferred') return 'accepted';
  if (s === 'wontfix' || s === 'won-t-fix' || s === 'rejected' || s === 'invalid') return 'wontfix';
  return 'open';
}

export function parseFindings(content: string): Finding[] {
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];
  let current: Finding | undefined;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = line.match(HEADING);
    if (heading) {
      current = {
        ...(heading[1] ? { id: heading[1] } : {}),
        severity: heading[2].toLowerCase(),
        pass: (heading[3] ?? 'general').toLowerCase(),
        title: heading[4],
        status: 'open',
        line: i + 1,
      };
      findings.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      current = undefined;
      continue;
    }
    if (!current) continue;
    const status = line.match(STATUS);
    if (status) current.status = normalizeStatus(status[1]);
    const where = line.match(WHERE);
    if (where) current.where = where[1].trim();
  }
  return findings;
}

export function summarizeFindings(findings: Finding[], blockOn: string[]): FindingSummary {
  const bySeverity: FindingSummary['bySeverity'] = {};
  const byPass: FindingSummary['byPass'] = {};
  const blocking: Finding[] = [];
  const blockSet = new Set(blockOn.map((s) => s.toLowerCase()));
  for (const f of findings) {
    const entry = (bySeverity[f.severity] ??= { total: 0, open: 0 });
    entry.total += 1;
    if (f.status === 'open') entry.open += 1;
    byPass[f.pass] = (byPass[f.pass] ?? 0) + 1;
    if (f.status === 'open' && blockSet.has(f.severity)) blocking.push(f);
  }
  return {
    total: findings.length,
    open: findings.filter((f) => f.status === 'open').length,
    bySeverity,
    byPass,
    blocking,
  };
}
