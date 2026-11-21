import { isValidChangeId } from './changes.js';
/** Render a skipped folder as data, including when its name contains Markdown delimiters. */
export function folderLabel(id) {
    return isValidChangeId(id) ? id : JSON.stringify(id).replaceAll('`', '\\u0060');
}
export function folderKey(id, validKey, invalidKey) {
    return isValidChangeId(id) ? validKey : invalidKey;
}
