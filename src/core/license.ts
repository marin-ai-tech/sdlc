import type { LicenseType, SdlcConfig } from './config.js';
import { harnessVersion } from './version.js';

/**
 * scdl's own license identity, and how it is recorded.
 *
 * scdl is dual-licensed (see LICENSE): the Community License (PolyForm
 * Noncommercial 1.0.0 + scdl Additional Permissions) or a Commercial License.
 * A project declares which one it uses in `openspec/sdlc.yaml`, and every log
 * entry, lifecycle record, change artifact and generated agent file records
 * the scdl version together with that license.
 */
export const LICENSOR = 'marin-ai technologies';
export const LICENSOR_URL = 'https://github.com/marin-ai-tech';
export const PROJECT_URL = 'https://github.com/marin-ai-tech/scdl';
export const COPYRIGHT_YEAR = '2026';
export const POLYFORM_NC_URL = 'https://polyformproject.org/licenses/noncommercial/1.0.0';
export const REQUIRED_NOTICE = `Required Notice: Copyright (c) ${COPYRIGHT_YEAR} ${LICENSOR} (${PROJECT_URL})`;
export const COMMUNITY_LICENSE_ID = 'PolyForm-Noncommercial-1.0.0 + scdl-Additional-Permissions-1.0';
export const COMMERCIAL_LICENSE_ID = 'scdl-Commercial';
export const LICENSE_TERMS =
  `PolyForm Noncommercial 1.0.0 (${POLYFORM_NC_URL}) with the scdl Additional Permissions, or a commercial license; see ${PROJECT_URL}`;
/** Short statement for license metadata fields (skill frontmatter). */
export const LICENSE_SUMMARY =
  `PolyForm-Noncommercial-1.0.0 with scdl Additional Permissions, or scdl Commercial License (${PROJECT_URL})`;
/** package.json and plugin.json `license` value: the terms are in the LICENSE file shipped alongside. */
export const LICENSE_REFERENCE = 'SEE LICENSE IN LICENSE';
/** Legal files shipped with every copy of scdl (and with the Claude Code plugin). */
export const LEGAL_FILES = [
  'LICENSE',
  'NOTICE.md',
  'COMMERCIAL-LICENSE.md',
  'LICENSES/PolyForm-Noncommercial-1.0.0.md',
  'LICENSES/scdl-Additional-Permissions.md',
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

/** e.g. `community (PolyForm-Noncommercial-1.0.0 + scdl-Additional-Permissions-1.0)`. */
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
  tool: 'scdl';
  version: string;
  license: string;
}

export function harnessStamp(config: Pick<SdlcConfig, 'license'>, version = harnessVersion()): HarnessStamp {
  return { tool: 'scdl', version, license: licenseLabel(effectiveLicense(config)) };
}

export function stampText(stamp: HarnessStamp): string {
  return `scdl ${stamp.version}, license: ${stamp.license}`;
}

// --- Provenance in change artifacts -----------------------------------------

/**
 * Matches exactly the line `provenanceComment` writes (any version, license
 * label or project URL, so lines stamped by other scdl versions still match),
 * and nothing looser: text excluded from digests must not be able to carry
 * arbitrary content.
 */
const PROVENANCE_LINE =
  /^[ \t]*<!-- sdlc-provenance: scdl [\w.+-]+ \| license: [^|<>\r\n]+ \| https?:\/\/[^\s|<>]+ -->[ \t]*\r?$\n?/gm;

/** One-line provenance comment the CLI keeps at the end of change artifacts. */
export function provenanceComment(stamp: HarnessStamp): string {
  return `<!-- sdlc-provenance: scdl ${stamp.version} | license: ${stamp.license} | ${PROJECT_URL} -->`;
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
 * Notice block for files scdl generates into a project (skills, commands,
 * subagents, plugin, schema). It keeps the PolyForm "Required Notice" with
 * every copy and records the version and, for project installs, the license
 * the project declared.
 */
export function generatedNotice(stamp: HarnessStamp, style: NoticeStyle, usedUnder = true): string {
  const lines = [
    `Generated by scdl ${stamp.version} (${PROJECT_URL})${usedUnder ? `; used under the ${stamp.license} license` : ''}.`,
    REQUIRED_NOTICE,
    `License: ${LICENSE_TERMS}`,
  ];
  if (style === 'markdown') return `<!--\n${lines.join('\n')}\n-->`;
  const prefix = style === 'js' ? '// ' : '# ';
  return lines.map((l) => `${prefix}${l}`).join('\n');
}
