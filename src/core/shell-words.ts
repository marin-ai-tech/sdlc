/** A bounded static shell view. Values are decoded; spans always refer to the original input. */
export type ShellExpansion = 'value' | 'fields' | 'command';

/** Flavor hints come from recognized literal shell bodies, never the environment. */
export interface ShellContext {
  dialect?: 'posix' | 'powershell' | 'cmd';
  delayed?: boolean;
}

export interface ShellWord {
  value: string;
  start: number;
  end: number;
  operator?: boolean;
  dynamic?: boolean;
  expansion?: ShellExpansion;
  pattern?: 'glob' | 'home';
}

export interface ShellCommand {
  words: ShellWord[];
  start: number;
  end: number;
  raw: string;
}

export interface ShellWords {
  commands: ShellCommand[];
  problem?: string;
}

export const MAX_INPUT = 131072;
const MAX_WORDS = 4096;
const MAX_NESTING = 16;

function ansiEscape(input: string, at: number): { value: string; next: number } {
  const code = input[at];
  const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07', e: '\x1b' };
  const hex = /^(?:x([a-f\d]{1,2})|u([a-f\d]{4})|U([a-f\d]{8})|([0-7]{1,3}))/i.exec(input.slice(at));
  if (!hex) return { value: simple[code] ?? code, next: at + 1 };
  const number = Number.parseInt(hex[1] ?? hex[2] ?? hex[3] ?? hex[4], hex[4] ? 8 : 16);
  return { value: number <= 0x10ffff ? String.fromCodePoint(number) : '', next: at + hex[0].length };
}

interface Quoted {
  value: string;
  next: number;
  dynamic: boolean;
  problem?: string;
  expansion?: ShellExpansion;
}

function stronger(left?: ShellExpansion, right?: ShellExpansion): ShellExpansion | undefined {
  const rank = { value: 1, fields: 2, command: 3 };
  return !left || right && rank[right] > rank[left] ? right : left;
}

