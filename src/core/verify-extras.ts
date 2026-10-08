import * as fs from 'node:fs';
import * as path from 'node:path';
import { isFile, readText } from './fs-utils.js';
import { git } from './git.js';
import { stripProvenance } from './license.js';
import { changedFiles } from './plan-drift.js';
import { filesThatChange } from './rework.js';

/**
 * What the evidence says beside the checks (0.11.2, B57, B58): planned files the change never touched, and the
 * attachments a tester left in the change's `verification/` folder. Neither changes the verify status.
 */
export interface EvidenceExtras {
  /** Files plan.md lists under "Files that change" that the diff does not touch. */
  untouched: string[];
  /** Files under `<change>/verification/`, as `verification/<file>` (POSIX), sorted. */
  attachments: string[];
}

/** True when there is a base to compare with that is not HEAD itself (work straight on the base branch). */
function usableBase(root: string, base: string | undefined): base is string {
  if (!base) return false;
  const ids = git(root, ['rev-parse', base, 'HEAD']);
  if (!ids.ok) return false;
  const [baseId, head] = ids.stdout.split(/\r?\n/);
  return baseId !== head;
}

/**
 * Files under "## Files that change" in plan.md that the diff from the base does not touch. Empty without plan.md
 * or a usable base. Paths inside openspec/ are left out: the diff never counts them.
 */
export function untouchedPlanned(
  root: string, changeDir: string, base: string | undefined, ignore: string[],
): string[] {
  const planFile = path.join(changeDir, 'plan.md');
  if (!isFile(planFile) || !usableBase(root, base)) return [];
  const planned = filesThatChange(stripProvenance(readText(planFile) ?? ''));
  const changed = new Set(changedFiles(root, base).filter((file) => !ignore.includes(file)));
  return planned.filter((file) => !file.startsWith('openspec/') && !changed.has(file)).sort();
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), next, out);
    else if (entry.isFile()) out.push(next);
  }
}

/** The change's `verification/` files, listed only: they are not read or checked. */
export function verificationAttachments(changeDir: string): string[] {
  const dir = path.join(changeDir, 'verification');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  walk(dir, 'verification', out);
  return out.sort();
}

/** Markdown lines for the evidence block; nothing when there is nothing to say. */
export function renderExtras(extras: EvidenceExtras | undefined): string[] {
  if (!extras) return [];
  const lines: string[] = [];
  if (extras.untouched.length > 0) {
    lines.push('**Warning**: plan.md lists files the change did not touch (review the plan or the diff):');
    lines.push(...extras.untouched.map((f) => `- \`${f}\``));
    lines.push('');
  }
  if (extras.attachments.length > 0) {
    lines.push('**Attachments**:');
    lines.push(...extras.attachments.map((f) => `- [${f}](${encodeURI(f)})`));
    lines.push('');
  }
  return lines;
}
