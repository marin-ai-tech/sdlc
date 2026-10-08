import * as path from 'node:path';
import { line, warn } from '../cli/output.js';
import { t } from '../core/i18n.js';
import type { GitHookResult } from '../integrations/git-hook.js';

/** The hook's path as shown to people and in JSON: relative to the project, forward slashes. */
function shownPath(root: string, result: GitHookResult): string {
  const file = result.path ?? '';
  const relative = path.relative(root, file) || file;
  return relative.split(path.sep).join('/');
}

/** The `gitHook` part of the JSON answers of init, update and uninstall. */
export function gitHookJson(root: string, result: GitHookResult): Record<string, unknown> {
  const shown = result.path === undefined ? {} : { path: shownPath(root, result) };
  const error = result.error === undefined ? {} : { error: result.error };
  return { gitHook: { state: result.state, ...shown, ...error } };
}

/** init and update: a line when the hook was written, a warning when it was left alone or failed. */
export function printGitHookInstall(root: string, result: GitHookResult): void {
  const shown = shownPath(root, result);
  if (result.state === 'installed' || result.state === 'updated') {
    line(t(`gitHook.${result.state}`, { path: shown }));
    return;
  }
  if (result.state === 'kept') warn(t('gitHook.kept', { path: shown }));
  if (result.state === 'shared') warn(t('gitHook.shared', { path: shown }));
  if (result.state === 'failed') warn(t('gitHook.failed', { error: result.error ?? '' }));
}

/** uninstall: a line when sdlc's hook was removed; a hook of the project's own is not sdlc's to mention. */
export function printGitHookRemoval(root: string, result: GitHookResult): void {
  if (result.state === 'removed') line(t('gitHook.removed', { path: shownPath(root, result) }));
  if (result.state === 'failed') warn(t('gitHook.failed', { error: result.error ?? '' }));
}
