/** The most characters of a registry or user value a reason prints. */
export const SHOWN_VALUE_MAX = 64;

/**
 * A registry or user value as a reason prints it (B249 review F5, round 2 F6): JSON of its first 64 characters with
 * every character outside printable ASCII escaped as \uXXXX, so no line break, control or format character (a
 * direction override, a zero-width space, U+2028) reaches the output, and no value makes a reason long.
 */
export function shownValue(value: unknown): string {
  const text = JSON.stringify(String(value).slice(0, SHOWN_VALUE_MAX));
  return text.replace(/[^\x20-\x7E]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
