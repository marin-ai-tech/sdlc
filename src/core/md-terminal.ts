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

function renderTable(lines: string[]): string[] {
  const rows = lines.filter((_, index) => index !== 1).map(cells);
  const count = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: count }, (_, column) =>
    Math.max(...rows.map((row) => width(row[column] ?? ''))));
  const renderRow = (row: string[]): string => widths.map((size, column) => {
    const value = row[column] ?? '';
    return value + ' '.repeat(size - width(value));
  }).join('  ').trimEnd();
  const header = renderRow(rows[0]);
  const divider = widths.map((size) => '─'.repeat(size)).join('  ');
  return [header, divider, ...rows.slice(1).map(renderRow)];
}

function withoutFrontMatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

export function markdownToTerminal(markdown: string): string {
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
      output.push(...renderTable(table));
      index -= 1;
      continue;
    }
    output.push(inline(current));
  }
  return output.join('\n').trimEnd();
}
