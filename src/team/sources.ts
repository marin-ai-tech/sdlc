import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { isFile, normalizeNewlines, readText } from '../core/fs-utils.js';
import { currentLocale, LOCALES, normalizeLocale, type Locale } from '../core/i18n.js';
import { harnessVersion } from '../core/version.js';
import { assetsDir } from '../integrations/assets.js';
import { builtinDraft, withoutSource } from './draft.js';
import type { PackSource } from './pack-config.js';

/**
 * Where drafts of roles come from. The built-in roles ship in `assets/roles/<locale>/<role>.md`; the team registry
 * over MCP (B71, `src/team/sync.ts`) comes first, then the packs (B76, `src/team/packs.ts`); the built-in set fills
 * the ids they do not have.
 */
export interface RoleDraft {
  id: string;
  text: string;
  source: 'registry' | 'builtin' | 'pack';
  version?: string;
  server?: string;
  checksum?: string;
  /** The pack a draft of a pack came from. */
  pack?: PackSource;
}

export interface RoleSource {
  id: string;
  drafts(locale: Locale): RoleDraft[];
}

export const BUILTIN_ROLE_IDS = ['analyst', 'architect', 'developer', 'tester', 'reviewer'] as const;

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}

/** The project's language: `locale` in sdlc.yaml, else the active locale. */
export function teamLocale(config: SdlcConfig): Locale {
  const configured = normalizeLocale(config.locale);
  return isLocale(configured) ? configured : currentLocale();
}

function roleAsset(locale: string, id: string): string | undefined {
  const file = path.join(assetsDir(), 'roles', locale, `${id}.md`);
  const text = isFile(file) ? readText(file) : undefined;
  return text === undefined ? undefined : normalizeNewlines(text);
}

/** The text of a built-in role in the locale, English when the locale has none; undefined for an unknown role. */
export function builtinRoleText(id: string, locale: Locale): string | undefined {
  return roleAsset(locale, id) ?? roleAsset('en', id);
}

export function isBuiltinRole(id: string): boolean {
  return (BUILTIN_ROLE_IDS as readonly string[]).includes(id);
}

/**
 * The sdlc version when `text` is a built-in role exactly as shipped (in any locale), apart from the `source` block
 * sync adds to the draft; otherwise undefined.
 */
export function builtinVersion(id: string, text: string): string | undefined {
  const plain = withoutSource(text);
  const same = LOCALES.some((locale) => {
    const asset = roleAsset(locale, id);
    return asset !== undefined && withoutSource(asset) === plain;
  });
  return same ? harnessVersion() : undefined;
}

export const builtinSource: RoleSource = {
  id: 'builtin',
  drafts(locale: Locale): RoleDraft[] {
    return BUILTIN_ROLE_IDS.flatMap((id) => {
      const text = builtinRoleText(id, locale);
      if (text === undefined) return [];
      const version = harnessVersion();
      return [{ id, text: builtinDraft(text, version), source: 'builtin' as const, version }];
    });
  },
};

/** The sources `sdlc team sync` reads, in order; the first source that has a role wins. */
export const ROLE_SOURCES: readonly RoleSource[] = [builtinSource];
