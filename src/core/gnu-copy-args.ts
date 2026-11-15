/**
 * The arguments of GNU cp, mv, install, ln and link as GNU getopt reads them (B323): `--` ends the options; a short
 * option that takes a value takes the rest of its word (`-tDIR`, `-rtDIR`, `-m644`) or the next word; a long option
 * takes `=value` or, when it requires one, the next word; an unambiguous prefix of a long option is that option; and
 * options may stand after the operands. Every writer check and the copy check read one destination from here.
 *
 * Doubt is refused, never guessed: an ambiguous or unknown long option, a missing value or a second target directory
 * makes the result uncertain, and the caller then treats every word as a possible destination.
 */
export interface GnuCopyArgs {
  /** Indexes into the arguments of the words that are operands (sources, and the destination without `-t`). */
  operands: number[];
  /** The value of `-t` / `--target-directory`, when given. */
  target?: string;
  /** Short option letters and long option names seen, for flags such as recursive. */
  options: string[];
  uncertain: boolean;
}

interface Table {
  /** Short letters that take a value. */
  valueShort: string;
  /** Long names that require a value (`--name value` or `--name=value`). */
  required: string[];
  /** Long names that take a value only as `--name=value`, and long flags. */
  other: string[];
}

const COMMON = ['help', 'version', 'verbose', 'debug', 'backup', 'context', 'no-target-directory'];
const TABLES: Record<string, Table> = {
  cp: {
    valueShort: 'St',
    required: ['suffix', 'target-directory', 'no-preserve', 'sparse'],
    other: [...COMMON, 'archive', 'attributes-only', 'copy-contents', 'dereference', 'force', 'interactive', 'link',
      'no-dereference', 'no-clobber', 'one-file-system', 'parents', 'preserve', 'recursive', 'reflink',
      'remove-destination', 'strip-trailing-slashes', 'symbolic-link', 'update', 'keep-directory-symlink'],
  },
  mv: {
    valueShort: 'St',
    required: ['suffix', 'target-directory'],
    other: [...COMMON, 'exchange', 'force', 'interactive', 'no-clobber', 'no-copy', 'strip-trailing-slashes',
      'update'],
  },
  install: {
    valueShort: 'Stgmo',
    required: ['suffix', 'target-directory', 'group', 'mode', 'owner', 'strip-program'],
    other: [...COMMON, 'compare', 'directory', 'preserve-timestamps', 'strip', 'preserve-context'],
  },
  ln: {
    valueShort: 'St',
    required: ['suffix', 'target-directory'],
    other: [...COMMON, 'directory', 'force', 'interactive', 'logical', 'no-dereference', 'physical', 'relative',
      'symbolic'],
  },
  link: { valueShort: '', required: [], other: ['help', 'version'] },
};

/** The long option a name stands for: exact first, else the one name it is a prefix of; undefined when ambiguous. */
function longOption(table: Table, name: string): { name: string; required: boolean } | 'ambiguous' | undefined {
  const all = [...table.required, ...table.other];
  const exact = all.find((candidate) => candidate === name);
  const found = exact ?? (() => {
    const matches = all.filter((candidate) => candidate.startsWith(name));
    return matches.length > 1 ? 'ambiguous' : matches[0];
  })();
  if (found === undefined || found === 'ambiguous') return found;
  return { name: found, required: table.required.includes(found) };
}

interface Walk {
  result: GnuCopyArgs;
  args: string[];
  at: number;
}

function setTarget(walk: Walk, value: string | undefined): void {
  if (value === undefined || walk.result.target !== undefined) walk.result.uncertain = true;
  else walk.result.target = value;
}

/** `--name[=value]`; returns the index of the last word it used. */
function readLong(walk: Walk, table: Table): number {
  const word = walk.args[walk.at];
  const equals = word.indexOf('=');
  const name = word.slice(2, equals < 0 ? undefined : equals);
  const inline = equals < 0 ? undefined : word.slice(equals + 1);
  const option = longOption(table, name);
  if (option === undefined || option === 'ambiguous') {
    if (inline === undefined) walk.result.uncertain = true;
    return walk.at;
  }
  walk.result.options.push(option.name);
  if (!option.required) return walk.at;
  const next = inline === undefined ? walk.at + 1 : walk.at;
  const value = inline ?? walk.args[next];
  if (value === undefined) walk.result.uncertain = true;
  if (option.name === 'target-directory') setTarget(walk, value);
  return next;
}

/** `-abc`, where a letter that takes a value takes the rest of the word or the next word. */
function readShort(walk: Walk, table: Table): number {
  const word = walk.args[walk.at];
  for (let j = 1; j < word.length; j += 1) {
    const letter = word[j];
    walk.result.options.push(letter);
    if (!table.valueShort.includes(letter)) continue;
    const rest = word.slice(j + 1);
    const next = rest ? walk.at : walk.at + 1;
    const value = rest || walk.args[next];
    if (value === undefined) walk.result.uncertain = true;
    if (letter === 't') setTarget(walk, value);
    return next;
  }
  return walk.at;
}

/** The arguments of one of the GNU copy tools; undefined for any other program. */
export function gnuCopyArgs(tool: string, args: string[]): GnuCopyArgs | undefined {
  const table = TABLES[tool.toLowerCase()];
  if (!table) return undefined;
  const walk: Walk = { result: { operands: [], options: [], uncertain: false }, args, at: 0 };
  let options = true;
  for (; walk.at < args.length; walk.at += 1) {
    const word = args[walk.at];
    if (!options || word === '-' || !word.startsWith('-')) walk.result.operands.push(walk.at);
    else if (word === '--') options = false;
    else walk.at = word.startsWith('--') ? readLong(walk, table) : readShort(walk, table);
  }
  return walk.result;
}

/** Every word and every value glued into an option word: what an uncertain reading may write to. */
function everyPossibleWrite(tool: string, args: string[]): string[] {
  const valueShort = TABLES[tool.toLowerCase()].valueShort;
  const out: string[] = [];
  for (const word of args) {
    if (word === '--') continue;
    if (word.startsWith('--')) {
      const equals = word.indexOf('=');
      if (equals >= 0) out.push(word.slice(equals + 1));
      continue;
    }
    if (!word.startsWith('-') || word === '-') {
      out.push(word);
      continue;
    }
    for (let j = 1; j < word.length - 1; j += 1) {
      if (valueShort.includes(word[j])) out.push(word.slice(j + 1));
    }
  }
  return out;
}

/** The last part of a path, as ln names a link made from one operand (`ln -s ../x/.claude/` makes `.claude`). */
function linkName(operand: string): string {
  const parts = operand.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) ?? operand;
}

/**
 * The written paths: the target and, for a move, the sources; every possible one when the reading is uncertain.
 * `install -d` creates every operand, and `ln` with one operand makes a link named after it in the current folder.
 */
export function gnuCopyWrites(tool: string, args: string[], move: boolean): string[] | undefined {
  const parsed = gnuCopyArgs(tool, args);
  if (!parsed) return undefined;
  if (parsed.uncertain) return everyPossibleWrite(tool, args);
  const operands = parsed.operands.map((index) => args[index]);
  const name = tool.toLowerCase();
  const folders = name === 'install' && parsed.options.some((option) => option === 'd' || option === 'directory');
  if (folders) return operands;
  if (parsed.target !== undefined) return move ? [parsed.target, ...operands] : [parsed.target];
  if (operands.length === 1 && name === 'ln') return [linkName(operands[0])];
  if (operands.length < 2) return [];
  return move ? operands : [operands[operands.length - 1]];
}
