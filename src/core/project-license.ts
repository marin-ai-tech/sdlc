import { t, type Locale } from './i18n.js';
import * as path from 'node:path';
import type { SdlcConfig } from './config.js';
import { readText } from './fs-utils.js';

/**
 * Best-effort detection of the license a project declares, so `sdlc license`
 * and `sdlc doctor` can tell whether the Community License's open source
 * permission plausibly applies. It reads declarations only: it cannot tell
 * whether the project's source is actually public, which the permission also
 * requires.
 */
export interface ProjectLicense {
  /** SPDX id or expression, or a name for a recognized license text. */
  id: string;
  /** Where it was declared (`package.json`, `LICENSE`, ...). */
  source: string;
  /** Approved by the Open Source Initiative. */
  osi: boolean;
}

/** OSI-approved licenses by SPDX id (the common ones; lower case). */
const OSI = new Set(
  [
    '0BSD', 'AFL-3.0', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-1.1', 'Apache-2.0', 'APSL-2.0',
    'Artistic-2.0', 'BSD-1-Clause', 'BSD-2-Clause', 'BSD-2-Clause-Patent', 'BSD-3-Clause', 'BSL-1.0', 'CAL-1.0',
    'CDDL-1.0', 'CECILL-2.1', 'ECL-2.0', 'EFL-2.0', 'EPL-1.0', 'EPL-2.0', 'EUPL-1.1', 'EUPL-1.2', 'GPL-2.0',
    'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC', 'LGPL-2.0',
    'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0',
    'LGPL-3.0-only', 'LGPL-3.0-or-later', 'LPL-1.02', 'MIT', 'MIT-0', 'MPL-1.1', 'MPL-2.0', 'MS-PL', 'MS-RL',
    'MulanPSL-2.0', 'NCSA', 'OFL-1.1', 'OSL-3.0', 'PostgreSQL', 'Python-2.0', 'UPL-1.0', 'Unicode-3.0',
    'Unlicense', 'W3C', 'Zlib', 'ZPL-2.0', 'ZPL-2.1',
  ].map((id) => id.toLowerCase())
);

function isOsiId(id: string): boolean {
  return OSI.has(id.trim().replace(/\+$/, '').toLowerCase());
}

/**
 * Whether an SPDX expression is open source: any alternative of an `OR`, all
 * parts of an `AND`. `WITH` exceptions do not change the answer.
 */
export function isOsiExpression(expression: string): boolean {
  const alternatives = expression.replace(/[()]/g, ' ').split(/\s+OR\s+/i);
  return alternatives.some((alt) =>
    alt.split(/\s+AND\s+/i).every((part) => isOsiId(part.split(/\s+WITH\s+/i)[0] ?? ''))
  );
}

