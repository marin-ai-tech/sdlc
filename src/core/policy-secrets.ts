import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import type { EditWrite } from './edit-texts.js';
import { t } from './i18n.js';
import type { Decision } from './policy.js';
import { relToRoot, WRITE_OPS } from './policy-shell.js';

/**
 * Rule `secret-in-edit` (B16): an agent's edit, or a shell command with a write op, that ADDS a key, a token or a
 * password is denied. A hard rule: it holds in `warn` too; only `off` allows.
 * - Built-in patterns only, no entropy guessing: few false positives.
 * - Added means: found in the new text and not in the old one. Removing a secret, or keeping one, is allowed.
 * - References and placeholders are not secrets: `${VAR}`, `$VAR`, `{{ x }}`, `<your-password>`, `process.env.X`,
 *   `os.environ[...]`, a value of one repeated character (`********`).
 * - The reason names the kind and the file, never the value or a fragment of it.
 * - Paths in `enforcement.secret_allow` (test data) are exempt; a shell write has no reliable target, so none is.
 * Every regular expression starts at a fixed prefix or at the start of a word and has no nested repetition, so the
 * scan is linear in the text.
 */
export type SecretKind = 'aws' | 'github' | 'gitlab' | 'slack' | 'google' | 'privateKey' | 'url' | 'assignment';

/** A secret found in a text; `value` is only compared, never shown. */
interface Finding {
  kind: SecretKind;
  value: string;
}

/**
 * Larger texts are not hand edits (generated files, bundles, data dumps): the rule skips them and allows the call,
 * so the hook's cost on every edit stays bounded.
 */
const MAX_TEXT = 1024 * 1024;

const KIND_KEYS: Record<SecretKind, string> = {
  aws: 'hook.secretKindAws',
  github: 'hook.secretKindGithub',
  gitlab: 'hook.secretKindGitlab',
  slack: 'hook.secretKindSlack',
  google: 'hook.secretKindGoogle',
  privateKey: 'hook.secretKindPrivateKey',
  url: 'hook.secretKindUrl',
  assignment: 'hook.secretKindAssignment',
};

