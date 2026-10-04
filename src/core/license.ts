import type { LicenseType, SdlcConfig } from './config.js';
import { harnessVersion } from './version.js';

/**
 * sdlc's own license identity, and how it is recorded.
 *
 * sdlc is dual-licensed (see LICENSE): the Community License (PolyForm
 * Noncommercial 1.0.0 + sdlc Additional Permissions) or a Commercial License.
 * A project declares which one it uses in `openspec/sdlc.yaml`, and every log
 * entry, lifecycle record, change artifact and generated agent file records
 * the sdlc version together with that license.
 */
export const LICENSOR = 'marin-ai technologies';
export const LICENSOR_URL = 'https://github.com/marin-ai-tech';
export const PROJECT_URL = 'https://github.com/marin-ai-tech/sdlc';
/**
 * Installs the latest release. Never `npm install -g sdlc`: an unrelated package of that name is on the npm
 * registry. Installing from git needs the release branch (github:marin-ai-tech/sdlc#release).
 */
export const INSTALL_COMMAND = `npm install -g ${PROJECT_URL}/releases/latest/download/sdlc.tgz`;
export const COPYRIGHT_YEAR = '2026';
export const POLYFORM_NC_URL = 'https://polyformproject.org/licenses/noncommercial/1.0.0';
export const REQUIRED_NOTICE = `Required Notice: Copyright (c) ${COPYRIGHT_YEAR} ${LICENSOR} (${PROJECT_URL})`;
export const COMMUNITY_LICENSE_ID = 'PolyForm-Noncommercial-1.0.0 + sdlc-Additional-Permissions-1.0';
export const COMMERCIAL_LICENSE_ID = 'sdlc-Commercial';
export const LICENSE_TERMS =
  `PolyForm Noncommercial 1.0.0 (${POLYFORM_NC_URL}) with the sdlc Additional Permissions, or a commercial license; see ${PROJECT_URL}`;
/** Short statement for license metadata fields (skill frontmatter). */
export const LICENSE_SUMMARY =
  `PolyForm-Noncommercial-1.0.0 with sdlc Additional Permissions, or sdlc Commercial License (${PROJECT_URL})`;
/** package.json and plugin.json `license` value: the terms are in the LICENSE file shipped alongside. */
export const LICENSE_REFERENCE = 'SEE LICENSE IN LICENSE';
/** Legal files shipped with every copy of sdlc (and with the Claude Code plugin). */
export const LEGAL_FILES = [
  'LICENSE',
  'NOTICE.md',
  'COMMERCIAL-LICENSE.md',
  'LICENSES/PolyForm-Noncommercial-1.0.0.md',
  'LICENSES/sdlc-Additional-Permissions.md',
  'LICENSES/MIT-OpenSpec.txt',
];

export interface LicenseInfo {
  type: LicenseType;
  id: string;
  agreement?: string;
  licensee?: string;
}

export function effectiveLicense(config: Pick<SdlcConfig, 'license'>): LicenseInfo {
  const l = config.license;
  if (l.type === 'commercial') {
    return {
      type: 'commercial',
      id: COMMERCIAL_LICENSE_ID,
      ...(l.agreement ? { agreement: l.agreement } : {}),
      ...(l.licensee ? { licensee: l.licensee } : {}),
    };
  }
  return { type: 'community', id: COMMUNITY_LICENSE_ID };
}

/** Defensive twin of config's LICENSE_FIELD check: labels must fit one provenance line. */
function oneLine(value: string): string {
  return value.replace(/[|<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** e.g. `community (PolyForm-Noncommercial-1.0.0 + sdlc-Additional-Permissions-1.0)`. */
export function licenseLabel(l: LicenseInfo): string {
  const details = [
    l.id,
    l.agreement ? `agreement ${oneLine(l.agreement)}` : '',
    l.licensee ? `licensee ${oneLine(l.licensee)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `${l.type} (${details})`;
}

/** What every log entry and lifecycle record carries. */
export interface HarnessStamp {
  tool: 'sdlc';
  version: string;
  license: string;
}

export function harnessStamp(config: Pick<SdlcConfig, 'license'>, version = harnessVersion()): HarnessStamp {
  return { tool: 'sdlc', version, license: licenseLabel(effectiveLicense(config)) };
}

export function stampText(stamp: HarnessStamp): string {
  return `sdlc ${stamp.version}, license: ${stamp.license}`;
}

// --- Provenance in change artifacts -----------------------------------------

/**
 * Matches exactly the line `provenanceComment` writes (any version, license
 * label or project URL, so lines stamped by other sdlc versions still match),
 * and nothing looser: text excluded from digests must not be able to carry
 * arbitrary content.
 */
const PROVENANCE_LINE =
  /^[ \t]*<!-- sdlc-provenance: (?:sdlc|scdl) [\w.+-]+ \| license: [^|<>\r\n]+ \| https?:\/\/[^\s|<>]+ -->[ \t]*\r?$\n?/gm;

/** One-line provenance comment the CLI keeps at the end of change artifacts. */
export function provenanceComment(stamp: HarnessStamp): string {
  return `<!-- sdlc-provenance: sdlc ${stamp.version} | license: ${stamp.license} | ${PROJECT_URL} -->`;
}

/** Content without provenance lines (used for digests and parsers). */
export function stripProvenance(content: string): string {
  return content.replace(PROVENANCE_LINE, '');
}

export function hasProvenance(content: string): boolean {
  PROVENANCE_LINE.lastIndex = 0;
  const found = PROVENANCE_LINE.test(content);
  PROVENANCE_LINE.lastIndex = 0;
  return found;
}

/** Replaces any provenance line with a current one, appended at the end (keeping the file's line endings). */
export function withProvenance(content: string, stamp: HarnessStamp): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = content.replace(PROVENANCE_LINE, '').replace(/\s+$/u, '');
  return `${body}${eol}${eol}${provenanceComment(stamp)}${eol}`;
}

// --- Notices in generated agent files ---------------------------------------

export type NoticeStyle = 'markdown' | 'js' | 'yaml';

/**
 * Notice block for files sdlc generates into a project (skills, commands,
 * subagents, plugin, schema). It keeps the PolyForm "Required Notice" with
 * every copy and records the version and, for project installs, the license
 * the project declared.
 */
export function generatedNotice(stamp: HarnessStamp, style: NoticeStyle, usedUnder = true): string {
  const lines = [
    `Generated by sdlc ${stamp.version} (${PROJECT_URL})${usedUnder ? `; used under the ${stamp.license} license` : ''}.`,
    REQUIRED_NOTICE,
    `License: ${LICENSE_TERMS}`,
  ];
  if (style === 'markdown') return `<!--\n${lines.join('\n')}\n-->`;
  const prefix = style === 'js' ? '// ' : '# ';
  return lines.map((l) => `${prefix}${l}`).join('\n');
}
