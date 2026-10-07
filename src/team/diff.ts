import { normalizeNewlines } from '../core/fs-utils.js';

/**
 * A short unified diff of two texts by lines (B71): what an agent may have changed in a draft since its source gave
 * it. Three lines of context; at most `max` lines of hunks, the rest counted. Texts too large for the line table
 * show as removed and added whole.
 */
interface Op {
  kind: ' ' | '-' | '+';
  text: string;
  a: number;
  b: number;
}

const TABLE_MAX = 4_000_000;
const CONTEXT = 3;

function lines(text: string): string[] {
  const all = normalizeNewlines(text).split('\n');
  return all.at(-1) === '' ? all.slice(0, -1) : all;
}

/** table[i][j]: the length of the longest common subsequence of a[i..] and b[j..]. */
function lcsTable(a: string[], b: string[]): Uint32Array[] {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function wholeOps(a: string[], b: string[]): Op[] {
  const removed = a.map((text, i): Op => ({ kind: '-', text, a: i, b: 0 }));
  return [...removed, ...b.map((text, j): Op => ({ kind: '+', text, a: a.length, b: j }))];
}

function ops(a: string[], b: string[]): Op[] {
  if ((a.length + 1) * (b.length + 1) > TABLE_MAX) return wholeOps(a, b);
  const table = lcsTable(a, b);
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: ' ', text: a[i++], a: i - 1, b: j++ });
    else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) {
      out.push({ kind: '-', text: a[i], a: i++, b: j });
    } else out.push({ kind: '+', text: b[j], a: i, b: j++ });
  }
  return out;
}

/** The op ranges [start, end] around the changes, merged when their context touches. */
function ranges(list: Op[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  list.forEach((op, index) => {
    if (op.kind === ' ') return;
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(list.length - 1, index + CONTEXT);
    const last = out.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  });
  return out;
}

function hunk(list: Op[], [start, end]: [number, number]): string[] {
  const part = list.slice(start, end + 1);
  const before = part.filter((op) => op.kind !== '+').length;
  const after = part.filter((op) => op.kind !== '-').length;
  const header = `@@ -${part[0].a + 1},${before} +${part[0].b + 1},${after} @@`;
  return [header, ...part.map((op) => `${op.kind}${op.text}`)];
}

/** The unified diff from `before` to `after`; empty when they are the same text. */
export function unifiedDiff(before: string, after: string, names = ['source', 'draft'], max = 60): string {
  const list = ops(lines(before), lines(after));
  const body = ranges(list).flatMap((range) => hunk(list, range));
  if (body.length === 0) return '';
  const shown = body.length > max ? [...body.slice(0, max), `... ${body.length - max} more lines`] : body;
  return `${[`--- ${names[0]}`, `+++ ${names[1]}`, ...shown].join('\n')}\n`;
}
