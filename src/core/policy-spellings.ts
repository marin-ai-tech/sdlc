import { t } from './i18n.js';
import * as path from 'node:path';
import type { Decision } from './policy.js';
import { stateCopyInspection, type CopyInspection } from './state-copy.js';
import { insideStateFolder, relToRoot, STATE_FILE } from './policy-shell.js';
import { hiddenTargetHits } from './shell-hidden-targets.js';
import { namedPart } from './state-reasons.js';
import { stateReason } from './state-reasons.js';
import { literalValueSpellings } from './shell-literal-values.js';
import { shellStateWrites, shellStateInlineGlobPart, shellWriteTargets } from './policy-shell.js';
import { hardLinkedFiles, hardLinkedStateFiles } from './policy-hardlink.js';
import { pluginStateFiles } from '../plugins/activation.js';

/**
 * The spellings of a command the path checks read: as written and, when it has a `\`, with `\` read as a separator
 * (`/./` and `//` collapsed). Windows shells, PowerShell on Linux too, write `cd .\openspec`; POSIX decoding reads
 * `.openspec`. Checking both only adds denials (0.29.0 checked the second alone).
 */
export function pathSpellings(command: string): string[] {
  if (!command.includes('\\')) return [command];
  const normalized = command.replace(/\\/g, '/').replace(/\/(?:\.\/)+/g, '/').replace(/\/{2,}/g, '/');
  return normalized === command ? [command] : [command, normalized];
}

/** Path spellings plus literal values, retaining the written command as the first view. */
export function commandSpellings(command: string, deadline?: number): {
  spellings: string[]; writeSpellings: string[]; exceeded: boolean; timedOut: boolean
} {
  const literal = literalValueSpellings(command, 0, {}, deadline);
  const writeSpellings = [...new Set([command, ...literal.spellings])];
  return { spellings: [...new Set(writeSpellings.flatMap((spelling) => pathSpellings(spelling)))],
    writeSpellings, exceeded: literal.exceeded, timedOut: literal.timedOut };
}

/**
 * A copy of a state file found only in the `\`-as-separator spelling. Only a found state file counts there: that
 * spelling breaks POSIX escapes (`source\[1\]`, quotes inside `sh -c`), so its "cannot be inspected" is not evidence.
 */
function copiedStateInSpelling(command: string, root: string, cwd: string): CopyInspection {
  const spelled = pathSpellings(command)[1];
  if (spelled === undefined) return { kind: 'none' };
  const result = stateCopyInspection(spelled, root, cwd);
  if (result.kind !== 'unknown') return result;
  for (const prefix of result.prefixes) {
    const rel = relToRoot(root, root, path.resolve(cwd, prefix));
    if (rel && insideStateFolder(rel)) return { kind: 'found' };
  }
  return { kind: 'none' };
}

/** The state-copy decision for the command as written, else a found state copy in its `\`-separator spelling. */
export function copyDecision(command: string, root: string, cwd: string): Decision | undefined {
  const direct = stateCopyInspection(command, root, cwd);
  const alternate = copiedStateInSpelling(command, root, cwd);
  const result = direct.kind === 'found' || alternate.kind === 'found' ? { kind: 'found' } as CopyInspection
    : direct.kind === 'unknown' ? direct : alternate;
  if (result.kind === 'none') return undefined;
  const reason = result.kind === 'found' ? t('hook.stateIntegrityBash')
    : result.role === 'directory' ? t('hook.copyUnresolvedDirectory', { part: namedPart(result.part) })
      : t('hook.copyUnresolved', { role: result.role, part: namedPart(result.part) });
  return { decision: 'deny', rule: 'state-integrity', reason };
}

/** The first decision a check returns over the spellings, in order. */
export function firstDecision(spellings: string[], check: (spelled: string) => Decision | undefined)
  : Decision | undefined {
  for (const spelled of spellings) {
    const decision = check(spelled);
    if (decision) return decision;
  }
  return undefined;
}

/** A shell write to a state file, by its path text or (after `cd`, by glob, through a link) by what it resolves to. */
export function stateWriteDenial(spelled: string, root: string, cwd: string): Decision | undefined {
  const hits = [...shellStateWrites(spelled, root, cwd), ...hiddenTargetHits(spelled, cwd, STATE_FILE),
    ...hardLinkedStateFiles(shellWriteTargets(spelled, root, cwd), root, root),
    ...hardLinkedFiles(shellWriteTargets(spelled, root, cwd), root, root, pluginStateFiles)];
  if (hits.length === 0) return undefined;
  const part = shellStateInlineGlobPart(spelled, root, cwd);
  const reason = part ? t('hook.stateInlineString', { part: namedPart(JSON.stringify(part)) })
    : stateReason(hits, false);
  return { decision: 'deny', rule: 'state-integrity', reason };
}
