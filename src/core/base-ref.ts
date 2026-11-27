import { SdlcError } from './errors.js';

/**
 * A base ref reaches git as an argument (merge-base, rev-parse, cat-file, diff), so a value that starts with "-"
 * would be read as an option: `git diff --output=<file>` writes a file (B249). Such a value is refused where it
 * enters (review.base, every --base option, the default guess); the git calls also pass `--end-of-options`.
 */
export function isOptionLike(value: string): boolean {
  return value.startsWith('-');
}

/** The longest base ref sdlc takes (B249 review round 2, F1). */
export const MAX_BASE_REF = 200;

/** Letters, digits and `._/~^@{}:+-`: no whitespace, control, format or shell characters. */
const PLAIN_REF = /^[\p{L}\p{N}._/~^@{}:+-]+$/u;

/**
 * A plain ref (B249 review round 2, F1): a branch, tag, hash or a revision such as `HEAD~1`, `main@{1}` or `HEAD^2`.
 * A commit-message search (`^{/text}`) is not one: it resolves in git, so its text would reach the JSON `base` and
 * the header of review context, which the reviewer reads and may paste into a shell.
 */
export function isPlainRef(value: string): boolean {
  if (value.length === 0 || value.length > MAX_BASE_REF || isOptionLike(value)) return false;
  return !value.includes('{/') && PLAIN_REF.test(value);
}

/** `value`, or a refusal naming `where` (the key or option it came from) when it is not a plain ref. */
export function assertBaseRef(value: string, where: string, code = 'invalid_option'): string {
  if (isPlainRef(value)) return value;
  if (isOptionLike(value)) {
    throw new SdlcError(code, { key: 'error.base_ref_starts_with_dash', params: { where } });
  }
  throw new SdlcError(code, { key: 'error.base_ref_not_plain', params: { where, max: MAX_BASE_REF } });
}

/**
 * `review.base` of sdlc.yaml: absent, or a non-empty string (the same refusal as the other string keys) that is a
 * plain ref; both refusals are `invalid_config` naming `where`.
 */
export function reviewBase(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_non_empty_string', params: { where } });
  }
  return assertBaseRef(value, where, 'invalid_config');
}
