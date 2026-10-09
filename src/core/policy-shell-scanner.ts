/** Visit shell characters with quote and here-string boundaries identified. */
type Visitor = (char: string, index: number, quoted: boolean, edge: boolean) => void;

function quotedStep(input: string, i: number, quote: string, visit: Visitor): { next: number; closed: boolean } {
  const char = input[i];
  if (char === quote && quote === "'" && input[i + 1] === quote) {
    visit(char, i, true, false);
    return { next: i + 1, closed: false };
  }
  if (char === quote) {
    visit(char, i, true, true);
    return { next: i, closed: true };
  }
  if (quote === '"' && (char === '\\' || char === '`') && input[i + 1] !== undefined) {
    visit(char, i, true, false);
    visit(input[i + 1], i + 1, true, false);
    return { next: i + 1, closed: false };
  }
  visit(char, i, true, false);
  return { next: i, closed: false };
}

export function scanShell(input: string, visit: Visitor): void {
  let quote = '';
  let here = '';
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (here) {
      const closing = (i === 0 || input[i - 1] === '\n') && input.startsWith(here, i);
      visit(char, i, true, closing);
      if (closing) {
        i += here.length - 1;
        here = '';
      }
      continue;
    }
    if (quote) {
      const step = quotedStep(input, i, quote, visit);
      i = step.next;
      if (step.closed) {
        quote = '';
      }
      continue;
    }
    if (char === '@' && (input[i + 1] === "'" || input[i + 1] === '"')) {
      here = `${input[i + 1]}@`;
      visit(char, i, true, true);
      i += 1;
      visit(input[i], i, true, true);
    } else if (char === "'" || char === '"') {
      quote = char;
      visit(char, i, true, true);
    } else {
      visit(char, i, false, false);
    }
  }
}
