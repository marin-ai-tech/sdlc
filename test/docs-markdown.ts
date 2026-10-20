import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Small Markdown readers for the documentation tests: fenced code is skipped, headings get GitHub's anchors.
 */

export interface MdLink {
  line: number;
  target: string;
}

/** The lines of a Markdown file outside fenced code blocks, with their 1-based numbers. */
export function proseLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let fence: string | undefined;
  text.split('\n').forEach((raw, index) => {
    const marker = /^\s*(```+|~~~+)/.exec(raw)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? undefined : marker;
      return;
    }
    if (!fence) out.push({ line: index + 1, text: raw });
  });
  return out;
}

/** GitHub's anchor for a heading: lower case, punctuation and emoji dropped, spaces to hyphens. */
export function slug(heading: string): string {
  const plain = heading
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '');
  return plain.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** Every anchor a file offers: its headings (with GitHub's -1, -2 suffixes) and explicit id/name attributes. */
export function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const { text: line } of proseLines(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      const base = slug(heading);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      out.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]!);
  }
  return out;
}

/** Inline links and images outside code: `[text](target)`, without external and mail links. */
export function localLinks(text: string): MdLink[] {
  const out: MdLink[] = [];
  for (const { line, text: raw } of proseLines(text)) {
    const prose = raw.replace(/`[^`]*`/g, '');
    for (const m of prose.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1]!;
      if (/^(https?:|mailto:)/i.test(target)) continue;
      out.push({ line, target });
    }
  }
  return out;
}

/** Markdown files under a folder, recursively, as absolute paths. */
export function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
