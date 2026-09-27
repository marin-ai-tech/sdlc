import * as path from 'node:path';
import picomatch from 'picomatch';
import { isFile, readText } from './fs-utils.js';
import { git } from './git.js';
import { stripProvenance } from './license.js';

/**
 * Plan drift: how the diff departs from the approved plan. The playbook's PR
 * review checks "the eventual diff against plan.md"; computing the file-level
 * part deterministically lets the reviewer spend attention on the reasons.
 */
export interface PlanDrift {
  base?: string;
  changedFiles: string[];
  plannedPaths: string[];
  /** Changed, but plan.md never mentions them. */
  unplanned: string[];
  /** Planned files the diff does not touch. */
  untouched: string[];
}

const PATH_TOKEN = /(?:`([^`\s]+)`)|(?:^|[\s(])((?:[\w.@-]+\/)+[\w.@*-]+\/?)/gm;

/** Path-like tokens in plan.md: backticked tokens with a slash or extension, and bare a/b/c paths. */
export function plannedPaths(planText: string): string[] {
  const out = new Set<string>();
  for (const m of planText.matchAll(PATH_TOKEN)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/[),.;:]+$/, '');
    if (!raw || raw.startsWith('http') || raw.startsWith('-') || raw.includes('<')) continue;
    if (m[1] !== undefined && !raw.includes('/') && !/\.[A-Za-z0-9]{1,8}$/.test(raw)) continue;
    if (/\s/.test(raw)) continue;
    out.add(raw.replace(/^\.\//, ''));
  }
  return [...out].sort();
}

function matchesPlan(file: string, planned: string[]): boolean {
  return planned.some((p) => {
    if (p === file) return true;
    if (p.endsWith('/')) return file.startsWith(p);
    if (/[*?[]/.test(p)) return picomatch(p, { dot: true })(file);
    // A bare file name in the plan matches that file anywhere in the tree.
    if (!p.includes('/')) return path.posix.basename(file) === p;
    return false;
  });
}

export function changedFiles(root: string, base: string | undefined, exclude: string[] = ['openspec/']): string[] {
  const files = new Set<string>();
  const add = (out: string) => out.split('\n').map((s) => s.trim()).filter(Boolean).forEach((f) => files.add(f));
  if (base) {
    const committed = git(root, ['diff', '--name-only', `${base}...HEAD`]);
    if (committed.ok) add(committed.stdout);
  }
  const uncommitted = git(root, ['diff', '--name-only', 'HEAD']);
  if (uncommitted.ok) add(uncommitted.stdout);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
  if (untracked.ok) add(untracked.stdout);
  return [...files].filter((f) => !exclude.some((e) => f.startsWith(e))).sort();
}

/**
 * @param ignore files that are not part of the change's own work, such as the
 *   agent integration files the harness generated (tracked in its manifest)
 */
export function computePlanDrift(root: string, changeDir: string, base: string | undefined, ignore: string[] = []): PlanDrift {
  const planFile = path.join(changeDir, 'plan.md');
  const planned = isFile(planFile) ? plannedPaths(stripProvenance(readText(planFile) ?? '')) : [];
  const ignored = new Set(ignore);
  const changed = changedFiles(root, base).filter((f) => !ignored.has(f));
  const unplanned = planned.length > 0 ? changed.filter((f) => !matchesPlan(f, planned)) : [];
  const untouched = planned.filter(
    (p) => !p.endsWith('/') && !/[*?[]/.test(p) && p.includes('/') && !changed.includes(p)
  );
  return { ...(base ? { base } : {}), changedFiles: changed, plannedPaths: planned, unplanned, untouched };
}