/** Recognizes common license texts by their opening lines. */
const TEXTS: Array<{ pattern: RegExp; id: string | ((text: string) => string); osi: boolean }> = [
  { pattern: /PolyForm Noncommercial/i, id: 'PolyForm-Noncommercial-1.0.0', osi: false },
  { pattern: /PolyForm/i, id: 'PolyForm', osi: false },
  { pattern: /Business Source License/i, id: 'BUSL-1.1', osi: false },
  { pattern: /Server Side Public License/i, id: 'SSPL-1.0', osi: false },
  { pattern: /Elastic License/i, id: 'Elastic-2.0', osi: false },
  { pattern: /GNU AFFERO GENERAL PUBLIC LICENSE/i, id: 'AGPL-3.0', osi: true },
  { pattern: /GNU LESSER GENERAL PUBLIC LICENSE/i, id: (t) => (/Version 3/i.test(t) ? 'LGPL-3.0' : 'LGPL-2.1'), osi: true },
  { pattern: /GNU GENERAL PUBLIC LICENSE/i, id: (t) => (/Version 3/i.test(t) ? 'GPL-3.0' : 'GPL-2.0'), osi: true },
  { pattern: /Apache License,?\s+Version 2\.0/i, id: 'Apache-2.0', osi: true },
  { pattern: /Mozilla Public License,?\s+(?:Version|v\.?)\s*2\.0/i, id: 'MPL-2.0', osi: true },
  { pattern: /Eclipse Public License\s*-?\s*v\s*2\.0/i, id: 'EPL-2.0', osi: true },
  { pattern: /European Union Public Licen[cs]e/i, id: 'EUPL-1.2', osi: true },
  { pattern: /Boost Software License/i, id: 'BSL-1.0', osi: true },
  { pattern: /This is free and unencumbered software released into the public domain/i, id: 'Unlicense', osi: true },
  { pattern: /Permission is hereby granted, free of charge, to any person obtaining a copy/i, id: 'MIT', osi: true },
  { pattern: /Permission to use, copy, modify, and(?:\/or)? distribute this software for any purpose/i, id: 'ISC', osi: true },
  {
    pattern: /Redistribution and use in source and binary forms/i,
    id: (t) => (/Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause'),
    osi: true,
  },
];

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING', 'COPYING.md', 'UNLICENSE'];

function fromText(text: string, source: string): ProjectLicense {
  for (const t of TEXTS) {
    if (t.pattern.test(text)) return { id: typeof t.id === 'string' ? t.id : t.id(text), source, osi: t.osi };
  }
  return { id: 'unrecognized', source, osi: false };
}

function fromExpression(expression: string, source: string, root: string): ProjectLicense {
  const trimmed = expression.trim();
  const seeFile = trimmed.match(/^SEE LICEN[CS]E IN\s+(.+)$/i);
  if (seeFile) {
    const text = readText(path.join(root, seeFile[1].trim()));
    return text ? fromText(text, seeFile[1].trim()) : { id: trimmed, source, osi: false };
  }
  return { id: trimmed, source, osi: isOsiExpression(trimmed) };
}

/** The first license declaration found, from package manifests to LICENSE files. */
export function detectProjectLicense(root: string): ProjectLicense | undefined {
  const pkg = readText(path.join(root, 'package.json'));
  if (pkg) {
    try {
      const data = JSON.parse(pkg) as { license?: unknown; licenses?: unknown };
      if (typeof data.license === 'string' && data.license.trim()) return fromExpression(data.license, 'package.json', root);
      if (Array.isArray(data.licenses)) {
        const ids = data.licenses
          .map((l) => (typeof l === 'string' ? l : (l as { type?: unknown })?.type))
          .filter((l): l is string => typeof l === 'string');
        if (ids.length > 0) return fromExpression(ids.join(' OR '), 'package.json', root);
      }
    } catch {
      // fall through to the other sources
    }
  }
  for (const [file, pattern] of [
    ['pyproject.toml', /^\s*license\s*=\s*(?:\{\s*text\s*=\s*)?"([^"]+)"/m],
    ['Cargo.toml', /^\s*license\s*=\s*"([^"]+)"/m],
  ] as const) {
    const text = readText(path.join(root, file));
    const match = text?.match(pattern);
    if (match) return fromExpression(match[1], file, root);
  }
  for (const file of LICENSE_FILES) {
    const text = readText(path.join(root, file));
    if (text) return fromText(text, file);
  }
  return undefined;
}

export interface LicenseAssessment {
  status: 'ok' | 'warn';
  message: string;
  fix?: string;
}

/**
 * Whether the declared sdlc license plausibly fits the project.
 * Defaults to English so JSON payloads stay locale-stable; pass the UI locale
 * when printing text.
 */
export function assessLicense(
  license: SdlcConfig['license'],
  detected: ProjectLicense | undefined,
  locale: Locale = 'en',
): LicenseAssessment {
  if (license.type === 'commercial') {
    return license.agreement
      ? {
          status: 'ok',
          message: t('license.assess.commercialOk', {
            agreement: license.agreement,
            licensee: license.licensee
              ? t('license.assess.licenseePart', { licensee: license.licensee }, locale)
              : '',
          }, locale),
        }
      : {
          status: 'warn',
          message: t('license.assess.commercialNoAgreement', undefined, locale),
          fix: t('license.assess.commercialFix', undefined, locale),
        };
  }
  if (detected?.osi) {
    return {
      status: 'ok',
      message: t('license.assess.communityOsi', {
        id: detected.id,
        source: detected.source,
      }, locale),
    };
  }
  return {
    status: 'warn',
    message: detected
      ? t('license.assess.communityNotOsi', {
        id: detected.id,
        source: detected.source,
      }, locale)
      : t('license.assess.communityNoOsi', undefined, locale),
    fix: t('license.assess.communityFix', undefined, locale),
  };
}
