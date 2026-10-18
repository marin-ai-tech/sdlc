interface Edit { kind: ' ' | '+' | '-'; text: string }

function steps(before: string[], after: string[]): Edit[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);
  const shared = new Set(oldMiddle);
  const disjoint = newMiddle.every((line) => !shared.has(line));
  const middle = disjoint
    ? [...oldMiddle.map((text): Edit => ({ kind: '-', text })),
      ...newMiddle.map((text): Edit => ({ kind: '+', text }))]
    : myersSteps(oldMiddle, newMiddle);
  return [
    ...before.slice(0, prefix).map((text): Edit => ({ kind: ' ', text })),
    ...middle,
    ...before.slice(before.length - suffix).map((text): Edit => ({ kind: ' ', text })),
  ];
}

function myersSteps(before: string[], after: string[]): Edit[] {
  const count = before.length + after.length;
  const furthest = new Map<number, number>([[1, 0]]);
  const history: Array<Map<number, number>> = [];
  for (let distance = 0; distance <= count; distance++) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = diagonal === -distance || (diagonal !== distance
        && (furthest.get(diagonal - 1) ?? -1) < (furthest.get(diagonal + 1) ?? -1));
      let x = down ? furthest.get(diagonal + 1) ?? 0 : (furthest.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x++;
        y++;
      }
      furthest.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        history.push(new Map(furthest));
        return backtrack(before, after, history);
      }
    }
    history.push(new Map(furthest));
  }
  return [];
}

function backtrack(before: string[], after: string[], history: Array<Map<number, number>>): Edit[] {
  const edits: Edit[] = [];
  let x = before.length;
  let y = after.length;
  for (let distance = history.length - 1; distance > 0; distance--) {
    const previous = history[distance - 1];
    const diagonal = x - y;
    const down = diagonal === -distance || (diagonal !== distance
      && (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1));
    const priorDiagonal = down ? diagonal + 1 : diagonal - 1;
    const priorX = previous.get(priorDiagonal) ?? 0;
    const priorY = priorX - priorDiagonal;
    while (x > priorX && y > priorY) {
      edits.push({ kind: ' ', text: before[--x] });
      y--;
    }
    if (down) edits.push({ kind: '+', text: after[--y] });
    else edits.push({ kind: '-', text: before[--x] });
  }
  while (x > 0 && y > 0) {
    edits.push({ kind: ' ', text: before[--x] });
    y--;
  }
  while (x > 0) edits.push({ kind: '-', text: before[--x] });
  while (y > 0) edits.push({ kind: '+', text: after[--y] });
  return edits.reverse();
}

function escapeLine(line: string): string {
  return line.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** A line-based Myers diff with three context lines and normalized line endings. */
export function unifiedDiff(before: string, after: string): string {
  const oldLines = before.replace(/\r\n/g, '\n').split('\n');
  const newLines = after.replace(/\r\n/g, '\n').split('\n');
  const edits = steps(oldLines, newLines);
  const changed = edits.flatMap((edit, index) => edit.kind === ' ' ? [] : [index]);
  const output = ['--- current', '+++ proposed'];
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - 3);
    const end = Math.min(edits.length, index + 4);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  for (const [start, end] of ranges) {
    const prior = edits.slice(0, start);
    const oldStart = prior.filter((edit) => edit.kind !== '+').length + 1;
    const newStart = prior.filter((edit) => edit.kind !== '-').length + 1;
    const section = edits.slice(start, end);
    const oldCount = section.filter((edit) => edit.kind !== '+').length;
    const newCount = section.filter((edit) => edit.kind !== '-').length;
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const edit of section) output.push(`${edit.kind}${escapeLine(edit.text)}`);
  }
  return output.join('\n');
}
