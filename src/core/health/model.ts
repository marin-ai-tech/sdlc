import { t, type Locale, type MessageRef } from '../i18n.js';

/**
 * The findings model of `sdlc health` (0.11.3, B65, B68): where the process and the practices suffer, each finding
 * with its facts and a recommended improvement. There is no single score. `title`, `facts` and `recommendation` are
 * English in JSON; text output renders the same catalog keys in the active locale.
 */
export const HEALTH_AREAS = ['flow', 'quality', 'discipline', 'config'] as const;
export type HealthArea = (typeof HEALTH_AREAS)[number];
export const HEALTH_LEVELS = ['bad', 'warn', 'info'] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

/** Plain values only, so JSON readers can branch on them. */
export type FindingParams = Record<string, string | number>;

export interface Finding {
  id: string;
  area: HealthArea;
  level: HealthLevel;
  title: string;
  facts: string[];
  recommendation: string;
  /** Catalog key prefix: `<key>.title` and `<key>.recommendation`. */
  key: string;
  params: FindingParams;
}

/** What a collector reports: the facts as catalog refs, rendered in a locale later. */
export interface FindingDraft {
  id: string;
  area: HealthArea;
  level: HealthLevel;
  params?: FindingParams;
  facts: MessageRef[];
  /** A recommendation other than `<key>.recommendation`, e.g. one per rework reason. */
  recommendation?: MessageRef;
}

export interface HealthCounts {
  info: number;
  warn: number;
  bad: number;
}

export function findingKey(id: string): string {
  return `health.${id}`;
}

/** The finding in a locale: English for JSON, the active locale for text. */
export function renderFinding(draft: FindingDraft, locale: Locale): Finding {
  const key = findingKey(draft.id);
  const params = draft.params ?? {};
  const recommendation = draft.recommendation ?? { key: `${key}.recommendation`, params };
  return {
    id: draft.id,
    area: draft.area,
    level: draft.level,
    title: t(`${key}.title`, params, locale),
    facts: draft.facts.map((fact) => t(fact.key, fact.params, locale)),
    recommendation: t(recommendation.key, recommendation.params, locale),
    key,
    params,
  };
}

function compareFindings(a: FindingDraft, b: FindingDraft): number {
  const level = HEALTH_LEVELS.indexOf(a.level) - HEALTH_LEVELS.indexOf(b.level);
  if (level !== 0) return level;
  return a.id.localeCompare(b.id);
}

/** Bad, warn, info, then by id; a finding without facts is not listed. */
export function orderFindings(drafts: FindingDraft[]): FindingDraft[] {
  const listed = drafts.filter((draft) => draft.facts.length > 0);
  return listed.sort(compareFindings);
}

export function countFindings(findings: Array<Pick<Finding, 'level'>>): HealthCounts {
  const counts: HealthCounts = { info: 0, warn: 0, bad: 0 };
  for (const finding of findings) counts[finding.level] += 1;
  return counts;
}
