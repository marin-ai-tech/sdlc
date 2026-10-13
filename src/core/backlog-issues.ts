import type { Backlog, BacklogItemInput } from './backlog.js';

/**
 * The GitHub issue link of a backlog item (B93): the `- **Issue**: GH-<n>` field. The `list_issues` answer is
 * parsed here, because it is untrusted input: entries that do not parse are skipped, and titles are flattened
 * to one line so a title cannot inject fields into `openspec/backlog.md`.
 */

/** `GH-<n>` — how an item's `Issue` field links to an issue. */
export const ISSUE_REF = /^GH-(\d+)$/;

/** One open issue of a `list_issues` answer. */
export interface ListedIssue {
  number: number;
  title: string;
}

/** The `GH-<n>` link text of an issue number. */
export function issueRef(number: number): string {
  return `GH-${number}`;
}

/** The issue number of a `GH-<n>` link; undefined when the field is absent or not a link. */
export function issueNumber(ref: string | undefined): number | undefined {
  const match = ref === undefined ? undefined : ISSUE_REF.exec(ref);
  return match ? Number(match[1]) : undefined;
}

/** One line: control characters become spaces, runs of whitespace collapse, ends trimmed. */
function cleanTitle(title: string): string {
  return title.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** One entry of `list_issues`; undefined when it does not parse, is not open or is a pull request. */
function parseIssue(entry: unknown): ListedIssue | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.number !== 'number' || !Number.isInteger(raw.number) || raw.number <= 0) return undefined;
  if (typeof raw.title !== 'string') return undefined;
  if (raw.state !== undefined && raw.state !== 'open') return undefined;
  if (raw.pull_request !== undefined && raw.pull_request !== null) return undefined;
  const title = cleanTitle(raw.title);
  if (!title) return undefined;
  return { number: raw.number, title };
}

/** The open issues of a `list_issues` answer, deduplicated by number; everything else is skipped. */
export function parseIssueList(answer: unknown): ListedIssue[] {
  if (!Array.isArray(answer)) return [];
  const seen = new Set<number>();
  const issues: ListedIssue[] = [];
  for (const entry of answer) {
    const issue = parseIssue(entry);
    if (!issue || seen.has(issue.number)) continue;
    seen.add(issue.number);
    issues.push(issue);
  }
  return issues;
}

/** The listed issues no backlog item links to yet, as input for `addBacklogItem`. */
export function missingIssueItems(backlog: Backlog, listed: ListedIssue[]): BacklogItemInput[] {
  const linked = new Set(
    backlog.items.map((item) => item.issue).filter((ref): ref is string => ref !== undefined),
  );
  return listed
    .filter((issue) => !linked.has(issueRef(issue.number)))
    .map((issue) => ({ title: issue.title, issue: issueRef(issue.number) }));
}
