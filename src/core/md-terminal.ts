/** Render the small Markdown subset used by guide articles as terminal text. */
function inline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

function width(text: string): number {
  return Array.from(text).length;
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => inline(cell.trim()));
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

const GAP = 2;
/** A column is never narrowed below this, so a wrapped cell still reads as words. */
const MIN_COLUMN = 8;

/**
 * Column widths that fit `maxWidth`: while the table is too wide, the widest column gives up one character, down to
 * MIN_COLUMN. Without a limit, or when the table already fits, the natural widths stay.
 */
function fitWidths(natural: number[], maxWidth: number | undefined): number[] {
  const widths = [...natural];
  if (maxWidth === undefined) return widths;
  const budget = maxWidth - GAP * (widths.length - 1);
  let total = widths.reduce((sum, size) => sum + size, 0);
  while (total > budget) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= MIN_COLUMN) break;
    widths[widest] -= 1;
    total -= 1;
  }
  return widths;
}

/** Splits a word longer than the column into pieces that fit. */
function pieces(word: string, size: number): string[] {
  const chars = Array.from(word);
  const out: string[] = [];
  for (let start = 0; start < chars.length; start += size) out.push(chars.slice(start, start + size).join(''));
  return out;
}

/** A cell's text wrapped by words into lines no wider than `size`. */
function wrap(text: string, size: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean).flatMap((w) => pieces(w, size))) {
    const next = current === '' ? word : `${current} ${word}`;
    if (width(next) <= size) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);
  return lines;
}

/** One table row as one or more terminal lines, each cell wrapped within its column. */
function renderRow(row: string[], widths: number[]): string[] {
  const wrapped = widths.map((size, column) => wrap(row[column] ?? '', size));
  const height = Math.max(...wrapped.map((cell) => cell.length));
  return Array.from({ length: height }, (_, lineIndex) => widths.map((size, column) => {
    const value = wrapped[column][lineIndex] ?? '';
    return value + ' '.repeat(size - width(value));
  }).join(' '.repeat(GAP)).trimEnd());
}

function renderTable(lines: string[], maxWidth: number | undefined): string[] {
  const rows = lines.filter((_, index) => index !== 1).map(cells);
  const count = Math.max(...rows.map((row) => row.length));
  const natural = Array.from({ length: count }, (_, column) =>
    Math.max(...rows.map((row) => width(row[column] ?? ''))));
  const widths = fitWidths(natural, maxWidth);
  const divider = widths.map((size) => '─'.repeat(size)).join(' '.repeat(GAP));
  return [...renderRow(rows[0], widths), divider, ...rows.slice(1).flatMap((row) => renderRow(row, widths))];
}

/**
 * The width tables must fit: the terminal's when the output is one, else COLUMNS when it is set, else no limit
 * (output to a file or a pipe keeps the natural width).
 */
export function terminalWidth(
  stream: { isTTY?: boolean; columns?: number } = process.stdout, env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  if (stream.isTTY && stream.columns && stream.columns > 0) return stream.columns;
  const columns = Number(env.COLUMNS);
  return Number.isInteger(columns) && columns > 0 ? columns : undefined;
}

function withoutFrontMatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/** Guide Markdown as plain terminal text; tables are fitted to `maxWidth` when it is given. */
export function markdownToTerminal(markdown: string, maxWidth?: number): string {
  const source = withoutFrontMatter(markdown).replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let code = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (/^\s*```/.test(current)) {
      code = !code;
      continue;
    }
    if (code) {
      output.push(`  ${current}`);
      continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(current);
    if (heading) {
      const title = inline(heading[2]);
      output.push(title, (heading[1].length === 1 ? '=' : '─').repeat(width(title)));
      continue;
    }
    if (source[index + 1] && isTableDivider(source[index + 1])) {
      const table = [current, source[index + 1]];
      index += 2;
      while (index < source.length && /^\s*\|/.test(source[index])) {
        table.push(source[index]);
        index += 1;
      }
      output.push(...renderTable(table, maxWidth));
      index -= 1;
      continue;
    }
    output.push(inline(current));
  }
  return output.join('\n').trimEnd();
}
