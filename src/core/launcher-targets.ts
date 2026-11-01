import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import type { ToolCall, Decision } from './policy.js';
import { linkedFiles, relToRoot, shellWriteTargets } from './policy-shell.js';
import { hardLinkedFiles } from './policy-hardlink.js';
import { shellWriteDestinations } from './policy-shell-writes.js';
import { decodedShellWords } from './shell-words.js';
import { t } from './i18n.js';

function script(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value = JSON.parse(text) as { scripts?: Record<string, unknown> };
    return { ok: true, value: value?.scripts?.sdlc };
  } catch {
    return { ok: false };
  }
}

function editedPackage(call: ToolCall, root: string): string | undefined {
  let before: string;
  try {
    before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  } catch {
    return undefined;
  }
  for (const edit of call.writes ?? []) {
    if (relToRoot(root, call.cwd, edit.file)?.toLowerCase() !== 'package.json') continue;
    if (edit.removed === undefined) return edit.added;
    if (edit.removed === '' || !before.includes(edit.removed)) return undefined;
    before = before.replace(edit.removed, edit.added);
  }
  return call.writes?.length ? before : undefined;
}

function shellPackage(command: string): string | undefined {
  const words = decodedShellWords(command);
  const redirect = words.findIndex((word) => word.operator && word.value === '>');
  if (redirect < 0 || !/^(?:echo|printf)$/i.test(words[0]?.value ?? '')) return undefined;
  return words.slice(1, redirect).map((word) => word.value).join(' ');
}

function sameScript(root: string, after: string | undefined): boolean {
  if (after === undefined) return false;
  try {
    const previous = script(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const next = script(after);
    return previous.ok && next.ok && previous.value === next.value;
  } catch {
    return false;
  }
}

function shimHits(files: string[], root: string): string[] {
  const pattern = /^node_modules\/\.bin\/sdlc[^/]*$/i;
  const shims = (base: string) => {
    try {
      return fs.readdirSync(path.join(base, 'node_modules/.bin'))
        .filter((name) => /^sdlc[^/]*$/i.test(name)).map((name) => `node_modules/.bin/${name}`);
    } catch {
      return [];
    }
  };
  return [...files.filter((file) => pattern.test(file)), ...linkedFiles(files, root, root, pattern),
    ...hardLinkedFiles(files, root, root, shims)];
}

/** The selected launcher is protected without reserving unrelated package metadata. */
export function launcherDecision(call: ToolCall, root: string, config: SdlcConfig): Decision | undefined {
  const cli = decodedShellWords(config.cli).map((word) => word.value);
  const files = call.kind === 'bash' && call.command ? shellWriteDestinations(call.command, root, call.cwd)
    : call.files.flatMap((file) => relToRoot(root, call.cwd, file) ?? []);
  if (call.command && /\b(?:rm|mv|del|rmdir|Remove-Item|Move-Item)\b/i.test(call.command)) {
    files.push(...shellWriteTargets(call.command, root, call.cwd));
  }
  const shim = /^npx(?:\.cmd)?$/i.test(cli[0] ?? '')
    ? shimHits(files, root)[0] : undefined;
  const packageEdit = /^(?:yarn|pnpm)(?:\.cmd)?$/i.test(cli[0] ?? '')
    && files.some((file) => file.toLowerCase() === 'package.json');
  if (!shim && !packageEdit) return undefined;
  if (packageEdit && sameScript(root, call.command ? shellPackage(call.command) : editedPackage(call, root))) {
    return undefined;
  }
  const file = shim ?? 'package.json scripts.sdlc';
  return { decision: 'deny', rule: 'guard-config', reason: t('hook.guardConfig', { path: file }) };
}
