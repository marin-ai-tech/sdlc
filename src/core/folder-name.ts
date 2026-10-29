import { isValidChangeId } from './changes.js';

/** Render a skipped folder as data, including when its name contains Markdown delimiters. */
export function folderLabel(id: string): string {
  return isValidChangeId(id) ? id : JSON.stringify(id).replaceAll('`', '\\u0060');
}

export function folderKey(id: string, validKey: string, invalidKey: string): string {
  return isValidChangeId(id) ? validKey : invalidKey;
}