function dollarExpansion(input: string, at: number, fields: boolean): ShellExpansion | undefined {
  if (input[at] !== '$' || !/[\w{(?$#@*!-]/.test(input[at + 1] ?? '')) return undefined;
  return input[at + 1] === '(' ? 'command' : fields ? 'fields' : 'value';
}

function bangExpansion(input: string, at: number, delayed?: boolean): ShellExpansion | undefined {
  if (!delayed || input[at] !== '!' || input.indexOf('!', at + 1) < 0) return undefined;
  // Delayed CMD output reaches the program's argv parser, including any inserted quote characters.
  return 'fields';
}

function quotedExpansion(input: string, at: number, quote: string, context: ShellContext): ShellExpansion | undefined {
  // Only explicit POSIX quoting guarantees a scalar remains one native argv field.
  const dollar = quote === '"' && context.dialect !== 'cmd'
    ? dollarExpansion(input, at, context.dialect !== 'posix') : undefined;
  return stronger(dollar, bangExpansion(input, at, context.delayed));
}

function quoted(input: string, at: number, ansi: boolean, context: ShellContext): Quoted {
  const quote = input[at];
  let value = '';
  let dynamic = false;
  let expansion: ShellExpansion | undefined;
  for (let i = at + 1; i < input.length; i += 1) {
    const char = input[i];
    if (char === quote) return { value, next: i + 1, dynamic, expansion };
    if (ansi && char === '\\') {
      const escape = ansiEscape(input, i + 1);
      value += escape.value;
      i = escape.next - 1;
    } else if (quote === '"' && (char === '`'
      || char === '\\' && /["$`\\\r\n]/.test(input[i + 1] ?? ''))) {
      const paired = context.dialect !== 'powershell' && char === '`' && input.indexOf('`', i + 1) >= 0;
      dynamic ||= paired;
      if (paired) expansion = 'command';
      i += 1;
      if (input[i] === '\r' && input[i + 1] === '\n') i += 1;
      if (input[i] !== '\n' && input[i] !== '\r') value += input[i];
    } else {
      if (quote === '"' && /[$`%]/.test(char)) dynamic = true;
      const scalar = quotedExpansion(input, i, quote, context);
      if (scalar) {
        dynamic = true;
        expansion = stronger(expansion, scalar);
      }
      value += char;
    }
  }
  return { value, next: input.length, dynamic, expansion, problem: 'Unterminated shell quote.' };
}

function hereExpansion(value: string, context: ShellContext): ShellExpansion | undefined {
  let expansion: ShellExpansion | undefined;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '`') {
      if (context.dialect !== 'powershell' && value.indexOf('`', i + 1) >= 0) expansion = 'command';
      i += 1;
    } else if (value[i] === '$') {
      expansion = stronger(expansion, dollarExpansion(value, i, context.dialect !== 'posix'));
    }
  }
  return expansion;
}

function hereString(input: string, at: number, context: ShellContext): Quoted {
  const closing = `${input[at + 1]}@`;
  const end = input.indexOf(closing, at + 2);
  if (end < 0) return { value: '', next: input.length, dynamic: true, problem: 'Unterminated shell here-string.' };
  const value = input.slice(at + 2, end);
  const dynamic = input[at + 1] === '"';
  return { value, next: end + 2, dynamic, expansion: dynamic ? hereExpansion(value, context) : undefined };
}

interface Lexer {
  input: string;
  windowsPaths: boolean;
  context: ShellContext;
  at: number;
  count: number;
  depth: number;
  commands: ShellCommand[];
  words: ShellWord[];
  word?: ShellWord;
  problem?: string;
}

function flush(state: Lexer): void {
  if (state.word) state.words.push(state.word);
  state.word = undefined;
}

function finish(state: Lexer): void {
  flush(state);
  if (!state.words.length) return;
  const start = state.words[0].start;
  const end = state.words[state.words.length - 1].end;
  state.commands.push({ words: state.words, start, end, raw: state.input.slice(start, end) });
  state.words = [];
}

function continuedLine(state: Lexer): boolean {
  const { input, at } = state;
  const slash = input[at] === '\\' && !state.windowsPaths && !/^[A-Za-z]:/.test(state.word?.value ?? '');
  if (input[at] !== '`' && !slash) return false;
  let end = at + 1;
  if (input[end] === '\r' && input[end + 1] === '\n') end += 1;
  if (input[end] !== '\n') return false;
  const word = state.word ?? state.words.at(-1);
  if (word && state.context.dialect !== 'powershell' && input[at] === '`' && input.indexOf('`', at + 1) >= 0) {
    word.dynamic = true;
    word.expansion = 'command';
  }
  state.at = end + 1;
  if (state.word) state.word.end = state.at;
  return true;
}

function lexicalWhitespace(state: Lexer, char: string): boolean {
  if (state.context.dialect === 'powershell') return /\s/.test(char);
  if (state.context.dialect === 'posix') return /[ \t\n]/.test(char);
  const ascii = /[ \t\r\n]/.test(char);
  if (!state.context.dialect && !ascii && /\s/.test(char)) {
    state.problem ??= 'Unquoted Unicode whitespace requires a known shell dialect.';
  }
  return ascii;
}

function boundary(state: Lexer): boolean {
  const { input, at } = state;
  const char = input[at];
  if (lexicalWhitespace(state, char) || char === ',') {
    if (/[\r\n]/.test(char)) finish(state);
    else flush(state);
  } else if (/[;&|{}]/.test(char) && !(char === '&' && /[<>]/.test(input[at - 1] ?? ''))) {
    finish(state);
    if (input[at + 1] === char) state.at += 1;
  } else if (/[()]/.test(char)) {
    flush(state);
    state.depth += char === '(' ? 1 : -1;
    if (state.depth > MAX_NESTING) state.problem = 'Shell nesting exceeds the static parsing limit.';
  } else if (/[<>]/.test(char) && (input[at - 1] !== '=' || input[at + 1] === '(')) {
    if (state.word && /^(?:\d+|\*)$/.test(state.word.value) && state.word.end === at) state.word = undefined;
    else flush(state);
    const end = at + (input[at + 1] === char || char === '>' && input[at + 1] === '|' ? 2 : 1);
    state.words.push({ value: char, start: at, end, operator: true });
    if (input[at + 1] === '(') state.words.at(-1)!.expansion = 'command';
    state.at = end;
    return true;
  } else {
    return false;
  }
  state.at += 1;
  return true;
}

function appendQuoted(state: Lexer, part: Quoted): void {
  const word = state.word!;
  word.value += part.value;
  word.dynamic ||= part.dynamic;
  if (part.expansion) word.expansion = stronger(word.expansion, part.expansion);
  state.problem ??= part.problem;
  state.at = part.next;
}

function scalarWord(state: Lexer): void {
  const { input, at } = state;
  const char = input[at];
  if (char !== '$' && char !== '%' && char !== '!') return;
  const delayed = state.context.delayed === true && char === '!' && input.indexOf('!', at + 1) >= 0;
  state.word!.dynamic ||= char === '$' || char === '%' || delayed;
  const percent = char === '%' && input.indexOf('%', at + 1) >= 0
    && state.context.dialect !== 'posix' && state.context.dialect !== 'powershell' ? 'fields' : undefined;
  const dollar = state.context.dialect !== 'cmd' ? dollarExpansion(input, at, true) : undefined;
  const scalar = stronger(dollar, bangExpansion(input, at, state.context.delayed));
  const expansion = stronger(scalar, percent);
  if (expansion) state.word!.expansion = stronger(state.word!.expansion, expansion);
}

function closingBrace(input: string, at: number): { end: number; closed: boolean } {
  let depth = 1;
  let end = at + 2;
  let quote = '';
  while (end < input.length && depth > 0) {
    const char = input[end];
    if (char === '\\') {
      end += 2;
      continue;
    }
    if (char === "'" && quote !== '"' || char === '"' && quote !== "'") {
      quote = quote === char ? '' : quote || char;
      end += 1;
      continue;
    }
    if (quote) {
      end += 1;
      continue;
    }
    if (input.slice(end, end + 2) === '${') {
      depth += 1;
      end += 2;
      continue;
    }
    if (char === '}') depth -= 1;
    end += 1;
  }
  return { end, closed: depth === 0 };
}

function substitutionInBraces(input: string, start: number, end: number): boolean {
  let quote = '';
  for (let i = start; i < end; i += 1) {
    const char = input[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === "'" && quote !== '"' || char === '"' && quote !== "'") {
      quote = quote === char ? '' : quote || char;
      continue;
    }
    if (quote === "'") continue;
    if (char === '$' && input[i + 1] === '(') return true;
    if (char === '`' && input.indexOf('`', i + 1) < end && input.indexOf('`', i + 1) >= 0) return true;
  }
  return false;
}

function bracedExpansion(state: Lexer): void {
  const { input, at } = state;
  const commandForm = /[\s|]/.test(input[at + 2] ?? '');
  const { end, closed } = closingBrace(input, at);
  state.word!.value += input.slice(at, end);
  state.word!.dynamic = true;
  // The outer braces are one word, but their default/assignment text still executes substitutions.
  const command = substitutionInBraces(input, at + 2, end - (closed ? 1 : 0));
  state.word!.expansion = stronger(state.word!.expansion,
    command || commandForm ? 'command' : state.context.dialect === 'posix' ? 'fields' : 'value');
  if (!closed) state.problem ??= 'Unterminated shell variable expansion.';
  state.at = end;
}

function readWord(state: Lexer): void {
  const { input, at } = state;
  const char = input[at];
  if (!state.word) {
    state.word = { value: '', start: at, end: at, dynamic: false };
    state.count += 1;
  }
  const word = state.word;
  const ansi = char === '$' && input[at + 1] === "'";
  if (char === '$' && input[at + 1] === '{') {
    bracedExpansion(state);
  } else if (ansi || /['"]/.test(char) || char === '@' && /['"]/.test(input[at + 1] ?? '')) {
    const part = char === '@' ? hereString(input, at, state.context)
      : quoted(input, at + (ansi ? 1 : 0), ansi, state.context);
    appendQuoted(state, part);
  } else if ((char === '\\' || char === '`') && input[at + 1] !== undefined
    && !(char === '\\' && (state.windowsPaths || /^[A-Za-z]:/.test(word.value)))) {
    const paired = state.context.dialect !== 'powershell' && char === '`' && input.indexOf('`', at + 1) >= 0;
    word.dynamic ||= paired;
    if (paired) word.expansion = 'command';
    state.at += 1;
    if (input[state.at] === '\r' && input[state.at + 1] === '\n') state.at += 1;
    if (input[state.at] !== '\r' && input[state.at] !== '\n') word.value += input[state.at];
    state.at += 1;
  } else {
    scalarWord(state);
    if (/[*?[]/.test(char)) word.pattern = 'glob';
    else if (char === '~' && at === word.start) word.pattern = 'home';
    word.value += char;
    state.at += 1;
  }
  word.end = state.at;
}

/** Parse without executing substitutions or expanding variables/globs. Limits yield a conservative diagnostic. */
export function shellWords(
  input: string, windowsPaths = windowsShell(input), context: ShellContext = {},
): ShellWords {
  if (input.length > MAX_INPUT) return { commands: [], problem: 'Shell input exceeds the static parsing limit.' };
  const state: Lexer = { input, windowsPaths, context,
    at: 0, count: 0, depth: 0, commands: [], words: [] };
  while (state.at < input.length) {
    if (continuedLine(state)) continue;
    if (!boundary(state)) readWord(state);
    if (state.count > MAX_WORDS) return { commands: [], problem: 'Shell word count exceeds the static parsing limit.' };
  }
  finish(state);
  return { commands: state.commands, ...(state.problem ? { problem: state.problem } : {}) };
}

function windowsShell(input: string): boolean {
  return /^\s*(?:\[|[A-Za-z]+-[A-Za-z]+|(?:cmd|robocopy|xcopy)\b)/i.test(input);
}

export function decodedShellWords(input: string, windowsPaths = windowsShell(input)): ShellWord[] {
  return shellWords(input, windowsPaths).commands.flatMap((command) => command.words);
}