/** Tokens with a fixed prefix; the whole match is the value. */
const TOKEN_PATTERNS: Array<{ kind: SecretKind; re: RegExp }> = [
  { kind: 'aws', re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g },
  { kind: 'github', re: /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,}/g },
  { kind: 'github', re: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{60,}/g },
  { kind: 'gitlab', re: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack', re: /(?<![A-Za-z0-9_-])xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google', re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  // The header and the start of the key body, so that a second key is not taken for the one already there.
  {
    kind: 'privateKey',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\r?\n[A-Za-z0-9+/=]{0,64})?/g,
  },
];
/** `scheme://user:<password>@host`; the user may be empty (`redis://:<password>@host`). */
const URL_PASSWORD = /:\/\/[^\s:/@'"`]*:([^\s/@'"`]+)@(?=[^\s/@'"`])/g;
/** `name = "value"`, `name: 'value'`, `"name": "value"`, `name := "value"`; a quoted value without spaces. */
const ASSIGNMENT = /(?<![\w.-])([A-Za-z_][\w.-]*)["'`]?[ \t]*(?::=|=|:)[ \t]*(["'`])([^\s"'`]*)\2/g;
/** The names an assignment of a secret ends with (`password`, `DB_PASSWORD`, `dbPassword`, `client.secret`). */
const SECRET_NAMES = ['password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'apikey', 'access_key', 'accesskey'];
const MIN_ASSIGNED = 12;
const REFERENCE = /^(?:\$|\{\{|process\.env|os\.environ)/;

/** References and placeholders: not secrets. */
function placeholder(value: string): boolean {
  return REFERENCE.test(value) || /^<[^>]*>$/.test(value) || /^(.)\1*$/s.test(value);
}

/** `name` ends with `word` at a word boundary: after `_`, `.` or `-`, at a camelCase hump, or as the whole name. */
function endsWithWord(name: string, word: string): boolean {
  const at = name.length - word.length;
  if (at < 0 || name.slice(at).toLowerCase() !== word) return false;
  if (at === 0) return true;
  const before = name[at - 1];
  return /[_.-]/.test(before) || (/[a-z0-9]/.test(before) && /[A-Z]/.test(name[at]));
}

function assignments(text: string): Finding[] {
  const found: Finding[] = [];
  for (const m of text.matchAll(ASSIGNMENT)) {
    const value = m[3];
    if (value.length < MIN_ASSIGNED || placeholder(value)) continue;
    if (SECRET_NAMES.some((word) => endsWithWord(m[1], word))) found.push({ kind: 'assignment', value });
  }
  return found;
}

/** Every secret in a text, by kind. */
export function findSecrets(text: string): Finding[] {
  const found: Finding[] = [];
  for (const { kind, re } of TOKEN_PATTERNS) {
    for (const m of text.matchAll(re)) {
      // AWS documents its sample keys with this suffix (`...EXAMPLE`): a placeholder.
      if (kind !== 'aws' || !m[0].endsWith('EXAMPLE')) found.push({ kind, value: m[0] });
    }
  }
  for (const m of text.matchAll(URL_PASSWORD)) {
    if (!placeholder(m[1])) found.push({ kind: 'url', value: m[1] });
  }
  found.push(...assignments(text));
  return found;
}

/** The kinds of the secrets in `added` that are not in `removed`. */
export function addedSecretKinds(added: string, removed: string): SecretKind[] {
  if (added.length > MAX_TEXT || removed.length > MAX_TEXT) return [];
  const before = new Set(findSecrets(removed).map((finding) => finding.value));
  const kinds = findSecrets(added).filter((finding) => !before.has(finding.value)).map((finding) => finding.kind);
  return [...new Set(kinds)];
}

/** The file a whole-file write replaces: its text, empty when there is none, undefined when it is too large. */
function fileOnDisk(abs: string): string | undefined {
  try {
    if (fs.statSync(abs).size > MAX_TEXT) return undefined;
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return '';
  }
}

function writeKinds(write: EditWrite, abs: string): SecretKind[] {
  if (write.added.length > MAX_TEXT) return [];
  const removed = write.removed ?? fileOnDisk(abs);
  return removed === undefined ? [] : addedSecretKinds(write.added, removed);
}

function denial(files: string[], kinds: SecretKind[]): Decision {
  const names = [...new Set(kinds)].map((kind) => t(KIND_KEYS[kind]));
  const file = [...new Set(files)].join(', ');
  const reason = t('hook.secretInEdit', { kinds: names.join(', '), file });
  return { decision: 'deny', rule: 'secret-in-edit', reason };
}

/** An edit that adds a secret to a project file outside `enforcement.secret_allow`. */
export function secretEditDenial(writes: EditWrite[] | undefined, root: string, cwd: string, allow: string[]) {
  if (!writes || writes.length === 0) return undefined;
  const exempt = allow.length === 0 ? () => false : picomatch(allow, { dot: true, nocase: true });
  const files: string[] = [];
  const kinds: SecretKind[] = [];
  for (const write of writes) {
    const rel = relToRoot(root, cwd, write.file);
    if (rel === undefined || exempt(rel)) continue;
    const found = writeKinds(write, path.resolve(cwd, write.file));
    if (found.length > 0) files.push(rel);
    kinds.push(...found);
  }
  return files.length === 0 ? undefined : denial(files, kinds);
}

/** A shell command with a write op whose text holds a secret; the whole command counts as added. */
export function shellSecretDenial(command: string): Decision | undefined {
  if (command.length > MAX_TEXT || !WRITE_OPS.test(command)) return undefined;
  const kinds = addedSecretKinds(command, '');
  return kinds.length === 0 ? undefined : denial([t('hook.secretShellTarget')], kinds);
}
