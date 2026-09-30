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
  deferredTo?: string;
  deferredUnlinked?: boolean;
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
const STATUS = /^\s*[-*]\s*\*\*Status\*\*\s*:\s*([A-Za-z-]+)(?:\s*\((D\d+)\))?/i;
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
    if (status) {
      current.status = normalizeStatus(status[1]);
      if (status[1].toLowerCase() === 'deferred') {
        if (status[2]) current.deferredTo = status[2];
        else current.deferredUnlinked = true;
      }
    }
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

/**
 * Coverage of the review passes and lenses, recorded in review.md so a pass
 * that ran and found nothing is distinguishable from a pass that never ran:
 *
 *   ## Coverage
 *   - bugs: 2 findings
 *   - adversarial: none found — checked: token replay, empty names
 *
 * Only lines under a `## Coverage` heading count.
 */
export interface CoverageEntry {
  name: string;
  /** Declared number of findings (`N finding(s)`). */
  findings?: number;
  /** For `none found`: the text after `checked:` (empty when no evidence was given). */
  none?: string;
  line: number;
}

export interface CoverageResult {
  /** Required passes/lenses with no coverage line. */
  missing: string[];
  /** `none found` without a non-empty `checked:` part. */
  unchecked: string[];
  /** Declared counts that differ from the findings tagged with that pass/lens. */
  mismatched: Array<{ name: string; declared: number; actual: number }>;
}

export function parseCoverage(content: string): CoverageEntry[] {
  const entries: CoverageEntry[] = [];
  let inCoverage = false;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (/^##\s+/.test(line)) { inCoverage = /^##\s+Coverage\s*$/i.test(line); continue; }
    if (/^#\s+/.test(line)) { inCoverage = false; continue; }
    if (!inCoverage) continue;
    const match = /^\s*[-*]\s+([a-z]+(?:-[a-z]+)*)\s*[:\-—]\s*(.*)$/i.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const value = match[2].trim();
    const count = /^(\d+)\s+findings?\b/i.exec(value);
    if (count) entries.push({ name, findings: Number(count[1]), line: index + 1 });
    else if (/^none found\b/i.test(value)) {
      const checked = /(?:^|[:\-—])\s*checked\s*:\s*(.*)$/i.exec(value);
      entries.push({ name, none: checked?.[1].trim() ?? '', line: index + 1 });
    }
  }
  return entries;
}

export function checkCoverage(findings: Finding[], coverage: CoverageEntry[], required: string[]): CoverageResult {
  const missing: string[] = [];
  const unchecked: string[] = [];
  const mismatched: CoverageResult['mismatched'] = [];
  for (const name of required) {
    const entry = coverage.find((item) => item.name === name);
    if (!entry) { missing.push(name); continue; }
    if (entry.none !== undefined && !entry.none.trim()) unchecked.push(name);
    if (entry.findings !== undefined) {
      const actual = findings.filter((finding) => finding.pass === name).length;
      if (entry.findings !== actual) mismatched.push({ name, declared: entry.findings, actual });
    }
  }
  return { missing, unchecked, mismatched };
}
