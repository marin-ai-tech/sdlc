import { intrinsicUndefined } from './node-intrinsics.js';

export interface InlineLiteral {
  index: number;
  end: number;
  value: string;
}

export interface InlineMutations {
  names: Set<string>;
  bindings: Set<string>;
  unknown: boolean;
  source: string;
  literals: InlineLiteral[];
  literalsByIndex: ReadonlyMap<number, InlineLiteral>;
  intrinsicUndefined: boolean;
  propertyWrites: boolean;
}

/** Visible replacement invalidates a static argument-role exemption; this does not execute JavaScript. */
export function inlineMutations(code: string): InlineMutations {
  let templateExecution = false;
  const literals: InlineLiteral[] = [];
  const source = code.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    (text: string, index: number) => {
      if (text.startsWith('`') && /(?:^|[^\\])(?:\\\\)*\$\{/.test(text)) templateExecution = true;
      if (/^["'`]/.test(text)) {
        literals.push({ index, end: index + text.length, value: text.slice(1, -1) });
        // Keep only canonical module specifiers for receiver recognition, never executable-looking data.
        if (/^['"](?:node:)?fs(?:\/promises)?['"]$/.test(text)) return text;
      }
      return ' '.repeat(text.length);
    },
  );
  const names = new Set<string>();
  const bindings = new Set<string>();
  let propertyWrites = false;
  for (const match of source.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*(?:\*\*|>>>|>>|<<|&&|\|\||\?\?|[+\-*/%&|^])?=(?![=>])/g)) {
    names.add(match[1]);
    let before = match.index! - 1;
    while (before >= 0 && /\s/.test(source[before])) before--;
    if (source[before] === '.') propertyWrites = true;
    if (!/\b(?:const|let|var)\s+$/.test(source.slice(0, match.index))) bindings.add(match[1]);
  }
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(match[1]);
  const unknown = /\]\s*=(?!=)|\b(?:defineProperty|defineProperties|assign|setPrototypeOf)\s*\(/.test(source)
    || templateExecution;
  return { names, bindings, unknown, source, literals,
    literalsByIndex: new Map(literals.map(literal => [literal.index, literal])),
    intrinsicUndefined: intrinsicUndefined(source, names), propertyWrites };
}

export function unchangedInlineCall(name: string, prefix: string, mutations: InlineMutations): boolean {
  if (mutations.unknown || mutations.names.has('require') || mutations.names.has(name)) return false;
  const receiver = /^([A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*$/.exec(prefix);
  return receiver === null || !mutations.bindings.has(receiver[1]);
}

