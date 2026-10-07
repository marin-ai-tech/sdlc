/**
 * The texts an edit tool call writes, per target file (B16): what the secret rule compares. A file gains `added`
 * and loses `removed`. The inputs as both agents send them:
 * - Claude Code: `content` (Write), `old_string`/`new_string` (Edit), `edits[]` (MultiEdit), `new_source`
 *   (NotebookEdit);
 * - OpenCode (the plugin passes `output.args`): `content`, `oldString`/`newString`, `patchText`/`patch`;
 * - a patch: the `*** Update File:` envelope or a unified diff, `+` lines added and `-` lines removed.
 */
export interface EditWrite {
  /** The target as the call names it: absolute, or relative to the call's `cwd`. */
  file: string;
  added: string;
  /** The text the edit replaces; undefined for a whole-file write, whose old text is the file on disk, if any. */
  removed?: string;
}

const FILE_KEYS = ['file_path', 'filePath', 'notebook_path', 'path', 'target_file'];
const PATCH_KEYS = ['patch', 'patchText', 'patch_text', 'input'];
/** `*** Update File: <path>` and the like, and the target of a rename (`*** Move to: <path>`). */
const PATCH_ENVELOPE_FILE = /^\*\*\*\s+(?:(Update|Add|Delete)\s+File|Move\s+to):\s*(.+)$/;
const PATCH_ENVELOPE_MARK = /^\*\*\*\s+(?:Begin Patch|End Patch|End of File)\s*$/;
const UNIFIED_DIFF_FILE = /^\+\+\+\s+(?:b\/)?(.+)$/;

/** The first string among `keys`. */
function text(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** MultiEdit: every replacement's new text, against every replacement's old text. */
function multiEdit(file: string, edits: unknown[]): EditWrite {
  const added: string[] = [];
  const removed: string[] = [];
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) continue;
    const fields = edit as Record<string, unknown>;
    added.push(text(fields, ['new_string', 'newString']) ?? '');
    removed.push(text(fields, ['old_string', 'oldString']) ?? '');
  }
  return { file, added: added.join('\n'), removed: removed.join('\n') };
}

/** The write of a tool that names its file: a replacement, a notebook cell or a whole file. */
function fileWrite(file: string, input: Record<string, unknown>): EditWrite | undefined {
  if (Array.isArray(input.edits)) return multiEdit(file, input.edits);
  const replacement = text(input, ['new_string', 'newString', 'new_str']);
  if (replacement !== undefined) {
    return { file, added: replacement, removed: text(input, ['old_string', 'oldString', 'old_str']) ?? '' };
  }
  const source = text(input, ['new_source']);
  // NotebookEdit: the cell's old text is not in the call, so it counts as empty.
  if (source !== undefined) return { file, added: source, removed: '' };
  const content = text(input, ['content', 'file_text']);
  return content === undefined ? undefined : { file, added: content };
}

type PatchLine = { header: true; file: string | undefined } | { header: false };

/** A line that starts a file's part of a patch (its target, or none for a deletion), or a line that is not one. */
function patchHeader(lines: string[], i: number): PatchLine | undefined {
  const line = lines[i];
  const envelope = PATCH_ENVELOPE_FILE.exec(line);
  if (envelope) return { header: true, file: envelope[1] === 'Delete' ? undefined : envelope[2].trim() };
  if (PATCH_ENVELOPE_MARK.test(line)) return { header: false };
  // A unified diff's `--- a/x` / `+++ b/x` pair; a lone `---` or `+++` line is content.
  if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) return { header: false };
  const diff = lines[i - 1]?.startsWith('--- ') ? UNIFIED_DIFF_FILE.exec(line) : null;
  if (!diff) return undefined;
  const file = diff[1].trim();
  return { header: true, file: file === '/dev/null' ? undefined : file };
}

/** The `+` and `-` lines of a patch, per target file. */
export function patchWrites(patch: string): EditWrite[] {
  const byFile = new Map<string, { added: string[]; removed: string[] }>();
  let current: { added: string[]; removed: string[] } | undefined;
  const lines = patch.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const header = patchHeader(lines, i);
    if (header?.header) {
      const file = header.file;
      current = file === undefined ? undefined : byFile.get(file) ?? { added: [], removed: [] };
      if (file !== undefined && current) byFile.set(file, current);
    } else if (header === undefined && current) {
      if (lines[i].startsWith('+')) current.added.push(lines[i].slice(1));
      if (lines[i].startsWith('-')) current.removed.push(lines[i].slice(1));
    }
  }
  const writes = [...byFile].map(([file, part]) =>
    ({ file, added: part.added.join('\n'), removed: part.removed.join('\n') }));
  // A file named only on its way to a new name (`*** Update File:` before `*** Move to:`) gains nothing.
  return writes.filter((write) => write.added !== '' || write.removed !== '');
}

/** What an edit tool call writes, per target file; empty when the call carries no text. */
export function editWrites(input: Record<string, unknown>): EditWrite[] {
  const writes: EditWrite[] = [];
  const file = FILE_KEYS.map((key) => input[key]).find((v): v is string => typeof v === 'string' && v !== '');
  const direct = file === undefined ? undefined : fileWrite(file, input);
  if (direct) writes.push(direct);
  for (const key of PATCH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && (value.includes('***') || value.includes('+++ '))) {
      writes.push(...patchWrites(value));
    }
  }
  return writes;
}
