import { stringify } from 'yaml';
import { normalizeNewlines } from '../core/fs-utils.js';
import type { PackSource } from './pack-config.js';
import type { RegistryRole } from './vetting.js';

/**
 * The text of a role draft (B71): the front matter records where it came from, `source: { kind: registry, server,
 * version, checksum }` for a role of the team registry, `source: { kind: builtin, version }` for a built-in one and
 * `source: { kind: pack, pack, git | npm, ref, commit | version, integrity? }` for a role of a pack (B76).
 */
const FRONT = /^---\n([\s\S]*?)\n---\n/;

/** A registry role as a draft: its fields as front matter, its body as it came. */
export function registryDraft(role: RegistryRole, server: string): string {
  const front = {
    id: role.id,
    title: role.title,
    description: role.title,
    stages: role.stages,
    tools: role.tools,
    readonly: role.readonly,
    skills: role.skills,
    source: { kind: 'registry', server, version: role.version, checksum: role.checksum },
  };
  return `---\n${stringify(front, { lineWidth: 0 })}---\n${role.body}`;
}

/** A built-in role's text with `source: { kind: builtin, version }` added to its front matter. */
export function builtinDraft(text: string, version: string): string {
  const normalized = normalizeNewlines(text);
  const match = normalized.match(FRONT);
  if (!match) return normalized;
  const block = `source:\n  kind: builtin\n  version: ${JSON.stringify(version)}`;
  return `---\n${match[1]}\n${block}\n---\n${normalized.slice(match[0].length)}`;
}

/** A pack's role file as a draft: its own `source` block, if any, replaced by the pack it came from. */
export function packDraft(text: string, source: PackSource): string {
  const normalized = withoutSource(text);
  const match = normalized.match(FRONT);
  if (!match) return normalized;
  const block = stringify({ source: { kind: 'pack', ...source } }, { lineWidth: 0 }).trimEnd();
  return `---\n${match[1]}\n${block}\n---\n${normalized.slice(match[0].length)}`;
}

/** The text without the `source` block of its front matter (to compare a draft with the role as shipped). */
export function withoutSource(text: string): string {
  const normalized = normalizeNewlines(text);
  const match = normalized.match(FRONT);
  if (!match) return normalized;
  const kept: string[] = [];
  let skipping = false;
  for (const line of match[1].split('\n')) {
    if (/^source:/.test(line)) skipping = true;
    else if (!skipping || !/^\s/.test(line)) {
      skipping = false;
      kept.push(line);
    }
  }
  return `---\n${kept.join('\n')}\n---\n${normalized.slice(match[0].length)}`;
}
