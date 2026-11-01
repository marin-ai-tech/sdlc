const IDENTIFIER = /[\w$]/;
const SPACE = /\s/;

function beforeSpace(source: string, at: number): number {
  while (at > 0 && SPACE.test(source[at - 1])) at--;
  return at;
}

function identifierStart(source: string, at: number): number {
  while (at > 0 && IDENTIFIER.test(source[at - 1])) at--;
  return at;
}

/** A closing call is trusted only when its complete receiver is the canonical literal require form. */
function requireStart(source: string, close: number): number | undefined {
  const quoteEnd = beforeSpace(source, close - 1);
  const quote = source[quoteEnd - 1];
  if (quote !== '"' && quote !== "'") return undefined;
  const quoteStart = source.lastIndexOf(quote, quoteEnd - 2);
  if (quoteStart < 0 || !/^(?:node:)?fs(?:\/promises)?$/.test(source.slice(quoteStart + 1, quoteEnd - 1))) return undefined;
  const open = beforeSpace(source, quoteStart);
  if (source[open - 1] !== '(') return undefined;
  const nameEnd = beforeSpace(source, open - 1);
  const start = identifierStart(source, nameEnd);
  if (source.slice(start, nameEnd) !== 'require' || source[beforeSpace(source, start) - 1] === '.') return undefined;
  return start;
}

/** Scan only adjacent callee tokens, rather than every earlier statement for each call. */
export function nodeCallPrefix(source: string, index: number): { text: string; start: number } {
  let at = beforeSpace(source, index);
  if (source[at - 1] !== '.') return { text: '', start: index };
  for (;;) {
    at = beforeSpace(source, at - 1);
    if (source[at - 1] === ')') {
      const start = requireStart(source, at);
      return start === undefined ? { text: '?.', start: at - 1 } : { text: source.slice(start, index), start };
    }
    const end = at;
    at = identifierStart(source, at);
    if (at === end) return { text: '?.', start: at };
    const previous = beforeSpace(source, at);
    if (source[previous - 1] !== '.' || source[previous - 2] === '.') {
      return { text: source.slice(at, index), start: at };
    }
    at = previous;
  }
}
